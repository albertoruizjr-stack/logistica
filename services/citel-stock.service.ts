// services/citel-stock.service.ts
// Integração completa com o estoque Citel para solicitações de entrega.
//
// Responsabilidades:
//   - Buscar itens reais do PD na Citel
//   - Enriquecer cada item com peso, barcode, marca e saldo real
//   - Classificar disponibilidade de estoque por item
//   - Validar capacidade do veículo (moto/fiorino/caminhão)
//   - Calcular peso e volume total da entrega

import {
  fetchEstoqueCitelBatch,
  fetchProdutoDetalhe,
  fetchPedidoItens,
  fetchPedidoCabecalho,
  getSaldoForEmpresa,
  isCitelConfigured,
} from "@/services/citel.service";
import { prisma } from "@/lib/prisma";
import type {
  CitelPedidoItem,
  EnrichedDeliveryItem,
  StockItemStatus,
  VehicleCapacityResult,
  VehicleType,
  StockValidationStatus,
} from "@/types/stock";

// ──────────────────────────────────────────────
// CAPACIDADE POR TIPO DE VEÍCULO
// ──────────────────────────────────────────────

export const VEHICLE_CAPACITY: Record<VehicleType, { maxWeightKg: number; maxLatas: number }> = {
  MOTO:     { maxWeightKg: 30,   maxLatas: 0    }, // bloqueada para lata/balde/galão
  FIORINO:  { maxWeightKg: 500,  maxLatas: 20   },
  VAN:      { maxWeightKg: 800,  maxLatas: 40   },
  CARRO:    { maxWeightKg: 200,  maxLatas: 10   },
  CAMINHAO: { maxWeightKg: 1650, maxLatas: 9999 },
};

// Unidades que representam volume pesado (lata/balde/galão)
const HEAVY_UNITS = new Set(["BD", "GL", "LT", "BAL", "LAT", "GAL"]);

export function isHeavyUnit(unit: string): boolean {
  return HEAVY_UNITS.has(unit.toUpperCase().trim());
}

// Peso padrão por unidade quando Citel não informa pesoBruto
const WEIGHT_FALLBACK_KG: Record<string, number> = {
  BD: 30,   // balde 18L ~30kg
  GL: 28,   // galão 18L ~28kg
  LT: 5,    // lata 3.6L ~5kg
  UN: 1,    // unidade genérica — melhor que 0
};
const WEIGHT_FALLBACK_DEFAULT_KG = 1;

// ──────────────────────────────────────────────
// FETCH DE ITENS DO PEDIDO (PD)
// Usa endpoint de itens do Citel (/pedidovenda/{numero}/itens/{empresa})
// com fallback para dados parciais do endpoint de faturamento.
// ──────────────────────────────────────────────

export async function fetchOrderItemsFromCitel(
  orderNumber: string,
  storeCode: string
): Promise<CitelPedidoItem[] | null> {
  if (!isCitelConfigured()) return null;

  // Busca itens com quantidade do endpoint dedicado
  const rawItems = await fetchPedidoItens(orderNumber, storeCode);
  if (!rawItems || rawItems.length === 0) return null;

  // Para cada item, busca detalhe de produto em paralelo
  const detalhes = await Promise.allSettled(
    rawItems.map((item) => fetchProdutoDetalhe(item.codigo))
  );

  return rawItems.map((item, idx) => {
    const detalhe = detalhes[idx].status === "fulfilled" ? detalhes[idx].value : null;
    const unit    = detalhe?.unidade ?? item.unidade ?? "UN";

    // ⚠️ pesoBruto da Citel: convenções diferentes por fonte
    // - item.pesoBruto (campo pesoBruto do PD): é o peso TOTAL da linha (já × quantidade).
    //   Ex: lixa 0.02 kg × 50 unidades → Citel devolve pesoBruto=1.0 (não 0.02).
    // - detalhe.pesoBruto (cadastro do produto): é o peso UNITÁRIO.
    let totalWeight: number;
    let pesoUnitario: number | null;
    let usingFallback = false;

    if (item.pesoBruto != null) {
      totalWeight  = item.pesoBruto;
      pesoUnitario = item.quantidade > 0 ? item.pesoBruto / item.quantidade : null;
    } else if (detalhe?.pesoBruto != null) {
      pesoUnitario = detalhe.pesoBruto;
      totalWeight  = item.quantidade * detalhe.pesoBruto;
    } else {
      const fallback = WEIGHT_FALLBACK_KG[unit.toUpperCase()] ?? WEIGHT_FALLBACK_DEFAULT_KG;
      pesoUnitario = null; // peso real ausente — marca hasMissingWeight
      totalWeight  = item.quantidade * fallback;
      usingFallback = true;
      console.warn(
        `[citel-stock] peso bruto ausente · order=${orderNumber} sku=${item.codigo} unit=${unit} ` +
        `→ usando fallback ${fallback}kg/un`,
      );
    }

    const peso = pesoUnitario;

    return {
      codigo:           item.codigo,
      descricao:        detalhe?.descricao ?? item.descricao,
      marca:            detalhe?.marca ?? null,
      quantidade:       item.quantidade,
      unidade:          unit,
      codigoBarra:      detalhe?.codigoBarra ?? null,
      pesoBruto:        peso,
      totalWeight,
      hasMissingWeight: usingFallback,
    };
  });
}

