# Motor de Decisão de Frete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar `services/freight-decision.service.ts` — motor que classifica a carga, compara custo interno vs Lalamove, decide o modal e sugere o preço ao cliente.

**Architecture:** 8 funções puras testáveis + 1 orquestrador assíncrono. Funções puras recebem configs como parâmetro (sem Prisma) para facilitar testes. O orquestrador carrega configs do banco e chama tudo em sequência. Um novo endpoint `POST /api/frete/decisao` expõe o motor.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma (PostgreSQL/Supabase), Vitest, Lalamove API v3

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `prisma/schema.prisma` | Modificar | Adicionar modelo `FreightDecisionLog` |
| `types/index.ts` | Modificar | Tipos `InternalVehicleType`, `LalamoveServiceType`, `FreightDecisionInput`, `FreightDecisionResult`, `VehicleConfig`, `CostConfig` |
| `lib/constants.ts` | Modificar | `LALAMOVE_VEHICLE_MAP`, `INTERNAL_VEHICLE_MARGINS` |
| `services/lalamove.service.ts` | Modificar | Adicionar param `serviceType` em `getLalamoveQuote` |
| `services/freight-decision.service.ts` | Criar | 9 funções do motor |
| `app/api/frete/decisao/route.ts` | Criar | Endpoint POST |
| `prisma/seed.ts` | Modificar | 16 novas chaves em SystemConfig |
| `tests/services/freight-decision.test.ts` | Criar | Testes unitários das 8 funções puras |

---

## Task 1: Schema — FreightDecisionLog

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Adicionar modelo ao schema**

No final de `prisma/schema.prisma`, antes do último `@@map`, adicionar:

```prisma
// ──────────────────────────────────────────────
// LOG DE DECISÃO DE FRETE (auditoria e otimização futura)
// ──────────────────────────────────────────────

model FreightDecisionLog {
  id                String   @id @default(cuid())
  storeId           String
  deliveryRequestId String?
  selectedMode      String   // "INTERNAL" | "LALAMOVE"
  selectedVehicle   String   // InternalVehicleType | LalamoveServiceType
  driverId          String?
  distanceKm        Float
  durationMin       Float
  internalCost      Float
  lalamoveCost      Float?
  suggestedPrice    Float
  decisionReason    String
  isUrgent          Boolean
  isApproximate     Boolean
  totalWeightKg     Float
  totalLatas        Int?
  createdAt         DateTime @default(now())

  @@map("freight_decision_logs")
}
```

- [ ] **Step 2: Sincronizar banco**

```bash
cd "Projects/sistema-logistica"
npx prisma db push --skip-generate
npx prisma generate
```

Expected: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add FreightDecisionLog model to schema"
```

---

## Task 2: Tipos e Constantes

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/constants.ts`

- [ ] **Step 1: Adicionar tipos em `types/index.ts`**

Adicionar após o bloco `// re-exporta enums`:

```typescript
// ──────────────────────────────────────────────
// MOTOR DE DECISÃO DE FRETE
// ──────────────────────────────────────────────

// Tipos de veículo da frota própria
export const InternalVehicleType = {
  MOTO:     "MOTO",
  FIORINO:  "FIORINO",
  CAMINHAO: "CAMINHAO",
} as const
export type InternalVehicleType = typeof InternalVehicleType[keyof typeof InternalVehicleType]

// Tipos de serviço Lalamove Brasil
// ATENÇÃO: confirmar os códigos exatos na API Lalamove antes do go-live
export const LalamoveServiceType = {
  LALAPRO:    "MOTORCYCLE",    // LalaPro — até 20 kg
  UTILITARIO: "VAN",           // Utilitário — até 500 kg
  VAN:        "VAN_L",         // Van — até 1.000 kg
  CARRETO:    "MOVING_TRUCK",  // Carreto — até 1.500 kg
  CAMINHAO:   "TRUCK",         // Caminhão — até 2.500 kg
} as const
export type LalamoveServiceType = typeof LalamoveServiceType[keyof typeof LalamoveServiceType]

// Configurações de classificação de veículos (carregadas do SystemConfig)
export interface VehicleConfig {
  INTERNAL_MOTO_MAX_KG:       number
  INTERNAL_FIORINO_MAX_KG:    number
  INTERNAL_FIORINO_MAX_LATAS: number
  INTERNAL_CAMINHAO_MAX_KG:   number
  INTERNAL_CAMINHAO_MAX_LATAS: number
  LALA_LALAPRO_MAX_KG:        number
  LALA_UTILITARIO_MAX_KG:     number
  LALA_VAN_MAX_KG:            number
  LALA_CARRETO_MAX_KG:        number
  LALA_CAMINHAO_MAX_KG:       number
}

// Configurações de custo de rota interna
export interface CostConfig {
  COST_PER_KM:       number
  COST_PER_HOUR:     number
  FIXED_ROUTE_COST:  number
}

export interface FreightDecisionInput {
  originLat:           number
  originLng:           number
  destLat:             number
  destLng:             number
  isUrgent:            boolean
  deliveryDate:        Date
  deliveryWindowStart: Date
  deliveryWindowEnd:   Date
  items: {
    productCode: string
    quantity:    number
    weightKg:    number
    latas?:      number   // qtd de latas por unidade (embalagem 18L)
    volumeM3?:   number
  }[]
  sellerId: string
  storeId:  string
}

export interface FreightDecisionResult {
  selectedMode:             "INTERNAL" | "LALAMOVE"
  selectedVehicle:          InternalVehicleType | LalamoveServiceType
  driverId?:                string
  requiresManualAssignment: boolean
  lalamoveQuote?: {
    quotationId:    string
    estimatedPrice: number
    serviceType:    string
  }
  distanceKm:      number
  durationMinutes: number
  isApproximate:   boolean
  internalCost:    number
  lalamoveCost:    number | null
  suggestedPrice:  number
  decisionReason:  string
}
```

- [ ] **Step 2: Adicionar constantes em `lib/constants.ts`**

Adicionar no final do arquivo:

```typescript
// Motor de Decisão de Frete — mapeamento interno → código Lalamove API
// Usar em conjunto com LalamoveServiceType de types/index.ts
export const LALAMOVE_VEHICLE_MAP: Record<string, string> = {
  LALAPRO:    "MOTORCYCLE",
  UTILITARIO: "VAN",
  VAN:        "VAN_L",
  CARRETO:    "MOVING_TRUCK",
  CAMINHAO:   "TRUCK",
}

// Margem por tipo de veículo interno: precoBase = MAX(zona, custo × margem)
export const INTERNAL_VEHICLE_MARGINS: Record<string, number> = {
  MOTO:     1.8,
  FIORINO:  1.4,
  CAMINHAO: 1.3,
}

// Margem sobre custo Lalamove quando selectedMode = LALAMOVE
export const LALAMOVE_PRICE_MARGIN = 1.15
```

