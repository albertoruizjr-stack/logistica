# Sprint 3A — Lalamove Wiring: Despacho Real via API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando um despacho é criado com `modal=LALAMOVE`, chamar automaticamente a API do Lalamove para criar o pedido real, salvar o `LalamoveOrder` vinculado, e expor endpoints para consultar status e cancelar.

**Architecture:** Um helper `lib/lalamove-dispatch.ts` concentra a orquestração (build de stops → quote → create order) sem banco de dados — funções puras + I/O de API. O `createDispatch` em `despacho.service.ts` é refatorado para extrair o dispatch da transaction e chamar o helper DEPOIS do commit, evitando rollback em falha de API externa. Se o Lalamove falhar, o dispatch persiste no banco sem `lalamoveOrderId`; o operador pode retentar. Dois endpoints novos expõem status e cancelamento.

**Tech Stack:** Next.js 14 (App Router) · Prisma (PostgreSQL) · TypeScript · Vitest · `crypto` (HMAC, já existente em `lalamove.service.ts`)

---

## Contexto — o que já existe

| Arquivo | Estado |
|---------|--------|
| `services/lalamove.service.ts` | ✅ Completo — HMAC auth + quote + createOrder + getStatus + cancel + verifyWebhook |
| `app/api/lalamove/webhook/route.ts` | ✅ Completo — recebe e processa eventos |
| `LalamoveOrder` + `LalamoveEvent` (schema) | ✅ Modelos existentes |
| `services/despacho.service.ts` → `createDispatch` | ❌ Não chama Lalamove |
| `app/api/despacho/[id]/lalamove/` | ❌ Não existe |

**Variáveis de ambiente já salvas em `.env.local`:**
```
LALAMOVE_API_KEY="pk_prod_1362f0ceb85968322792911ef30e5d18"
LALAMOVE_API_SECRET="sk_prod_Q2YoAQ3kscbAQFaX0kgagunq/..."
LALAMOVE_MARKET="BR"
LALAMOVE_SANDBOX="false"
```

---

## Mapa de Arquivos

| Ação | Arquivo | Responsabilidade |
|------|---------|-----------------|
| Criar | `lib/lalamove-dispatch.ts` | Orquestra quote + create order; funções puras para stops |
| Criar | `tests/lib/lalamove-dispatch.test.ts` | Testes unitários com mocks da API |
| Modificar | `services/despacho.service.ts` | Extrair dispatch da transaction; chamar Lalamove pós-commit |
| Criar | `app/api/despacho/[id]/lalamove/route.ts` | GET status + DELETE cancel |

---

## Task 0 — Testes para `lib/lalamove-dispatch.ts`

**Files:**
- Create: `tests/lib/lalamove-dispatch.test.ts`

- [ ] **Step 1: Criar o arquivo de testes**

