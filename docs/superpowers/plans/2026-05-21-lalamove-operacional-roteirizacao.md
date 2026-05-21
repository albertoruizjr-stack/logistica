# Lalamove operacional na roteirização — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador chame o Lalamove pela roteirização (escolhendo o veículo, vendo o preço antes de confirmar), acompanhe as corridas no rastreamento (com link pro cliente) e veja o gasto de Lalamove separado da frota no dashboard.

**Architecture:** Reaproveita a integração Lalamove já existente (`services/lalamove.service.ts`, `lib/lalamove-dispatch.ts`, `services/despacho.service.ts`, webhook, modelos `Dispatch`/`LalamoveOrder`). A mudança central é **propagar o `serviceType`** (hoje cravado em `LALAPRO`) por toda a cadeia e separar a cotação da criação do pedido para o fluxo "cotar → confirmar". UI nova na roteirização (botão por entrega), no rastreamento (seção de corridas) e no dashboard (card dividido). **Sem mudança de schema.**

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma 5 (Supabase Postgres), Tailwind, vitest. Spec: `docs/superpowers/specs/2026-05-21-lalamove-operacional-roteirizacao-design.md`.

**Fase 1 (este plano):** Frentes 0,1,3,4 do spec + só corridas separadas (uma corrida por entrega).
**Fase 2 (fora deste plano):** multi-parada (schema 1:N) e WhatsApp automático via Donna.

---

## Estrutura de arquivos

**Modificados:**
- `lib/lalamove-dispatch.ts` — `dispatchViaLalamove` ganha `opts: { serviceType?, quotationId? }`
- `services/lalamove.service.ts` — `getLalamoveQuote` já aceita `serviceType` ✅ (sem mudança); confirmar
- `services/despacho.service.ts` — `createDispatch` repassa `serviceType`/`quotationId`
- `types/index.ts` — `CreateDispatchInput` ganha `serviceType?`/`quotationId?`
- `lib/constants.ts` — labels amigáveis dos veículos (`LALAMOVE_VEHICLE_LABELS`)
- `app/(app)/roteirizacao/_components/nova-wave-form.tsx` — ação "Lalamove" por entrega
- `app/(app)/rastreamento/page.tsx` — query + render da seção Lalamove
- `app/(app)/dashboard/page.tsx` — card de custo dividido

**Novos:**
- `app/api/lalamove/cotacao/route.ts`
- `app/api/roteirizacao/lalamove/route.ts`
- `app/(app)/roteirizacao/_components/lalamove-call-modal.tsx`
- `components/rastreamento/lalamove-tracking-cards.tsx`
- `tests/lib/lalamove-serviceType.test.ts`
- `lib/phone.ts` + `tests/lib/phone.test.ts`

---

## Task 1: Threading do `serviceType` (base de tudo)

**Files:**
- Modify: `types/index.ts` (`CreateDispatchInput`, ~497-507)
- Modify: `lib/lalamove-dispatch.ts` (`dispatchViaLalamove`, ~73-96)
- Modify: `services/despacho.service.ts` (`createDispatch` Fase 2, ~185-242)
- Modify: `lib/constants.ts` (adicionar labels)
- Test: `tests/lib/lalamove-dispatch.test.ts` (já existe — estender)

- [ ] **Step 1: Escrever teste que falha** em `tests/lib/lalamove-dispatch.test.ts`

```typescript
// adicionar ao describe existente de dispatchViaLalamove
it("usa o serviceType informado na cotação", async () => {
  (getLalamoveQuote as Mock).mockResolvedValue({
    quotationId: "Q1", priceBreakdown: { total: "34.50", currency: "BRL" }, stops: [],
  });
  (createLalamoveOrder as Mock).mockResolvedValue({ orderId: "O1", shareLink: "http://x" });
  await dispatchViaLalamove(mockStore, mockDeliveryRequest, { serviceType: "UV_FIORINO" });
  // 4º argumento de getLalamoveQuote é o serviceType
  expect((getLalamoveQuote as Mock).mock.calls[0][3]).toBe("UV_FIORINO");
});

it("pula a cotação quando recebe quotationId pronto", async () => {
  (createLalamoveOrder as Mock).mockResolvedValue({ orderId: "O1", shareLink: "http://x" });
  const r = await dispatchViaLalamove(mockStore, mockDeliveryRequest, { quotationId: "Q-PRONTO", estimatedPrice: 34.5 });
  expect(getLalamoveQuote).not.toHaveBeenCalled();
  expect(r?.lalamoveOrderId).toBe("O1");
});
```
(Importar `Mock` de vitest e ajustar o mock do topo se necessário.)

