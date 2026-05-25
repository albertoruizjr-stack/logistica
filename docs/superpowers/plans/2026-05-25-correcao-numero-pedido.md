# Correção do número do pedido (PD) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir corrigir o número do pedido (PD) de uma solicitação PENDENTE, re-buscando todos os dados do pedido correto no Citel e substituindo-os, com preview de conferência e auditoria.

**Architecture:** Um helper compartilhado classifica o status do pedido; um service puro/testável (`corrigir-pedido.service.ts`) re-busca cabeçalho + itens + estoque do Citel, valida, e — fora de dryRun — atualiza a solicitação e seus itens numa transação. Um endpoint PATCH com `dryRun` serve tanto o preview quanto a aplicação. Na UI, um lápis (✏️) no card PENDENTE abre um modal que faz preview e confirma.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma, Vitest, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-25-correcao-numero-pedido-design.md`

---

## File Structure

- **Create** `lib/erp-order-status.ts` — `classifyOrderStatus`, `BLOCKED_MESSAGES`, `formatEndereco` (extraídos de `app/api/erp/pedido/route.ts`).
- **Modify** `app/api/erp/pedido/route.ts` — importar do helper em vez de definir local.
- **Create** `services/corrigir-pedido.service.ts` — lógica de correção (re-busca, valida, aplica/dry-run).
- **Create** `app/api/solicitacoes/[id]/corrigir-pedido/route.ts` — endpoint PATCH.
- **Modify** `components/operacao/types.ts` — `sellerId` no `OperationalCard`.
- **Modify** o serviço/rota que monta os cards da workqueue — incluir `sellerId`.
- **Create** `components/operacao/CorrigirPedidoModal.tsx` — modal de preview + confirmação.
- **Modify** `components/operacao/DeliveryCard.tsx` — ✏️ no cabeçalho.
- **Modify** `components/operacao/WorkQueueColumn.tsx` — repassar props novas.
- **Modify** `app/(app)/operacao/OperacaoClient.tsx` — estado do modal + permissão.
- **Modify** `app/(app)/operacao/page.tsx` — passar `currentUserRole`.

---

## Task 1: Helper compartilhado de status do pedido (TDD)

**Files:**
- Create: `lib/erp-order-status.ts`
- Test: `tests/lib/erp-order-status.test.ts`
- Modify: `app/api/erp/pedido/route.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/erp-order-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyOrderStatus, BLOCKED_MESSAGES } from "@/lib/erp-order-status";