- [ ] **Step 3: Verificar que TypeScript compila**

```bash
npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts lib/constants.ts
git commit -m "feat: add FreightDecision types and vehicle constants"
```

---

## Task 3: classifyVehicle (TDD)

**Files:**
- Create: `tests/services/freight-decision.test.ts`
- Create: `services/freight-decision.service.ts`

- [ ] **Step 1: Criar teste com casos de classifyVehicle**

Criar `tests/services/freight-decision.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  classifyVehicle,
} from "@/services/freight-decision.service";
import { InternalVehicleType, LalamoveServiceType } from "@/types";
import type { VehicleConfig } from "@/types";

const defaultVehicleConfig: VehicleConfig = {
  INTERNAL_MOTO_MAX_KG:        20,
  INTERNAL_FIORINO_MAX_KG:     500,
  INTERNAL_FIORINO_MAX_LATAS:  20,
  INTERNAL_CAMINHAO_MAX_KG:    1500,
  INTERNAL_CAMINHAO_MAX_LATAS: 67,
  LALA_LALAPRO_MAX_KG:         20,
  LALA_UTILITARIO_MAX_KG:      500,
  LALA_VAN_MAX_KG:             1000,
  LALA_CARRETO_MAX_KG:         1500,
  LALA_CAMINHAO_MAX_KG:        2500,
};

describe("classifyVehicle", () => {
  it("5 kg → MOTO interno, LALAPRO Lalamove", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 1, weightKg: 5 }], defaultVehicleConfig);
    expect(r.internalVehicle).toBe(InternalVehicleType.MOTO);
    expect(r.lalamoveVehicle).toBe(LalamoveServiceType.LALAPRO);
    expect(r.totalWeightKg).toBe(5);
  });

  it("100 kg → FIORINO interno, UTILITARIO Lalamove", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 2, weightKg: 50 }], defaultVehicleConfig);
    expect(r.internalVehicle).toBe(InternalVehicleType.FIORINO);
    expect(r.lalamoveVehicle).toBe(LalamoveServiceType.UTILITARIO);
    expect(r.totalWeightKg).toBe(100);
  });

  it("700 kg → CAMINHAO interno, VAN Lalamove", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 1, weightKg: 700 }], defaultVehicleConfig);
    expect(r.internalVehicle).toBe(InternalVehicleType.CAMINHAO);
    expect(r.lalamoveVehicle).toBe(LalamoveServiceType.VAN);
  });

  it("21 latas mas 420 kg → excede limite de latas do FIORINO → CAMINHAO interno", () => {
    const r = classifyVehicle(
      [{ productCode: "T01", quantity: 21, weightKg: 20, latas: 1 }],
      defaultVehicleConfig
    );
    expect(r.internalVehicle).toBe(InternalVehicleType.CAMINHAO);
    expect(r.totalLatas).toBe(21);
  });

  it("68 latas → excede limite de latas do CAMINHAO → EXCEPTION interno", () => {
    const r = classifyVehicle(
      [{ productCode: "T01", quantity: 68, weightKg: 20, latas: 1 }],
      defaultVehicleConfig
    );
    expect(r.internalVehicle).toBe("EXCEPTION");
  });

  it("2600 kg → EXCEPTION interno e EXCEPTION Lalamove", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 1, weightKg: 2600 }], defaultVehicleConfig);
    expect(r.internalVehicle).toBe("EXCEPTION");
    expect(r.lalamoveVehicle).toBe("EXCEPTION");
  });

  it("sem latas informadas → usa apenas peso para frota própria", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 100, weightKg: 4 }], defaultVehicleConfig);
    // 400 kg sem latas → não bloqueia por latas
    expect(r.internalVehicle).toBe(InternalVehicleType.FIORINO);
    expect(r.totalLatas).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `Cannot find module '@/services/freight-decision.service'`

- [ ] **Step 3: Criar `services/freight-decision.service.ts` com classifyVehicle**

```typescript
// services/freight-decision.service.ts
// Motor de decisão logística: classifica carga, calcula custos, decide modal.
// Funções puras recebem configs como parâmetro — sem Prisma — para facilitar testes.
// O orquestrador makeFreightDecision() carrega configs e chama tudo em sequência.

import { InternalVehicleType, LalamoveServiceType } from "@/types";
import type {
  FreightDecisionInput,
  FreightDecisionResult,
  VehicleConfig,
  CostConfig,
} from "@/types";

// ──────────────────────────────────────────────
// PASSO 1 — CLASSIFICAÇÃO DA CARGA
// ──────────────────────────────────────────────

export interface CargoClassification {
  internalVehicle: InternalVehicleType | "EXCEPTION";
  lalamoveVehicle: LalamoveServiceType | "EXCEPTION";
  totalWeightKg:   number;
  totalLatas:      number;
}

export function classifyVehicle(
  items: FreightDecisionInput["items"],
  config: VehicleConfig
): CargoClassification {
  const totalWeightKg = items.reduce((s, i) => s + i.weightKg * i.quantity, 0);
  const totalLatas    = items.reduce((s, i) => s + (i.latas ?? 0) * i.quantity, 0);

  // Frota própria: peso E latas (ambos devem caber)
  let internalVehicle: InternalVehicleType | "EXCEPTION";
  const latasOk = (max: number) => totalLatas === 0 || totalLatas <= max;

  if (totalWeightKg <= config.INTERNAL_MOTO_MAX_KG) {
    internalVehicle = InternalVehicleType.MOTO;
  } else if (totalWeightKg <= config.INTERNAL_FIORINO_MAX_KG && latasOk(config.INTERNAL_FIORINO_MAX_LATAS)) {
    internalVehicle = InternalVehicleType.FIORINO;
  } else if (totalWeightKg <= config.INTERNAL_CAMINHAO_MAX_KG && latasOk(config.INTERNAL_CAMINHAO_MAX_LATAS)) {
    internalVehicle = InternalVehicleType.CAMINHAO;
  } else {
    internalVehicle = "EXCEPTION";
  }

  // Lalamove: apenas peso
  let lalamoveVehicle: LalamoveServiceType | "EXCEPTION";
  if      (totalWeightKg <= config.LALA_LALAPRO_MAX_KG)    lalamoveVehicle = LalamoveServiceType.LALAPRO;
  else if (totalWeightKg <= config.LALA_UTILITARIO_MAX_KG) lalamoveVehicle = LalamoveServiceType.UTILITARIO;
  else if (totalWeightKg <= config.LALA_VAN_MAX_KG)        lalamoveVehicle = LalamoveServiceType.VAN;
  else if (totalWeightKg <= config.LALA_CARRETO_MAX_KG)    lalamoveVehicle = LalamoveServiceType.CARRETO;
  else if (totalWeightKg <= config.LALA_CAMINHAO_MAX_KG)   lalamoveVehicle = LalamoveServiceType.CAMINHAO;
  else                                                      lalamoveVehicle = "EXCEPTION";

  return { internalVehicle, lalamoveVehicle, totalWeightKg, totalLatas };
}
```

- [ ] **Step 4: Rodar e confirmar PASS**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add services/freight-decision.service.ts tests/services/freight-decision.test.ts
git commit -m "feat: add classifyVehicle with TDD"
```