// ──────────────────────────────────────────────
// ENRIQUECIMENTO COM SALDO
// Adiciona saldoDisponivel e saldoFisico para cada item
// numa única chamada batch ao Citel.
// ──────────────────────────────────────────────

export async function enrichDeliveryItemsWithStock(
  items: CitelPedidoItem[],
  codigoEmpresaCitel: string
): Promise<EnrichedDeliveryItem[]> {
  const codes = [...new Set(items.map((i) => i.codigo))];

  // Batch — uma única chamada para todos os SKUs
  const estoques = await fetchEstoqueCitelBatch(codes, [codigoEmpresaCitel]);
  const stockMap = new Map(estoques.map((e) => [e.codigoProduto, e]));

  return items.map((item) => {
    const produto = stockMap.get(item.codigo);
    const saldo   = produto ? getSaldoForEmpresa(produto, codigoEmpresaCitel) : null;

    const availableStock = saldo?.saldoDisponivel ?? 0;
    const physicalStock  = saldo?.saldoFisico     ?? 0;
    const citelDown      = produto === undefined;

    const stockStatus = classifyStockStatus(
      availableStock,
      physicalStock,
      item.quantidade,
      citelDown
    );

    return {
      productCode:      item.codigo,
      description:      item.descricao,
      brand:            item.marca,
      quantity:         item.quantidade,
      unit:             item.unidade,
      barcode:          item.codigoBarra,
      grossWeight:      item.pesoBruto,
      totalWeight:      item.totalWeight,
      hasMissingWeight: item.hasMissingWeight,
      availableStock,
      physicalStock,
      daysWithoutSale:  null, // retornado apenas em fetchProdutoDetalhe, não no batch de estoque
      turnoverClass:    null,
      stockStatus,
      availableAtStore: stockStatus === "AVAILABLE",
      sourceStoreId:    null,
    };
  });
}

// ──────────────────────────────────────────────
// CLASSIFICAÇÃO DE ESTOQUE POR ITEM
// ──────────────────────────────────────────────

function classifyStockStatus(
  disponivel: number,
  fisico: number,
  solicitado: number,
  citelDown: boolean
): StockItemStatus {
  if (citelDown) return "CITEL_DOWN";
  if (disponivel === 0) return "ZERO_STOCK";
  if (disponivel >= solicitado) return "AVAILABLE";
  if (fisico >= solicitado) return "RESERVED_ELSEWHERE";
  return "UNAVAILABLE";
}

// ──────────────────────────────────────────────
// VALIDAÇÃO DE DISPONIBILIDADE
// Retorna status consolidado para a solicitação.
// ──────────────────────────────────────────────

export function validateStockAvailability(
  items: EnrichedDeliveryItem[]
): StockValidationStatus {
  if (items.length === 0) return "PENDING";

  const allDown = items.every((i) => i.stockStatus === "CITEL_DOWN");
  if (allDown) return "CITEL_DOWN";

  const anyDown = items.some((i) => i.stockStatus === "CITEL_DOWN");
  const anyUnavailable = items.some(
    (i) => i.stockStatus === "UNAVAILABLE" || i.stockStatus === "ZERO_STOCK"
  );
  const anyReserved = items.some((i) => i.stockStatus === "RESERVED_ELSEWHERE");

  if (anyUnavailable) return "UNAVAILABLE";
  if (anyDown || anyReserved) return "PARTIAL";
  return "VALIDATED";
}