```typescript
// tests/lib/lalamove-dispatch.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLalamoveStops, dispatchViaLalamove } from "@/lib/lalamove-dispatch";

// mock do serviço Lalamove (evita HTTP real nos testes)
vi.mock("@/services/lalamove.service", () => ({
  getLalamoveQuote: vi.fn(),
  createLalamoveOrder: vi.fn(),
}));

import { getLalamoveQuote, createLalamoveOrder } from "@/services/lalamove.service";

const mockStore = {
  lat: -23.5657,
  lng: -46.6521,
  address: "Rua Funchal, 123 — Vila Olímpia, SP",
  phone: "11999990000",
};

const mockDeliveryRequest = {
  deliveryLat: -23.5505,
  deliveryLng: -46.6333,
  deliveryAddress: "Av. Paulista, 1000 — Bela Vista, SP",
  customerName: "João Silva",
  customerPhone: "11988887777",
};

// ──────────────────────────────────────────────
// buildLalamoveStops
// ──────────────────────────────────────────────

describe("buildLalamoveStops", () => {
  it("retorna stops com coordenadas como strings", () => {
    const result = buildLalamoveStops(mockStore, mockDeliveryRequest);
    expect(result).not.toBeNull();
    expect(result!.origin.coordinates.lat).toBe("-23.5657");
    expect(result!.origin.coordinates.lng).toBe("-46.6521");
    expect(result!.destination.coordinates.lat).toBe("-23.5505");
    expect(result!.destination.coordinates.lng).toBe("-46.6333");
  });

  it("preenche name e phone no destino", () => {
    const result = buildLalamoveStops(mockStore, mockDeliveryRequest);
    expect(result!.destination.name).toBe("João Silva");
    expect(result!.destination.phone).toBe("11988887777");
  });

  it("retorna null quando deliveryLat é null", () => {
    const result = buildLalamoveStops(mockStore, {
      ...mockDeliveryRequest,
      deliveryLat: null,
    });
    expect(result).toBeNull();
  });

  it("retorna null quando deliveryLng é null", () => {
    const result = buildLalamoveStops(mockStore, {
      ...mockDeliveryRequest,
      deliveryLng: null,
    });
    expect(result).toBeNull();
  });

  it("usa string vazia para phone quando customerPhone é null", () => {
    const result = buildLalamoveStops(mockStore, {
      ...mockDeliveryRequest,
      customerPhone: null,
    });
    expect(result!.destination.phone).toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// dispatchViaLalamove
// ──────────────────────────────────────────────

describe("dispatchViaLalamove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLalamoveQuote).mockResolvedValue({
      quotationId: "q_abc123",
      scheduleAt: "",
      serviceType: "MOTORCYCLE",
      specialRequests: [],
      expiresAt: "",
      priceBreakdown: {
        base: "15.00",
        totalBeforeOptimization: "15.00",
        total: "15.00",
        currency: "BRL",
      },
      stops: [],
    });
    vi.mocked(createLalamoveOrder).mockResolvedValue({
      orderId: "ord_xyz789",
      shareLink: "https://share.lalamove.com/xyz789",
    });
  });

  it("chama getLalamoveQuote com os stops corretos", async () => {
    await dispatchViaLalamove(mockStore, mockDeliveryRequest);
    expect(getLalamoveQuote).toHaveBeenCalledOnce();
    const [originStop, destStop] = vi.mocked(getLalamoveQuote).mock.calls[0];
    expect(originStop.coordinates.lat).toBe("-23.5657");
    expect(destStop.name).toBe("João Silva");
  });

  it("chama createLalamoveOrder com o quotationId retornado pelo quote", async () => {
    await dispatchViaLalamove(mockStore, mockDeliveryRequest);
    expect(createLalamoveOrder).toHaveBeenCalledWith(
      "q_abc123",
      expect.any(Object),
      expect.any(Object),
      "11999990000"
    );
  });

  it("retorna os campos esperados em caso de sucesso", async () => {
    const result = await dispatchViaLalamove(mockStore, mockDeliveryRequest);
    expect(result).toEqual({
      lalamoveOrderId: "ord_xyz789",
      quotationId: "q_abc123",
      estimatedPrice: 15,
      shareLink: "https://share.lalamove.com/xyz789",
    });
  });

  it("retorna null sem chamar a API quando coordenadas ausentes", async () => {
    const result = await dispatchViaLalamove(mockStore, {
      ...mockDeliveryRequest,
      deliveryLat: null,
    });
    expect(result).toBeNull();
    expect(getLalamoveQuote).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
cd "C:/Users/Alberto/OneDrive - Atual Comercio de Tintas e Materiais para Pintura/Claude/Projects/sistema-logistica"
node node_modules/vitest/dist/cli.js run tests/lib/lalamove-dispatch.test.ts 2>&1 | tail -5
```

Expected: FAIL com `Cannot find module '@/lib/lalamove-dispatch'`.

---

## Task 1 — Implementar `lib/lalamove-dispatch.ts`

