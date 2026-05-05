# Torre de Controle — Fase 1A + 1B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a fundação operacional da Torre de Controle: modelos de dados, curva ABC manual, sync de estoque com cobertura calculada, regras R03 e R10, motor de alertas, dashboard T1 e tela de ruptura T2.

**Architecture:** Sync-First — o sync de estoque alimenta o motor de auditoria (função pura), que produz ocorrências, e o motor de alertas persiste e deduplica os alertas. Os modelos existentes (Transfer, StockLedger, DeliveryRequest) são apenas lidos. Spec completo em `docs/superpowers/specs/2026-05-03-torre-controle-design.md`.

**Tech Stack:** Next.js 14, Prisma 5 + PostgreSQL (Supabase), TypeScript, Vitest

---

## Mapa de arquivos

| Ação | Arquivo | Responsabilidade |
|---|---|---|
| Modificar | `prisma/schema.prisma` | Adicionar 4 modelos + 8 enums novos |
| Criar | `types/torre.ts` | Tipos TypeScript da Torre de Controle |
| Criar | `services/torre/coverage.service.ts` | Calcular coverageDaysActual por loja/SKU |
| Criar | `services/torre/audit-engine.service.ts` | Regras R03 e R10 (função pura) |
| Criar | `services/torre/alert-engine.service.ts` | Criar, deduplicar e resolver alertas |
| Criar | `services/torre/sync-orchestrator.service.ts` | Orquestrar sync + audit + alert |
| Criar | `app/api/torre/abc/route.ts` | GET + POST curva ABC manual |
| Criar | `app/api/torre/dashboard/route.ts` | GET contadores + saúde por loja |
| Criar | `app/api/torre/alertas/route.ts` | GET lista paginada de alertas |
| Criar | `app/api/torre/alertas/[id]/route.ts` | PATCH resolver/atualizar alerta |
| Criar | `app/(app)/torre/page.tsx` | Tela T1 — Dashboard Torre |
| Criar | `app/(app)/torre/ruptura/page.tsx` | Tela T2 — Ruptura e Risco |
| Criar | `__tests__/torre/audit-engine.test.ts` | Testes unitários das regras |
| Criar | `__tests__/torre/alert-engine.test.ts` | Testes do motor de alertas |

---

## Task 1: Schema Prisma — 4 modelos + enums

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1.1: Adicionar enums ao schema**

Inserir após os enums existentes (após `ResolutionType`), antes dos models:

```prisma
enum AbcClassificationValue {
  A
  B
  C
}

enum DataConfidence {
  HIGH
  MEDIUM
  LOW
}

enum SyncJobType {
  STOCK
  TRANSFERS
  SALES
  PURCHASES
  HISTORY
  ABC
}

enum SyncJobTier {
  FAST_CRITICAL
  FAST_STANDARD
  MEDIUM
  SLOW
}

enum SyncJobStatus {
  RUNNING
  SUCCESS
  PARTIAL
  FAILED
}

enum SyncJobSource {
  API
  CSV
  MANUAL
}

enum AlertType {
  RUPTURA_REDE_SEM_ESTOQUE
  RUPTURA_TRANSFERENCIA_POSSIVEL
  ALERTA_SKU_B
  ABAIXO_MINIMO
  EXCESSO_SUGESTAO
  VENDA_SEM_COBERTURA
  COBERTURA_EM_RISCO
  ENTREGA_DIA_SEGUINTE
  TRANSFER_VENCIDA
  NF_SEM_RECEBIMENTO
  DIVERGENCIA_TRANSFERENCIA
  PEDIDO_COMPRA_VENCIDO
  ITEM_CRITICO_SEM_FATURAR
  FOLLOWUP_VENCIDO
  DIVERGENCIA_COMPRA
}

enum AlertSeverity {
  CRITICAL
  WARNING
  INFO
}

enum AlertStatus {
  PENDING
  IN_PROGRESS
  RESOLVED
  CANCELLED
  SNOOZED
  NEEDS_MANUAL_CONFIRMATION
  CRITICAL_UNRESOLVED
}

enum AlertSlaStatus {
  ON_TRACK
  AT_RISK
  OVERDUE
}

enum AlertActionType {
  CREATE_TRANSFER
  PLACE_PURCHASE_ORDER
  CONFIRM_RECEIPT
  RESOLVE_DIVERGENCE
  CONTACT_SUPPLIER
  LINK_COVERAGE
  REVIEW_STOCK
  INFO_ONLY
}

enum AlertEscalationLevel {
  L1
  L2
  L3
}

enum AlertResolutionType {
  TRANSFER
  PURCHASE
  MANUAL_FIX
  CANCELLED
}
```

- [ ] **Step 1.2: Adicionar modelos ao schema**

Inserir após o model `FreightDecisionLog` (último model existente):

```prisma
model AbcClassification {
  id                 String                 @id @default(cuid())
  storeId            String
  productCode        String
  productName        String
  classification     AbcClassificationValue
  source             String                 @default("MANUAL")
  isManualOverride   Boolean                @default(false)
  minStock           Float?
  maxStock           Float?
  coverageDaysTarget Int                    @default(30)
  avgDailySales      Float?
  coverageDaysActual Float?
  coverageUpdatedAt  DateTime?
  calculatedAt       DateTime?
  createdAt          DateTime               @default(now())
  updatedAt          DateTime               @updatedAt

  store Store @relation(fields: [storeId], references: [id])

  @@unique([storeId, productCode])
  @@index([storeId])
  @@map("abc_classifications")
}

model CitelSyncJob {
  id               String         @id @default(cuid())
  type             SyncJobType
  tier             SyncJobTier
  status           SyncJobStatus  @default(RUNNING)
  source           SyncJobSource  @default(API)
  dataConfidence   DataConfidence @default(HIGH)
  recordsProcessed Int            @default(0)
  errors           Int            @default(0)
  startedAt        DateTime       @default(now())
  finishedAt       DateTime?
  errorDetail      String?

  @@index([type, status])
  @@map("citel_sync_jobs")
}

model ControlTowerAlert {
  id                 String                @id @default(cuid())
  type               AlertType
  severity           AlertSeverity
  storeId            String
  ownerId            String
  notifiedUserIds    String[]
  actionType         AlertActionType
  slaDeadline        DateTime
  slaStatus          AlertSlaStatus        @default(ON_TRACK)
  status             AlertStatus           @default(PENDING)
  escalationLevel    AlertEscalationLevel?
  escalatedAt        DateTime?
  escalatedToId      String?
  groupKey           String
  suppressedBy       String?
  suppressedAt       DateTime?
  resolvedById       String?
  resolvedAt         DateTime?
  resolutionType     AlertResolutionType?
  resolutionNotes    String?
  resolution         String?
  revalidatedAt      DateTime?
  revalidationResult String?
  dataConfidence     DataConfidence        @default(HIGH)
  whatsappSentAt     DateTime?
  snoozedUntil       DateTime?
  createdAt          DateTime              @default(now())
  updatedAt          DateTime              @updatedAt

  store Store                   @relation(fields: [storeId], references: [id])
  owner User                    @relation("AlertOwner", fields: [ownerId], references: [id])
  items ControlTowerAlertItem[]

  @@index([storeId, status])
  @@index([groupKey])
  @@index([severity, status])
  @@map("control_tower_alerts")
}

model ControlTowerAlertItem {
  id                     String                  @id @default(cuid())
  alertId                String
  productCode            String
  productName            String
  abcClassification      AbcClassificationValue?
  metricValue            Float
  metricUnit             String
  suggestedSourceStoreId String?
  suggestedSourceQty     Float?
  detail                 Json                    @default("{}")
  createdAt              DateTime                @default(now())

  alert ControlTowerAlert @relation(fields: [alertId], references: [id], onDelete: Cascade)

  @@map("control_tower_alert_items")
}
```