describe("classifyOrderStatus", () => {
  it("status nulo → VALID", () => {
    expect(classifyOrderStatus(null)).toBe("VALID");
  });
  it("cancelado (qualquer variação) → CANCELLED", () => {
    expect(classifyOrderStatus("CANCELADO")).toBe("CANCELLED");
    expect(classifyOrderStatus("Pedido em cancelamento")).toBe("CANCELLED");
  });
  it("bloqueado → BLOCKED", () => {
    expect(classifyOrderStatus("BLOQUEADO")).toBe("BLOCKED");
  });
  it("aguardando aprovação/liberação → APPROVAL_PENDING", () => {
    expect(classifyOrderStatus("AGUARDANDO APROVACAO")).toBe("APPROVAL_PENDING");
    expect(classifyOrderStatus("aguardando liberacao")).toBe("APPROVAL_PENDING");
  });
  it("faturado/encerrado → ALREADY_FULFILLED", () => {
    expect(classifyOrderStatus("FATURADO")).toBe("ALREADY_FULFILLED");
    expect(classifyOrderStatus("NF EMITIDA")).toBe("ALREADY_FULFILLED");
  });
  it("status comum → VALID", () => {
    expect(classifyOrderStatus("APROVADO")).toBe("VALID");
  });
  it("BLOCKED_MESSAGES cobre cada status não-VALID", () => {
    for (const k of ["CANCELLED", "BLOCKED", "APPROVAL_PENDING", "ALREADY_FULFILLED"]) {
      expect(typeof BLOCKED_MESSAGES[k]).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/erp-order-status.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp-order-status"`.

- [ ] **Step 3: Create the helper**

Create `lib/erp-order-status.ts` (conteúdo movido de `app/api/erp/pedido/route.ts`):

```ts
// Classificação do status bruto de um pedido (Autcom/Citel) + mensagens de bloqueio
// e formatação de endereço. Compartilhado entre o endpoint de consulta e a correção.
import type { ERPOrderValidationStatus, CitelEndereco } from "@/types/stock";

const STATUS_RULES: Array<{ pattern: RegExp; result: ERPOrderValidationStatus }> = [
  { pattern: /CANCEL/i,                        result: "CANCELLED"         },
  { pattern: /BLOQ/i,                          result: "BLOCKED"           },
  { pattern: /AGUARDANDO.*(APRO|LIBERA)/i,     result: "APPROVAL_PENDING"  },
  { pattern: /FATURA|NF.EMIT|ENCERR|CONCLU/i,  result: "ALREADY_FULFILLED" },
];

export const BLOCKED_MESSAGES: Record<string, string> = {
  CANCELLED:         "Pedido cancelado — não é possível criar entrega para pedidos cancelados.",
  BLOCKED:           "Pedido bloqueado — entre em contato com a equipe de crédito antes de prosseguir.",
  APPROVAL_PENDING:  "Pedido aguardando aprovação — não pode ser despachado até aprovação do comercial.",
  ALREADY_FULFILLED: "Pedido já faturado ou encerrado — a NF já foi emitida para este pedido.",
};

export function classifyOrderStatus(rawStatus: string | null): ERPOrderValidationStatus {
  if (!rawStatus) return "VALID";
  for (const { pattern, result } of STATUS_RULES) {
    if (pattern.test(rawStatus)) return result;
  }
  return "VALID";
}

export function formatEndereco(e: CitelEndereco): string {
  return [e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.estado]
    .filter(Boolean)
    .join(", ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/erp-order-status.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Update `app/api/erp/pedido/route.ts` to import from the helper**

Remova de `route.ts` as definições locais de `STATUS_RULES`, `BLOCKED_MESSAGES`, `classifyOrderStatus` e `formatEndereco` (linhas ~15-45). No topo, adicione o import:

```ts
import { classifyOrderStatus, BLOCKED_MESSAGES, formatEndereco } from "@/lib/erp-order-status";
```

Mantenha a função local `enderecosDiferentes` (ela usa `formatEndereco` importado). Confirme que o resto do arquivo (`classifyOrderStatus(...)`, `BLOCKED_MESSAGES[...]`, `formatEndereco(...)`) continua compilando.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npx vitest run tests/lib/erp-order-status.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/erp-order-status.ts tests/lib/erp-order-status.test.ts "app/api/erp/pedido/route.ts"
git commit -m "refactor(erp): extrai classificacao de status do pedido p/ lib compartilhada

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Service de correção (TDD)

**Files:**
- Create: `services/corrigir-pedido.service.ts`
- Test: `tests/services/corrigir-pedido.test.ts`

Tipos de referência (já existem no projeto):
- `CitelPedidoCabecalho` (`types/stock.ts`): `nomeCliente`, `documento`, `telefone`, `celular`, `customerAddress: CitelEndereco`, `deliveryAddress: CitelEndereco | null`, `status`, `entregaPeloCD`, `codigoEmpresaCD`.
- `DeliveryStockResult` (`services/citel-stock.service.ts`): `items`, `totalWeightKg`, `totalLatas`, `volumeBreakdown`, `hasMissingWeights`, `stockValidationStatus`, `isEntregaCD`.
- `geocodeAddress(address): Promise<StructuredAddress | null>` (`lib/google-maps.ts`) — `StructuredAddress` tem `city`, `state`, `lat`, `lng`.

- [ ] **Step 1: Write the failing test**

Create `tests/services/corrigir-pedido.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks dos módulos externos antes de importar o service.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    deliveryRequest: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    deliveryItem:    { deleteMany: vi.fn(), createMany: vi.fn() },
    deliveryStatusHistory: { create: vi.fn() },
    store:           { findFirst: vi.fn() },
    $transaction:    vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      deliveryRequest: { update: vi.fn() },
      deliveryItem:    { deleteMany: vi.fn(), createMany: vi.fn() },
      deliveryStatusHistory: { create: vi.fn() },
    })),
  },
}));
vi.mock("@/services/citel.service", () => ({
  isCitelConfigured: vi.fn(() => true),
  fetchPedidoCabecalho: vi.fn(),
}));
vi.mock("@/services/citel-stock.service", () => ({
  enrichDeliveryRequestStock: vi.fn(),
}));
vi.mock("@/lib/google-maps", () => ({
  geocodeAddress: vi.fn(async () => ({ city: "São Paulo", state: "SP", lat: -23.5, lng: -46.6 })),
}));