**Files:**
- Create: `lib/lalamove-dispatch.ts`

- [ ] **Step 1: Criar o arquivo**

```typescript
// lib/lalamove-dispatch.ts
// Orquestra a criação de pedido no Lalamove:
// buildLalamoveStops (pura) → getLalamoveQuote → createLalamoveOrder.
// Separado do serviço HTTP (lalamove.service.ts) para facilitar testes.

import { getLalamoveQuote, createLalamoveOrder } from "@/services/lalamove.service";
import type { LalamoveStop } from "@/types";

export interface LalamovedDispatch {
  lalamoveOrderId: string;
  quotationId: string;
  estimatedPrice: number;   // em BRL, convertido de string para number
  shareLink?: string;
}

// Tipos mínimos necessários para construir os stops.
// Mantidos simples para facilitar mocks nos testes.
type StoreInfo = {
  lat: number;
  lng: number;
  address: string;
  phone?: string | null;
};

type DeliveryInfo = {
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  deliveryAddress: string;
  customerName: string;
  customerPhone?: string | null;
};

// ──────────────────────────────────────────────
// FUNÇÃO PURA — sem I/O, testável sem mocks de banco
// ──────────────────────────────────────────────

export function buildLalamoveStops(
  store: StoreInfo,
  deliveryRequest: DeliveryInfo
): { origin: LalamoveStop; destination: LalamoveStop } | null {
  if (!deliveryRequest.deliveryLat || !deliveryRequest.deliveryLng) return null;

  const origin: LalamoveStop = {
    coordinates: {
      lat: String(store.lat),
      lng: String(store.lng),
    },
    address: store.address,
  };

  const destination: LalamoveStop = {
    coordinates: {
      lat: String(deliveryRequest.deliveryLat),
      lng: String(deliveryRequest.deliveryLng),
    },
    address: deliveryRequest.deliveryAddress,
    name: deliveryRequest.customerName,
    ...(deliveryRequest.customerPhone
      ? { phone: deliveryRequest.customerPhone }
      : {}),
  };

  return { origin, destination };
}

// ──────────────────────────────────────────────
// ORQUESTRADOR — quote → create order
// Retorna null se coordenadas ausentes (sem parar o fluxo de despacho).
// Lança exceção se a API Lalamove falhar (o chamador decide como tratar).
// ──────────────────────────────────────────────

export async function dispatchViaLalamove(
  store: StoreInfo,
  deliveryRequest: DeliveryInfo
): Promise<LalamovedDispatch | null> {
  const stops = buildLalamoveStops(store, deliveryRequest);
  if (!stops) return null;

  const quote = await getLalamoveQuote(stops.origin, stops.destination);

  const order = await createLalamoveOrder(
    quote.quotationId,
    stops.origin,
    stops.destination,
    store.phone ?? ""
  );

  return {
    lalamoveOrderId: order.orderId,
    quotationId: quote.quotationId,
    estimatedPrice: parseFloat(quote.priceBreakdown.total),
    shareLink: order.shareLink,
  };
}
```

- [ ] **Step 2: Rodar os testes**

```bash
node node_modules/vitest/dist/cli.js run tests/lib/lalamove-dispatch.test.ts 2>&1 | tail -8
```

Expected:
```
Test Files  1 passed (1)
Tests       9 passed (9)
```

- [ ] **Step 3: Commit**

```bash
git add lib/lalamove-dispatch.ts tests/lib/lalamove-dispatch.test.ts
git commit -m "feat: helper lalamove-dispatch com buildLalamoveStops e dispatchViaLalamove"
```

---

## Task 2 — Integrar `dispatchViaLalamove` em `createDispatch`

**Files:**
- Modify: `services/despacho.service.ts`

