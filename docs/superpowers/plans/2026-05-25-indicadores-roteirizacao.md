# Indicadores na lista de roteirização — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar selos de urgência (⚡App / 🔴Hoje), data de agendamento (📅) e loja de origem (🏪) em cada entrega da lista de roteirização, ordenando por prioridade e impedindo que "Selecionar todas" inclua entregas agendadas para o futuro.

**Architecture:** Lógica de classificação/ordenação isolada num helper puro (`lib/eligible-delivery.ts`), testado por unidade. O server component (`page.tsx`) amplia a query, classifica e ordena, e passa a lista enriquecida para o client component (`nova-wave-form.tsx`), que só renderiza selos e ajusta a seleção. Sem migration, sem mudança no Spoke.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma, Vitest, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-25-indicadores-roteirizacao-design.md`

---

## File Structure

- **Create** `lib/eligible-delivery.ts` — classificação (selos + rank) e ordenação. Lógica pura, sem React/Prisma.
- **Create** `tests/lib/eligible-delivery.test.ts` — testes de unidade do helper.
- **Modify** `app/(app)/roteirizacao/page.tsx` — ampliar `select`, carregar lojas, classificar + ordenar, passar lista enriquecida.
- **Modify** `app/(app)/roteirizacao/_components/nova-wave-form.tsx` — interface, selos, "Selecionar de hoje", contadores, legenda.

---

## Task 1: Helper de classificação (lógica pura, TDD)

**Files:**
- Create: `lib/eligible-delivery.ts`
- Test: `tests/lib/eligible-delivery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/eligible-delivery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  classifyEligibleDelivery,
  sortEligibleDeliveries,
  type ClassifyContext,
  type EligibleDeliveryInput,
} from "@/lib/eligible-delivery";

// Hoje = 2026-05-25 12:00. CD = loja "cd-id" (code "132"); Morumbi = "morumbi-id" (code "067").
const NOW = new Date("2026-05-25T12:00:00");
const ctx: ClassifyContext = {
  cdCode:        "132",
  cdStoreId:     "cd-id",
  storeCodeById: new Map([
    ["cd-id", "132"],
    ["morumbi-id", "067"],
  ]),
  now: NOW,
};

function baseInput(over: Partial<EligibleDeliveryInput> = {}): EligibleDeliveryInput {
  return {
    slaType:         "STANDARD",
    scheduledFor:    null,
    dispatchStoreId: "cd-id",
    entregaPeloCD:   true,
    storeId:         "cd-id",
    ...over,
  };
}

describe("classifyEligibleDelivery", () => {
  it("EXPRESS → appUrgent e rank 0", () => {
    const f = classifyEligibleDelivery(baseInput({ slaType: "EXPRESS" }), ctx);
    expect(f.appUrgent).toBe(true);
    expect(f.todayUrgent).toBe(false);
    expect(f.sortRank).toBe(0);
  });

  it("URGENT → todayUrgent e rank 1", () => {
    const f = classifyEligibleDelivery(baseInput({ slaType: "URGENT" }), ctx);
    expect(f.todayUrgent).toBe(true);
    expect(f.appUrgent).toBe(false);
    expect(f.sortRank).toBe(1);
  });

  it("STANDARD sem data → rank 2, sem selos de urgência", () => {
    const f = classifyEligibleDelivery(baseInput(), ctx);
    expect(f.appUrgent).toBe(false);
    expect(f.todayUrgent).toBe(false);
    expect(f.isFutureScheduled).toBe(false);
    expect(f.sortRank).toBe(2);
  });

  it("scheduledFor futura → isFutureScheduled, label dd/MM, rank 3 (prevalece sobre EXPRESS)", () => {
    const f = classifyEligibleDelivery(
      baseInput({ slaType: "EXPRESS", scheduledFor: new Date("2026-05-28T09:00:00") }),
      ctx,
    );
    expect(f.isFutureScheduled).toBe(true);
    expect(f.scheduledDateLabel).toBe("28/05");
    expect(f.sortRank).toBe(3);
  });

  it("scheduledFor hoje → não-futura, sem label", () => {
    const f = classifyEligibleDelivery(
      baseInput({ scheduledFor: new Date("2026-05-25T18:00:00") }),
      ctx,
    );
    expect(f.isFutureScheduled).toBe(false);
    expect(f.scheduledDateLabel).toBeNull();
    expect(f.sortRank).toBe(2);
  });

  it("loja de despacho != 132 → originStoreCode preenchido", () => {
    const f = classifyEligibleDelivery(
      baseInput({ dispatchStoreId: "morumbi-id", entregaPeloCD: false, storeId: "morumbi-id" }),
      ctx,
    );
    expect(f.originStoreCode).toBe("067");
  });

  it("loja de despacho = 132 → originStoreCode null", () => {
    const f = classifyEligibleDelivery(baseInput(), ctx);
    expect(f.originStoreCode).toBeNull();
  });

  it("sem dispatchStoreId usa fallback entregaPeloCD/storeId", () => {
    const f = classifyEligibleDelivery(
      baseInput({ dispatchStoreId: null, entregaPeloCD: false, storeId: "morumbi-id" }),
      ctx,
    );
    expect(f.originStoreCode).toBe("067");
  });
});