import { corrigirPedido } from "@/services/corrigir-pedido.service";
import { prisma } from "@/lib/prisma";
import { fetchPedidoCabecalho } from "@/services/citel.service";
import { enrichDeliveryRequestStock } from "@/services/citel-stock.service";

const DR_BASE = {
  id: "dr1", orderNumber: "11633", orderStoreId: "s1", storeId: "s1", sellerId: "u1",
  status: "PENDING",
  orderStore: { code: "067", codigoEmpresaCitel: "067" },
};
const CABECALHO_OK = {
  nomeCliente: "JOÃO DA SILVA", documento: "123", telefone: "11999", celular: null,
  customerAddress: { logradouro: "Rua A", numero: "1", cidade: "São Paulo", estado: "SP" },
  deliveryAddress: { logradouro: "Rua B", numero: "2", cidade: "São Paulo", estado: "SP" },
  status: "APROVADO", entregaPeloCD: false, codigoEmpresaCD: null,
};
const ENRICH_OK = {
  items: [{ productCode: "P1", description: "Tinta", quantity: 2, unit: "GL", brand: "X",
            barcode: "1", grossWeight: 5, totalWeight: 10, hasMissingWeight: false,
            availableStock: 5, physicalStock: 5, stockStatus: "AVAILABLE", availableAtStore: true,
            sourceStoreId: null }],
  totalWeightKg: 10, totalLatas: 2, volumeBreakdown: { GL: 2 }, hasMissingWeights: false,
  stockValidationStatus: "VALIDATED", isEntregaCD: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.deliveryRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...DR_BASE });
  (prisma.deliveryRequest.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null); // sem duplicata
  (fetchPedidoCabecalho as ReturnType<typeof vi.fn>).mockResolvedValue({ ...CABECALHO_OK });
  (enrichDeliveryRequestStock as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ENRICH_OK });
});