O objetivo é:
1. Extrair o resultado da `$transaction` para uma variável (sem mudar o conteúdo interno).
2. Após o commit da transaction, verificar se `modal=LALAMOVE` e `deliveryRequestId` existe.
3. Buscar store + deliveryRequest do banco.
4. Chamar `dispatchViaLalamove` — se retornar null ou lançar exceção, logar e continuar.
5. Se bem-sucedido, salvar `LalamoveOrder` e atualizar o dispatch com `lalamoveOrderId` e `estimatedCost`.

- [ ] **Step 1: Adicionar import de `dispatchViaLalamove`**

No topo de `services/despacho.service.ts`, após os imports existentes, adicionar:

```typescript
import { dispatchViaLalamove } from "@/lib/lalamove-dispatch";
```

- [ ] **Step 2: Refatorar `createDispatch` para extrair dispatch da transaction e chamar Lalamove pós-commit**

Substituir o corpo completo de `createDispatch` (linhas 95–163):

```typescript
export async function createDispatch(input: CreateDispatchInput) {
  // ── FASE 1: transaction atômica — cria dispatch + atualiza status + cria audit ──
  const dispatch = await prisma.$transaction(async (tx) => {
    const dispatch = await tx.dispatch.create({
      data: {
        deliveryRequestId: input.deliveryRequestId,
        transferId: input.transferId,
        storeId: input.storeId,
        modal: input.modal,
        status: DispatchStatus.PENDING,
        driverId: input.driverId,
        routeId: input.routeId,
        estimatedCost: input.estimatedCost,
        dispatchedById: input.dispatchedById,
        notes: input.notes,
        dispatchedAt: new Date(),
      },
      include: {
        deliveryRequest: true,
        transfer: { include: { fromStore: true, toStore: true } },
        store: true,
        driver: true,
      },
    });

    // atualiza a solicitação de entrega para DISPATCHED
    if (input.deliveryRequestId) {
      await tx.deliveryRequest.update({
        where: { id: input.deliveryRequestId },
        data: { status: "DISPATCHED" },
      });
    }

    // cria registro de auditoria de frete
    if (input.deliveryRequestId) {
      const deliveryRequest = await tx.deliveryRequest.findUnique({
        where: { id: input.deliveryRequestId },
        include: { freightQuote: true },
      });

      if (deliveryRequest) {
        await tx.freightAudit.upsert({
          where: { deliveryRequestId: input.deliveryRequestId },
          update: {
            dispatchId: dispatch.id,
            estimatedCost: input.estimatedCost,
            modal: input.modal,
          },
          create: {
            deliveryRequestId: input.deliveryRequestId,
            dispatchId: dispatch.id,
            invoiceNumber: deliveryRequest.invoiceNumber,
            storeId: deliveryRequest.storeId,
            suggestedFreight: deliveryRequest.freightQuote?.suggestedPrice,
            chargedFreight: deliveryRequest.chargedFreight,
            estimatedCost: input.estimatedCost,
            modal: input.modal,
            deliveryType: deliveryRequest.deliveryType,
            distanceKm: deliveryRequest.freightQuote?.distanceKm,
            freightDeviation: deliveryRequest.chargedFreight != null && deliveryRequest.freightQuote != null
              ? deliveryRequest.chargedFreight - deliveryRequest.freightQuote.suggestedPrice
              : null,
          },
        });
      }
    }

    return dispatch;
  });

  // ── FASE 2: chamar API Lalamove FORA da transaction ──
  // Se falhar, o dispatch já está no banco — operador pode retentar.
  if (dispatch.modal === DispatchModal.LALAMOVE && input.deliveryRequestId) {
    try {
      const [store, deliveryRequest] = await Promise.all([
        prisma.store.findUnique({
          where: { id: input.storeId },
          select: { lat: true, lng: true, address: true, phone: true },
        }),
        prisma.deliveryRequest.findUnique({
          where: { id: input.deliveryRequestId },
          select: {
            deliveryLat: true,
            deliveryLng: true,
            deliveryAddress: true,
            customerName: true,
            customerPhone: true,
          },
        }),
      ]);

      if (!store || !deliveryRequest) {
        console.warn("[Lalamove] Store ou DeliveryRequest não encontrada — dispatch sem pedido Lalamove.");
      } else {
        const result = await dispatchViaLalamove(store, deliveryRequest);

        if (!result) {
          console.warn("[Lalamove] Coordenadas ausentes na solicitação — dispatch sem pedido Lalamove.");
        } else {
          // salva LalamoveOrder vinculada ao dispatch
          await prisma.lalamoveOrder.create({
            data: {
              dispatchId: dispatch.id,
              lalamoveOrderId: result.lalamoveOrderId,
              quotationId: result.quotationId,
              status: "ASSIGNING_DRIVER",
              internalStatus: DispatchStatus.PENDING,
              estimatedPrice: result.estimatedPrice,
              shareLink: result.shareLink,
              currency: "BRL",
            },
          });

          // atualiza dispatch com ID externo e custo estimado
          await prisma.dispatch.update({
            where: { id: dispatch.id },
            data: {
              lalamoveOrderId: result.lalamoveOrderId,
              estimatedCost: result.estimatedPrice,
            },
          });

          console.info(`[Lalamove] Pedido criado: ${result.lalamoveOrderId} — dispatch ${dispatch.id}`);
        }
      }
    } catch (error) {
      // log mas não propaga: dispatch válido, Lalamove pode ser retentado
      console.error("[Lalamove] Falha ao criar pedido — dispatch criado sem vinculação:", error);
    }
  }

  return dispatch;
}
```