describe("sortEligibleDeliveries", () => {
  it("ordena App → Hoje → normal → futuras (futuras por data crescente)", () => {
    const mk = (id: string, sortRank: number, scheduledFor: Date | null, createdAt: Date) =>
      ({ id, sortRank, scheduledFor, createdAt });
    const list = [
      mk("normal",    2, null,                              new Date("2026-05-25T08:00:00")),
      mk("futura-30", 3, new Date("2026-05-30T08:00:00"),   new Date("2026-05-25T08:00:00")),
      mk("app",       0, null,                              new Date("2026-05-25T08:00:00")),
      mk("futura-28", 3, new Date("2026-05-28T08:00:00"),   new Date("2026-05-25T08:00:00")),
      mk("hoje",      1, null,                              new Date("2026-05-25T08:00:00")),
    ];
    const sorted = sortEligibleDeliveries(list).map((x) => x.id);
    expect(sorted).toEqual(["app", "hoje", "normal", "futura-28", "futura-30"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/eligible-delivery.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/eligible-delivery"` (módulo não existe ainda).

- [ ] **Step 3: Write minimal implementation**

Create `lib/eligible-delivery.ts`:

```ts
// Classificação e ordenação das entregas elegíveis na roteirização.
// Lógica pura (sem React/Prisma) — testável isoladamente.
//
// Selos derivados de campos já existentes em DeliveryRequest:
//   ⚡ App    = slaType EXPRESS  (precisa Lalamove/99)
//   🔴 Hoje   = slaType URGENT   (same-day pela frota)
//   📅 dd/MM  = scheduledFor depois de hoje (agendada futura)
//   🏪 código = loja de despacho != CD (132)

export interface EligibleDeliveryInput {
  slaType:         string;
  scheduledFor:    Date | null;
  dispatchStoreId: string | null;
  entregaPeloCD:   boolean;
  storeId:         string;
}

export interface ClassifyContext {
  cdCode:        string;               // "132"
  cdStoreId:     string | null;        // id da loja com code "132"
  storeCodeById: Map<string, string>;  // id -> code
  now:           Date;
}

export interface EligibleDeliveryFlags {
  appUrgent:          boolean;
  todayUrgent:        boolean;
  scheduledDateLabel: string | null;   // "28/05" quando futura, senão null
  isFutureScheduled:  boolean;
  originStoreCode:    string | null;   // "067" quando != CD, senão null
  sortRank:           number;          // 0 app · 1 hoje · 2 normal · 3 futura
}

function endOfDayMs(d: Date): number {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e.getTime();
}

// Formata "dd/MM" sem depender de locale/ICU (determinístico em qualquer ambiente).
function formatDayMonth(d: Date): string {
  const day   = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

export function classifyEligibleDelivery(
  input: EligibleDeliveryInput,
  ctx:   ClassifyContext,
): EligibleDeliveryFlags {
  const isFutureScheduled =
    input.scheduledFor != null && input.scheduledFor.getTime() > endOfDayMs(ctx.now);

  const appUrgent   = input.slaType === "EXPRESS";
  const todayUrgent = input.slaType === "URGENT";

  const scheduledDateLabel =
    isFutureScheduled && input.scheduledFor ? formatDayMonth(input.scheduledFor) : null;

  const originStoreId =
    input.dispatchStoreId ?? (input.entregaPeloCD ? ctx.cdStoreId : input.storeId);
  const originCode = originStoreId ? ctx.storeCodeById.get(originStoreId) ?? null : null;
  const originStoreCode = originCode && originCode !== ctx.cdCode ? originCode : null;

  const sortRank =
    isFutureScheduled ? 3 :
    appUrgent         ? 0 :
    todayUrgent       ? 1 :
                        2;

  return {
    appUrgent,
    todayUrgent,
    scheduledDateLabel,
    isFutureScheduled,
    originStoreCode,
    sortRank,
  };
}

export function sortEligibleDeliveries<
  T extends { sortRank: number; scheduledFor: Date | null; createdAt: Date },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    if (a.sortRank === 3) {
      const at = a.scheduledFor?.getTime() ?? 0;
      const bt = b.scheduledFor?.getTime() ?? 0;
      if (at !== bt) return at - bt;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/eligible-delivery.test.ts`
Expected: PASS — 9 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add lib/eligible-delivery.ts tests/lib/eligible-delivery.test.ts
git commit -m "feat(roteirizacao): helper de classificacao de entregas elegiveis"
```

---

## Task 2: Server — ampliar query, classificar e ordenar

**Files:**
- Modify: `app/(app)/roteirizacao/page.tsx`

- [ ] **Step 1: Importar o helper**

No topo de `page.tsx`, após o import de `route-sequence` (linha ~13), adicionar:

```ts
import { classifyEligibleDelivery, sortEligibleDeliveries } from "@/lib/eligible-delivery";
```

- [ ] **Step 2: Ampliar o `select` de `eligibleRequests`**

Substituir o bloco `prisma.deliveryRequest.findMany({...})` (dentro do `Promise.all`, ~linhas 56-74) por:

```ts
    prisma.deliveryRequest.findMany({
      where: {
        status: "PRONTO_ROTEIRIZACAO",
        deliveryAddress: { not: "" },
      },
      select: {
        id:              true,
        orderNumber:     true,
        invoiceNumber:   true,
        customerName:    true,
        deliveryAddress: true,
        deliveryCity:    true,
        totalWeightKg:   true,
        totalLatas:      true,
        volumeBreakdown: true,
        // novos: base dos selos de urgência / agendamento / loja de origem
        slaType:         true,
        scheduledFor:    true,
        dispatchStoreId: true,
        entregaPeloCD:   true,
        storeId:         true,
        createdAt:       true,
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
```

- [ ] **Step 3: Adicionar a query de lojas ao `Promise.all`**

Como último item do array passado ao `Promise.all` (após o `prisma.route.findMany({...})`, antes do `]);` na ~linha 121), adicionar:

```ts
    // Lojas ativas — mapa id→code para resolver a loja de origem das entregas.
    prisma.store.findMany({
      where:  { active: true },
      select: { id: true, code: true },
    }),
```

E atualizar a desestruturação (linha ~55) para incluir `allStores`:

```ts
  const [eligibleRequests, availableDrivers, recentWaves, rawTransfers, activeRoutes, allStores] = await Promise.all([
```

- [ ] **Step 4: Classificar e ordenar após o `Promise.all`**

Logo após o fechamento do `Promise.all` (`]);`, ~linha 121), adicionar:

```ts
  // Enriquece e ordena as entregas elegíveis (selos + prioridade).
  const storeCodeById = new Map(allStores.map((s) => [s.id, s.code]));
  const cdStoreId = allStores.find((s) => s.code === "132")?.id ?? null;
  const classifyCtx = { cdCode: "132", cdStoreId, storeCodeById, now: new Date() };

  const eligibleEnriched = sortEligibleDeliveries(
    eligibleRequests.map((r) => ({ ...r, ...classifyEligibleDelivery(r, classifyCtx) })),
  );
```

- [ ] **Step 5: Passar a lista enriquecida para o form**

Substituir o prop `eligibleRequests={...}` do `<NovaWaveForm ... />` (~linhas 214-217) por:

```tsx
            eligibleRequests={eligibleEnriched.map((r) => ({
              id:                 r.id,
              orderNumber:        r.orderNumber,
              invoiceNumber:      r.invoiceNumber,
              customerName:       r.customerName,
              deliveryAddress:    r.deliveryAddress,
              deliveryCity:       r.deliveryCity,
              totalWeightKg:      r.totalWeightKg,
              totalLatas:         r.totalLatas,
              volumeBreakdown:    (r.volumeBreakdown as Record<string, number> | null) ?? null,
              appUrgent:          r.appUrgent,
              todayUrgent:        r.todayUrgent,
              scheduledDateLabel: r.scheduledDateLabel,
              isFutureScheduled:  r.isFutureScheduled,
              originStoreCode:    r.originStoreCode,
            }))}
```

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. (Se o build de tipos do Next reclamar do prop novo, é porque a interface do form ainda não tem os campos — será resolvido na Task 3. Avançar mesmo assim; o `tsc` definitivo roda no fim da Task 3.)

- [ ] **Step 7: Commit**

```bash
git add app/(app)/roteirizacao/page.tsx
git commit -m "feat(roteirizacao): classifica e ordena entregas elegiveis no server"
```

---

## Task 3: Client — selos, seleção de hoje, contadores, legenda

**Files:**
- Modify: `app/(app)/roteirizacao/_components/nova-wave-form.tsx`

- [ ] **Step 1: Adicionar ícones ao import do lucide-react**

Substituir a linha de import (linha 5):

```tsx
import { Loader2, Play, AlertTriangle, CheckCircle2, Truck, PackageCheck, X, ArrowRight } from "lucide-react";
```

por:

```tsx
import { Loader2, Play, AlertTriangle, CheckCircle2, Truck, PackageCheck, X, ArrowRight, Zap, Calendar, Store } from "lucide-react";
```

- [ ] **Step 2: Estender a interface `EligibleRequest`**

Substituir a interface `EligibleRequest` (linhas ~10-20) por:

```tsx
interface EligibleRequest {
  id:               string;
  orderNumber:      string | null;
  invoiceNumber:    string | null;
  customerName:     string;
  deliveryAddress:  string;
  deliveryCity:     string | null;
  totalWeightKg:    number | null;
  totalLatas:       number | null;
  volumeBreakdown:  Record<string, number> | null;
  // selos de classificação (calculados no server)
  appUrgent:          boolean;
  todayUrgent:        boolean;
  scheduledDateLabel: string | null;
  isFutureScheduled:  boolean;
  originStoreCode:    string | null;
}
```

- [ ] **Step 3: Adicionar o componente de selos**

No fim do arquivo (após a função `WaveProgressPanel`), adicionar:

```tsx
// Selos de classificação exibidos na linha de cada entrega elegível.
function DeliveryBadges({ r }: { r: EligibleRequest }) {
  return (
    <>
      {r.appUrgent && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 flex-shrink-0">
          <Zap className="w-2.5 h-2.5" /> App
        </span>
      )}
      {r.todayUrgent && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-700 bg-red-100 rounded px-1.5 py-0.5 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Hoje
        </span>
      )}
      {r.scheduledDateLabel && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-violet-700 bg-violet-100 rounded px-1.5 py-0.5 flex-shrink-0">
          <Calendar className="w-2.5 h-2.5" /> {r.scheduledDateLabel}
        </span>
      )}
      {r.originStoreCode && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-sky-700 bg-sky-100 rounded px-1.5 py-0.5 flex-shrink-0">
          <Store className="w-2.5 h-2.5" /> {r.originStoreCode}
        </span>
      )}
    </>
  );
}
```

- [ ] **Step 4: Calcular "de hoje" e contadores**

Dentro do componente `NovaWaveForm`, logo após o cálculo de `excessKg` (~linha 119), adicionar:

```tsx
  // Entregas de hoje (não-futuras) — base do "Selecionar de hoje".
  const todayIds = eligibleRequests.filter((r) => !r.isFutureScheduled).map((r) => r.id);
  const allTodaySelected = todayIds.length > 0 && todayIds.every((id) => reqIds.has(id));
  const urgentCount = eligibleRequests.filter(
    (r) => (r.appUrgent || r.todayUrgent) && !r.isFutureScheduled,
  ).length;
  const scheduledCount = eligibleRequests.filter((r) => r.isFutureScheduled).length;
```

- [ ] **Step 5: Atualizar o rótulo e o botão de seleção em massa**

Substituir o bloco `<label className="flex items-center justify-between mb-2">...</label>` da seção **Entregas** (linhas ~357-374) por:

```tsx
        <label className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700">
            Entregas elegíveis ({reqIds.size} de {eligibleRequests.length})
            {urgentCount > 0 && <span className="text-red-600"> · {urgentCount} urgentes</span>}
            {scheduledCount > 0 && <span className="text-violet-600"> · {scheduledCount} agendadas</span>}
          </span>
          {todayIds.length > 0 && (
            <button
              type="button"
              onClick={() => setReqIds(allTodaySelected ? new Set() : new Set(todayIds))}
              className="text-[11px] text-orange-600 hover:underline font-medium"
            >
              {allTodaySelected ? "Limpar" : `Selecionar de hoje (${todayIds.length})`}
            </button>
          )}
        </label>
```

- [ ] **Step 6: Renderizar os selos na linha da entrega**

Substituir o bloco do título da entrega (o `<div className="min-w-0 flex-1">` que contém o `<p>` com NF/PD · cliente e o `<p>` do endereço, ~linhas 404-415) por:

```tsx
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                      <span className="flex-shrink-0">
                        {r.invoiceNumber
                          ? `NF ${r.invoiceNumber}`
                          : r.orderNumber
                            ? `PD ${r.orderNumber}`
                            : `#${r.id.slice(-6)}`}
                      </span>
                      <DeliveryBadges r={r} />
                      <span className="text-gray-400 font-normal flex-shrink-0">·</span>
                      <span className="truncate">{r.customerName}</span>
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {r.deliveryAddress}{r.deliveryCity && ` — ${r.deliveryCity}`}
                    </p>
                  </div>
```

- [ ] **Step 7: Adicionar a legenda no rodapé da lista**

Logo após o fechamento do `<div className="border border-gray-200 rounded-lg max-h-96 ...">` que envolve a lista de entregas (o `</div>` que fecha a lista, antes do fechamento da seção **Entregas** ~linha 439), adicionar:

```tsx
            <p className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-0.5"><Zap className="w-2.5 h-2.5 text-amber-500" /> App (Lalamove/99)</span>
              <span className="inline-flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Hoje (frota)</span>
              <span className="inline-flex items-center gap-0.5"><Calendar className="w-2.5 h-2.5 text-violet-500" /> agendada</span>
              <span className="inline-flex items-center gap-0.5"><Store className="w-2.5 h-2.5 text-sky-500" /> outra loja</span>
            </p>
```

(Inserir logo após a `</div>` da lista e dentro da `<div>` da seção "Entregas", de modo que apareça só quando `eligibleRequests.length > 0` — colocar dentro do mesmo bloco condicional que renderiza a lista.)

- [ ] **Step 8: Verificar tipos e testes**

Run: `npx tsc --noEmit`
Expected: sem erros (interface do form agora bate com o prop do `page.tsx`).

Run: `npx vitest run tests/lib/eligible-delivery.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 9: Conferência visual**

Run: `npm run dev` e abrir `/roteirizacao`.
Verificar:
- Entregas EXPRESS mostram ⚡App; URGENT mostram 🔴Hoje; agendadas futuras mostram 📅 dd/MM; entregas que saem de outra loja mostram 🏪 código.
- Ordem: App → Hoje → normais → agendadas (no fim).
- "Selecionar de hoje (N)" ignora as agendadas futuras.
- Contadores e legenda aparecem corretamente.

- [ ] **Step 10: Commit**

```bash
git add app/(app)/roteirizacao/_components/nova-wave-form.tsx
git commit -m "feat(roteirizacao): selos de urgencia/agendamento/loja na lista de entregas"
```

---

## Self-Review

**Spec coverage:**
- ⚡App / 🔴Hoje / 📅 / 🏪 → Task 1 (classificação) + Task 3 (render). ✓
- Resolução da loja de origem com fallback → Task 1 (`originStoreId`) + Task 2 (mapa de lojas). ✓
- Ordenação App→Hoje→normal→futura → Task 1 (`sortRank` + `sortEligibleDeliveries`) + Task 2 (aplicação). ✓
- "Selecionar de hoje" ignora futuras → Task 3 Step 4-5. ✓
- Contadores + legenda → Task 3 Step 4, 5, 7. ✓
- Sem migration / sem mudança no Spoke → nenhuma task toca schema ou `spoke.service`. ✓
- Casos de borda (sem dispatchStoreId, data passada, código fora do mapa, EXPRESS+futura) → cobertos nos testes da Task 1. ✓

**Placeholder scan:** Nenhum TBD/TODO; todo passo de código tem o código completo. ✓

**Type consistency:** `EligibleDeliveryFlags` (Task 1) define `appUrgent`, `todayUrgent`, `scheduledDateLabel`, `isFutureScheduled`, `originStoreCode`, `sortRank` — exatamente os campos consumidos no `page.tsx` (Task 2) e na interface do form (Task 3). `classifyEligibleDelivery`/`sortEligibleDeliveries` têm a mesma assinatura em todas as referências. ✓