// ──────────────────────────────────────────────
// CÁLCULO DE PESO TOTAL
// ──────────────────────────────────────────────

export function calculateDeliveryWeight(items: EnrichedDeliveryItem[]): {
  totalWeightKg: number;
  hasMissingWeights: boolean;
  missingWeightCodes: string[];
} {
  let totalWeightKg = 0;
  const missingWeightCodes: string[] = [];

  for (const item of items) {
    totalWeightKg += item.totalWeight;
    if (item.hasMissingWeight) missingWeightCodes.push(item.productCode);
  }

  return {
    totalWeightKg,
    hasMissingWeights: missingWeightCodes.length > 0,
    missingWeightCodes,
  };
}

// ──────────────────────────────────────────────
// CÁLCULO DE REGRAS DE VOLUME
// ──────────────────────────────────────────────

export function calculateDeliveryVolumeRules(items: EnrichedDeliveryItem[]): {
  totalLatas: number;
  hasHeavyUnit: boolean;
  heavyItems: string[];
} {
  let totalLatas = 0;
  const heavyItems: string[] = [];

  for (const item of items) {
    if (isHeavyUnit(item.unit)) {
      totalLatas += item.quantity;
      heavyItems.push(item.productCode);
    }
  }

  return {
    totalLatas,
    hasHeavyUnit: heavyItems.length > 0,
    heavyItems,
  };
}

// ──────────────────────────────────────────────
// VALIDAÇÃO DE CAPACIDADE DO VEÍCULO
// ──────────────────────────────────────────────

export function validateVehicleCapacity(
  totalWeightKg: number,
  totalLatas: number,
  hasHeavyUnit: boolean,
  vehicleType: VehicleType
): VehicleCapacityResult {
  const cap = VEHICLE_CAPACITY[vehicleType];

  const exceedsWeight = totalWeightKg > cap.maxWeightKg;
  const exceedsLatas  = totalLatas > cap.maxLatas;
  // Moto não pode carregar lata/balde/galão grande
  const blockedByUnit = vehicleType === "MOTO" && hasHeavyUnit;

  const allowed = !exceedsWeight && !exceedsLatas && !blockedByUnit;

  let blockedReason: string | null = null;
  let suggestedModal: VehicleType | null = null;

  if (blockedByUnit) {
    blockedReason  = `Moto não pode transportar latas/baldes/galões. Itens pesados detectados.`;
    suggestedModal = totalWeightKg <= VEHICLE_CAPACITY.FIORINO.maxWeightKg ? "FIORINO" : "CAMINHAO";
  } else if (exceedsWeight && exceedsLatas) {
    blockedReason  = `Peso (${totalWeightKg.toFixed(1)} kg) e volume (${totalLatas} latas) excedem capacidade de ${vehicleType}.`;
    suggestedModal = suggestNextVehicle(vehicleType, totalWeightKg, totalLatas);
  } else if (exceedsWeight) {
    blockedReason  = `Peso total (${totalWeightKg.toFixed(1)} kg) excede limite de ${cap.maxWeightKg} kg para ${vehicleType}.`;
    suggestedModal = suggestNextVehicle(vehicleType, totalWeightKg, totalLatas);
  } else if (exceedsLatas) {
    blockedReason  = `Volume (${totalLatas} latas/baldes) excede limite de ${cap.maxLatas} para ${vehicleType}.`;
    suggestedModal = suggestNextVehicle(vehicleType, totalWeightKg, totalLatas);
  }

  return { allowed, blockedReason, suggestedModal, totalWeightKg, totalLatas, exceedsWeight, exceedsLatas, hasHeavyUnit };
}

function suggestNextVehicle(
  current: VehicleType,
  weightKg: number,
  latas: number
): VehicleType | null {
  const order: VehicleType[] = ["MOTO", "CARRO", "FIORINO", "VAN", "CAMINHAO"];
  const candidates = order.filter((v) => {
    const cap = VEHICLE_CAPACITY[v];
    return cap.maxWeightKg >= weightKg && cap.maxLatas >= latas;
  });
  // retorna o menor veículo que comporta — excluindo o atual
  return candidates.find((v) => v !== current) ?? null;
}

// ──────────────────────────────────────────────
// FUNÇÃO PRINCIPAL — enriquece uma solicitação
// Chamada na criação da DeliveryRequest.
// ──────────────────────────────────────────────