- [ ] **Step 3: Verificar compilação**

```bash
cd "C:/Users/Alberto/OneDrive - Atual Comercio de Tintas e Materiais para Pintura/Claude/Projects/sistema-logistica"
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "despacho.service\|lalamove-dispatch"
```

Expected: sem erros.

- [ ] **Step 4: Rodar suite completa de testes**

```bash
node node_modules/vitest/dist/cli.js run 2>&1 | tail -8
```

Expected:
```
Test Files  6 passed (6)
Tests       44 passed (44)
```

- [ ] **Step 5: Commit**

```bash
git add services/despacho.service.ts
git commit -m "feat: criar pedido Lalamove automaticamente ao despachar com modal=LALAMOVE"
```

---

## Task 3 — Endpoints GET status + DELETE cancel

**Files:**
- Create: `app/api/despacho/[id]/lalamove/route.ts`

- [ ] **Step 1: Criar a rota**

```typescript
// app/api/despacho/[id]/lalamove/route.ts
// GET  — retorna status atual do pedido Lalamove vinculado ao dispatch
// DELETE — cancela o pedido Lalamove e atualiza status interno

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { prisma } from "@/lib/prisma";
import { getLalamoveOrderStatus, cancelLalamoveOrder } from "@/services/lalamove.service";
import { updateDispatchStatus } from "@/services/despacho.service";
import { DispatchStatus } from "@prisma/client";

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const lalamoveOrder = await prisma.lalamoveOrder.findFirst({
      where: { dispatchId: params.id },
    });

    if (!lalamoveOrder) {
      return NextResponse.json(apiError("Pedido Lalamove não encontrado para este despacho"), { status: 404 });
    }

    const status = await getLalamoveOrderStatus(lalamoveOrder.lalamoveOrderId);

    // atualiza o banco se o status mudou
    if (status.status !== lalamoveOrder.status) {
      await prisma.lalamoveOrder.update({
        where: { id: lalamoveOrder.id },
        data: {
          status: status.status,
          driverName: status.driverName ?? lalamoveOrder.driverName,
          driverPhone: status.driverPhone ?? lalamoveOrder.driverPhone,
          driverPlate: status.driverPlate ?? lalamoveOrder.driverPlate,
          finalPrice: status.priceBreakdown
            ? parseFloat(status.priceBreakdown.total)
            : lalamoveOrder.finalPrice,
        },
      });
    }

    return NextResponse.json(
      apiSuccess({
        lalamoveOrderId: lalamoveOrder.lalamoveOrderId,
        status: status.status,
        shareLink: lalamoveOrder.shareLink,
        driverName: status.driverName,
        driverPhone: status.driverPhone,
        driverPlate: status.driverPlate,
        estimatedPrice: lalamoveOrder.estimatedPrice,
        finalPrice: status.priceBreakdown
          ? parseFloat(status.priceBreakdown.total)
          : lalamoveOrder.finalPrice,
      })
    );
  } catch (error) {
    console.error("[GET /api/despacho/[id]/lalamove]", error);
    return NextResponse.json(apiError("Erro ao consultar status Lalamove"), { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!["ADMIN", "OPERATOR"].includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const lalamoveOrder = await prisma.lalamoveOrder.findFirst({
      where: { dispatchId: params.id },
    });

    if (!lalamoveOrder) {
      return NextResponse.json(apiError("Pedido Lalamove não encontrado"), { status: 404 });
    }

    await cancelLalamoveOrder(lalamoveOrder.lalamoveOrderId);

    // atualiza status interno
    await Promise.all([
      prisma.lalamoveOrder.update({
        where: { id: lalamoveOrder.id },
        data: { status: "CANCELLED", internalStatus: DispatchStatus.FAILED },
      }),
      updateDispatchStatus(params.id, DispatchStatus.FAILED, {
        failureReason: "Cancelado pelo operador via Lalamove",
      }),
    ]);

    return NextResponse.json(apiSuccess({ message: "Pedido Lalamove cancelado com sucesso." }));
  } catch (error) {
    console.error("[DELETE /api/despacho/[id]/lalamove]", error);
    return NextResponse.json(apiError("Erro ao cancelar pedido Lalamove"), { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar compilação**

```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "despacho.*lalamove\|lalamove.*route"
```

Expected: sem erros.

- [ ] **Step 3: Rodar todos os testes**

```bash
node node_modules/vitest/dist/cli.js run 2>&1 | tail -8
```

Expected:
```
Test Files  6 passed (6)
Tests       44 passed (44)
```

- [ ] **Step 4: Commit**

```bash
git add "app/api/despacho/[id]/lalamove/route.ts"
git commit -m "feat: endpoints GET status e DELETE cancel do pedido Lalamove"
```

---

## Self-Review

### Cobertura do spec

| Requisito | Task |
|-----------|------|
| Criar pedido Lalamove quando modal=LALAMOVE | Task 2 (createDispatch fase 2) |
| Salvar LalamoveOrder vinculada ao dispatch | Task 2 (prisma.lalamoveOrder.create) |
| Atualizar dispatch com lalamoveOrderId | Task 2 (prisma.dispatch.update) |
| Não reverter dispatch se Lalamove falhar | Task 2 (try/catch fora da transaction) |
| Não criar pedido se coordenadas ausentes | Task 1 (buildLalamoveStops retorna null) |
| GET status com sync no banco | Task 3 (GET route) |
| DELETE cancel + update status interno | Task 3 (DELETE route) |
| Funções puras testadas sem banco | Task 0 + Task 1 |

### Placeholder scan
Sem TBD, TODO ou "similar ao task N".

### Type consistency
- `LalamovedDispatch` definido em `lib/lalamove-dispatch.ts` — consumido apenas em `despacho.service.ts`
- `StoreInfo` e `DeliveryInfo` são tipos locais em `lalamove-dispatch.ts` — compatíveis com os selects Prisma na Task 2
- `LalamoveStop` de `@/types` — mesma interface usada em `lalamove.service.ts`
- `DispatchStatus.PENDING` como `internalStatus` inicial ao criar LalamoveOrder — correto, motorista ainda não foi atribuído