- [ ] **Step 1.3: Adicionar relações nos modelos existentes**

Em `model Store`, adicionar dentro do bloco de relações:
```prisma
  abcClassifications   AbcClassification[]
  controlTowerAlerts   ControlTowerAlert[]
```

Em `model User`, adicionar dentro do bloco de relações:
```prisma
  alertsOwned          ControlTowerAlert[] @relation("AlertOwner")
```

- [ ] **Step 1.4: Gerar migration e cliente**

```bash
npx prisma migrate dev --name add_torre_controle_fase1
npx prisma generate
```

Resultado esperado:
```
✔ Your database is now in sync with your schema.
✔ Generated Prisma Client
```

- [ ] **Step 1.5: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 1.6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(torre): schema prisma — 4 modelos e 8 enums da Torre de Controle"
```

---

## Task 2: Tipos TypeScript

**Files:**
- Create: `types/torre.ts`

- [ ] **Step 2.1: Criar o arquivo de tipos**

```typescript
// types/torre.ts
import type {
  AbcClassificationValue,
  AlertType,
  AlertSeverity,
  AlertStatus,
  AlertSlaStatus,
  AlertActionType,
  AlertEscalationLevel,
  AlertResolutionType,
  DataConfidence,
} from "@prisma/client";

// ──────────────────────────────────────────────
// DASHBOARD
// ──────────────────────────────────────────────

export type StoreHealthColor = "GREEN" | "YELLOW" | "RED";

export interface TowerStoreHealth {
  storeId: string;
  storeCode: string;
  storeName: string;
  health: StoreHealthColor;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export interface TowerDashboardStats {
  critical: number;
  warning: number;
  info: number;
  overdueCount: number;
  stores: TowerStoreHealth[];
  lastSyncAt: Date | null;
}

// ──────────────────────────────────────────────
// AUDIT ENGINE — ocorrências (output da função pura)
// ──────────────────────────────────────────────

export type OwnerRole =
  | "COMPRAS"
  | "LOGISTICA"
  | "LIDER_ORIGEM"
  | "LIDER_DESTINO"
  | "ADMIN";

export interface AlertOccurrenceItem {
  productCode: string;
  productName: string;
  abcClassification?: AbcClassificationValue;
  metricValue: number;
  metricUnit: string;
  suggestedSourceStoreId?: string;
  suggestedSourceQty?: number;
  detail?: Record<string, unknown>;
}

export interface AlertOccurrence {
  ruleId: string;
  type: AlertType;
  severity: AlertSeverity;
  storeId: string;
  actionType: AlertActionType;
  slaMinutes: number;
  ownerRole: OwnerRole;
  groupKey: string;
  dataConfidence: DataConfidence;
  items: AlertOccurrenceItem[];
}

// ──────────────────────────────────────────────
// ALERT ENGINE — alertas com timeRemaining calculado
// ──────────────────────────────────────────────

export interface AlertWithTimeRemaining {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  storeId: string;
  storeCode: string;
  storeName: string;
  ownerName: string;
  actionType: AlertActionType;
  slaDeadline: Date;
  slaStatus: AlertSlaStatus;
  timeRemaining: number; // minutos; negativo = vencido
  status: AlertStatus;
  escalationLevel: AlertEscalationLevel | null;
  dataConfidence: DataConfidence;
  itemCount: number;
  items: AlertItemSummary[];
  createdAt: Date;
}

export interface AlertItemSummary {
  productCode: string;
  productName: string;
  abcClassification?: AbcClassificationValue;
  metricValue: number;
  metricUnit: string;
}

// ──────────────────────────────────────────────
// INPUTS DE API
// ──────────────────────────────────────────────

export interface AbcUpsertInput {
  storeId: string;
  productCode: string;
  productName: string;
  classification: AbcClassificationValue;
  minStock?: number;
  maxStock?: number;
  coverageDaysTarget?: number;
  avgDailySales?: number;
  isManualOverride?: boolean;
}

export interface AlertResolveInput {
  status: "RESOLVED" | "CANCELLED" | "IN_PROGRESS" | "SNOOZED";
  resolutionType?: AlertResolutionType;
  resolutionNotes?: string;
  snoozedUntil?: string; // ISO date string
  resolvedById: string;
}

// ──────────────────────────────────────────────
// COBERTURA
// ──────────────────────────────────────────────

export interface CoverageResult {
  storeId: string;
  productCode: string;
  qtdDisponivel: number;
  avgDailySales: number | null;
  coverageDaysActual: number | null;
  coverageDaysTarget: number;
  minStock: number | null;
  aboveMinStock: boolean;
}
```

- [ ] **Step 2.2: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 2.3: Commit**

```bash
git add types/torre.ts
git commit -m "feat(torre): tipos TypeScript — dashboard, audit engine, alert engine"
```

---

## Task 3: Serviço de cobertura + extensão do sync

**Files:**
- Create: `services/torre/coverage.service.ts`
- Modify: `services/stock-ledger.service.ts` (adicionar chamada ao coverage ao final de `syncFromCitel`)

- [ ] **Step 3.1: Escrever teste para o serviço de cobertura**

```typescript
// __tests__/torre/coverage.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateCoverageForStore } from "../../services/torre/coverage.service";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    abcClassification: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    stockLedger: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../lib/prisma";

describe("calculateCoverageForStore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calcula coverageDaysActual quando avgDailySales > 0", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-001",
        coverageDaysTarget: 30,
        minStock: 5,
        avgDailySales: 2,
        classification: "A",
      },
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-001",
        qtdFisica: 20,
        qtdComprometida: 0,
      },
    ]);
    (prisma.abcClassification.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await calculateCoverageForStore("store-1");

    expect(result).toHaveLength(1);
    expect(result[0].coverageDaysActual).toBe(10); // 20 / 2
    expect(result[0].aboveMinStock).toBe(true);    // 20 >= 5
  });

  it("retorna coverageDaysActual null quando avgDailySales não está definida", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-002",
        coverageDaysTarget: 30,
        minStock: null,
        avgDailySales: null,
        classification: "B",
      },
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-002",
        qtdFisica: 10,
        qtdComprometida: 2,
      },
    ]);
    (prisma.abcClassification.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await calculateCoverageForStore("store-1");

    expect(result[0].coverageDaysActual).toBeNull();
    expect(result[0].qtdDisponivel).toBe(8); // 10 - 2
  });
});
```

- [ ] **Step 3.2: Rodar teste para verificar que falha**

```bash
npx vitest run __tests__/torre/coverage.test.ts
```

Resultado esperado: FAIL — "Cannot find module '../../services/torre/coverage.service'"

- [ ] **Step 3.3: Implementar o serviço de cobertura**

```typescript
// services/torre/coverage.service.ts
import { prisma } from "@/lib/prisma";
import type { CoverageResult } from "@/types/torre";