- [ ] **Step 2: Rodar e ver falhar**
Run: `node_modules/.bin/vitest run tests/lib/lalamove-dispatch.test.ts`
Expected: FAIL (assinatura de `dispatchViaLalamove` ainda não aceita `opts`).

- [ ] **Step 3: Implementar `opts` em `dispatchViaLalamove`** (`lib/lalamove-dispatch.ts`)

```typescript
export interface DispatchViaLalamoveOpts {
  serviceType?: string;       // default LALAPRO (via getLalamoveQuote)
  quotationId?: string;       // se vier, pula a cotação
  estimatedPrice?: number;    // preço já mostrado ao operador (quando quotationId vem)
}

export async function dispatchViaLalamove(
  store: StoreInfo,
  deliveryRequest: DeliveryInfo,
  opts: DispatchViaLalamoveOpts = {},
): Promise<LalamovedDispatch | null> {
  const stops = buildLalamoveStops(store, deliveryRequest);
  if (!stops) return null;

  let quotationId = opts.quotationId;
  let estimatedPrice = opts.estimatedPrice ?? 0;

  if (!quotationId) {
    const quote = await getLalamoveQuote(stops.origin, stops.destination, false, opts.serviceType);
    if ("reason" in quote) return null;
    quotationId = quote.quotationId;
    estimatedPrice = parseFloat(quote.priceBreakdown.total);
  }

  const order = await createLalamoveOrder(quotationId, stops.origin, stops.destination, store.phone ?? "");
  if ("reason" in order) return null;

  return { lalamoveOrderId: order.orderId, quotationId, estimatedPrice, shareLink: order.shareLink };
}
```

- [ ] **Step 4: Estender `CreateDispatchInput`** (`types/index.ts`)
```typescript
export interface CreateDispatchInput {
  deliveryRequestId?: string;
  transferId?: string;
  storeId: string;
  modal: DispatchModal;
  driverId?: string;
  routeId?: string;
  estimatedCost?: number;
  dispatchedById: string;
  notes?: string;
  serviceType?: string;   // NOVO — tipo de veículo Lalamove
  quotationId?: string;   // NOVO — cotação já feita (pula re-cotação)
}
```

- [ ] **Step 5: Repassar em `createDispatch`** (`services/despacho.service.ts`, bloco Fase 2 onde chama `dispatchViaLalamove(store, deliveryRequest)`)
Trocar a chamada por:
```typescript
const result = await dispatchViaLalamove(store, deliveryRequest, {
  serviceType: input.serviceType,
  quotationId: input.quotationId,
  estimatedPrice: input.estimatedCost,
});
```

- [ ] **Step 6: Labels amigáveis** em `lib/constants.ts`
```typescript
export const LALAMOVE_VEHICLE_LABELS: Record<string, string> = {
  LALAPRO:    "LalaPro (moto)",
  UV_FIORINO: "Utilitário (Fiorino)",
  VAN:        "Van",
  TRUCK330:   "Carreto",
  TRUCK3_5T:  "Caminhão 2,5t",
};
```

- [ ] **Step 7: Rodar testes e tsc**
Run: `node_modules/.bin/vitest run tests/lib/lalamove-dispatch.test.ts && node_modules/.bin/tsc --noEmit`
Expected: PASS + zero erros tsc.

- [ ] **Step 8: Commit**
```bash
git add types/index.ts lib/lalamove-dispatch.ts services/despacho.service.ts lib/constants.ts tests/lib/lalamove-dispatch.test.ts
git commit -m "feat(lalamove): threading de serviceType e quotationId na cadeia de despacho"
```

---

## Task 2: Endpoint de cotação `POST /api/lalamove/cotacao`