export interface DeliveryStockResult {
  items:                 EnrichedDeliveryItem[];
  totalWeightKg:         number;
  totalLatas:            number;
  hasHeavyUnit:          boolean;
  hasMissingWeights:     boolean;
  missingWeightCodes:    string[];
  stockValidationStatus: StockValidationStatus;
  citelAvailable:        boolean;
  /** true quando o PD foi marcado como entrega CD no Autcom — estoque foi conferido no CD */
  isEntregaCD:           boolean;
  /** Empresa Citel que efetivamente foi usada para conferir estoque (CD se entregaCD, senão a loja origem) */
  empresaConsultada:     string;
}

export async function enrichDeliveryRequestStock(
  orderNumber: string,
  storeCode:   string,
  codigoEmpresaCitel: string
): Promise<DeliveryStockResult | null> {
  if (!isCitelConfigured()) return null;

  // 1. Busca cabeçalho pra detectar entrega CD
  const cabecalho = await fetchPedidoCabecalho(orderNumber, storeCode);

  // 2. Busca itens do pedido com detalhes de produto
  const pedidoItems = await fetchOrderItemsFromCitel(orderNumber, storeCode);
  if (!pedidoItems || pedidoItems.length === 0) return null;

  // 3. Decide qual empresa Citel usar para o estoque:
  //    - Se entregaPeloCD=true → usar codigoEmpresaCD (ex: "132" Vila Andrade/CD)
  //    - Senão → usar a loja origem do PD
  const isEntregaCD     = Boolean(cabecalho?.entregaPeloCD && cabecalho.codigoEmpresaCD);
  const empresaEstoque  = isEntregaCD ? cabecalho!.codigoEmpresaCD! : codigoEmpresaCitel;
  if (isEntregaCD) {
    console.log(`[CitelStock] PD ${orderNumber} é entrega CD — consultando estoque na empresa ${empresaEstoque} (loja origem do PD: ${codigoEmpresaCitel})`);
  }

  // 4. Enriquece com saldo disponível e físico (usa a empresa decidida acima)
  const enrichedItems = await enrichDeliveryItemsWithStock(pedidoItems, empresaEstoque);

  // 3. Calcula totais
  const { totalWeightKg, hasMissingWeights, missingWeightCodes } = calculateDeliveryWeight(enrichedItems);
  const { totalLatas, hasHeavyUnit } = calculateDeliveryVolumeRules(enrichedItems);

  // 4. Status consolidado
  const stockValidationStatus = validateStockAvailability(enrichedItems);

  // 5. Loga alerta se houver pesos ausentes
  if (hasMissingWeights) {
    console.warn(
      `[CitelStock] Peso bruto ausente para ${missingWeightCodes.length} produto(s) no pedido ${orderNumber}: ${missingWeightCodes.join(", ")}. Usando fallback.`
    );
  }

  return {
    items:                 enrichedItems,
    totalWeightKg,
    totalLatas,
    hasHeavyUnit,
    hasMissingWeights,
    missingWeightCodes,
    stockValidationStatus,
    isEntregaCD,
    empresaConsultada:     empresaEstoque,
    citelAvailable:        true,
  };
}

// ──────────────────────────────────────────────
// CONSULTA DE ESTOQUE DE UM PRODUTO ESPECÍFICO
// Usado para verificar saldo antes de despacho/separação
// ──────────────────────────────────────────────

export async function fetchProductStockFromCitel(
  productCode: string,
  codigoEmpresaCitel: string
): Promise<{ disponivel: number; fisico: number; status: StockItemStatus } | null> {
  if (!isCitelConfigured()) return null;

  const [estoques, detalhe] = await Promise.all([
    fetchEstoqueCitelBatch([productCode], [codigoEmpresaCitel]),
    fetchProdutoDetalhe(productCode),
  ]);

  const produto = estoques[0];
  if (!produto) return null;

  const saldo = getSaldoForEmpresa(produto, codigoEmpresaCitel);
  if (!saldo) return null;

  const status = classifyStockStatus(
    saldo.saldoDisponivel,
    saldo.saldoFisico,
    0, // sem quantidade solicitada — apenas retorna os saldos
    false
  );

  void detalhe; // disponível para uso futuro se necessário

  return {
    disponivel: saldo.saldoDisponivel,
    fisico:     saldo.saldoFisico,
    status,
  };
}