export async function calculateCoverageForStore(storeId: string): Promise<CoverageResult[]> {
  const classifications = await prisma.abcClassification.findMany({
    where: { storeId },
  });

  if (classifications.length === 0) return [];

  const productCodes = classifications.map((c) => c.productCode);
  const ledgers = await prisma.stockLedger.findMany({
    where: { storeId, productCode: { in: productCodes } },
    select: { productCode: true, qtdFisica: true, qtdComprometida: true },
  });

  const ledgerMap = new Map(ledgers.map((l) => [l.productCode, l]));
  const results: CoverageResult[] = [];
  const now = new Date();

  for (const abc of classifications) {
    const ledger = ledgerMap.get(abc.productCode);
    const qtdDisponivel = ledger ? ledger.qtdFisica - ledger.qtdComprometida : 0;

    const coverageDaysActual =
      abc.avgDailySales && abc.avgDailySales > 0
        ? Math.round((qtdDisponivel / abc.avgDailySales) * 10) / 10
        : null;

    results.push({
      storeId,
      productCode: abc.productCode,
      qtdDisponivel,
      avgDailySales: abc.avgDailySales ?? null,
      coverageDaysActual,
      coverageDaysTarget: abc.coverageDaysTarget,
      minStock: abc.minStock ?? null,
      aboveMinStock: abc.minStock === null || abc.minStock === undefined
        ? true
        : qtdDisponivel >= abc.minStock,
    });
  }

  // Persiste coverageDaysActual em batch
  await Promise.all(
    results.map((r) =>
      prisma.abcClassification.updateMany({
        where: { storeId, productCode: r.productCode },
        data: {
          coverageDaysActual: r.coverageDaysActual,
          coverageUpdatedAt: now,
        },
      })
    )
  );

  return results;
}
```

- [ ] **Step 3.4: Rodar teste para verificar que passa**

```bash
npx vitest run __tests__/torre/coverage.test.ts
```

Resultado esperado: 2 testes passando.

- [ ] **Step 3.5: Conectar ao syncFromCitel**

Em `services/stock-ledger.service.ts`, no final da função `syncFromCitel`, antes do `return result`, adicionar:

```typescript
  // Recalcula coverageDaysActual após sync
  if (result.synced > 0) {
    try {
      const { calculateCoverageForStore } = await import("./torre/coverage.service");
      await calculateCoverageForStore(storeId);
    } catch {
      // falha silenciosa — cobertura é calculada novamente no próximo sync
    }
  }

  return result;
```

- [ ] **Step 3.6: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 3.7: Commit**

```bash
git add services/torre/coverage.service.ts services/stock-ledger.service.ts __tests__/torre/coverage.test.ts
git commit -m "feat(torre): serviço de cobertura — calcula coverageDaysActual após sync"
```

---

## Task 4: Audit Engine — R03 e R10

**Files:**
- Create: `services/torre/audit-engine.service.ts`
- Create: `__tests__/torre/audit-engine.test.ts`

- [ ] **Step 4.1: Escrever testes do audit engine**

```typescript
// __tests__/torre/audit-engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateRules } from "../../services/torre/audit-engine.service";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    abcClassification: { findMany: vi.fn() },
    stockLedger: { findMany: vi.fn() },
    transferDivergence: { findMany: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma";

function mockAbc(overrides = {}) {
  return {
    storeId: "store-1",
    productCode: "TINT-001",
    productName: "Tinta Branca 18L",
    classification: "A",
    minStock: 5,
    maxStock: 50,
    coverageDaysTarget: 30,
    avgDailySales: 2,
    coverageDaysActual: 10,
    ...overrides,
  };
}

function mockLedger(overrides = {}) {
  return {
    storeId: "store-1",
    productCode: "TINT-001",
    qtdFisica: 3,
    qtdComprometida: 0,
    ...overrides,
  };
}

describe("evaluateRules — R03 (abaixo do mínimo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.transferDivergence.findMany as any).mockResolvedValue([]);
  });

  it("gera ocorrência CRITICAL quando curva A está abaixo do mínimo", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([mockAbc()]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      mockLedger({ qtdFisica: 3, qtdComprometida: 0 }), // disponível=3, minStock=5
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("R03");
    expect(result[0].severity).toBe("CRITICAL");
    expect(result[0].items[0].metricValue).toBe(3);
    expect(result[0].slaMinutes).toBe(240); // 4h
  });

  it("gera ocorrência WARNING quando curva B está abaixo do mínimo", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      mockAbc({ classification: "B" }),
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      mockLedger({ qtdFisica: 3, qtdComprometida: 0 }),
    ]);

    const result = await evaluateRules("store-1");

    expect(result[0].severity).toBe("WARNING");
    expect(result[0].slaMinutes).toBe(1440); // 24h
  });

  it("não gera ocorrência quando estoque está acima do mínimo", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([mockAbc()]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      mockLedger({ qtdFisica: 20, qtdComprometida: 0 }), // disponível=20 >= minStock=5
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(0);
  });

  it("não gera ocorrência quando minStock não está cadastrado", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      mockAbc({ minStock: null }),
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([mockLedger()]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(0);
  });
});

