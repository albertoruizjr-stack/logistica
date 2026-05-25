import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { isCitelConfigured, fetchPedidoCabecalho } from "@/services/citel.service";
import { fetchOrderItemsFromCitel, enrichDeliveryItemsWithStock } from "@/services/citel-stock.service";
import {
  headerCache, itemsCache, stockCache,
  headerKey, itemsKey, stockKey,
} from "@/services/citel-cache.service";
import type { CitelEndereco, DeliveryAddressSource } from "@/types/stock";
import { classifyOrderStatus, BLOCKED_MESSAGES, formatEndereco } from "@/lib/erp-order-status";

function enderecosDiferentes(a: CitelEndereco, b: CitelEndereco | null): boolean {
  if (!b) return false;
  return formatEndereco(a).toLowerCase().trim() !== formatEndereco(b).toLowerCase().trim();
}

// ─── Route Handler ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const t0 = Date.now();

  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);
    const number    = searchParams.get("number")?.trim();
    const storeCode = searchParams.get("storeCode")?.trim();
    const noCache   = searchParams.get("nocache") === "1";

    if (!number || !storeCode) {
      return NextResponse.json(
        apiError("Informe o número do pedido e o código da loja", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    if (!isCitelConfigured()) {
      console.warn(`[erp/pedido] CITEL_NOT_CONFIGURED user=${session.userId}`);
      return NextResponse.json(
        apiError("Citel não configurado — contate o suporte técnico", "CITEL_DOWN"),
        { status: 503 }
      );
    }

    // Busca codigoEmpresaCitel da loja para queries de estoque
    const store = await prisma.store.findFirst({
      where: { code: storeCode, active: true },
      select: { codigoEmpresaCitel: true },
    });
    const codigoEmpresaCitel = store?.codigoEmpresaCitel ?? storeCode;

    // ─── Cache lookup (apenas header e items neste ponto) ─────────────
    // O cache de estoque depende da empresa real (que varia se for entrega CD),
    // então só pode ser consultado depois de termos o cabecalho.
    const hKey = headerKey(number, storeCode);
    const iKey = itemsKey(number, storeCode);

    const cachedHeader = noCache ? null : headerCache.get(hKey);
    const cachedItems  = noCache ? null : itemsCache.get(iKey);

    let cabecalho   = cachedHeader?.data ?? null;
    let pedidoItems = cachedItems?.data  ?? null;

    // ─── Fetch: cabeçalho + itens em paralelo ─────────────────────────
    if (!cabecalho || !pedidoItems) {
      const [fetchedCab, fetchedItems] = await Promise.all([
        cabecalho    ? Promise.resolve(cabecalho)    : fetchPedidoCabecalho(number, storeCode),
        pedidoItems  ? Promise.resolve(pedidoItems)  : fetchOrderItemsFromCitel(number, storeCode),
      ]);

      if (!fetchedCab) {
        console.log(`[erp/pedido] NOT_FOUND order=${number} store=${storeCode} ms=${Date.now() - t0}`);
        return NextResponse.json(
          apiError(`Pedido ${number} não encontrado na Citel para a loja ${storeCode}`, "NOT_FOUND"),
          { status: 404 }
        );
      }

      cabecalho   = fetchedCab;
      pedidoItems = fetchedItems;
      headerCache.set(hKey, cabecalho);
      if (pedidoItems) itemsCache.set(iKey, pedidoItems);
    }

    // ─── Validação de status ───────────────────────────────────────────
    const erpValidationStatus = classifyOrderStatus(cabecalho.status);

    if (erpValidationStatus !== "VALID") {
      console.log(
        `[erp/pedido] BLOCKED order=${number} status=${cabecalho.status} validation=${erpValidationStatus} ms=${Date.now() - t0}`
      );
      return NextResponse.json(
        apiError(
          BLOCKED_MESSAGES[erpValidationStatus] ?? "Pedido em status inválido para entrega.",
          erpValidationStatus,
          { rawStatus: cabecalho.status }
        ),
        { status: 422 }
      );
    }

    // ─── Detecta entrega CD ───────────────────────────────────────────
    // Quando entregaPeloCD=true, o estoque relevante está no CD (codigoEmpresaCD),
    // não na loja origem do PD. Mantemos o mesmo critério aqui e na criação para
    // garantir que o badge "Disponível" do preview reflita a realidade.
    const isEntregaCD       = Boolean(cabecalho.entregaPeloCD && cabecalho.codigoEmpresaCD);
    const empresaConsultada = isEntregaCD ? cabecalho.codigoEmpresaCD! : codigoEmpresaCitel;
    if (isEntregaCD) {
      console.log(`[erp/pedido] PD ${number} é entrega CD — consultando estoque na empresa ${empresaConsultada}`);
    }

    // ─── Estoque: cache indexado pela empresa REAL consultada ─────────
    const sKey       = stockKey(number, storeCode, empresaConsultada);
    const cachedStock = noCache ? null : stockCache.get(sKey);
    let enriched     = cachedStock?.data ?? null;
    const cacheHit   = !!(cachedHeader && cachedItems && cachedStock);

    if (!enriched && pedidoItems && pedidoItems.length > 0) {
      enriched = await enrichDeliveryItemsWithStock(pedidoItems, empresaConsultada);
      stockCache.set(sKey, enriched);
    }

    const items = enriched ?? [];

    // ─── Endereços ─────────────────────────────────────────────────────
    const hasDeliveryAddr = cabecalho.deliveryAddress !== null;
    const deliveryAddressSource: DeliveryAddressSource = hasDeliveryAddr
      ? "ORDER_DELIVERY_ADDRESS"
      : "CUSTOMER_MAIN_ADDRESS";

    const effectiveDelivery = cabecalho.deliveryAddress ?? cabecalho.customerAddress;
    const isAlternateDelivery = enderecosDiferentes(
      cabecalho.customerAddress,
      cabecalho.deliveryAddress
    );

    const customerAddressStr = formatEndereco(cabecalho.customerAddress);
    const deliveryAddressStr  = formatEndereco(effectiveDelivery);

    // ─── Agregados ─────────────────────────────────────────────────────
    const totalWeightKg = items.reduce((s, i) => s + (i.totalWeight ?? 0), 0);
    const stockSummary = {
      available: items.filter(i => i.stockStatus === "AVAILABLE").length,
      reserved:  items.filter(i => i.stockStatus === "RESERVED_ELSEWHERE").length,
      missing:   items.filter(i => ["UNAVAILABLE", "ZERO_STOCK"].includes(i.stockStatus)).length,
      unknown:   items.filter(i => i.stockStatus === "CITEL_DOWN").length,
    };

    const fetchedInMs = Date.now() - t0;
    console.log(
      `[erp/pedido] OK order=${number} store=${storeCode} items=${items.length} ` +
      `addrSource=${deliveryAddressSource} alternate=${isAlternateDelivery} ` +
      `cache=${cacheHit} ms=${fetchedInMs}`
    );

    return NextResponse.json(apiSuccess({
      numeroPedido:         cabecalho.numeroPedido,
      erpOrderStatus:       cabecalho.status,
      erpValidationStatus,
      // Dados do cliente
      customerName:         cabecalho.nomeCliente,
      customerPhone:        cabecalho.telefone ?? cabecalho.celular ?? "",
      customerDocument:     cabecalho.documento,
      // Endereços separados
      customerAddressObj:   cabecalho.customerAddress,
      customerAddressStr,
      deliveryAddressObj:   effectiveDelivery,
      deliveryAddressStr,
      deliveryAddressSource,
      isAlternateDelivery,
      // Financeiro / físico
      totalValue:           cabecalho.valorTotal,
      // peso/itens preferem os valores enriquecidos; caem para o cabeçalho do Citel
      // se o enriquecimento de itens não rodou (ex: Citel responde cabeçalho mas falha em /produto)
      totalWeightKg:        items.length > 0
                              ? Math.round(totalWeightKg * 10) / 10
                              : (cabecalho.pesoBrutoTotal ?? 0),
      itemCount:            items.length || cabecalho.quantidadeItens,
      stockSummary,
      items,
      // Entrega CD — quando true, o estoque foi conferido no CD (não na loja origem do PD)
      isEntregaCD,
      codigoEmpresaCD:      cabecalho.codigoEmpresaCD,
      empresaConsultada,
      // Observabilidade
      cacheHit,
      fetchedInMs,
    }));
  } catch (error) {
    console.error("[GET /api/erp/pedido]", error);
    return NextResponse.json(apiError("Erro ao consultar Citel"), { status: 500 });
  }
}