---

## Task 4: calculateInternalCost (TDD)

**Files:**
- Modify: `tests/services/freight-decision.test.ts`
- Modify: `services/freight-decision.service.ts`

- [ ] **Step 1: Adicionar testes em `freight-decision.test.ts`**

Adicionar após o `describe("classifyVehicle")`:

```typescript
import {
  classifyVehicle,
  calculateInternalCost,
} from "@/services/freight-decision.service";
import type { CostConfig } from "@/types";

const defaultCostConfig: CostConfig = {
  COST_PER_KM:      1.50,
  COST_PER_HOUR:    30.00,
  FIXED_ROUTE_COST:  8.00,
};

describe("calculateInternalCost", () => {
  it("10 km, 20 min → 8 + 15 + 10 = 33", () => {
    const cost = calculateInternalCost({ distanceKm: 10, durationMin: 20 }, defaultCostConfig);
    expect(cost).toBeCloseTo(33, 2); // 8 + (10×1.5) + (20/60×30)
  });

  it("0 km, 0 min → apenas custo fixo", () => {
    const cost = calculateInternalCost({ distanceKm: 0, durationMin: 0 }, defaultCostConfig);
    expect(cost).toBeCloseTo(8, 2);
  });

  it("respeita configs customizadas", () => {
    const cfg: CostConfig = { COST_PER_KM: 2, COST_PER_HOUR: 60, FIXED_ROUTE_COST: 10 };
    const cost = calculateInternalCost({ distanceKm: 5, durationMin: 30 }, cfg);
    expect(cost).toBeCloseTo(10 + 10 + 30, 2); // 10 + (5×2) + (30/60×60)
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `calculateInternalCost is not a function`

- [ ] **Step 3: Adicionar `calculateInternalCost` em `freight-decision.service.ts`**

Adicionar após `classifyVehicle`:

```typescript
// ──────────────────────────────────────────────
// PASSO 3 — CUSTO DE ROTA INTERNA
// Custo flat — não varia por tipo de veículo.
// ──────────────────────────────────────────────

export function calculateInternalCost(
  route: { distanceKm: number; durationMin: number },
  config: CostConfig
): number {
  return (
    config.FIXED_ROUTE_COST +
    route.distanceKm * config.COST_PER_KM +
    (route.durationMin / 60) * config.COST_PER_HOUR
  );
}
```

- [ ] **Step 4: Rodar e confirmar PASS**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `10 passed`

- [ ] **Step 5: Commit**

```bash
git add services/freight-decision.service.ts tests/services/freight-decision.test.ts
git commit -m "feat: add calculateInternalCost with TDD"
```

---

## Task 5: scoreDriverForDelivery (TDD)

**Files:**
- Modify: `tests/services/freight-decision.test.ts`
- Modify: `services/freight-decision.service.ts`

- [ ] **Step 1: Adicionar testes**

Adicionar no arquivo de testes:

```typescript
import {
  classifyVehicle,
  calculateInternalCost,
  scoreDriverForDelivery,
} from "@/services/freight-decision.service";