describe("corrigirPedido", () => {
  it("dryRun retorna preview sem persistir", async () => {
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.preview?.customerName).toBe("JOÃO DA SILVA");
    expect(r.preview?.itemCount).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("aplica: chama transação e grava marcador", async () => {
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("status != PENDING → NOT_PENDING", async () => {
    (prisma.deliveryRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...DR_BASE, status: "SEPARADO" });
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("NOT_PENDING");
  });

  it("número igual ao atual → SAME_NUMBER", async () => {
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "11633", actorId: "u1", dryRun: false });
    expect(r.error).toBe("SAME_NUMBER");
  });

  it("já existe solicitação ativa com o novo número → DUPLICATE", async () => {
    (prisma.deliveryRequest.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dr2" });
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("DUPLICATE");
  });

  it("pedido cancelado → ORDER_BLOCKED", async () => {
    (fetchPedidoCabecalho as ReturnType<typeof vi.fn>).mockResolvedValue({ ...CABECALHO_OK, status: "CANCELADO" });
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("ORDER_BLOCKED");
  });

  it("pedido inexistente → NOT_FOUND", async () => {
    (fetchPedidoCabecalho as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("NOT_FOUND");
  });

  it("sem itens no Citel → NO_ITEMS", async () => {
    (enrichDeliveryRequestStock as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("NO_ITEMS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/corrigir-pedido.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/corrigir-pedido.service"`.

- [ ] **Step 3: Write the service**

Create `services/corrigir-pedido.service.ts`:

```ts
// Corrige o número do pedido (PD) de uma solicitação PENDENTE, re-buscando os dados
// do pedido correto no Citel. Em dryRun retorna só o preview; senão aplica numa transação.
import { prisma } from "@/lib/prisma";
import { isCitelConfigured, fetchPedidoCabecalho } from "@/services/citel.service";
import { enrichDeliveryRequestStock } from "@/services/citel-stock.service";
import { geocodeAddress } from "@/lib/google-maps";
import { classifyOrderStatus, BLOCKED_MESSAGES, formatEndereco } from "@/lib/erp-order-status";
import type { Prisma } from "@prisma/client";

export type CorrigirPedidoError =
  | "NOT_FOUND" | "NOT_PENDING" | "SAME_NUMBER" | "DUPLICATE"
  | "CITEL_DOWN" | "ORDER_BLOCKED" | "NO_ITEMS";

export interface CorrigirPedidoPreview {
  orderNumber:     string;
  customerName:    string;
  customerDoc:     string | null;
  deliveryAddress: string;
  itemCount:       number;
  totalWeightKg:   number;
  isEntregaCD:     boolean;
}

export interface CorrigirPedidoResult {
  ok:       boolean;
  error?:   CorrigirPedidoError;
  message?: string;
  preview?: CorrigirPedidoPreview;
}

export async function corrigirPedido(input: {
  requestId:      string;
  newOrderNumber: string;
  actorId:        string;
  dryRun:         boolean;
}): Promise<CorrigirPedidoResult> {
  const { requestId, newOrderNumber, actorId, dryRun } = input;

  const dr = await prisma.deliveryRequest.findUnique({
    where:   { id: requestId },
    include: { orderStore: { select: { code: true, codigoEmpresaCitel: true } } },
  });
  if (!dr) return { ok: false, error: "NOT_FOUND", message: "Solicitação não encontrada." };
  if (dr.status !== "PENDING")
    return { ok: false, error: "NOT_PENDING", message: "Só é possível corrigir pedidos pendentes." };
  if (newOrderNumber === dr.orderNumber)
    return { ok: false, error: "SAME_NUMBER", message: "O número informado é o mesmo já cadastrado." };

  // Duplicata: outra solicitação ativa com o novo número na mesma loja do pedido.
  const dup = await prisma.deliveryRequest.findFirst({
    where: {
      orderNumber:  newOrderNumber,
      orderStoreId: dr.orderStoreId ?? undefined,
      status:       { not: "CANCELLED" },
      id:           { not: requestId },
    },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "DUPLICATE", message: "Já existe uma solicitação ativa para este pedido." };

  if (!isCitelConfigured())
    return { ok: false, error: "CITEL_DOWN", message: "Citel indisponível — tente novamente em instantes." };

  const storeCode = dr.orderStore?.code ?? "";
  const codigoEmpresaCitel = dr.orderStore?.codigoEmpresaCitel ?? storeCode;

  const cabecalho = await fetchPedidoCabecalho(newOrderNumber, storeCode);
  if (!cabecalho)
    return { ok: false, error: "NOT_FOUND", message: `Pedido ${newOrderNumber} não encontrado na Citel.` };

  const validation = classifyOrderStatus(cabecalho.status);
  if (validation !== "VALID")
    return { ok: false, error: "ORDER_BLOCKED", message: BLOCKED_MESSAGES[validation] ?? "Pedido em status inválido." };

  const citel = await enrichDeliveryRequestStock(newOrderNumber, storeCode, codigoEmpresaCitel);
  if (!citel || citel.items.length === 0)
    return { ok: false, error: "NO_ITEMS", message: "Não foi possível obter os itens do pedido no Citel." };

  const deliveryAddress = formatEndereco(cabecalho.deliveryAddress ?? cabecalho.customerAddress);
  const customerPhone = cabecalho.telefone ?? cabecalho.celular ?? dr.customerPhone ?? "";

  const preview: CorrigirPedidoPreview = {
    orderNumber:     newOrderNumber,
    customerName:    cabecalho.nomeCliente,
    customerDoc:     cabecalho.documento,
    deliveryAddress,
    itemCount:       citel.items.length,
    totalWeightKg:   citel.totalWeightKg,
    isEntregaCD:     citel.isEntregaCD,
  };

  if (dryRun) return { ok: true, preview };

  // Geocoding (best-effort): se falhar, salva sem coords (pipeline geocoda depois).
  const geo = await geocodeAddress(deliveryAddress).catch(() => null);

  // Loja de despacho: CD (132) quando entrega CD; senão a loja da solicitação.
  const cdStore = citel.isEntregaCD
    ? await prisma.store.findFirst({ where: { code: "132", active: true }, select: { id: true } })
    : null;
  const dispatchStoreId = citel.isEntregaCD && cdStore ? cdStore.id : dr.storeId;

  const itemsData = citel.items.map((i) => ({
    productCode:      i.productCode,
    productName:      i.description ?? i.productCode,
    quantity:         i.quantity,
    unit:             i.unit,
    description:      i.description,
    brand:            i.brand,
    barcode:          i.barcode,
    grossWeight:      i.grossWeight,
    totalWeight:      i.totalWeight,
    hasMissingWeight: i.hasMissingWeight,
    availableStock:   i.availableStock,
    physicalStock:    i.physicalStock,
    stockStatus:      i.stockStatus,
    fetchedAt:        new Date(),
    availableAtStore: i.availableAtStore,
    sourceStoreId:    i.sourceStoreId ?? undefined,
  }));

  const oldOrderNumber = dr.orderNumber;

  await prisma.$transaction(async (tx) => {
    await tx.deliveryItem.deleteMany({ where: { deliveryRequestId: requestId } });
    await tx.deliveryRequest.update({
      where: { id: requestId },
      data: {
        orderNumber:           newOrderNumber,
        customerName:          cabecalho.nomeCliente,
        customerPhone,
        customerDoc:           cabecalho.documento,
        deliveryAddress,
        deliveryCity:          geo?.city ?? null,
        deliveryState:         geo?.state ?? null,
        deliveryLat:           geo?.lat ?? null,
        deliveryLng:           geo?.lng ?? null,
        entregaPeloCD:         citel.isEntregaCD,
        dispatchStoreId,
        totalWeightKg:         citel.totalWeightKg,
        totalLatas:            citel.totalLatas,
        volumeBreakdown:       citel.volumeBreakdown as Prisma.InputJsonValue,
        hasMissingWeights:     citel.hasMissingWeights,
        stockValidationStatus: citel.stockValidationStatus,
        stockFetchedAt:        new Date(),
        items: { create: itemsData },
      },
    });
    await tx.deliveryStatusHistory.create({
      data: {
        deliveryRequestId: requestId,
        fromStatus:        "PENDING",
        toStatus:          "PENDING",
        changedById:       actorId,
        metadata: {
          event:          "ORDER_NUMBER_CORRECTED",
          oldOrderNumber,
          newOrderNumber,
          correctedBy:    actorId,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { ok: true, preview };
}
```

> Nota de implementação: confirme os nomes exatos dos campos de `DeliveryStatusHistory`
> (ex.: `changedById` vs `actorId`) lendo `prisma/schema.prisma` antes de finalizar — ajuste
> se divergir. Os demais campos (DeliveryRequest, DeliveryItem) seguem o mesmo shape usado em
> `app/api/solicitacoes/route.ts` na criação.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/corrigir-pedido.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add services/corrigir-pedido.service.ts tests/services/corrigir-pedido.test.ts
git commit -m "feat(solicitacoes): service de correcao do numero do pedido (re-busca Citel)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Endpoint PATCH de correção

**Files:**
- Create: `app/api/solicitacoes/[id]/corrigir-pedido/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/solicitacoes/[id]/corrigir-pedido/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { corrigirPedido } from "@/services/corrigir-pedido.service";

const OPERATOR_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR", "STOCK_OPERATOR", "STORE_LEADER"];

const schema = z.object({
  newOrderNumber: z.string().min(1, "Informe o número do pedido"),
  dryRun:         z.boolean().default(false),
});

// HTTP status por erro de negócio do service.
const STATUS_BY_ERROR: Record<string, number> = {
  NOT_FOUND: 404, NOT_PENDING: 409, SAME_NUMBER: 400,
  DUPLICATE: 409, CITEL_DOWN: 503, ORDER_BLOCKED: 422, NO_ITEMS: 422,
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    // Permissão: operador OU vendedor dono da solicitação.
    const dr = await prisma.deliveryRequest.findUnique({
      where: { id: params.id }, select: { sellerId: true },
    });
    if (!dr) return NextResponse.json(apiError("Solicitação não encontrada", "NOT_FOUND"), { status: 404 });
    const isOwner = dr.sellerId === session.userId;
    if (!OPERATOR_ROLES.includes(session.role) && !isOwner) {
      return NextResponse.json(apiError("Sem permissão para corrigir esta solicitação", "FORBIDDEN"), { status: 403 });
    }

    const result = await corrigirPedido({
      requestId:      params.id,
      newOrderNumber: parsed.data.newOrderNumber.trim(),
      actorId:        session.userId,
      dryRun:         parsed.data.dryRun,
    });

    if (!result.ok) {
      const status = STATUS_BY_ERROR[result.error ?? ""] ?? 400;
      return NextResponse.json(apiError(result.message ?? "Erro ao corrigir pedido", result.error), { status });
    }
    return NextResponse.json(apiSuccess({ preview: result.preview }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao corrigir pedido";
    console.error(`[PATCH /api/solicitacoes/${params.id}/corrigir-pedido]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "app/api/solicitacoes/[id]/corrigir-pedido/route.ts"
git commit -m "feat(solicitacoes): endpoint PATCH corrigir-pedido (dryRun + apply)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `sellerId` no card da workqueue

**Files:**
- Modify: `components/operacao/types.ts`
- Modify: o serviço/rota que monta os `OperationalCard` (buscar por onde os cards são montados a partir de `deliveryRequest`)

- [ ] **Step 1: Add `sellerId` to the type**

Em `components/operacao/types.ts`, dentro de `interface OperationalCard`, logo abaixo de `sellerName: string;`, adicione:

```ts
  sellerId: string;
```

- [ ] **Step 2: Populate `sellerId` where cards are built**

Localize onde os `OperationalCard` são montados a partir das solicitações (procure por `sellerName:` no diretório `services/` ou `app/api/operacao/`). No objeto que monta cada card, adicione `sellerId` a partir do `sellerId`/`seller.id` da `deliveryRequest`:

```ts
    sellerId:   dr.sellerId,
```

Se a query que alimenta esse serviço não seleciona `sellerId`, inclua `sellerId: true` (ou `seller: { select: { id: true, name: true } }`) no `select`/`include`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: sem erros (o type novo é preenchido na origem).

- [ ] **Step 4: Commit**

```bash
git add components/operacao/types.ts
git add -A services app/api/operacao
git commit -m "feat(operacao): expoe sellerId no card da workqueue

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Modal de correção

**Files:**
- Create: `components/operacao/CorrigirPedidoModal.tsx`

- [ ] **Step 1: Create the modal**

Create `components/operacao/CorrigirPedidoModal.tsx` (segue o padrão visual de `MarkDeliveredModal.tsx`):

```tsx
"use client";

import { useState } from "react";
import { X, Loader2, Search, AlertTriangle, CheckCircle2, Package } from "lucide-react";
import type { OperationalCard } from "./types";

interface Preview {
  orderNumber:     string;
  customerName:    string;
  customerDoc:     string | null;
  deliveryAddress: string;
  itemCount:       number;
  totalWeightKg:   number;
  isEntregaCD:     boolean;
}

interface Props {
  card:      OperationalCard;
  onClose:   () => void;
  onSuccess: () => void;
}

export function CorrigirPedidoModal({ card, onClose, onSuccess }: Props) {
  const [num,     setNum]     = useState(card.orderNumber ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState<"preview" | "apply" | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  async function call(dryRun: boolean) {
    setError(null);
    setLoading(dryRun ? "preview" : "apply");
    try {
      const res = await fetch(`/api/solicitacoes/${card.id}/corrigir-pedido`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ newOrderNumber: num.trim(), dryRun }),
      });
      const json = await res.json().catch(() => ({ success: false, error: `Erro ${res.status}` }));
      if (!res.ok || !json.success) { setError(json.error ?? `Erro ${res.status}`); return false; }
      if (dryRun) setPreview(json.data.preview as Preview);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
      return false;
    } finally {
      setLoading(null);
    }
  }

  async function handleApply() {
    const ok = await call(false);
    if (ok) { onSuccess(); onClose(); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-xl overflow-hidden" style={{ backgroundColor: "#111318", border: "1px solid #1E2530" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #1E2530" }}>
          <div>
            <p className="text-[13px] font-bold" style={{ color: "#E5E7EB" }}>Corrigir número do pedido</p>
            <p className="text-[11px] mt-0.5" style={{ color: "#4B5563" }}>Atual: PD {card.orderNumber} · {card.customerName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "#6B7280" }}><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <label className="block text-[11px] font-semibold" style={{ color: "#9CA3AF" }}>Número correto do pedido (PD)</label>
          <div className="flex gap-2">
            <input
              value={num}
              onChange={(e) => { setNum(e.target.value); setPreview(null); }}
              className="flex-1 px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ backgroundColor: "#0D1117", border: "1px solid #1E2530", color: "#E5E7EB" }}
              placeholder="Ex: 11640"
            />
            <button
              onClick={() => call(true)}
              disabled={loading !== null || num.trim().length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold"
              style={{ backgroundColor: "#1E2530", color: "#9CA3AF", opacity: num.trim() ? 1 : 0.5 }}
            >
              {loading === "preview" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Buscar
            </button>
          </div>

          {preview && (
            <div className="rounded-lg p-3 space-y-1" style={{ backgroundColor: "#0D1117", border: "1px solid #16A34A33" }}>
              <p className="text-[12px] font-bold" style={{ color: "#86EFAC" }}>{preview.customerName}</p>
              {preview.customerDoc && <p className="text-[10px]" style={{ color: "#6B7280" }}>Doc: {preview.customerDoc}</p>}
              <p className="text-[10px]" style={{ color: "#9CA3AF" }}>{preview.deliveryAddress}</p>
              <p className="text-[10px] flex items-center gap-1" style={{ color: "#6B7280" }}>
                <Package className="w-2.5 h-2.5" /> {preview.itemCount} {preview.itemCount === 1 ? "item" : "itens"} · {preview.totalWeightKg.toFixed(1)} kg
                {preview.isEntregaCD && " · entrega CD"}
              </p>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg text-[11px] flex items-start gap-1.5" style={{ backgroundColor: "#EF444422", color: "#F87171", border: "1px solid #EF444433" }}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 flex gap-2 justify-end" style={{ borderTop: "1px solid #1E2530" }}>
          <button onClick={onClose} disabled={loading !== null} className="px-4 py-2 rounded-lg text-[12px] font-medium" style={{ backgroundColor: "#1E2530", color: "#9CA3AF" }}>
            Cancelar
          </button>
          <button
            onClick={handleApply}
            disabled={loading !== null || !preview}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold"
            style={{ backgroundColor: "#16A34A33", color: "#86EFAC", border: "1px solid #16A34A44", opacity: preview ? 1 : 0.5 }}
          >
            {loading === "apply" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Confirmar correção
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/operacao/CorrigirPedidoModal.tsx
git commit -m "feat(operacao): modal de correcao do numero do pedido (preview + confirmar)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Lápis no card + wiring

**Files:**
- Modify: `components/operacao/DeliveryCard.tsx`
- Modify: `components/operacao/WorkQueueColumn.tsx`
- Modify: `app/(app)/operacao/OperacaoClient.tsx`
- Modify: `app/(app)/operacao/page.tsx`

- [ ] **Step 1: DeliveryCard — receber props e mostrar o ✏️**

Em `components/operacao/DeliveryCard.tsx`:

a) No import do lucide, adicione `Pencil`:
```tsx
import { Zap, ArrowLeftRight, AlertTriangle, Clock, MapPin, Lock, Unlock, Pencil } from "lucide-react";
```

b) Estenda os props:
```tsx
interface DeliveryCardProps {
  card:        OperationalCard;
  currentUserId: string;
  currentUserRole: string;
  onAction:    (card: OperationalCard, action: ActionDefinition) => void;
  onCorrigirPedido: (card: OperationalCard) => void;
}
```

c) Na desestruturação e no corpo, calcule a permissão (logo após `const actions = ...`):
```tsx
export function DeliveryCard({ card, currentUserId, currentUserRole, onAction, onCorrigirPedido }: DeliveryCardProps) {
```
```tsx
  const OPERATOR_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR", "STOCK_OPERATOR", "STORE_LEADER"];
  const canCorrigir = card.status === "PENDING" &&
    (OPERATOR_ROLES.includes(currentUserRole) || card.sellerId === currentUserId);
```

d) No bloco "Linha topo: ref + badges", logo após o `<span>{formatRef(card)}</span>`, adicione o botão do lápis:
```tsx
        {canCorrigir && (
          <button
            onClick={() => onCorrigirPedido(card)}
            title="Corrigir número do pedido"
            className="p-0.5 rounded hover:bg-white/10 transition-colors"
            style={{ color: "#6B7280" }}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
```

- [ ] **Step 2: WorkQueueColumn — repassar as props novas**

Em `components/operacao/WorkQueueColumn.tsx`, adicione `currentUserRole: string` e `onCorrigirPedido: (card: OperationalCard) => void` aos props do componente e repasse-os ao `<DeliveryCard .../>`. (Leia o arquivo; ele já repassa `currentUserId` e `onAction` — siga o mesmo padrão para as duas props novas.)

- [ ] **Step 3: OperacaoClient — estado do modal + permissão + render**

Em `app/(app)/operacao/OperacaoClient.tsx`:

a) Importe o modal:
```tsx
import { CorrigirPedidoModal } from "@/components/operacao/CorrigirPedidoModal";
```

b) Aceite `currentUserRole` nos props:
```tsx
interface OperacaoClientProps {
  initial:       OperationalQueuePayload;
  currentUserId: string;
  currentUserName: string;
  currentUserRole: string;
  requirePhoto:  boolean;
}
```
```tsx
export function OperacaoClient({ initial, currentUserId, currentUserName, currentUserRole, requirePhoto }: OperacaoClientProps) {
```

c) Adicione o estado do card em correção (junto dos outros `useState`):
```tsx
  const [correctingCard, setCorrectingCard] = useState<OperationalCard | null>(null);
```

d) Passe as props novas para cada `<WorkQueueColumn>`:
```tsx
            <WorkQueueColumn
              key={column.id}
              column={column}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onAction={openModal}
              onCorrigirPedido={setCorrectingCard}
            />
```

e) Renderize o modal (perto do `ClaimConflictModal`):
```tsx
      {correctingCard && (
        <CorrigirPedidoModal
          card={correctingCard}
          onClose={() => setCorrectingCard(null)}
          onSuccess={refetch}
        />
      )}
```

- [ ] **Step 4: page.tsx — passar o role**

Em `app/(app)/operacao/page.tsx`, localize onde `<OperacaoClient ... />` é renderizado e adicione a prop `currentUserRole={session.role}` (a sessão já é lida nessa página; use o mesmo objeto de onde vêm `currentUserId`/`currentUserName`).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npx vitest run tests/lib/erp-order-status.test.ts tests/services/corrigir-pedido.test.ts`
Expected: PASS.

- [ ] **Step 6: Conferência visual**

Run: `npm run dev`, abrir `/operacao`. Num card PENDENTE, confirmar:
- o ✏️ aparece ao lado do "PD …" (e some em status posteriores);
- clicar abre o modal; Buscar com um número válido mostra o preview; número cancelado/inexistente mostra erro e não deixa confirmar;
- Confirmar correção atualiza o card (cliente/itens corretos) e fecha o modal.

- [ ] **Step 7: Commit**

```bash
git add components/operacao/DeliveryCard.tsx components/operacao/WorkQueueColumn.tsx "app/(app)/operacao/OperacaoClient.tsx" "app/(app)/operacao/page.tsx"
git commit -m "feat(operacao): lapis no card pendente abre correcao do numero do pedido

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Re-busca tudo + preview + confirmar → Task 2 (dryRun/apply) + Task 5 (modal). ✓
- ✏️ ao lado do PD → Task 6 Step 1. ✓
- Só em PENDING → Task 2 (NOT_PENDING) + Task 6 (canCorrigir). ✓
- Operadores + vendedor dono → Task 3 (rota) + Task 6 (card). ✓
- Atualiza orderNumber/cliente/doc/endereço+geocoding/entregaCD/dispatchStore/itens/totais + auditoria → Task 2 transação. ✓
- Validações (NOT_PENDING, NOT_FOUND, SAME_NUMBER, DUPLICATE, ORDER_BLOCKED, NO_ITEMS, CITEL_DOWN) → Task 2 + Task 3 (mapa HTTP). ✓
- Reúso do classificador de status → Task 1 (extração) + Task 2 (uso). ✓
- Testes do service e do helper → Task 1 e Task 2. ✓

**Placeholder scan:** Tasks 2, 4 e 6 contêm notas de "localize/confirme" para pontos de integração (campos do `DeliveryStatusHistory`, onde os cards são montados, repasses em `WorkQueueColumn`/`page.tsx`) — são instruções acionáveis para o implementador (que lê o código), não placeholders de lógica. Todo código de lógica nova está completo.

**Type consistency:** `CorrigirPedidoPreview` (Task 2) é o mesmo shape consumido pelo `Preview` do modal (Task 5). `corrigirPedido({ requestId, newOrderNumber, actorId, dryRun })` tem a mesma assinatura na rota (Task 3) e nos testes (Task 2). `OperationalCard.sellerId` (Task 4) é usado em `canCorrigir` (Task 6). Props `currentUserRole` e `onCorrigirPedido` fluem consistentes page→OperacaoClient→WorkQueueColumn→DeliveryCard.
```