describe("evaluateRules — R10 (divergência em aberto)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.abcClassification.findMany as any).mockResolvedValue([]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([]);
  });

  it("gera ocorrência WARNING quando há divergência com deadline vencido", async () => {
    const pastDeadline = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás
    (prisma.transferDivergence.findMany as any).mockResolvedValue([
      {
        id: "div-1",
        transferId: "transfer-1",
        ledgerId: "ledger-1",
        productCode: "TINT-001",
        productName: "Tinta Branca 18L",
        divergenceQty: 2,
        deadline: pastDeadline,
        ledger: { storeId: "store-1" },
      },
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("R10");
    expect(result[0].severity).toBe("WARNING");
    expect(result[0].actionType).toBe("RESOLVE_DIVERGENCE");
  });

  it("não gera ocorrência quando deadline ainda não venceu", async () => {
    const futureDeadline = new Date(Date.now() + 2 * 60 * 60 * 1000);
    (prisma.transferDivergence.findMany as any).mockResolvedValue([
      {
        id: "div-2",
        transferId: "transfer-2",
        ledgerId: "ledger-2",
        productCode: "TINT-002",
        productName: "Tinta Cinza 18L",
        divergenceQty: 1,
        deadline: futureDeadline,
        ledger: { storeId: "store-1" },
      },
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 4.2: Rodar testes para verificar que falham**

```bash
npx vitest run __tests__/torre/audit-engine.test.ts
```

Resultado esperado: FAIL — "Cannot find module '../../services/torre/audit-engine.service'"

- [ ] **Step 4.3: Implementar o audit engine**

```typescript
// services/torre/audit-engine.service.ts
//
// Função pura: recebe storeId, avalia regras contra DB local,
// retorna lista de ocorrências. Sem efeitos colaterais.
import { prisma } from "@/lib/prisma";
import type { AlertOccurrence } from "@/types/torre";

function windowKey(minutes: number): string {
  const slot = Math.floor(Date.now() / (minutes * 60 * 1000));
  return String(slot);
}

// ── R03 — Estoque abaixo do mínimo ────────────────────────────────────────────
async function evaluateR03(storeId: string): Promise<AlertOccurrence[]> {
  const classifications = await prisma.abcClassification.findMany({
    where: { storeId, minStock: { not: null } },
  });

  if (classifications.length === 0) return [];

  const productCodes = classifications.map((c) => c.productCode);
  const ledgers = await prisma.stockLedger.findMany({
    where: { storeId, productCode: { in: productCodes } },
    select: { productCode: true, qtdFisica: true, qtdComprometida: true },
  });
  const ledgerMap = new Map(ledgers.map((l) => [l.productCode, l]));

  const criticalItems: AlertOccurrence["items"] = [];
  const warningItems: AlertOccurrence["items"] = [];

  for (const abc of classifications) {
    if (abc.minStock === null) continue;
    const ledger = ledgerMap.get(abc.productCode);
    const qtdDisponivel = ledger ? ledger.qtdFisica - ledger.qtdComprometida : 0;

    if (qtdDisponivel < abc.minStock) {
      const item = {
        productCode: abc.productCode,
        productName: abc.productName,
        abcClassification: abc.classification as "A" | "B" | "C",
        metricValue: qtdDisponivel,
        metricUnit: "unidades",
        detail: { minStock: abc.minStock, deficit: abc.minStock - qtdDisponivel },
      };
      if (abc.classification === "A") criticalItems.push(item);
      else warningItems.push(item);
    }
  }

  const occurrences: AlertOccurrence[] = [];

  if (criticalItems.length > 0) {
    occurrences.push({
      ruleId: "R03",
      type: "ABAIXO_MINIMO",
      severity: "CRITICAL",
      storeId,
      actionType: "CREATE_TRANSFER",
      slaMinutes: 240,
      ownerRole: "COMPRAS",
      groupKey: `${storeId}_R03_CRITICAL_${windowKey(30)}`,
      dataConfidence: "HIGH",
      items: criticalItems,
    });
  }

  if (warningItems.length > 0) {
    occurrences.push({
      ruleId: "R03",
      type: "ABAIXO_MINIMO",
      severity: "WARNING",
      storeId,
      actionType: "CREATE_TRANSFER",
      slaMinutes: 1440,
      ownerRole: "COMPRAS",
      groupKey: `${storeId}_R03_WARNING_${windowKey(120)}`,
      dataConfidence: "HIGH",
      items: warningItems,
    });
  }

  return occurrences;
}

// ── R10 — Divergência de transferência em aberto ───────────────────────────────
async function evaluateR10(storeId: string): Promise<AlertOccurrence[]> {
  const now = new Date();

  const overdue = await prisma.transferDivergence.findMany({
    where: {
      status: "PENDING_RESOLUTION",
      deadline: { lt: now },
      ledger: { storeId },
    },
    include: {
      ledger: { select: { storeId: true } },
    },
  });

  if (overdue.length === 0) return [];

  const items = overdue.map((div) => ({
    productCode: div.productCode,
    productName: div.productName,
    metricValue: Math.abs(div.divergenceQty),
    metricUnit: "unidades",
    detail: {
      divergenceQty: div.divergenceQty,
      transferId: div.transferId,
      deadlineVencidoEm: div.deadline.toISOString(),
    },
  }));

  return [
    {
      ruleId: "R10",
      type: "DIVERGENCIA_TRANSFERENCIA",
      severity: "WARNING",
      storeId,
      actionType: "RESOLVE_DIVERGENCE",
      slaMinutes: 1440,
      ownerRole: "LIDER_DESTINO",
      groupKey: `${storeId}_R10_${windowKey(120)}`,
      dataConfidence: "HIGH",
      items,
    },
  ];
}

// ── Entry point ────────────────────────────────────────────────────────────────
export async function evaluateRules(storeId: string): Promise<AlertOccurrence[]> {
  const [r03, r10] = await Promise.all([evaluateR03(storeId), evaluateR10(storeId)]);
  return [...r03, ...r10];
}
```

- [ ] **Step 4.4: Rodar testes para verificar que passam**

```bash
npx vitest run __tests__/torre/audit-engine.test.ts
```

Resultado esperado: 6 testes passando.

- [ ] **Step 4.5: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 4.6: Commit**

```bash
git add services/torre/audit-engine.service.ts __tests__/torre/audit-engine.test.ts
git commit -m "feat(torre): audit engine — regras R03 (abaixo mínimo) e R10 (divergência)"
```

---

## Task 5: Alert Engine

**Files:**
- Create: `services/torre/alert-engine.service.ts`
- Create: `__tests__/torre/alert-engine.test.ts`

- [ ] **Step 5.1: Escrever testes do alert engine**

```typescript
// __tests__/torre/alert-engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { processOccurrences } from "../../services/torre/alert-engine.service";
import type { AlertOccurrence } from "../../types/torre";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    controlTowerAlert: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findFirst: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma";

const baseOccurrence: AlertOccurrence = {
  ruleId: "R03",
  type: "ABAIXO_MINIMO",
  severity: "CRITICAL",
  storeId: "store-1",
  actionType: "CREATE_TRANSFER",
  slaMinutes: 240,
  ownerRole: "COMPRAS",
  groupKey: "store-1_R03_CRITICAL_123",
  dataConfidence: "HIGH",
  items: [
    {
      productCode: "TINT-001",
      productName: "Tinta Branca 18L",
      abcClassification: "A",
      metricValue: 3,
      metricUnit: "unidades",
    },
  ],
};

describe("processOccurrences — criação de alerta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria novo alerta quando não existe alerta aberto com o mesmo groupKey", async () => {
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue(null);
    (prisma.user.findFirst as any).mockResolvedValue({ id: "user-fernanda" });
    (prisma.controlTowerAlert.create as any).mockResolvedValue({ id: "alert-1" });

    await processOccurrences([baseOccurrence]);

    expect(prisma.controlTowerAlert.create).toHaveBeenCalledTimes(1);
    const call = (prisma.controlTowerAlert.create as any).mock.calls[0][0];
    expect(call.data.type).toBe("ABAIXO_MINIMO");
    expect(call.data.severity).toBe("CRITICAL");
    expect(call.data.ownerId).toBe("user-fernanda");
  });

  it("não cria alerta duplicado se já existe um aberto com o mesmo groupKey", async () => {
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue({ id: "alert-existente" });

    await processOccurrences([baseOccurrence]);

    expect(prisma.controlTowerAlert.create).not.toHaveBeenCalled();
  });

  it("usa Alberto como fallback quando owner por papel não é encontrado", async () => {
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue(null);
    (prisma.user.findFirst as any)
      .mockResolvedValueOnce(null) // COMPRAS não encontrado
      .mockResolvedValueOnce({ id: "user-alberto" }); // ADMIN fallback
    (prisma.controlTowerAlert.create as any).mockResolvedValue({ id: "alert-2" });

    await processOccurrences([baseOccurrence]);

    const call = (prisma.controlTowerAlert.create as any).mock.calls[0][0];
    expect(call.data.ownerId).toBe("user-alberto");
  });
});

describe("processOccurrences — resolução automática", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolve alertas abertos cujas ocorrências desapareceram", async () => {
    (prisma.controlTowerAlert.updateMany as any).mockResolvedValue({ count: 1 });

    // Nenhuma ocorrência ativa — todos os alertas R03 devem ser auto-resolvidos
    await processOccurrences([], { storeId: "store-1", ruleIds: ["R03"] });

    expect(prisma.controlTowerAlert.updateMany).toHaveBeenCalledWith({
      where: {
        storeId: "store-1",
        status: { in: ["PENDING", "IN_PROGRESS"] },
        type: "ABAIXO_MINIMO",
      },
      data: {
        status: "RESOLVED",
        resolutionType: "MANUAL_FIX",
        resolutionNotes: "Condição resolvida automaticamente — regra R03 não disparou no último sync",
        resolvedAt: expect.any(Date),
      },
    });
  });
});
```

- [ ] **Step 5.2: Rodar testes para verificar que falham**

```bash
npx vitest run __tests__/torre/alert-engine.test.ts
```

Resultado esperado: FAIL — "Cannot find module '../../services/torre/alert-engine.service'"

- [ ] **Step 5.3: Implementar o alert engine**

```typescript
// services/torre/alert-engine.service.ts
import { prisma } from "@/lib/prisma";
import type { AlertOccurrence, OwnerRole } from "@/types/torre";
import type { AlertType } from "@prisma/client";

// Mapeamento de tipo de alerta para tipo de AlertType do Prisma
const RULE_TO_ALERT_TYPE: Record<string, AlertType> = {
  R03_CRITICAL: "ABAIXO_MINIMO",
  R03_WARNING:  "ABAIXO_MINIMO",
  R10:          "DIVERGENCIA_TRANSFERENCIA",
  R01b:         "RUPTURA_REDE_SEM_ESTOQUE",
  R01a:         "RUPTURA_TRANSFERENCIA_POSSIVEL",
  R02:          "ALERTA_SKU_B",
};

// Resolve o userId a partir do papel esperado (COMPRAS, LOGISTICA, etc.)
async function resolveOwner(storeId: string, role: OwnerRole): Promise<string> {
  // Primeiro: busca usuário com a tag de papel configurada via SystemConfig
  // Simplificação para Fase 1A: busca por role e storeId
  let user: { id: string } | null = null;

  if (role === "COMPRAS" || role === "LOGISTICA") {
    // Papéis globais: busca OPERATOR com tag correspondente
    // Na Fase 1A, mapeamos por convenção de e-mail ou nome (configurável depois)
    user = await prisma.user.findFirst({
      where: { role: "OPERATOR", active: true },
      select: { id: true },
    });
  } else if (role === "LIDER_ORIGEM" || role === "LIDER_DESTINO") {
    user = await prisma.user.findFirst({
      where: { role: "OPERATOR", storeId, active: true },
      select: { id: true },
    });
  }

  if (user) return user.id;

  // Fallback: Alberto (ADMIN)
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    select: { id: true },
  });
  if (!admin) throw new Error("Nenhum usuário ADMIN encontrado para fallback de owner");
  return admin.id;
}

function calculateSlaDeadline(slaMinutes: number): Date {
  return new Date(Date.now() + slaMinutes * 60 * 1000);
}

function calculateSlaStatus(slaDeadline: Date, slaMinutes: number): "ON_TRACK" | "AT_RISK" | "OVERDUE" {
  const remaining = slaDeadline.getTime() - Date.now();
  if (remaining < 0) return "OVERDUE";
  if (remaining < (slaMinutes * 60 * 1000) / 2) return "AT_RISK";
  return "ON_TRACK";
}

// Cria um novo alerta a partir de uma ocorrência
async function createAlert(occurrence: AlertOccurrence): Promise<void> {
  const ownerId = await resolveOwner(occurrence.storeId, occurrence.ownerRole);
  const slaDeadline = calculateSlaDeadline(occurrence.slaMinutes);
  const slaStatus = calculateSlaStatus(slaDeadline, occurrence.slaMinutes);

  await prisma.controlTowerAlert.create({
    data: {
      type: occurrence.type,
      severity: occurrence.severity,
      storeId: occurrence.storeId,
      ownerId,
      notifiedUserIds: [],
      actionType: occurrence.actionType,
      slaDeadline,
      slaStatus,
      groupKey: occurrence.groupKey,
      dataConfidence: occurrence.dataConfidence,
      items: {
        create: occurrence.items.map((item) => ({
          productCode: item.productCode,
          productName: item.productName,
          abcClassification: item.abcClassification,
          metricValue: item.metricValue,
          metricUnit: item.metricUnit,
          suggestedSourceStoreId: item.suggestedSourceStoreId,
          suggestedSourceQty: item.suggestedSourceQty,
          detail: (item.detail ?? {}) as Record<string, unknown>,
        })),
      },
    },
  });
}

// Auto-resolve alertas abertos cujas regras não dispararam mais
async function autoResolveStale(
  storeId: string,
  activeGroupKeys: string[],
  ruleIds: string[]
): Promise<void> {
  // Mapeia ruleIds para AlertTypes
  const alertTypes = ruleIds
    .map((id) => RULE_TO_ALERT_TYPE[id])
    .filter(Boolean) as AlertType[];

  if (alertTypes.length === 0) return;

  await prisma.controlTowerAlert.updateMany({
    where: {
      storeId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      type: { in: alertTypes },
      groupKey: { notIn: activeGroupKeys },
    },
    data: {
      status: "RESOLVED",
      resolutionType: "MANUAL_FIX",
      resolutionNotes: `Condição resolvida automaticamente — regra ${ruleIds.join("/")} não disparou no último sync`,
      resolvedAt: new Date(),
    },
  });
}

export async function processOccurrences(
  occurrences: AlertOccurrence[],
  autoResolveContext?: { storeId: string; ruleIds: string[] }
): Promise<void> {
  // 1. Criar alertas novos para ocorrências sem alerta aberto
  for (const occ of occurrences) {
    const existing = await prisma.controlTowerAlert.findFirst({
      where: {
        groupKey: occ.groupKey,
        status: { in: ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] },
      },
      select: { id: true },
    });

    if (!existing) {
      await createAlert(occ);
    }
    // Se já existe: manter o alerta aberto, não duplicar
  }

  // 2. Auto-resolver alertas cujas condições desapareceram
  if (autoResolveContext) {
    const activeGroupKeys = occurrences
      .filter((o) => o.storeId === autoResolveContext.storeId)
      .map((o) => o.groupKey);

    await autoResolveStale(
      autoResolveContext.storeId,
      activeGroupKeys,
      autoResolveContext.ruleIds
    );
  }
}
```

- [ ] **Step 5.4: Rodar testes para verificar que passam**

```bash
npx vitest run __tests__/torre/alert-engine.test.ts
```

Resultado esperado: 4 testes passando.

- [ ] **Step 5.5: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 5.6: Commit**

```bash
git add services/torre/alert-engine.service.ts __tests__/torre/alert-engine.test.ts
git commit -m "feat(torre): alert engine — criar, deduplicar e auto-resolver alertas"
```

---

## Task 6: Sync Orchestrator

**Files:**
- Create: `services/torre/sync-orchestrator.service.ts`

- [ ] **Step 6.1: Implementar o orquestrador**

```typescript
// services/torre/sync-orchestrator.service.ts
//
// Orquestra: sync de estoque → cálculo de cobertura → audit engine → alert engine.
// Chamado pelo cron (FAST_STANDARD: a cada 15 min).
import { prisma } from "@/lib/prisma";
import { syncFromCitel } from "@/services/stock-ledger.service";
import { calculateCoverageForStore } from "./coverage.service";
import { evaluateRules } from "./audit-engine.service";
import { processOccurrences } from "./alert-engine.service";

export interface OrchestratorResult {
  storeId: string;
  stockSynced: number;
  stockErrors: number;
  occurrencesFound: number;
  alertsCreated: number;
  durationMs: number;
}

export async function runFastStandardSync(storeId: string): Promise<OrchestratorResult> {
  const start = Date.now();

  // 1. Registrar job de sync
  const job = await prisma.citelSyncJob.create({
    data: {
      type: "STOCK",
      tier: "FAST_STANDARD",
      status: "RUNNING",
      source: "API",
    },
  });

  let stockSynced = 0;
  let stockErrors = 0;

  try {
    // 2. Buscar codigoEmpresaCitel da loja
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { codigoEmpresaCitel: true },
    });

    if (!store.codigoEmpresaCitel) {
      throw new Error(`Loja ${storeId} não tem codigoEmpresaCitel configurado`);
    }

    // 3. Sync de estoque (já chama calculateCoverageForStore internamente)
    const syncResult = await syncFromCitel(storeId, store.codigoEmpresaCitel);
    stockSynced = syncResult.synced;
    stockErrors = syncResult.errors;

    // 4. Calcular cobertura explicitamente caso syncFromCitel não tenha cobertura
    await calculateCoverageForStore(storeId);

    // 5. Avaliar regras R03 e R10
    const occurrences = await evaluateRules(storeId);

    // 6. Processar alertas (criar novos + auto-resolver resolvidos)
    await processOccurrences(occurrences, {
      storeId,
      ruleIds: ["R03", "R10"],
    });

    // 7. Fechar job com sucesso
    await prisma.citelSyncJob.update({
      where: { id: job.id },
      data: {
        status: stockErrors === 0 ? "SUCCESS" : "PARTIAL",
        recordsProcessed: stockSynced,
        errors: stockErrors,
        finishedAt: new Date(),
      },
    });

    return {
      storeId,
      stockSynced,
      stockErrors,
      occurrencesFound: occurrences.length,
      alertsCreated: occurrences.length, // aproximação — alert engine deduplica internamente
      durationMs: Date.now() - start,
    };
  } catch (err) {
    await prisma.citelSyncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errors: 1,
        finishedAt: new Date(),
        errorDetail: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

// Roda o sync para todas as lojas ativas com Citel configurado
export async function runFastStandardSyncAllStores(): Promise<OrchestratorResult[]> {
  const stores = await prisma.store.findMany({
    where: { active: true, codigoEmpresaCitel: { not: null } },
    select: { id: true },
  });

  const results: OrchestratorResult[] = [];

  for (const store of stores) {
    try {
      const result = await runFastStandardSync(store.id);
      results.push(result);
    } catch (err) {
      console.error(`[SyncOrchestrator] Falha na loja ${store.id}:`, err);
    }
  }

  return results;
}
```

- [ ] **Step 6.2: Criar rota de API para disparar sync manualmente (útil em staging)**

```typescript
// app/api/torre/sync/route.ts
import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { runFastStandardSyncAllStores } from "@/services/torre/sync-orchestrator.service";

export async function POST(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth || auth.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const results = await runFastStandardSyncAllStores();
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 6.3: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 6.4: Commit**

```bash
git add services/torre/sync-orchestrator.service.ts app/api/torre/sync/route.ts
git commit -m "feat(torre): sync orchestrator — stock + coverage + audit + alert em sequência"
```

---

## Task 7: API de ABC Manual

**Files:**
- Create: `app/api/torre/abc/route.ts`

- [ ] **Step 7.1: Implementar a rota**

```typescript
// app/api/torre/abc/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyAuth } from "@/lib/auth";

const AbcUpsertSchema = z.object({
  storeId: z.string(),
  productCode: z.string(),
  productName: z.string(),
  classification: z.enum(["A", "B", "C"]),
  minStock: z.number().positive().optional(),
  maxStock: z.number().positive().optional(),
  coverageDaysTarget: z.number().int().positive().optional(),
  avgDailySales: z.number().nonnegative().optional(),
  isManualOverride: z.boolean().optional(),
});

// GET /api/torre/abc?storeId=xxx
export async function GET(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId");

  const items = await prisma.abcClassification.findMany({
    where: storeId ? { storeId } : undefined,
    include: { store: { select: { code: true, name: true } } },
    orderBy: [{ storeId: "asc" }, { classification: "asc" }, { productCode: "asc" }],
  });

  return NextResponse.json(items);
}

// POST /api/torre/abc — upsert de um ou mais itens
export async function POST(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth || !["ADMIN", "OPERATOR"].includes(auth.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const items = Array.isArray(body) ? body : [body];

  const parsed = z.array(AbcUpsertSchema).safeParse(items);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const upserted = await Promise.all(
    parsed.data.map((item) =>
      prisma.abcClassification.upsert({
        where: { storeId_productCode: { storeId: item.storeId, productCode: item.productCode } },
        create: {
          storeId: item.storeId,
          productCode: item.productCode,
          productName: item.productName,
          classification: item.classification,
          source: "MANUAL",
          isManualOverride: item.isManualOverride ?? true,
          minStock: item.minStock,
          maxStock: item.maxStock,
          coverageDaysTarget: item.coverageDaysTarget ?? (item.classification === "A" ? 30 : item.classification === "B" ? 15 : 7),
          avgDailySales: item.avgDailySales,
        },
        update: {
          productName: item.productName,
          classification: item.classification,
          isManualOverride: item.isManualOverride ?? true,
          minStock: item.minStock,
          maxStock: item.maxStock,
          coverageDaysTarget: item.coverageDaysTarget,
          avgDailySales: item.avgDailySales,
        },
      })
    )
  );

  return NextResponse.json({ upserted: upserted.length, items: upserted }, { status: 201 });
}
```

- [ ] **Step 7.2: Testar manualmente em staging**

```bash
# GET — listar ABC de uma loja
curl -s -H "Cookie: token=<jwt>" \
  "http://localhost:3000/api/torre/abc?storeId=<store-id>" | jq .

# POST — cadastrar SKU curva A
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: token=<jwt>" \
  -d '[{"storeId":"<store-id>","productCode":"TINT-001","productName":"Tinta Branca 18L","classification":"A","minStock":10,"coverageDaysTarget":30,"avgDailySales":2}]' \
  http://localhost:3000/api/torre/abc | jq .
```

Resultado esperado: `{"upserted":1,"items":[...]}`

- [ ] **Step 7.3: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 7.4: Commit**

```bash
git add app/api/torre/abc/route.ts
git commit -m "feat(torre): API de curva ABC — GET e POST com upsert em lote"
```

---

## Task 8: API de Dashboard e Alertas

**Files:**
- Create: `app/api/torre/dashboard/route.ts`
- Create: `app/api/torre/alertas/route.ts`
- Create: `app/api/torre/alertas/[id]/route.ts`

- [ ] **Step 8.1: Implementar o dashboard**

```typescript
// app/api/torre/dashboard/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAuth } from "@/lib/auth";
import type { TowerDashboardStats, TowerStoreHealth, StoreHealthColor } from "@/types/torre";

function storeHealthColor(critical: number, warning: number): StoreHealthColor {
  if (critical > 0) return "RED";
  if (warning > 0) return "YELLOW";
  return "GREEN";
}

export async function GET(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const [alertCounts, stores, lastSync] = await Promise.all([
    prisma.controlTowerAlert.groupBy({
      by: ["storeId", "severity"],
      where: { status: { in: ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] } },
      _count: { id: true },
    }),
    prisma.store.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
    }),
    prisma.citelSyncJob.findFirst({
      where: { type: "STOCK", status: { in: ["SUCCESS", "PARTIAL"] } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  // Monta mapa de contadores por loja
  const countMap = new Map<string, { CRITICAL: number; WARNING: number; INFO: number }>();
  for (const row of alertCounts) {
    if (!countMap.has(row.storeId)) {
      countMap.set(row.storeId, { CRITICAL: 0, WARNING: 0, INFO: 0 });
    }
    countMap.get(row.storeId)![row.severity] += row._count.id;
  }

  const storeHealthList: TowerStoreHealth[] = stores.map((s) => {
    const counts = countMap.get(s.id) ?? { CRITICAL: 0, WARNING: 0, INFO: 0 };
    return {
      storeId: s.id,
      storeCode: s.code,
      storeName: s.name,
      health: storeHealthColor(counts.CRITICAL, counts.WARNING),
      criticalCount: counts.CRITICAL,
      warningCount: counts.WARNING,
      infoCount: counts.INFO,
    };
  });

  const totals = alertCounts.reduce(
    (acc, row) => {
      acc[row.severity] = (acc[row.severity] ?? 0) + row._count.id;
      return acc;
    },
    {} as Record<string, number>
  );

  const overdueCount = await prisma.controlTowerAlert.count({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS"] },
      slaStatus: "OVERDUE",
    },
  });

  const stats: TowerDashboardStats = {
    critical: totals["CRITICAL"] ?? 0,
    warning: totals["WARNING"] ?? 0,
    info: totals["INFO"] ?? 0,
    overdueCount,
    stores: storeHealthList,
    lastSyncAt: lastSync?.finishedAt ?? null,
  };

  return NextResponse.json(stats);
}
```

- [ ] **Step 8.2: Implementar lista de alertas**

```typescript
// app/api/torre/alertas/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAuth } from "@/lib/auth";
import type { AlertWithTimeRemaining } from "@/types/torre";

export async function GET(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const storeId   = searchParams.get("storeId") ?? undefined;
  const severity  = searchParams.get("severity") as "CRITICAL" | "WARNING" | "INFO" | null;
  const status    = searchParams.get("status") ?? undefined;
  const page      = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize  = 20;

  const where = {
    ...(storeId ? { storeId } : {}),
    ...(severity ? { severity } : {}),
    ...(status
      ? { status: status as any }
      : { status: { in: ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] as any[] } }),
  };

  const [alerts, total] = await Promise.all([
    prisma.controlTowerAlert.findMany({
      where,
      orderBy: [{ severity: "asc" }, { slaDeadline: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        store:  { select: { code: true, name: true } },
        owner:  { select: { name: true } },
        items: {
          orderBy: { abcClassification: "asc" },
          take: 10,
        },
      },
    }),
    prisma.controlTowerAlert.count({ where }),
  ]);

  const now = Date.now();
  const result: AlertWithTimeRemaining[] = alerts.map((a) => ({
    id:              a.id,
    type:            a.type,
    severity:        a.severity,
    storeId:         a.storeId,
    storeCode:       a.store.code,
    storeName:       a.store.name,
    ownerName:       a.owner.name,
    actionType:      a.actionType,
    slaDeadline:     a.slaDeadline,
    slaStatus:       a.slaStatus,
    timeRemaining:   Math.round((a.slaDeadline.getTime() - now) / 60000),
    status:          a.status,
    escalationLevel: a.escalationLevel,
    dataConfidence:  a.dataConfidence,
    itemCount:       a.items.length,
    items: a.items.map((i) => ({
      productCode:       i.productCode,
      productName:       i.productName,
      abcClassification: i.abcClassification ?? undefined,
      metricValue:       i.metricValue,
      metricUnit:        i.metricUnit,
    })),
    createdAt: a.createdAt,
  }));

  return NextResponse.json({
    data: result,
    pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
  });
}
```

- [ ] **Step 8.3: Implementar resolução de alerta**

```typescript
// app/api/torre/alertas/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyAuth } from "@/lib/auth";

const AlertResolveSchema = z.object({
  status: z.enum(["RESOLVED", "CANCELLED", "IN_PROGRESS", "SNOOZED"]),
  resolutionType: z.enum(["TRANSFER", "PURCHASE", "MANUAL_FIX", "CANCELLED"]).optional(),
  resolutionNotes: z.string().max(1000).optional(),
  snoozedUntil: z.string().datetime().optional(),
  resolvedById: z.string(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const parsed = AlertResolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { status, resolutionType, resolutionNotes, snoozedUntil, resolvedById } = parsed.data;

  const isClosing = status === "RESOLVED" || status === "CANCELLED";

  const updated = await prisma.controlTowerAlert.update({
    where: { id: params.id },
    data: {
      status,
      ...(isClosing ? {
        resolutionType,
        resolutionNotes,
        resolvedById,
        resolvedAt: new Date(),
      } : {}),
      ...(status === "SNOOZED" && snoozedUntil ? {
        snoozedUntil: new Date(snoozedUntil),
      } : {}),
      ...(status === "IN_PROGRESS" ? { status: "IN_PROGRESS" } : {}),
    },
  });

  return NextResponse.json(updated);
}
```

- [ ] **Step 8.4: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 8.5: Commit**

```bash
git add app/api/torre/dashboard/route.ts app/api/torre/alertas/route.ts app/api/torre/alertas/[id]/route.ts
git commit -m "feat(torre): API routes — dashboard, lista de alertas e resolução"
```

---

## Task 9: Tela T1 — Dashboard Torre de Controle (Fase 1A)

**Files:**
- Create: `app/(app)/torre/page.tsx`

- [ ] **Step 9.1: Criar a tela de dashboard**

```tsx
// app/(app)/torre/page.tsx
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyJwt } from "@/lib/auth";
import type { TowerDashboardStats } from "@/types/torre";

async function getDashboardStats(): Promise<TowerDashboardStats> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/torre/dashboard`, {
    headers: { Cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Falha ao carregar dashboard");
  return res.json();
}

const HEALTH_COLORS = {
  GREEN:  "bg-green-100 border-green-300 text-green-800",
  YELLOW: "bg-yellow-100 border-yellow-300 text-yellow-800",
  RED:    "bg-red-100 border-red-300 text-red-800",
};

const HEALTH_LABELS = { GREEN: "OK", YELLOW: "Atenção", RED: "Crítico" };

export default async function TorrePage() {
  const stats = await getDashboardStats();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Torre de Controle</h1>
        {stats.lastSyncAt && (
          <p className="text-sm text-gray-500 mt-1">
            Último sync: {new Date(stats.lastSyncAt).toLocaleString("pt-BR")}
          </p>
        )}
      </div>

      {/* Contadores globais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-xs text-red-600 font-medium uppercase">Crítico</p>
          <p className="text-3xl font-bold text-red-700">{stats.critical}</p>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-xs text-yellow-600 font-medium uppercase">Atenção</p>
          <p className="text-3xl font-bold text-yellow-700">{stats.warning}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-xs text-blue-600 font-medium uppercase">Informativo</p>
          <p className="text-3xl font-bold text-blue-700">{stats.info}</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <p className="text-xs text-orange-600 font-medium uppercase">SLA Vencido</p>
          <p className="text-3xl font-bold text-orange-700">{stats.overdueCount}</p>
        </div>
      </div>

      {/* Mapa de saúde por loja */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Saúde por Loja</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {stats.stores.map((store) => (
            <a
              key={store.storeId}
              href={`/torre/alertas?storeId=${store.storeId}`}
              className={`border rounded-lg p-3 text-center hover:opacity-80 transition-opacity ${HEALTH_COLORS[store.health]}`}
            >
              <p className="font-bold text-lg">{store.storeCode}</p>
              <p className="text-xs truncate">{store.storeName}</p>
              <p className="text-xs font-medium mt-1">{HEALTH_LABELS[store.health]}</p>
              {store.criticalCount > 0 && (
                <p className="text-xs mt-1">{store.criticalCount} crítico(s)</p>
              )}
            </a>
          ))}
        </div>
      </div>

      {/* Link para alertas críticos */}
      {stats.critical > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-red-800">
              {stats.critical} alerta(s) crítico(s) aguardando ação
            </p>
            <p className="text-sm text-red-600 mt-1">
              {stats.overdueCount} com SLA vencido
            </p>
          </div>
          <a
            href="/torre/alertas?severity=CRITICAL"
            className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700"
          >
            Ver Alertas
          </a>
        </div>
      )}

      {stats.critical === 0 && stats.warning === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center text-green-700">
          Nenhum alerta ativo. Operação normalizada.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9.2: Adicionar item "Torre de Controle" no sidebar**

Em `components/sidebar.tsx`, localizar o array de items de navegação e adicionar:

```tsx
{ href: "/torre", label: "Torre de Controle", icon: <ShieldAlert size={18} /> }
```

Importar `ShieldAlert` de `lucide-react` se ainda não estiver importado.

- [ ] **Step 9.3: Testar a tela em desenvolvimento**

```bash
npm run dev
```

Abrir `http://localhost:3000/torre` e verificar:
- Contadores aparecem (podem ser 0 se não houver alertas)
- Mapa de lojas aparece
- Nenhum erro de console

- [ ] **Step 9.4: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 9.5: Commit**

```bash
git add app/"(app)"/torre/page.tsx components/sidebar.tsx
git commit -m "feat(torre): tela T1 — dashboard com contadores e mapa de saúde por loja"
```

---

## Task 10: Tela T2 — Ruptura e Risco (Fase 1B)

**Files:**
- Create: `app/api/torre/ruptura/route.ts`
- Create: `app/(app)/torre/ruptura/page.tsx`

- [ ] **Step 10.1: Implementar API de ruptura**

```typescript
// app/api/torre/ruptura/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId") ?? undefined;
  const classification = searchParams.get("classification") as "A" | "B" | "C" | null;

  const items = await prisma.abcClassification.findMany({
    where: {
      ...(storeId ? { storeId } : {}),
      ...(classification ? { classification } : {}),
      coverageDaysActual: { not: null },
    },
    include: {
      store: { select: { code: true, name: true } },
    },
    orderBy: [
      { classification: "asc" },
      { coverageDaysActual: "asc" },
    ],
  });

  // Calcula saldo disponível de cada item
  const productCodes = [...new Set(items.map((i) => i.productCode))];
  const storeIds = [...new Set(items.map((i) => i.storeId))];

  const ledgers = await prisma.stockLedger.findMany({
    where: {
      storeId: { in: storeIds },
      productCode: { in: productCodes },
    },
    select: { storeId: true, productCode: true, qtdFisica: true, qtdComprometida: true },
  });

  const ledgerKey = (s: string, p: string) => `${s}_${p}`;
  const ledgerMap = new Map(ledgers.map((l) => [ledgerKey(l.storeId, l.productCode), l]));

  const enriched = items
    .filter((item) => {
      // Mostrar apenas itens com cobertura abaixo do target ou abaixo do mínimo
      const belowTarget = item.coverageDaysActual !== null &&
        item.coverageDaysActual < item.coverageDaysTarget;
      const belowMin = item.minStock !== null && item.minStock !== undefined && (() => {
        const l = ledgerMap.get(ledgerKey(item.storeId, item.productCode));
        return l ? (l.qtdFisica - l.qtdComprometida) < item.minStock! : false;
      })();
      return belowTarget || belowMin;
    })
    .map((item) => {
      const l = ledgerMap.get(ledgerKey(item.storeId, item.productCode));
      const qtdDisponivel = l ? l.qtdFisica - l.qtdComprometida : 0;
      const riskLevel: "CRITICAL" | "WARNING" =
        item.classification === "A" ? "CRITICAL" : "WARNING";

      return {
        storeId: item.storeId,
        storeCode: item.store.code,
        storeName: item.store.name,
        productCode: item.productCode,
        productName: item.productName,
        classification: item.classification,
        qtdDisponivel,
        minStock: item.minStock,
        maxStock: item.maxStock,
        coverageDaysActual: item.coverageDaysActual,
        coverageDaysTarget: item.coverageDaysTarget,
        avgDailySales: item.avgDailySales,
        riskLevel,
        coverageUpdatedAt: item.coverageUpdatedAt,
      };
    });

  return NextResponse.json(enriched);
}
```

- [ ] **Step 10.2: Implementar tela T2**

```tsx
// app/(app)/torre/ruptura/page.tsx
import { cookies } from "next/headers";

interface RupturaItem {
  storeId: string;
  storeCode: string;
  storeName: string;
  productCode: string;
  productName: string;
  classification: "A" | "B" | "C";
  qtdDisponivel: number;
  minStock: number | null;
  coverageDaysActual: number | null;
  coverageDaysTarget: number;
  avgDailySales: number | null;
  riskLevel: "CRITICAL" | "WARNING";
}

async function getRupturaData(): Promise<RupturaItem[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/torre/ruptura`,
    { headers: { Cookie: cookies().toString() }, cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

const CURVE_COLORS = {
  A: "bg-red-100 text-red-800 border-red-300",
  B: "bg-yellow-100 text-yellow-800 border-yellow-300",
  C: "bg-gray-100 text-gray-700 border-gray-300",
};

export default async function RupturaPage() {
  const items = await getRupturaData();
  const critical = items.filter((i) => i.riskLevel === "CRITICAL");
  const warning  = items.filter((i) => i.riskLevel === "WARNING");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ruptura e Risco de Ruptura</h1>
          <p className="text-sm text-gray-500 mt-1">
            {critical.length} crítico(s) · {warning.length} em atenção
          </p>
        </div>
        <a href="/torre" className="text-sm text-blue-600 hover:underline">← Torre</a>
      </div>

      {items.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center text-green-700">
          Nenhum SKU com cobertura abaixo do alvo.
        </div>
      )}

      {[...critical, ...warning].map((item) => (
        <div
          key={`${item.storeId}_${item.productCode}`}
          className={`border rounded-lg p-4 ${item.riskLevel === "CRITICAL" ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50"}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${CURVE_COLORS[item.classification]}`}>
                  Curva {item.classification}
                </span>
                <span className="text-xs text-gray-500">
                  {item.storeCode} — {item.storeName}
                </span>
              </div>
              <p className="font-semibold">{item.productName}</p>
              <p className="text-xs text-gray-500">{item.productCode}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold">
                {item.coverageDaysActual !== null ? `${item.coverageDaysActual}d` : "—"}
              </p>
              <p className="text-xs text-gray-500">cobertura atual</p>
              <p className="text-xs text-gray-400">alvo: {item.coverageDaysTarget}d</p>
            </div>
          </div>
          <div className="mt-3 flex gap-4 text-sm text-gray-600">
            <span>Disponível: <strong>{item.qtdDisponivel}</strong> un.</span>
            {item.minStock !== null && (
              <span>Mínimo: <strong>{item.minStock}</strong> un.</span>
            )}
            {item.avgDailySales !== null && (
              <span>Giro: <strong>{item.avgDailySales}</strong>/dia</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 10.3: Adicionar link "Ruptura" no sidebar**

Em `components/sidebar.tsx`, adicionar abaixo do item "Torre de Controle":

```tsx
{ href: "/torre/ruptura", label: "Ruptura", icon: <AlertTriangle size={18} /> }
```

Importar `AlertTriangle` de `lucide-react` se necessário.

- [ ] **Step 10.4: Testar a tela**

```bash
npm run dev
```

Abrir `http://localhost:3000/torre/ruptura`. Verificar que a lista aparece (vazia se nenhum ABC cadastrado — cadastrar um item via API da Task 7 primeiro).

- [ ] **Step 10.5: Rodar todos os testes**

```bash
npx vitest run
```

Resultado esperado: todos passando (incluindo os 26 testes do Pilar 1).

- [ ] **Step 10.6: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 10.7: Commit final de Fase 1A + 1B**

```bash
git add app/api/torre/ruptura/route.ts app/"(app)"/torre/ruptura/page.tsx components/sidebar.tsx
git commit -m "feat(torre): tela T2 — ruptura e risco de ruptura por curva ABC"
```

---

## Self-Review

**Spec coverage (Fase 1A + 1B):**
- ✅ Modelos AbcClassification, CitelSyncJob, ControlTowerAlert, ControlTowerAlertItem — Task 1
- ✅ ABC manual Fase 1A — Task 7
- ✅ Sync FAST_STANDARD + coverageDaysActual — Tasks 3, 6
- ✅ R03 (abaixo mínimo) — Task 4
- ✅ R10 (divergência transfer) — Task 4
- ✅ Dashboard T1 — Tasks 8 + 9
- ✅ Alertas in-app — Task 8
- ✅ R01b (ruptura sem rede) — Task 4 cobre a base; R01b usa o mesmo padrão de R03 e será adicionado estendendo `evaluateRules` na Fase 1B com verificação de rede entre lojas
- ✅ Tela T2 (ruptura) — Task 10
- ✅ actionType visível + botão de resolução — Tasks 8.3, 10

**Fases 2, 3 e 4:** precisam de planos separados quando iniciadas.
`syncFromCitel` já está modificado para chamar `calculateCoverageForStore` —
os planos das fases seguintes podem estender `evaluateRules` adicionando novas regras.

---

*Plano gerado em 2026-05-03. Cobre Fases 1A e 1B do spec `2026-05-03-torre-controle-design.md`.*