describe("scoreDriverForDelivery", () => {
  const origin = { lat: -23.62, lng: -46.70 };
  const dest   = { lat: -23.60, lng: -46.73 };

  it("motorista sem localização → score 0", () => {
    const score = scoreDriverForDelivery(
      { lastLat: null, lastLng: null, activeDispatches: 0 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score).toBe(0);
  });

  it("motorista na origem, 0 dispatches → score alto (≥ 60)", () => {
    const score = scoreDriverForDelivery(
      { lastLat: origin.lat, lastLng: origin.lng, activeDispatches: 0 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("motorista longe (30 km), 2 dispatches → score baixo (< 30)", () => {
    const score = scoreDriverForDelivery(
      { lastLat: -23.00, lastLng: -46.00, activeDispatches: 2 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score).toBeLessThan(30);
  });

  it("2 dispatches ativos → perde os 30 pts de disponibilidade", () => {
    const score0 = scoreDriverForDelivery(
      { lastLat: origin.lat, lastLng: origin.lng, activeDispatches: 0 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    const score2 = scoreDriverForDelivery(
      { lastLat: origin.lat, lastLng: origin.lng, activeDispatches: 2 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score0 - score2).toBeCloseTo(30, 0);
  });

  it("score sempre entre 0 e 100", () => {
    const score = scoreDriverForDelivery(
      { lastLat: origin.lat, lastLng: origin.lng, activeDispatches: 0 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `scoreDriverForDelivery is not a function`

- [ ] **Step 3: Adicionar `scoreDriverForDelivery` em `freight-decision.service.ts`**

Adicionar no topo do arquivo após os imports existentes:

```typescript
import { calculateHaversineDistance } from "@/lib/utils";
```

Adicionar após `calculateInternalCost`:

```typescript
// ──────────────────────────────────────────────
// PASSO 5 — SCORE DE MOTORISTA
// ──────────────────────────────────────────────

export interface DriverCandidate {
  lastLat:         number | null;
  lastLng:         number | null;
  activeDispatches: number;
}

const MAX_PROXIMITY_KM = 20; // distâncias além disso valem 0 pts de proximidade

export function scoreDriverForDelivery(
  driver:    DriverCandidate,
  originLat: number,
  originLng: number,
  destLat:   number,
  destLng:   number
): number {
  if (driver.lastLat === null || driver.lastLng === null) return 0;

  const dOrigin = calculateHaversineDistance(driver.lastLat, driver.lastLng, originLat, originLng);
  const dDest   = calculateHaversineDistance(driver.lastLat, driver.lastLng, destLat, destLng);

  const originScore   = Math.max(0, 40 * (1 - dOrigin / MAX_PROXIMITY_KM));
  const destScore     = Math.max(0, 30 * (1 - dDest   / MAX_PROXIMITY_KM));
  const dispatchScore = driver.activeDispatches === 0 ? 30 : driver.activeDispatches === 1 ? 15 : 0;

  return Math.round(originScore + destScore + dispatchScore);
}
```

- [ ] **Step 4: Rodar e confirmar PASS**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `15 passed`

- [ ] **Step 5: Commit**

```bash
git add services/freight-decision.service.ts tests/services/freight-decision.test.ts
git commit -m "feat: add scoreDriverForDelivery with TDD"
```

---

## Task 6: decideBestDeliveryOption (TDD — 6 ramificações)

**Files:**
- Modify: `tests/services/freight-decision.test.ts`
- Modify: `services/freight-decision.service.ts`

- [ ] **Step 1: Adicionar testes para as 6 ramificações**

Adicionar no arquivo de testes:

```typescript
import {
  classifyVehicle,
  calculateInternalCost,
  scoreDriverForDelivery,
  decideBestDeliveryOption,
} from "@/services/freight-decision.service";

const mockDriver = { id: "d1", name: "João", score: 80 };

describe("decideBestDeliveryOption", () => {
  // Regra 1: Urgente + Lalamove mais barato → Lalamove
  it("regra 1: urgente com Lalamove barato → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,
      internalCost: 50,
      lalamoveCost: 40,  // < 50 × 1.2 = 60
      isUrgent: true,
    });
    expect(r.mode).toBe("LALAMOVE");
    expect(r.requiresManualAssignment).toBe(false);
  });

  // Regra 2: Motorista bom + custo interno ≤ Lalamove → INTERNAL
  it("regra 2: motorista score >= 60 e mais barato → INTERNAL", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,  // score 80
      internalCost: 35,
      lalamoveCost: 40,
      isUrgent: false,
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.driverId).toBe("d1");
  });

  // Regra 3: Lalamove mais barato → LALAMOVE
  it("regra 3: Lalamove mais barato que interno → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: { id: "d1", name: "João", score: 70 },
      internalCost: 60,
      lalamoveCost: 30,
      isUrgent: false,
    });
    expect(r.mode).toBe("LALAMOVE");
  });

  // Regra 4: Sem motorista disponível → LALAMOVE
  it("regra 4: nenhum motorista disponível → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: null,
      internalCost: 35,
      lalamoveCost: 40,
      isUrgent: false,
    });
    expect(r.mode).toBe("LALAMOVE");
  });

  // Regra 5: Lalamove indisponível + motorista disponível → INTERNAL
  it("regra 5: Lalamove indisponível → INTERNAL", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,
      internalCost: 35,
      lalamoveCost: null,
      isUrgent: false,
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.requiresManualAssignment).toBe(false);
  });

  // Regra 6: Nada disponível → INTERNAL com atribuição manual
  it("regra 6: nenhum recurso → INTERNAL com requiresManualAssignment", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: null,
      internalCost: 35,
      lalamoveCost: null,
      isUrgent: false,
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.requiresManualAssignment).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `decideBestDeliveryOption is not a function`

- [ ] **Step 3: Adicionar `decideBestDeliveryOption` em `freight-decision.service.ts`**

```typescript
// ──────────────────────────────────────────────
// PASSO 7 — DECISÃO DE MODAL
// ──────────────────────────────────────────────

export interface DecisionParams {
  internalVehicle: InternalVehicleType | "EXCEPTION";
  lalamoveVehicle: LalamoveServiceType | "EXCEPTION";
  bestDriver: { id: string; name: string; score: number } | null;
  internalCost: number;
  lalamoveCost: number | null;
  isUrgent:     boolean;
}

export interface ModalDecisionResult {
  mode:                    "INTERNAL" | "LALAMOVE";
  vehicle:                 InternalVehicleType | LalamoveServiceType;
  driverId?:               string;
  requiresManualAssignment: boolean;
  reason:                  string;
}

export function decideBestDeliveryOption(p: DecisionParams): ModalDecisionResult {
  const internalOk  = p.internalVehicle !== "EXCEPTION" && p.bestDriver !== null;
  const lalamoveOk  = p.lalamoveVehicle !== "EXCEPTION" && p.lalamoveCost !== null;

  // Regra 1: urgente + Lalamove disponível e não muito mais caro → Lalamove
  if (p.isUrgent && lalamoveOk && p.lalamoveCost! < p.internalCost * 1.2) {
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: `Urgente — Lalamove (R$ ${p.lalamoveCost!.toFixed(2)}) preferido vs interno (R$ ${p.internalCost.toFixed(2)})`,
    };
  }

  // Regra 2: motorista com score ≥ 60 e custo interno ≤ Lalamove → interno
  if (internalOk && p.bestDriver!.score >= 60 && (!lalamoveOk || p.internalCost <= p.lalamoveCost!)) {
    return {
      mode: "INTERNAL",
      vehicle: p.internalVehicle as InternalVehicleType,
      driverId: p.bestDriver!.id,
      requiresManualAssignment: false,
      reason: `${p.bestDriver!.name} disponível (score ${p.bestDriver!.score}) — custo interno R$ ${p.internalCost.toFixed(2)}`,
    };
  }

  // Regra 3: Lalamove mais barato
  if (lalamoveOk && internalOk && p.lalamoveCost! < p.internalCost) {
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: `Lalamove (R$ ${p.lalamoveCost!.toFixed(2)}) mais econômico que rota interna (R$ ${p.internalCost.toFixed(2)})`,
    };
  }

  // Regra 4: sem motorista → Lalamove
  if (!internalOk && lalamoveOk) {
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: "Nenhum motorista disponível — usando Lalamove",
    };
  }

  // Regra 5: Lalamove indisponível + motorista disponível → interno
  if (internalOk && !lalamoveOk) {
    return {
      mode: "INTERNAL",
      vehicle: p.internalVehicle as InternalVehicleType,
      driverId: p.bestDriver!.id,
      requiresManualAssignment: false,
      reason: "Lalamove indisponível — usando rota interna",
    };
  }

  // Regra 6: nada disponível → interno com atribuição manual
  return {
    mode: "INTERNAL",
    vehicle: InternalVehicleType.FIORINO,
    requiresManualAssignment: true,
    reason: "Nenhum recurso disponível — requer atribuição manual pelo operador",
  };
}
```

- [ ] **Step 4: Rodar e confirmar PASS**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `21 passed`

- [ ] **Step 5: Commit**

```bash
git add services/freight-decision.service.ts tests/services/freight-decision.test.ts
git commit -m "feat: add decideBestDeliveryOption with 6 rules"
```

---

## Task 7: calculateCustomerPrice (TDD)

**Files:**
- Modify: `tests/services/freight-decision.test.ts`
- Modify: `services/freight-decision.service.ts`

- [ ] **Step 1: Adicionar testes**

```typescript
import {
  classifyVehicle,
  calculateInternalCost,
  scoreDriverForDelivery,
  decideBestDeliveryOption,
  calculateCustomerPrice,
} from "@/services/freight-decision.service";

describe("calculateCustomerPrice", () => {
  const zone = { basePrice: 25 };

  it("interno FIORINO: MAX(zona=25, custo 20 × 1.4=28) → 28", () => {
    const price = calculateCustomerPrice({
      zone,
      internalCost:    20,
      lalamoveCost:    40,
      selectedMode:    "INTERNAL",
      internalVehicle: InternalVehicleType.FIORINO,
      isUrgent:        false,
      urgencySurcharge: 1.3,
    });
    expect(price).toBeCloseTo(28, 2);
  });

  it("interno MOTO: MAX(zona=25, custo 10 × 1.8=18) → usa zona (25)", () => {
    const price = calculateCustomerPrice({
      zone,
      internalCost:    10,
      lalamoveCost:    null,
      selectedMode:    "INTERNAL",
      internalVehicle: InternalVehicleType.MOTO,
      isUrgent:        false,
      urgencySurcharge: 1.3,
    });
    expect(price).toBeCloseTo(25, 2);
  });

  it("Lalamove: MAX(zona=25, custo 30 × 1.15=34.5) → 34.5", () => {
    const price = calculateCustomerPrice({
      zone,
      internalCost:    20,
      lalamoveCost:    30,
      selectedMode:    "LALAMOVE",
      internalVehicle: InternalVehicleType.FIORINO,
      isUrgent:        false,
      urgencySurcharge: 1.3,
    });
    expect(price).toBeCloseTo(34.5, 2);
  });

  it("urgente aplica sobretaxa de 1.3×", () => {
    const normal = calculateCustomerPrice({
      zone,
      internalCost:    20,
      lalamoveCost:    null,
      selectedMode:    "INTERNAL",
      internalVehicle: InternalVehicleType.FIORINO,
      isUrgent:        false,
      urgencySurcharge: 1.3,
    });
    const urgent = calculateCustomerPrice({
      zone,
      internalCost:    20,
      lalamoveCost:    null,
      selectedMode:    "INTERNAL",
      internalVehicle: InternalVehicleType.FIORINO,
      isUrgent:        true,
      urgencySurcharge: 1.3,
    });
    expect(urgent).toBeCloseTo(normal * 1.3, 2);
  });

  it("zona null → usa apenas custo × margem", () => {
    const price = calculateCustomerPrice({
      zone: null,
      internalCost:    20,
      lalamoveCost:    null,
      selectedMode:    "INTERNAL",
      internalVehicle: InternalVehicleType.FIORINO,
      isUrgent:        false,
      urgencySurcharge: 1.3,
    });
    expect(price).toBeCloseTo(28, 2); // 20 × 1.4
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `calculateCustomerPrice is not a function`

- [ ] **Step 3: Adicionar `calculateCustomerPrice` em `freight-decision.service.ts`**

Adicionar no início do arquivo após os imports existentes:

```typescript
import { INTERNAL_VEHICLE_MARGINS, LALAMOVE_PRICE_MARGIN } from "@/lib/constants";
```

Adicionar após `decideBestDeliveryOption`:

```typescript
// ──────────────────────────────────────────────
// PASSO 8 — PREÇO SUGERIDO AO CLIENTE
// MAX(zona, custo_real × margem) + sobretaxa de urgência
// ──────────────────────────────────────────────

export function calculateCustomerPrice(params: {
  zone:             { basePrice: number } | null;
  internalCost:     number;
  lalamoveCost:     number | null;
  selectedMode:     "INTERNAL" | "LALAMOVE";
  internalVehicle:  InternalVehicleType | "EXCEPTION";
  isUrgent:         boolean;
  urgencySurcharge: number;
}): number {
  const { zone, internalCost, lalamoveCost, selectedMode, internalVehicle, isUrgent, urgencySurcharge } = params;

  let basePrice: number;

  if (selectedMode === "INTERNAL" && internalVehicle !== "EXCEPTION") {
    const margin = INTERNAL_VEHICLE_MARGINS[internalVehicle] ?? 1.3;
    basePrice = Math.max(zone?.basePrice ?? 0, internalCost * margin);
  } else {
    const lalamoveBase = lalamoveCost != null ? lalamoveCost * LALAMOVE_PRICE_MARGIN : 0;
    basePrice = Math.max(zone?.basePrice ?? 0, lalamoveBase);
  }

  return isUrgent ? basePrice * urgencySurcharge : basePrice;
}
```

- [ ] **Step 4: Rodar e confirmar PASS**

```bash
npm test -- tests/services/freight-decision.test.ts
```

Expected: `26 passed`

- [ ] **Step 5: Commit**

```bash
git add services/freight-decision.service.ts tests/services/freight-decision.test.ts
git commit -m "feat: add calculateCustomerPrice with TDD"
```

---

## Task 8: getAvailableDrivers + Lalamove serviceType

**Files:**
- Modify: `services/freight-decision.service.ts`
- Modify: `services/lalamove.service.ts`

- [ ] **Step 1: Adicionar `getAvailableDrivers` em `freight-decision.service.ts`**

Adicionar no topo, após imports existentes:

```typescript
import { prisma } from "@/lib/prisma";
import { DispatchStatus } from "@prisma/client";
```

Adicionar após `calculateCustomerPrice`:

```typescript
// ──────────────────────────────────────────────
// PASSO 4 — MOTORISTAS DISPONÍVEIS
// ──────────────────────────────────────────────

export interface AvailableDriver {
  id:               string;
  name:             string;
  lastLat:          number | null;
  lastLng:          number | null;
  activeDispatches: number;
}

export async function getAvailableDrivers(
  storeId:            string,
  maxLocationAgeMin:  number
): Promise<AvailableDriver[]> {
  const cutoff = new Date(Date.now() - maxLocationAgeMin * 60 * 1000);

  const drivers = await prisma.driver.findMany({
    where: { storeId, active: true, available: true },
    include: {
      locations: {
        where:   { timestamp: { gte: cutoff } },
        orderBy: { timestamp: "desc" },
        take:    1,
      },
      dispatches: {
        where:  { status: { in: [DispatchStatus.PENDING, DispatchStatus.ASSIGNED, DispatchStatus.IN_TRANSIT] } },
        select: { id: true },
      },
    },
  });

  return drivers.map((d) => ({
    id:               d.id,
    name:             d.name,
    lastLat:          d.locations[0]?.lat ?? null,
    lastLng:          d.locations[0]?.lng ?? null,
    activeDispatches: d.dispatches.length,
  }));
}
```

- [ ] **Step 2: Adicionar `serviceType` opcional em `services/lalamove.service.ts`**

Localizar a função `getLalamoveQuote` e alterar a assinatura para aceitar `serviceType` opcional:

```typescript
export async function getLalamoveQuote(
  originStop:      LalamoveStop,
  destinationStop: LalamoveStop,
  isUrgent:        boolean = false,
  serviceType:     string = LALAMOVE_SERVICE_TYPE   // novo parâmetro — backward compatible
): Promise<LalamoveQuoteResponse> {
  const path = "/v3/quotations";
  const body: LalamoveQuoteRequest = {
    language:        "pt_BR",
    serviceType,                  // usa o parâmetro em vez da constante diretamente
    specialRequests: [],
    stops: [originStop, destinationStop],
    item: {
      quantity:             "1",
      weight:               "LESS_THAN_3_KG",
      categories:           ["OFFICE_SUPPLY"],
      handlingInstructions: [],
    },
  };
  // ... resto da função sem alteração
```

- [ ] **Step 3: Rodar todos os testes**

```bash
npm test
```

Expected: `44+ passed` (todos os anteriores + nenhuma regressão)

- [ ] **Step 4: Commit**

```bash
git add services/freight-decision.service.ts services/lalamove.service.ts
git commit -m "feat: add getAvailableDrivers and serviceType param in Lalamove"
```

---

## Task 9: makeFreightDecision — orquestrador

**Files:**
- Modify: `services/freight-decision.service.ts`
- Modify: `tests/services/freight-decision.test.ts`

- [ ] **Step 1: Adicionar imports necessários em `freight-decision.service.ts`**

Verificar que os imports no topo do arquivo incluem:

```typescript
import { prisma }        from "@/lib/prisma";
import { resolveRoute }  from "@/lib/route-resolver";
import { getLalamoveQuote } from "@/services/lalamove.service";
import { DispatchStatus }   from "@prisma/client";
import { calculateHaversineDistance } from "@/lib/utils";
import { INTERNAL_VEHICLE_MARGINS, LALAMOVE_PRICE_MARGIN, LALAMOVE_VEHICLE_MAP } from "@/lib/constants";
import type { FreightDecisionInput, FreightDecisionResult, VehicleConfig, CostConfig } from "@/types";
import { InternalVehicleType, LalamoveServiceType } from "@/types";
import type { LalamoveStop } from "@/types";
```

- [ ] **Step 2: Adicionar `makeFreightDecision` em `freight-decision.service.ts`**

Adicionar no final do arquivo:

```typescript
// ──────────────────────────────────────────────
// ORQUESTRADOR PRINCIPAL
// ──────────────────────────────────────────────

const DECISION_CONFIG_KEYS = [
  "COST_PER_KM", "COST_PER_HOUR", "FIXED_ROUTE_COST",
  "INTERNAL_MOTO_MAX_KG", "INTERNAL_FIORINO_MAX_KG", "INTERNAL_FIORINO_MAX_LATAS",
  "INTERNAL_CAMINHAO_MAX_KG", "INTERNAL_CAMINHAO_MAX_LATAS",
  "LALA_LALAPRO_MAX_KG", "LALA_UTILITARIO_MAX_KG", "LALA_VAN_MAX_KG",
  "LALA_CARRETO_MAX_KG", "LALA_CAMINHAO_MAX_KG",
  "URGENCY_SURCHARGE_MIN", "DRIVER_MAX_LOCATION_AGE_MIN",
] as const;

export async function makeFreightDecision(
  input: FreightDecisionInput
): Promise<FreightDecisionResult> {
  // 1. Configs em uma query
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: [...DECISION_CONFIG_KEYS] } },
  });
  const cfg = Object.fromEntries(rows.map((r) => [r.key, parseFloat(r.value)])) as
    VehicleConfig & CostConfig & { URGENCY_SURCHARGE_MIN: number; DRIVER_MAX_LOCATION_AGE_MIN: number };

  // 2. Classificação da carga
  const cargo = classifyVehicle(input.items, cfg);

  // 3. Rota
  const route = await resolveRoute(input.originLat, input.originLng, input.destLat, input.destLng);

  // 4. Custo interno
  const internalCost = calculateInternalCost(route, cfg);

  // 5. Motoristas disponíveis (só se frota própria é viável)
  const driverCandidates = cargo.internalVehicle !== "EXCEPTION"
    ? await getAvailableDrivers(input.storeId, cfg.DRIVER_MAX_LOCATION_AGE_MIN ?? 30)
    : [];

  const scoredDrivers = driverCandidates
    .map((d) => ({ ...d, score: scoreDriverForDelivery(d, input.originLat, input.originLng, input.destLat, input.destLng) }))
    .sort((a, b) => b.score - a.score);
  const bestDriver = scoredDrivers[0] ?? null;

  // 6. Cotação Lalamove (não bloqueia em caso de erro)
  let lalamoveCost: number | null = null;
  let lalamoveQuote: FreightDecisionResult["lalamoveQuote"] | undefined;

  if (cargo.lalamoveVehicle !== "EXCEPTION") {
    try {
      const origin: LalamoveStop = {
        coordinates: { lat: String(input.originLat), lng: String(input.originLng) },
        address: "",
      };
      const dest: LalamoveStop = {
        coordinates: { lat: String(input.destLat), lng: String(input.destLng) },
        address: "",
      };
      const serviceType = LALAMOVE_VEHICLE_MAP[cargo.lalamoveVehicle] ?? LALAMOVE_VEHICLE_MAP.LALAPRO;
      const quote = await getLalamoveQuote(origin, dest, input.isUrgent, serviceType);
      lalamoveCost = parseFloat(quote.priceBreakdown.total);
      lalamoveQuote = {
        quotationId:    quote.quotationId,
        estimatedPrice: lalamoveCost,
        serviceType,
      };
    } catch {
      // Lalamove indisponível — decisão continua sem cotação externa
    }
  }

  // 7. Decisão de modal
  const decision = decideBestDeliveryOption({
    internalVehicle: cargo.internalVehicle,
    lalamoveVehicle: cargo.lalamoveVehicle,
    bestDriver,
    internalCost,
    lalamoveCost,
    isUrgent: input.isUrgent,
  });

  // 8. Zona de frete + preço ao cliente
  const zone = await prisma.freightZone.findFirst({
    where: {
      active: true,
      minKm:  { lte: route.distanceKm },
      OR:     [{ maxKm: null }, { maxKm: { gt: route.distanceKm } }],
    },
    orderBy: { minKm: "asc" },
  });

  const suggestedPrice = calculateCustomerPrice({
    zone,
    internalCost,
    lalamoveCost,
    selectedMode:     decision.mode,
    internalVehicle:  cargo.internalVehicle,
    isUrgent:         input.isUrgent,
    urgencySurcharge: cfg.URGENCY_SURCHARGE_MIN ?? 1.3,
  });

  const result: FreightDecisionResult = {
    selectedMode:             decision.mode,
    selectedVehicle:          decision.vehicle,
    driverId:                 decision.driverId,
    requiresManualAssignment: decision.requiresManualAssignment,
    lalamoveQuote,
    distanceKm:      route.distanceKm,
    durationMinutes: route.durationMin,
    isApproximate:   route.isApproximate,
    internalCost,
    lalamoveCost,
    suggestedPrice,
    decisionReason: decision.reason,
  };

  // 9. Log assíncrono — não bloqueia a resposta
  prisma.freightDecisionLog.create({
    data: {
      storeId:        input.storeId,
      selectedMode:   decision.mode,
      selectedVehicle: String(decision.vehicle),
      driverId:        decision.driverId,
      distanceKm:      route.distanceKm,
      durationMin:     route.durationMin,
      internalCost,
      lalamoveCost,
      suggestedPrice,
      decisionReason:  decision.reason,
      isUrgent:        input.isUrgent,
      isApproximate:   route.isApproximate,
      totalWeightKg:   cargo.totalWeightKg,
      totalLatas:      cargo.totalLatas || null,
    },
  }).catch((err: unknown) => console.error("[FreightDecision] log error:", err));

  return result;
}
```

- [ ] **Step 3: Adicionar teste de integração (com mocks)**

Adicionar no final de `tests/services/freight-decision.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: {
      findMany: vi.fn(),
    },
    freightZone: {
      findFirst: vi.fn(),
    },
    driver: {
      findMany: vi.fn(),
    },
    freightDecisionLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/route-resolver", () => ({
  resolveRoute: vi.fn(),
}));

vi.mock("@/services/lalamove.service", () => ({
  getLalamoveQuote: vi.fn(),
}));

import { prisma }       from "@/lib/prisma";
import { resolveRoute } from "@/lib/route-resolver";
import { getLalamoveQuote } from "@/services/lalamove.service";
import { makeFreightDecision } from "@/services/freight-decision.service";

describe("makeFreightDecision (integração com mocks)", () => {
  const baseInput: FreightDecisionInput = {
    originLat: -23.62, originLng: -46.70,
    destLat:   -23.60, destLng:   -46.73,
    isUrgent:  false,
    deliveryDate:        new Date(),
    deliveryWindowStart: new Date(),
    deliveryWindowEnd:   new Date(),
    items: [{ productCode: "T01", quantity: 2, weightKg: 30, latas: 1 }],
    sellerId: "seller1",
    storeId:  "store1",
  };

  beforeEach(() => {
    vi.mocked(prisma.systemConfig.findMany).mockResolvedValue([
      { key: "COST_PER_KM",               value: "1.50" },
      { key: "COST_PER_HOUR",             value: "30.00" },
      { key: "FIXED_ROUTE_COST",          value: "8.00" },
      { key: "INTERNAL_MOTO_MAX_KG",      value: "20" },
      { key: "INTERNAL_FIORINO_MAX_KG",   value: "500" },
      { key: "INTERNAL_FIORINO_MAX_LATAS", value: "20" },
      { key: "INTERNAL_CAMINHAO_MAX_KG",  value: "1500" },
      { key: "INTERNAL_CAMINHAO_MAX_LATAS", value: "67" },
      { key: "LALA_LALAPRO_MAX_KG",       value: "20" },
      { key: "LALA_UTILITARIO_MAX_KG",    value: "500" },
      { key: "LALA_VAN_MAX_KG",           value: "1000" },
      { key: "LALA_CARRETO_MAX_KG",       value: "1500" },
      { key: "LALA_CAMINHAO_MAX_KG",      value: "2500" },
      { key: "URGENCY_SURCHARGE_MIN",     value: "1.30" },
      { key: "DRIVER_MAX_LOCATION_AGE_MIN", value: "30" },
    ] as any);

    vi.mocked(resolveRoute).mockResolvedValue({
      distanceKm: 8, durationMin: 20, isApproximate: false,
    });

    vi.mocked(prisma.driver.findMany).mockResolvedValue([
      {
        id: "d1", name: "João", active: true, available: true,
        locations: [{ lat: -23.62, lng: -46.70, timestamp: new Date() }],
        dispatches: [],
      },
    ] as any);

    vi.mocked(prisma.freightZone.findFirst).mockResolvedValue({
      id: "z1", basePrice: 25,
    } as any);

    vi.mocked(getLalamoveQuote).mockResolvedValue({
      quotationId: "q1",
      priceBreakdown: { total: "40.00", base: "35.00", totalBeforeOptimization: "40.00", currency: "BRL" },
      scheduleAt: "", serviceType: "VAN", specialRequests: [], expiresAt: "", stops: [],
    });
  });

  it("retorna resultado completo com modo, veículo, custos e preço", async () => {
    const result = await makeFreightDecision(baseInput);

    expect(result.distanceKm).toBe(8);
    expect(result.internalCost).toBeGreaterThan(0);
    expect(result.suggestedPrice).toBeGreaterThan(0);
    expect(["INTERNAL", "LALAMOVE"]).toContain(result.selectedMode);
    expect(result.decisionReason.length).toBeGreaterThan(0);
    expect(result.requiresManualAssignment).toBe(false);
  });

  it("quando Lalamove lança erro, continua com modo interno", async () => {
    vi.mocked(getLalamoveQuote).mockRejectedValue(new Error("API timeout"));
    const result = await makeFreightDecision(baseInput);
    expect(result.lalamoveCost).toBeNull();
    expect(result.selectedMode).toBe("INTERNAL");
  });
});
```

- [ ] **Step 4: Rodar todos os testes**

```bash
npm test
```

Expected: todos passando (26 + novos de integração)

- [ ] **Step 5: Commit**

```bash
git add services/freight-decision.service.ts tests/services/freight-decision.test.ts
git commit -m "feat: add makeFreightDecision orchestrator with integration tests"
```

---

## Task 10: Endpoint POST /api/frete/decisao

**Files:**
- Create: `app/api/frete/decisao/route.ts`

- [ ] **Step 1: Criar o endpoint**

Criar `app/api/frete/decisao/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { makeFreightDecision } from "@/services/freight-decision.service";
import { apiSuccess, apiError } from "@/types";

const itemSchema = z.object({
  productCode: z.string(),
  quantity:    z.number().positive(),
  weightKg:    z.number().nonnegative(),
  latas:       z.number().nonnegative().optional(),
  volumeM3:    z.number().nonnegative().optional(),
});

const schema = z.object({
  originLat:           z.number(),
  originLng:           z.number(),
  destLat:             z.number(),
  destLng:             z.number(),
  isUrgent:            z.boolean().default(false),
  deliveryDate:        z.string().datetime(),
  deliveryWindowStart: z.string().datetime(),
  deliveryWindowEnd:   z.string().datetime(),
  items:               z.array(itemSchema).min(1),
  sellerId:            z.string(),
  storeId:             z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado", "UNAUTHORIZED"), { status: 401 });
    }

    const body   = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const input = {
      ...parsed.data,
      deliveryDate:        new Date(parsed.data.deliveryDate),
      deliveryWindowStart: new Date(parsed.data.deliveryWindowStart),
      deliveryWindowEnd:   new Date(parsed.data.deliveryWindowEnd),
    };

    const result = await makeFreightDecision(input);
    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    console.error("[POST /api/frete/decisao]", error);
    return NextResponse.json(apiError("Erro ao calcular decisão de frete"), { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 3: Testar com curl (servidor deve estar rodando)**

```bash
curl -s -X POST http://localhost:3001/api/frete/decisao \
  -H "Content-Type: application/json" \
  -d '{"originLat":-23.62,"originLng":-46.70,"destLat":-23.60,"destLng":-46.73,"isUrgent":false,"deliveryDate":"2026-04-18T10:00:00Z","deliveryWindowStart":"2026-04-18T08:00:00Z","deliveryWindowEnd":"2026-04-18T18:00:00Z","items":[{"productCode":"T01","quantity":2,"weightKg":30,"latas":1}],"sellerId":"seller1","storeId":"store1"}' \
  | head -c 200
```

Expected: `{"error":"Não autenticado","code":"UNAUTHORIZED","success":false}` (correto — falta JWT)

- [ ] **Step 4: Commit**

```bash
git add app/api/frete/decisao/route.ts
git commit -m "feat: add POST /api/frete/decisao endpoint"
```

---

## Task 11: Seed — novas chaves no SystemConfig

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Adicionar novas configs no array `configs`**

Localizar o array `configs` em `prisma/seed.ts` e adicionar as seguintes entradas (após as existentes):

```typescript
    // Motor de Decisão de Frete — frota própria
    { key: "COST_PER_KM",               value: "1.50",  type: "number", label: "Custo por km (frota própria)" },
    { key: "COST_PER_HOUR",             value: "30.00", type: "number", label: "Custo por hora de rota" },
    { key: "FIXED_ROUTE_COST",          value: "8.00",  type: "number", label: "Custo fixo por saída" },
    { key: "INTERNAL_MOTO_MAX_KG",      value: "20",    type: "number", label: "Peso máximo moto (kg)" },
    { key: "INTERNAL_FIORINO_MAX_KG",   value: "500",   type: "number", label: "Peso máximo fiorino (kg)" },
    { key: "INTERNAL_FIORINO_MAX_LATAS", value: "20",   type: "number", label: "Latas máximo fiorino" },
    { key: "INTERNAL_CAMINHAO_MAX_KG",  value: "1500",  type: "number", label: "Peso máximo caminhão (kg)" },
    { key: "INTERNAL_CAMINHAO_MAX_LATAS", value: "67",  type: "number", label: "Latas máximo caminhão" },
    // Motor de Decisão de Frete — Lalamove
    { key: "LALA_LALAPRO_MAX_KG",       value: "20",    type: "number", label: "LalaPro — peso máximo (kg)" },
    { key: "LALA_UTILITARIO_MAX_KG",    value: "500",   type: "number", label: "Utilitário Lalamove — peso máximo (kg)" },
    { key: "LALA_VAN_MAX_KG",           value: "1000",  type: "number", label: "Van Lalamove — peso máximo (kg)" },
    { key: "LALA_CARRETO_MAX_KG",       value: "1500",  type: "number", label: "Carreto Lalamove — peso máximo (kg)" },
    { key: "LALA_CAMINHAO_MAX_KG",      value: "2500",  type: "number", label: "Caminhão Lalamove — peso máximo (kg)" },
    // Motor de Decisão de Frete — preço
    { key: "URGENCY_SURCHARGE_MIN",     value: "1.30",  type: "number", label: "Sobretaxa urgência (padrão)" },
    { key: "URGENCY_SURCHARGE_MAX",     value: "1.50",  type: "number", label: "Sobretaxa urgência (pico)" },
    { key: "DRIVER_MAX_LOCATION_AGE_MIN", value: "30",  type: "number", label: "Idade máx localização motorista (min)" },
```

- [ ] **Step 2: Rodar seed**

```bash
npm run db:seed
```

Expected:
```
✅ Lojas criadas: 067, 131, 132, 173, 191
✅ Zonas de frete criadas: 5
✅ Configurações criadas: 27
✅ Usuários criados: 7 — Motoristas: 3
🎉 Seed concluído com sucesso!
```

- [ ] **Step 3: Rodar todos os testes uma última vez**

```bash
npm test
```

Expected: todos passando.

- [ ] **Step 4: Commit final**

```bash
git add prisma/seed.ts
git commit -m "feat: add freight decision SystemConfig keys to seed"
```

---

## Checklist de cobertura do spec

| Requisito do spec | Task que implementa |
|---|---|
| `classifyVehicle` — frota própria (peso + latas) | Task 3 |
| `classifyVehicle` — Lalamove (apenas peso) | Task 3 |
| `calculateInternalCost` (flat, sem distinção de veículo) | Task 4 |
| `getAvailableDrivers` | Task 8 |
| `scoreDriverForDelivery` (proximidade + dispatches) | Task 5 |
| Cotação Lalamove com serviceType por veículo | Task 8 |
| `decideBestDeliveryOption` (6 regras) | Task 6 |
| `calculateCustomerPrice` (MAX zona/custo×margem + urgência) | Task 7 |
| `FreightDecisionResult` com `requiresManualAssignment` | Task 2 + Task 9 |
| Log assíncrono em `FreightDecisionLog` | Task 1 + Task 9 |
| Endpoint `POST /api/frete/decisao` | Task 10 |
| SystemConfig com todos os thresholds | Task 11 |
| Testes unitários das funções puras | Tasks 3-7 |
| Teste de integração do orquestrador com mocks | Task 9 |