**Files:**
- Create: `app/api/lalamove/cotacao/route.ts` (a pasta existe, vazia)
- Reuso: `buildLalamoveStops` (`lib/lalamove-dispatch.ts`), `getLalamoveQuote` (`services/lalamove.service.ts`), auth `getSessionFromRequest` (`lib/auth.ts`)

- [ ] **Step 1: Implementar a rota**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { buildLalamoveStops } from "@/lib/lalamove-dispatch";
import { getLalamoveQuote } from "@/services/lalamove.service";

const ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];
const schema = z.object({ deliveryRequestId: z.string().min(1), serviceType: z.string().min(1) });

// POST /api/lalamove/cotacao → { quotationId, price, currency }
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ROLES.includes(session.role)) return NextResponse.json(apiError("Acesso restrito", "FORBIDDEN"), { status: 403 });

    const body = schema.safeParse(await req.json());
    if (!body.success) return NextResponse.json(apiError("Dados inválidos"), { status: 400 });

    const dr = await prisma.deliveryRequest.findUnique({
      where: { id: body.data.deliveryRequestId },
      select: { deliveryLat: true, deliveryLng: true, deliveryAddress: true, customerName: true, customerPhone: true,
                store: { select: { lat: true, lng: true, address: true, phone: true } } },
    });
    if (!dr) return NextResponse.json(apiError("Entrega não encontrada", "NOT_FOUND"), { status: 404 });

    const stops = buildLalamoveStops(dr.store, dr);
    if (!stops) return NextResponse.json(apiError("Entrega sem coordenadas — não dá pra cotar", "NO_COORDS"), { status: 422 });

    const quote = await getLalamoveQuote(stops.origin, stops.destination, false, body.data.serviceType);
    if ("reason" in quote) return NextResponse.json(apiError("Lalamove não configurado/indisponível", "LALAMOVE_OFF"), { status: 503 });

    return NextResponse.json(apiSuccess({
      quotationId: quote.quotationId,
      price: parseFloat(quote.priceBreakdown.total),
      currency: quote.priceBreakdown.currency ?? "BRL",
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao cotar";
    console.error("[POST /api/lalamove/cotacao]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
```
> Nota: `buildLalamoveStops` espera `{lat,lng,address,phone}` na loja e `{deliveryLat,deliveryLng,deliveryAddress,customerName,customerPhone}` na entrega — o `select` acima já entrega nesse formato.

- [ ] **Step 2: tsc**
Run: `node_modules/.bin/tsc --noEmit` → zero erros.

- [ ] **Step 3: Commit**
```bash
git add app/api/lalamove/cotacao/route.ts
git commit -m "feat(lalamove): endpoint de cotacao por serviceType"
```

---

## Task 3: Endpoint de despacho `POST /api/roteirizacao/lalamove`

**Files:**
- Create: `app/api/roteirizacao/lalamove/route.ts`
- Reuso: `createDispatch` (`services/despacho.service.ts`), auth

- [ ] **Step 1: Implementar a rota** (Fase 1: só `mode SEPARATE`, uma corrida por entrega)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { createDispatch } from "@/services/despacho.service";
import { DispatchModal } from "@prisma/client";

const ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];
const schema = z.object({
  deliveryRequestId: z.string().min(1),
  serviceType:       z.string().min(1),
  quotationId:       z.string().optional(),
  estimatedPrice:    z.number().optional(),
});

// POST /api/roteirizacao/lalamove → cria Dispatch LALAMOVE para UMA entrega
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ROLES.includes(session.role)) return NextResponse.json(apiError("Acesso restrito", "FORBIDDEN"), { status: 403 });

    const body = schema.safeParse(await req.json());
    if (!body.success) return NextResponse.json(apiError("Dados inválidos"), { status: 400 });

    const dr = await prisma.deliveryRequest.findUnique({
      where: { id: body.data.deliveryRequestId },
      select: { id: true, status: true, storeId: true },
    });
    if (!dr) return NextResponse.json(apiError("Entrega não encontrada", "NOT_FOUND"), { status: 404 });
    if (dr.status !== "PRONTO_ROTEIRIZACAO") {
      return NextResponse.json(apiError(`Entrega não está elegível (status ${dr.status})`, "NOT_ELIGIBLE"), { status: 409 });
    }

    const dispatch = await createDispatch({
      deliveryRequestId: dr.id,
      storeId:           dr.storeId,
      modal:             DispatchModal.LALAMOVE,
      dispatchedById:    session.userId,
      serviceType:       body.data.serviceType,
      quotationId:       body.data.quotationId,
      estimatedCost:     body.data.estimatedPrice,
      notes:             `Lalamove ${body.data.serviceType} via roteirização`,
    });

    return NextResponse.json(apiSuccess({ dispatchId: dispatch.id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao chamar Lalamove";
    console.error("[POST /api/roteirizacao/lalamove]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
```
> `createDispatch` já transiciona a DR para DISPATCHED, cria a `LalamoveOrder` e atualiza o custo (ver `services/despacho.service.ts`). Como a DR sai de PRONTO_ROTEIRIZACAO, ela some da lista de elegíveis automaticamente.

- [ ] **Step 2: tsc** → zero erros.
- [ ] **Step 3: Commit**
```bash
git add app/api/roteirizacao/lalamove/route.ts
git commit -m "feat(lalamove): endpoint de despacho via roteirizacao (corrida separada)"
```

---

## Task 4: UI — botão + modal "Lalamove" na roteirização

**Files:**
- Create: `app/(app)/roteirizacao/_components/lalamove-call-modal.tsx`
- Modify: `app/(app)/roteirizacao/_components/nova-wave-form.tsx` (lista de elegíveis ~286-330)

- [ ] **Step 1: Criar `lalamove-call-modal.tsx`** (client component, fluxo veículo → cotar → confirmar)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LALAMOVE_VEHICLE_LABELS } from "@/lib/constants";

interface Props {
  delivery: { id: string; label: string; address: string };
  onClose: () => void;
}
const VEHICLES = Object.keys(LALAMOVE_VEHICLE_LABELS); // LALAPRO, UV_FIORINO, ...

export function LalamoveCallModal({ delivery, onClose }: Props) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState("UV_FIORINO");
  const [quote, setQuote] = useState<{ quotationId: string; price: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cotar() {
    setLoading(true); setError(null); setQuote(null);
    try {
      const res = await fetch("/api/lalamove/cotacao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryRequestId: delivery.id, serviceType: vehicle }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) { setError(j.error ?? "Erro ao cotar"); return; }
      setQuote({ quotationId: j.data.quotationId, price: j.data.price });
    } catch (e) { setError(e instanceof Error ? e.message : "Erro de conexão"); }
    finally { setLoading(false); }
  }

  async function confirmar() {
    if (!quote) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/roteirizacao/lalamove", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryRequestId: delivery.id, serviceType: vehicle, quotationId: quote.quotationId, estimatedPrice: quote.price }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        // quotationId pode ter expirado → re-cotar
        setError((j.error ?? "Erro ao confirmar") + " — cote novamente.");
        setQuote(null);
        return;
      }
      onClose();
      router.refresh(); // entrega sai da lista de elegíveis
    } catch (e) { setError(e instanceof Error ? e.message : "Erro de conexão"); }
    finally { setLoading(false); }
  }

  // ... markup: <select> de VEHICLES (labels via LALAMOVE_VEHICLE_LABELS),
  // botão [Cotar] → mostra "R$ price", botão [Confirmar] habilitado só com quote.
  // Seguir o estilo claro das telas (app), não o tema escuro da operação.
}
```

- [ ] **Step 2: Ligar no `nova-wave-form.tsx`**
- Adicionar estado: `const [lalaTarget, setLalaTarget] = useState<EligibleRequest | null>(null);`
- Em cada card de entrega elegível (perto do `onClick={() => toggleReq(r.id)}`, ~292), adicionar um botão pequeno "Lalamove" que faz `e.stopPropagation(); setLalaTarget(r);` (não deve disparar o toggle de seleção).
- No fim do componente, renderizar `{lalaTarget && <LalamoveCallModal delivery={{ id: lalaTarget.id, label: ..., address: ... }} onClose={() => setLalaTarget(null)} />}`.
- Importar `LalamoveCallModal`.

- [ ] **Step 3: tsc + lint**
Run: `node_modules/.bin/tsc --noEmit`
Expected: zero erros.

- [ ] **Step 4: Commit**
```bash
git add "app/(app)/roteirizacao/_components/lalamove-call-modal.tsx" "app/(app)/roteirizacao/_components/nova-wave-form.tsx"
git commit -m "feat(lalamove): botao Lalamove por entrega na roteirizacao (cotar -> confirmar)"
```

---

## Task 5: Rastreamento — seção "Corridas Lalamove"

**Files:**
- Create: `lib/phone.ts` + `tests/lib/phone.test.ts`
- Create: `components/rastreamento/lalamove-tracking-cards.tsx`
- Modify: `app/(app)/rastreamento/page.tsx` (server component — adicionar query + render)

- [ ] **Step 1: Teste do helper de telefone** `tests/lib/phone.test.ts`
```typescript
import { describe, it, expect } from "vitest";
import { toWhatsappNumber } from "@/lib/phone";
describe("toWhatsappNumber", () => {
  it("normaliza fixo/celular SP para 55+DDD+numero", () => {
    expect(toWhatsappNumber("(11) 98888-7777")).toBe("5511988887777");
  });
  it("não duplica o 55 se já tiver", () => {
    expect(toWhatsappNumber("5511988887777")).toBe("5511988887777");
  });
  it("retorna null para telefone vazio/curto", () => {
    expect(toWhatsappNumber("")).toBeNull();
    expect(toWhatsappNumber("123")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**
Run: `node_modules/.bin/vitest run tests/lib/phone.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `lib/phone.ts`**
```typescript
// Normaliza um telefone BR para o formato do wa.me (55 + DDD + número, só dígitos).
export function toWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length < 10) return null;          // precisa de DDD + número
  if (!d.startsWith("55")) d = "55" + d;   // prefixo Brasil
  return d;
}
```

- [ ] **Step 4: Rodar e ver passar**
Run: `node_modules/.bin/vitest run tests/lib/phone.test.ts` → PASS.

- [ ] **Step 5: Criar `lalamove-tracking-cards.tsx`** (client; recebe corridas como prop)
Card por corrida: veículo (label), badge de status, motorista (nome/placa/telefone quando houver), preço, e 3 ações:
- **Acompanhar** → `<a href={shareLink} target="_blank" rel="noopener">`
- **WhatsApp** → `const n = toWhatsappNumber(customerPhone); href = 'https://wa.me/' + n + '?text=' + encodeURIComponent('Olá! Acompanhe sua entrega: ' + shareLink)` (botão desabilitado se `!n || !shareLink`)
- **Copiar link** → `navigator.clipboard.writeText(shareLink)`
Tipo da prop:
```typescript
export interface LalamoveRide {
  orderId: string; vehicle: string; status: string;
  driverName: string | null; driverPhone: string | null; driverPlate: string | null;
  price: number | null; shareLink: string | null;
  customerName: string; customerPhone: string | null; address: string;
}
```

- [ ] **Step 6: Query + render no `rastreamento/page.tsx`** (server component)
Adicionar antes do render (junto da query de `drivers`):
```typescript
const lalamoveOrders = await prisma.lalamoveOrder.findMany({
  where: { internalStatus: { in: ["PENDING", "ASSIGNED", "IN_TRANSIT"] } },
  include: {
    dispatch: {
      include: {
        deliveryRequest: { select: { customerName: true, customerPhone: true, deliveryAddress: true } },
      },
    },
  },
  orderBy: { createdAt: "desc" },
});
const rides = lalamoveOrders.map((o) => ({
  orderId: o.lalamoveOrderId,
  vehicle: o.dispatch?.notes?.match(/LALAPRO|UV_FIORINO|VAN|TRUCK330|TRUCK3_5T/)?.[0] ?? "LALAPRO",
  status: o.status,
  driverName: o.driverName, driverPhone: o.driverPhone, driverPlate: o.driverPlate,
  price: o.finalPrice ?? o.estimatedPrice, shareLink: o.shareLink,
  customerName: o.dispatch?.deliveryRequest?.customerName ?? "Cliente",
  customerPhone: o.dispatch?.deliveryRequest?.customerPhone ?? null,
  address: o.dispatch?.deliveryRequest?.deliveryAddress ?? "",
}));
```
Renderizar `<LalamoveTrackingCards rides={rides} />` numa seção acima/abaixo de `<DriverCards />`. A página já recarrega a cada 30s.

- [ ] **Step 7: tsc + testes**
Run: `node_modules/.bin/vitest run tests/lib/phone.test.ts && node_modules/.bin/tsc --noEmit` → PASS + zero erros.

- [ ] **Step 8: Commit**
```bash
git add lib/phone.ts tests/lib/phone.test.ts components/rastreamento/lalamove-tracking-cards.tsx "app/(app)/rastreamento/page.tsx"
git commit -m "feat(lalamove): secao de corridas no rastreamento (acompanhar/WhatsApp/copiar)"
```

---

## Task 6: Dashboard — card de custo dividido

**Files:**
- Modify: `app/(app)/dashboard/page.tsx` (agregação ~110-129 + KPI ~266-267)

- [ ] **Step 1: Adicionar agregação por modal (hoje)** junto das outras queries do dashboard
```typescript
const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
const dispatchesHoje = await prisma.dispatch.groupBy({
  by: ["modal"],
  where: { dispatchedAt: { gte: startOfToday } },
  _count: { _all: true },
  _sum: { actualCost: true, estimatedCost: true },
});
const lalamoveAgg = dispatchesHoje.find((d) => d.modal === "LALAMOVE");
const frotaCount  = dispatchesHoje.find((d) => d.modal === "INTERNAL_ROUTE")?._count._all ?? 0;
const lalamoveGasto = (lalamoveAgg?._sum.actualCost ?? 0) || (lalamoveAgg?._sum.estimatedCost ?? 0);
const lalamoveCount = lalamoveAgg?._count._all ?? 0;
```

- [ ] **Step 2: Substituir o KPI único** "Custo Logístico Hoje" (linha ~267) por um card composto
Manter o `KpiLink` para `/auditoria`, mas com o conteúdo dividido (headline = R$ Lalamove; sub: 🚐 frota = N entregas, 🛵 Lalamove = N · R$). Reaproveitar o componente de card existente ou um bloco com o mesmo estilo das telas claras:
```tsx
<KpiLink
  href="/auditoria"
  label="Custo Logístico Hoje"
  value={`${formatCurrency(lalamoveGasto)} em Lalamove`}
  icon={DollarSign}
  variant="default"
  subtitle={`🚐 Frota: ${frotaCount} entregas · 🛵 Lalamove: ${lalamoveCount}`}
/>
```
> Se `KpiLink` não tiver prop `subtitle`, adicionar (opcional) — checar `components/.../KpiLink` e estender de forma retrocompatível.

- [ ] **Step 3: tsc**
Run: `node_modules/.bin/tsc --noEmit` → zero erros.

- [ ] **Step 4: Commit**
```bash
git add "app/(app)/dashboard/page.tsx"
git commit -m "feat(lalamove): card de custo dividido (frota x Lalamove) no dashboard"
```

---

## Verificação final (antes de abrir PR / deploy)

- [ ] `node_modules/.bin/tsc --noEmit` → zero erros
- [ ] `node_modules/.bin/vitest run` → só as 4 falhas pré-existentes do `pilar1-stock-lock` (mock desatualizado, não relacionadas)
- [ ] `npm run build` → compila
- [ ] **Reteste de conectividade Lalamove** antes de validar em produção (a API andou dando 502 — ver memória/spec). Se estiver offline, o fluxo cotar/confirmar mostra erro tratado e nada quebra.
- [ ] Smoke manual: `/roteirizacao` → botão Lalamove → cotar → confirmar → entrega some dos elegíveis → aparece em `/rastreamento` → testar Acompanhar/WhatsApp/Copiar → conferir card no dashboard.

---

## Notas de risco (do spec)

- **Lalamove 502:** retestar antes; padrão "cria Dispatch primeiro, chama Lalamove fora da transação" já protege (corrida falha não perde o registro, dá retry).
- **quotationId expira em minutos:** o modal re-cota se o confirmar falhar por expiração.
- **Sem mudança de schema** nesta fase.
