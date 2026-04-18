# Sprint 2B — Auditoria de Frete e KPIs Logísticos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o sistema em uma ferramenta de controle financeiro e operacional com auditoria de frete, hard gate de justificativa, KPIs agregados e dashboard de governança.

**Architecture:** Um serviço central `audit.service.ts` concentra toda a lógica de desvio (funções puras + DB). O `FreightAudit` é expandido com campos de classificação, tolerância e justificativa. O `AuditConfig` guarda a política de tolerância separada do dado auditado. O hard gate barra o despacho quando o desvio não foi justificado. APIs RESTful expõem listas filtradas e KPIs. O dashboard e a tela `/auditoria` consomem essas APIs.

**Tech Stack:** Next.js 14 (App Router) · Prisma (PostgreSQL) · TypeScript · Vitest · Tailwind / shadcn

---

## Mapa de Arquivos

| Ação | Arquivo | Responsabilidade |
|------|---------|-----------------|
| Modificar | `prisma/schema.prisma` | Enums + AuditConfig + expandir FreightAudit |
| Criar | `services/audit.service.ts` | Lógica de desvio, tolerância, gate, KPIs |
| Criar | `tests/services/audit.test.ts` | Testes das funções puras + mocks Prisma |
| Modificar | `app/api/solicitacoes/route.ts` | Criar audit ao criar solicitação |
| Modificar | `app/api/despacho/route.ts` | Hard gate antes de criar despacho |
| Criar | `app/api/auditoria/frete/route.ts` | GET lista com filtros + paginação |
| Criar | `app/api/auditoria/frete/[id]/justificativa/route.ts` | POST justificativa |
| Criar | `app/api/auditoria/kpis/route.ts` | GET KPIs agregados |
| Modificar | `app/(app)/dashboard/page.tsx` | Adicionar seção financeira + auditoria |
| Criar | `app/(app)/auditoria/page.tsx` | Tabela + modal de justificativa |
| Modificar | `types/index.ts` | FreightKPIs + AuditListItem |

---

## Task 0 — Schema: Enums + AuditConfig + Expandir FreightAudit

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Adicionar enums após os existentes**

Localizar o bloco de enumerações (após `DispatchModal`) e adicionar:

```prisma
enum DeviationClassification {
  WITHIN_RULE  // desvio dentro da tolerância configurada
  BELOW_RULE   // cobrado abaixo do sugerido (subsídio — alerta, sem bloqueio)
  ABOVE_RULE   // cobrado acima da tolerância (overcharge — exige justificativa)
}

enum RouteSource {
  GOOGLE_MAPS  // distância via API do Google Maps (ou cache de dados do Google)
  HAVERSINE    // fallback — linha reta (isApproximate = true)
}
```

- [ ] **Step 2: Adicionar modelo AuditConfig antes de FreightAudit**

```prisma
// ──────────────────────────────────────────────
// CONFIGURAÇÃO DE AUDITORIA
// Política de tolerância separada do dado auditado.
// storeId = null → configuração global.
// Configuração específica por loja tem precedência.
// ──────────────────────────────────────────────

model AuditConfig {
  id               String   @id @default(cuid())
  storeId          String?  // null = configuração global
  tolerancePercent Float    @default(15) // % de desvio permitido sem justificativa
  description      String?
  active           Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  store Store? @relation(fields: [storeId], references: [id])

  @@map("audit_configs")
}
```

- [ ] **Step 3: Expandir FreightAudit com campos de classificação e justificativa**

No modelo `FreightAudit`, após `freightDeviation Float?` e `costDeviation Float?`, adicionar:

```prisma
  // classificação e controle de desvio
  deviationPercent        Float?                    // (chargedFreight - suggestedFreight) / suggestedFreight * 100
  deviationClassification DeviationClassification?  // classificação automática
  tolerancePercent        Float?                    // tolerância vigente no momento da criação
  justificationRequired   Boolean @default(false)   // true = desvio exige justificativa
  justification           String?                   // texto da justificativa
  justifiedById           String?                   // quem justificou
  justifiedAt             DateTime?                 // quando justificou
  // contexto da rota
  routeSource             RouteSource?              // fonte da distância (para % de fallback)
  durationMinutes         Float?                    // duração da rota no momento da cotação
  // para KPIs — desnormalizado para evitar joins
  sellerId                String?                   // vendedor da solicitação
  totalValue              Float?                    // valor total da NF (para % sobre faturamento)
```

- [ ] **Step 4: Adicionar relações em FreightAudit**

Após as relações existentes (`deliveryRequest`, `dispatch`):

```prisma
  justifiedBy User? @relation("AuditJustifiedBy", fields: [justifiedById], references: [id])
  seller      User? @relation("AuditSeller", fields: [sellerId], references: [id])
```

- [ ] **Step 5: Adicionar back-references em User e Store**

No modelo `User`, após as relações existentes:

```prisma
  auditJustifications FreightAudit[] @relation("AuditJustifiedBy")
  auditSales          FreightAudit[] @relation("AuditSeller")
```

No modelo `Store`, após as relações existentes:

```prisma
  auditConfigs AuditConfig[]
```

- [ ] **Step 6: Gerar client e verificar schema**

```bash
cd "C:/Users/Alberto/OneDrive - Atual Comercio de Tintas e Materiais para Pintura/Claude/Projects/sistema-logistica"
node node_modules/prisma/build/index.js generate 2>&1 | grep -E "Generated|Error|error"
```

Expected: `✔ Generated Prisma Client`

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: expandir FreightAudit com auditoria de desvio e AuditConfig"
```

---

## Task 1 — audit.service.ts: Funções Puras + Testes

**Files:**
- Create: `services/audit.service.ts`
- Create: `tests/services/audit.test.ts`

- [ ] **Step 1: Escrever testes das funções puras**

```typescript
// tests/services/audit.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeDeviation,
  classifyDeviation,
  isJustificationRequired,
} from "@/services/audit.service";

// ──────────────────────────────────────────────
// computeDeviation
// ──────────────────────────────────────────────

describe("computeDeviation", () => {
  it("calcula desvio positivo quando cobrado > sugerido", () => {
    const result = computeDeviation(50, 70);
    expect(result.deviationAmount).toBeCloseTo(20, 2);
    expect(result.deviationPercent).toBeCloseTo(40, 1); // (70-50)/50*100 = 40%
  });

  it("calcula desvio negativo quando cobrado < sugerido", () => {
    const result = computeDeviation(50, 30);
    expect(result.deviationAmount).toBeCloseTo(-20, 2);
    expect(result.deviationPercent).toBeCloseTo(-40, 1);
  });

  it("retorna zero quando cobrado = sugerido", () => {
    const result = computeDeviation(50, 50);
    expect(result.deviationAmount).toBe(0);
    expect(result.deviationPercent).toBe(0);
  });

  it("retorna deviationPercent zero quando sugerido é zero (evita divisão por zero)", () => {
    const result = computeDeviation(0, 50);
    expect(result.deviationAmount).toBe(50);
    expect(result.deviationPercent).toBe(0);
  });

  it("funciona com valores decimais típicos de frete", () => {
    const result = computeDeviation(12.5, 15);
    expect(result.deviationAmount).toBeCloseTo(2.5, 2);
    expect(result.deviationPercent).toBeCloseTo(20, 1);
  });
});

// ──────────────────────────────────────────────
// classifyDeviation
// ──────────────────────────────────────────────

describe("classifyDeviation", () => {
  it("classifica como WITHIN_RULE quando desvio dentro da tolerância positiva", () => {
    expect(classifyDeviation(10, 15)).toBe("WITHIN_RULE");
    expect(classifyDeviation(0, 15)).toBe("WITHIN_RULE");
    expect(classifyDeviation(15, 15)).toBe("WITHIN_RULE"); // no limite = dentro
  });

  it("classifica como WITHIN_RULE quando desvio dentro da tolerância negativa", () => {
    expect(classifyDeviation(-10, 15)).toBe("WITHIN_RULE");
    expect(classifyDeviation(-15, 15)).toBe("WITHIN_RULE"); // no limite = dentro
  });

  it("classifica como ABOVE_RULE quando cobrado excede tolerância positiva", () => {
    expect(classifyDeviation(15.1, 15)).toBe("ABOVE_RULE");
    expect(classifyDeviation(50, 15)).toBe("ABOVE_RULE");
  });

  it("classifica como BELOW_RULE quando cobrado muito abaixo do sugerido", () => {
    expect(classifyDeviation(-15.1, 15)).toBe("BELOW_RULE");
    expect(classifyDeviation(-50, 15)).toBe("BELOW_RULE");
  });

  it("respeita tolerância customizada", () => {
    expect(classifyDeviation(10, 5)).toBe("ABOVE_RULE");  // 10% > 5% de tolerância
    expect(classifyDeviation(4, 5)).toBe("WITHIN_RULE");  // 4% < 5% de tolerância
  });
});

// ──────────────────────────────────────────────
// isJustificationRequired
// ──────────────────────────────────────────────

describe("isJustificationRequired", () => {
  it("exige justificativa apenas para ABOVE_RULE", () => {
    expect(isJustificationRequired("ABOVE_RULE")).toBe(true);
  });

  it("não exige justificativa para WITHIN_RULE", () => {
    expect(isJustificationRequired("WITHIN_RULE")).toBe(false);
  });

  it("não exige justificativa para BELOW_RULE (subsídio é alerta, não bloqueio)", () => {
    expect(isJustificationRequired("BELOW_RULE")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar testes para confirmar que falham**

```bash
npm test -- tests/services/audit.test.ts 2>&1 | tail -5
```

Expected: FAIL com `Cannot find module '@/services/audit.service'`.

- [ ] **Step 3: Criar services/audit.service.ts com as funções puras**

```typescript
// services/audit.service.ts
// Governança de frete: lógica de desvio, classificação, gate de despacho e KPIs.
// Funções puras (computeDeviation, classifyDeviation, isJustificationRequired)
// são exportadas separadamente para facilitar testes.

import { prisma } from "@/lib/prisma";
import {
  DeviationClassification,
  RouteSource,
  DispatchModal,
  DeliveryType,
} from "@prisma/client";

const DEFAULT_TOLERANCE_PERCENT = 15;

// ──────────────────────────────────────────────
// FUNÇÕES PURAS — TESTÁVEIS SEM BANCO
// ──────────────────────────────────────────────

export function computeDeviation(
  suggestedFreight: number,
  chargedFreight: number
): { deviationAmount: number; deviationPercent: number } {
  const deviationAmount = chargedFreight - suggestedFreight;
  const deviationPercent =
    suggestedFreight > 0 ? (deviationAmount / suggestedFreight) * 100 : 0;
  return { deviationAmount, deviationPercent };
}

export function classifyDeviation(
  deviationPercent: number,
  tolerancePercent: number
): DeviationClassification {
  if (deviationPercent > tolerancePercent) return DeviationClassification.ABOVE_RULE;
  if (deviationPercent < -tolerancePercent) return DeviationClassification.BELOW_RULE;
  return DeviationClassification.WITHIN_RULE;
}

export function isJustificationRequired(
  classification: DeviationClassification
): boolean {
  return classification === DeviationClassification.ABOVE_RULE;
}

// ──────────────────────────────────────────────
// TOLERÂNCIA POR LOJA
// Busca configuração específica da loja, com fallback para global.
// ──────────────────────────────────────────────

export async function getToleranceForStore(storeId: string): Promise<number> {
  // tenta config da loja específica primeiro, depois global
  const config = await prisma.auditConfig.findFirst({
    where: {
      active: true,
      OR: [{ storeId }, { storeId: null }],
    },
    orderBy: { storeId: "asc" }, // store-specific (não-null) antes de global (null)
  });
  return config?.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT;
}

// ──────────────────────────────────────────────
// CRIAÇÃO E ATUALIZAÇÃO DE AUDIT
// ──────────────────────────────────────────────

export interface CreateAuditParams {
  deliveryRequestId: string;
  storeId: string;
  invoiceNumber: string;
  sellerId: string;
  suggestedFreight?: number;
  chargedFreight?: number;
  distanceKm?: number;
  durationMinutes?: number;
  isApproximate?: boolean;
  totalValue?: number;
}

export async function createOrUpdateInitialAudit(
  params: CreateAuditParams
): Promise<void> {
  const { suggestedFreight, chargedFreight, storeId } = params;

  let deviationAmount: number | undefined;
  let deviationPercent: number | undefined;
  let classification: DeviationClassification | undefined;
  let justificationRequired = false;
  let tolerancePercent: number | undefined;

  if (suggestedFreight !== undefined && chargedFreight !== undefined) {
    const dev = computeDeviation(suggestedFreight, chargedFreight);
    deviationAmount = dev.deviationAmount;
    deviationPercent = dev.deviationPercent;
    tolerancePercent = await getToleranceForStore(storeId);
    classification = classifyDeviation(deviationPercent, tolerancePercent);
    justificationRequired = isJustificationRequired(classification);
  }

  const routeSource: RouteSource | undefined =
    params.isApproximate !== undefined
      ? params.isApproximate
        ? RouteSource.HAVERSINE
        : RouteSource.GOOGLE_MAPS
      : undefined;

  await prisma.freightAudit.upsert({
    where: { deliveryRequestId: params.deliveryRequestId },
    create: {
      deliveryRequestId: params.deliveryRequestId,
      storeId: params.storeId,
      invoiceNumber: params.invoiceNumber,
      sellerId: params.sellerId,
      suggestedFreight,
      chargedFreight,
      distanceKm: params.distanceKm,
      durationMinutes: params.durationMinutes,
      freightDeviation: deviationAmount,
      deviationPercent,
      deviationClassification: classification,
      tolerancePercent,
      justificationRequired,
      routeSource,
      totalValue: params.totalValue,
    },
    update: {
      suggestedFreight,
      chargedFreight,
      freightDeviation: deviationAmount,
      deviationPercent,
      deviationClassification: classification,
      tolerancePercent,
      justificationRequired,
      routeSource,
    },
  });
}

// ──────────────────────────────────────────────
// HARD GATE — bloqueia despacho sem justificativa
// ──────────────────────────────────────────────

export async function checkAuditGate(deliveryRequestId: string): Promise<{
  blocked: boolean;
  reason?: string;
  auditId?: string;
}> {
  const audit = await prisma.freightAudit.findUnique({
    where: { deliveryRequestId },
    select: { id: true, justificationRequired: true, justification: true },
  });

  if (!audit) return { blocked: false };

  if (audit.justificationRequired && !audit.justification) {
    return {
      blocked: true,
      auditId: audit.id,
      reason:
        "Desvio de frete acima da tolerância exige justificativa antes do despacho. " +
        "Acesse a tela de auditoria para justificar.",
    };
  }

  return { blocked: false };
}

// ──────────────────────────────────────────────
// JUSTIFICATIVA
// ──────────────────────────────────────────────

export async function addJustification(
  auditId: string,
  justification: string,
  justifiedById: string
): Promise<void> {
  if (!justification.trim()) {
    throw new Error("Justificativa não pode ser vazia.");
  }

  await prisma.freightAudit.update({
    where: { id: auditId },
    data: {
      justification: justification.trim(),
      justifiedById,
      justifiedAt: new Date(),
    },
  });
}

// ──────────────────────────────────────────────
// LISTA DE AUDITORIAS (filtrada e paginada)
// ──────────────────────────────────────────────

export interface AuditListFilters {
  storeId?: string;
  sellerId?: string;
  classification?: DeviationClassification;
  from?: Date;
  to?: Date;
  onlyPendingJustification?: boolean;
  page?: number;
  pageSize?: number;
}

export async function getAuditList(filters: AuditListFilters) {
  const {
    storeId,
    sellerId,
    classification,
    from,
    to,
    onlyPendingJustification,
    page = 1,
    pageSize = 50,
  } = filters;

  const where = {
    ...(storeId ? { storeId } : {}),
    ...(sellerId ? { sellerId } : {}),
    ...(classification ? { deviationClassification: classification } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(onlyPendingJustification
      ? { justificationRequired: true, justification: null }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.freightAudit.count({ where }),
    prisma.freightAudit.findMany({
      where,
      include: {
        deliveryRequest: {
          select: { invoiceNumber: true, customerName: true, deliveryAddress: true },
        },
        seller: { select: { id: true, name: true } },
        justifiedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ deviationPercent: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ──────────────────────────────────────────────
// KPIs FINANCEIROS E OPERACIONAIS
// ──────────────────────────────────────────────

export interface FreightKPIs {
  period: { from: string; to: string };
  financial: {
    totalFreightCharged: number;
    totalLogisticsCost: number;
    netSubsidy: number;
    freightAsPercentOfRevenue: number | null;
    avgCostPerDelivery: number;
  };
  operational: {
    totalDeliveries: number;
    urgentPercent: number;
    lalamovePercent: number;
    avgDurationMin: number | null;
    haversinePercent: number | null;
  };
  audit: {
    avgDeviationPercent: number | null;
    pendingJustifications: number;
    withinRulePercent: number | null;
    aboveRulePercent: number | null;
    belowRulePercent: number | null;
  };
  sellerRanking: {
    sellerId: string;
    sellerName: string;
    avgDeviationPercent: number;
    deliveryCount: number;
  }[];
}

export async function getKPIs(params: {
  storeId?: string;
  from: Date;
  to: Date;
}): Promise<FreightKPIs> {
  const { storeId, from, to } = params;
  const periodFilter = { gte: from, lte: to };
  const storeFilter = storeId ? { storeId } : {};

  const [
    auditAgg,
    classGroups,
    haversineCount,
    totalAudits,
    totalDeliveries,
    urgentCount,
    lalamoveCount,
    durationAgg,
    pendingJustifications,
    sellerGroups,
  ] = await Promise.all([
    // financeiro: totais de frete e custo
    prisma.freightAudit.aggregate({
      _sum: { chargedFreight: true, estimatedCost: true, totalValue: true },
      _avg: { deviationPercent: true },
      where: { createdAt: periodFilter, ...storeFilter },
    }),
    // classificação de desvio
    prisma.freightAudit.groupBy({
      by: ["deviationClassification"],
      _count: { id: true },
      where: {
        createdAt: periodFilter,
        ...storeFilter,
        deviationClassification: { not: null },
      },
    }),
    // fallback Haversine
    prisma.freightAudit.count({
      where: { createdAt: periodFilter, ...storeFilter, routeSource: RouteSource.HAVERSINE },
    }),
    // total de registros de auditoria (base para percentuais)
    prisma.freightAudit.count({
      where: { createdAt: periodFilter, ...storeFilter },
    }),
    // total entregas
    prisma.deliveryRequest.count({
      where: { createdAt: periodFilter, ...storeFilter },
    }),
    // entregas urgentes
    prisma.deliveryRequest.count({
      where: { createdAt: periodFilter, ...storeFilter, deliveryType: DeliveryType.URGENT },
    }),
    // despachos via Lalamove
    prisma.dispatch.count({
      where: {
        createdAt: periodFilter,
        modal: DispatchModal.LALAMOVE,
        ...(storeId ? { storeId } : {}),
      },
    }),
    // duração média de rota
    prisma.freightAudit.aggregate({
      _avg: { durationMinutes: true },
      where: {
        createdAt: periodFilter,
        ...storeFilter,
        durationMinutes: { not: null },
      },
    }),
    // justificativas pendentes
    prisma.freightAudit.count({
      where: {
        createdAt: periodFilter,
        ...storeFilter,
        justificationRequired: true,
        justification: null,
      },
    }),
    // ranking por vendedor
    prisma.freightAudit.groupBy({
      by: ["sellerId"],
      _avg: { deviationPercent: true },
      _count: { id: true },
      where: {
        createdAt: periodFilter,
        ...storeFilter,
        sellerId: { not: null },
        deviationPercent: { not: null },
      },
      orderBy: { _avg: { deviationPercent: "desc" } },
      take: 10,
    }),
  ]);

  // classificações como mapa
  const classMap: Record<string, number> = {};
  for (const g of classGroups) {
    if (g.deviationClassification) {
      classMap[g.deviationClassification] = g._count.id;
    }
  }
  const totalWithClass = Object.values(classMap).reduce((a, b) => a + b, 0);

  // buscar nomes dos vendedores
  const sellerIds = sellerGroups
    .map((g) => g.sellerId)
    .filter((id): id is string => id !== null);
  const sellers = await prisma.user.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, name: true },
  });
  const sellerNameMap = Object.fromEntries(sellers.map((s) => [s.id, s.name]));

  const charged = auditAgg._sum.chargedFreight ?? 0;
  const cost = auditAgg._sum.estimatedCost ?? 0;
  const revenue = auditAgg._sum.totalValue ?? 0;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    financial: {
      totalFreightCharged: charged,
      totalLogisticsCost: cost,
      netSubsidy: cost - charged,
      freightAsPercentOfRevenue: revenue > 0 ? (charged / revenue) * 100 : null,
      avgCostPerDelivery: totalDeliveries > 0 ? cost / totalDeliveries : 0,
    },
    operational: {
      totalDeliveries,
      urgentPercent: totalDeliveries > 0 ? (urgentCount / totalDeliveries) * 100 : 0,
      lalamovePercent: totalDeliveries > 0 ? (lalamoveCount / totalDeliveries) * 100 : 0,
      avgDurationMin: durationAgg._avg.durationMinutes ?? null,
      haversinePercent:
        totalAudits > 0 ? (haversineCount / totalAudits) * 100 : null,
    },
    audit: {
      avgDeviationPercent: auditAgg._avg.deviationPercent ?? null,
      pendingJustifications,
      withinRulePercent:
        totalWithClass > 0
          ? ((classMap["WITHIN_RULE"] ?? 0) / totalWithClass) * 100
          : null,
      aboveRulePercent:
        totalWithClass > 0
          ? ((classMap["ABOVE_RULE"] ?? 0) / totalWithClass) * 100
          : null,
      belowRulePercent:
        totalWithClass > 0
          ? ((classMap["BELOW_RULE"] ?? 0) / totalWithClass) * 100
          : null,
    },
    sellerRanking: sellerGroups
      .filter((g) => g.sellerId !== null)
      .map((g) => ({
        sellerId: g.sellerId!,
        sellerName: sellerNameMap[g.sellerId!] ?? "Desconhecido",
        avgDeviationPercent: g._avg.deviationPercent ?? 0,
        deliveryCount: g._count.id,
      })),
  };
}
```

- [ ] **Step 4: Rodar testes**

```bash
npm test -- tests/services/audit.test.ts 2>&1 | tail -10
```

Expected:
```
Test Files  1 passed (1)
Tests       10 passed (10)
```

- [ ] **Step 5: Commit**

```bash
git add services/audit.service.ts tests/services/audit.test.ts
git commit -m "feat: criar audit.service.ts com lógica de desvio, gate e KPIs"
```

---

## Task 2 — Integração: Solicitação Cria Audit

**Files:**
- Modify: `app/api/solicitacoes/route.ts`

- [ ] **Step 1: Verificar ponto de integração atual**

No arquivo `app/api/solicitacoes/route.ts`, a criação da solicitação termina em:

```typescript
return NextResponse.json(apiSuccess(deliveryRequest), { status: 201 });
```

Antes desse return, vamos inserir a criação do audit.

- [ ] **Step 2: Adicionar import e chamada ao createOrUpdateInitialAudit**

No topo de `app/api/solicitacoes/route.ts`, adicionar import:

```typescript
import { createOrUpdateInitialAudit } from "@/services/audit.service";
```

- [ ] **Step 3: Inserir criação do audit após criação da DeliveryRequest**

Após o bloco que cria transferências automáticas (linha ~178) e antes do `return NextResponse.json(apiSuccess(deliveryRequest), { status: 201 })`, adicionar:

```typescript
    // cria registro de auditoria de frete com desvio calculado
    if (data.freightQuoteId) {
      const quote = await prisma.freightQuote.findUnique({
        where: { id: data.freightQuoteId },
        select: {
          suggestedPrice: true,
          distanceKm: true,
          durationMinutes: true,
          isApproximate: true,
        },
      });

      await createOrUpdateInitialAudit({
        deliveryRequestId: deliveryRequest.id,
        storeId: deliveryRequest.storeId,
        invoiceNumber: deliveryRequest.invoiceNumber,
        sellerId: session.userId,
        suggestedFreight: quote?.suggestedPrice ?? undefined,
        chargedFreight: data.chargedFreight,
        distanceKm: quote?.distanceKm ?? undefined,
        durationMinutes: quote?.durationMinutes ?? undefined,
        isApproximate: quote?.isApproximate ?? undefined,
        totalValue: invoice.totalValue,
      });
    }
```

- [ ] **Step 4: Verificar que FreightQuote tem campo suggestedPrice**

Nota: no schema Prisma, o campo em FreightQuote é `suggestedPrice`. Verificar:

```bash
grep -n "suggestedPrice" "C:/Users/Alberto/OneDrive - Atual Comercio de Tintas e Materiais para Pintura/Claude/Projects/sistema-logistica/prisma/schema.prisma"
```

Se a coluna se chama `suggestedPrice`, usar esse nome. Se for `suggestedFreight`, usar `suggestedFreight` — ajustar o código acima conforme o resultado.

- [ ] **Step 5: Verificar compilação**

```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "solicitacoes"
```

Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/solicitacoes/route.ts
git commit -m "feat: criar FreightAudit automaticamente ao criar solicitação de entrega"
```

---

## Task 3 — Hard Gate no Despacho

**Files:**
- Modify: `app/api/despacho/route.ts`

- [ ] **Step 1: Adicionar import**

No topo de `app/api/despacho/route.ts`:

```typescript
import { checkAuditGate } from "@/services/audit.service";
```

- [ ] **Step 2: Inserir verificação no POST antes de createDispatch**

No método `POST`, antes da chamada `const dispatch = await createDispatch(...)`:

```typescript
    // hard gate: verificar se audit exige justificativa não preenchida
    if (parsed.data.deliveryRequestId) {
      const gate = await checkAuditGate(parsed.data.deliveryRequestId);
      if (gate.blocked) {
        return NextResponse.json(
          apiError(gate.reason!, "AUDIT_JUSTIFICATION_REQUIRED", { auditId: gate.auditId }),
          { status: 422 }
        );
      }
    }
```

- [ ] **Step 3: Verificar compilação**

```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "despacho/route"
```

Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/api/despacho/route.ts
git commit -m "feat: bloquear despacho quando desvio de frete exige justificativa"
```

---

## Task 4 — APIs de Auditoria

**Files:**
- Create: `app/api/auditoria/frete/route.ts`
- Create: `app/api/auditoria/frete/[id]/justificativa/route.ts`

- [ ] **Step 1: Criar GET /api/auditoria/frete**

```typescript
// app/api/auditoria/frete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { getAuditList } from "@/services/audit.service";
import { DeviationClassification } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);

    const storeId =
      session.role === "SELLER"
        ? session.storeId
        : searchParams.get("storeId") ?? undefined;

    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const classificationStr = searchParams.get("classification");
    const page = parseInt(searchParams.get("page") ?? "1");
    const pageSize = Math.min(parseInt(searchParams.get("pageSize") ?? "50"), 100);

    const result = await getAuditList({
      storeId,
      sellerId: searchParams.get("sellerId") ?? undefined,
      classification: classificationStr as DeviationClassification | undefined,
      from: fromStr ? new Date(fromStr) : undefined,
      to: toStr ? new Date(toStr) : undefined,
      onlyPendingJustification: searchParams.get("pendente") === "true",
      page,
      pageSize,
    });

    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    console.error("[GET /api/auditoria/frete]", error);
    return NextResponse.json(apiError("Erro ao listar auditorias"), { status: 500 });
  }
}
```

- [ ] **Step 2: Criar POST /api/auditoria/frete/[id]/justificativa**

```typescript
// app/api/auditoria/frete/[id]/justificativa/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { addJustification } from "@/services/audit.service";

const schema = z.object({
  justification: z.string().min(10, "Justificativa deve ter pelo menos 10 caracteres"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    await addJustification(params.id, parsed.data.justification, session.userId);
    return NextResponse.json(apiSuccess({ message: "Justificativa salva com sucesso." }));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("vazia")) {
      return NextResponse.json(apiError(error.message), { status: 400 });
    }
    console.error("[POST /api/auditoria/frete/[id]/justificativa]", error);
    return NextResponse.json(apiError("Erro ao salvar justificativa"), { status: 500 });
  }
}
```

- [ ] **Step 3: Verificar compilação**

```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "auditoria"
```

Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/api/auditoria/
git commit -m "feat: APIs GET /auditoria/frete e POST /auditoria/frete/[id]/justificativa"
```

---

## Task 5 — API de KPIs

**Files:**
- Create: `app/api/auditoria/kpis/route.ts`
- Modify: `types/index.ts`

- [ ] **Step 1: Adicionar FreightKPIs em types/index.ts**

No final do arquivo `types/index.ts`, antes da seção de respostas da API:

```typescript
// ──────────────────────────────────────────────
// KPIs DE AUDITORIA
// ──────────────────────────────────────────────

export interface FreightKPIs {
  period: { from: string; to: string };
  financial: {
    totalFreightCharged: number;
    totalLogisticsCost: number;
    netSubsidy: number;
    freightAsPercentOfRevenue: number | null;
    avgCostPerDelivery: number;
  };
  operational: {
    totalDeliveries: number;
    urgentPercent: number;
    lalamovePercent: number;
    avgDurationMin: number | null;
    haversinePercent: number | null;
  };
  audit: {
    avgDeviationPercent: number | null;
    pendingJustifications: number;
    withinRulePercent: number | null;
    aboveRulePercent: number | null;
    belowRulePercent: number | null;
  };
  sellerRanking: {
    sellerId: string;
    sellerName: string;
    avgDeviationPercent: number;
    deliveryCount: number;
  }[];
}
```

- [ ] **Step 2: Criar app/api/auditoria/kpis/route.ts**

```typescript
// app/api/auditoria/kpis/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { getKPIs } from "@/services/audit.service";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);

    // período padrão: últimos 30 dias
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const storeId =
      session.role === "SELLER"
        ? session.storeId
        : searchParams.get("storeId") ?? undefined;

    const kpis = await getKPIs({
      storeId,
      from: fromStr ? new Date(fromStr) : thirtyDaysAgo,
      to: toStr ? new Date(toStr) : today,
    });

    return NextResponse.json(apiSuccess(kpis));
  } catch (error) {
    console.error("[GET /api/auditoria/kpis]", error);
    return NextResponse.json(apiError("Erro ao calcular KPIs"), { status: 500 });
  }
}
```

- [ ] **Step 3: Verificar compilação**

```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "kpis"
```

Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/api/auditoria/kpis/ types/index.ts
git commit -m "feat: API GET /auditoria/kpis com indicadores financeiros e operacionais"
```

---

## Task 6 — Dashboard: Seção Financeira e de Auditoria

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Substituir freightAuditSummary por queries mais completas**

No arquivo `app/(app)/dashboard/page.tsx`, localizar o `Promise.all` existente e substituir a query de `freightAuditSummary` por:

```typescript
    // financeiro e auditoria para o dashboard
    prisma.freightAudit.aggregate({
      _avg: { deviationPercent: true },
      _sum: { chargedFreight: true, estimatedCost: true },
      _count: { id: true },
      where: { createdAt: { gte: today } },
    }),
    prisma.freightAudit.count({
      where: { createdAt: { gte: today }, justificationRequired: true, justification: null },
    }),
```

Isso vai precisar ajustar o destructuring de `freightAuditSummary` para dois valores. Depois ajustar nos kpis e no JSX.

- [ ] **Step 2: Adicionar KPI de subsídio e justificativas pendentes**

No array `kpis`, substituir o card "Frete Faturado Hoje" por três cards:

```typescript
    {
      label: "Frete Faturado Hoje",
      value: formatCurrency(auditSummary._sum.chargedFreight ?? 0),
      icon: TrendingUp,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      href: "/auditoria",
    },
    {
      label: "Custo Logístico Hoje",
      value: formatCurrency(auditSummary._sum.estimatedCost ?? 0),
      icon: DollarSign,
      color: "text-blue-600",
      bg: "bg-blue-50",
      href: "/auditoria",
    },
    {
      label: "Justificativas Pendentes",
      value: pendingJustifications,
      icon: AlertOctagon,
      color: pendingJustifications > 0 ? "text-red-600" : "text-gray-400",
      bg: pendingJustifications > 0 ? "bg-red-50" : "bg-gray-50",
      href: "/auditoria?pendente=true",
      alert: pendingJustifications > 0 ? "bloqueiam despacho" : undefined,
    },
```

- [ ] **Step 3: Adicionar imports dos novos ícones**

```typescript
import { DollarSign, AlertOctagon } from "lucide-react";
```

- [ ] **Step 4: Adicionar seção de desvio médio por vendedor abaixo dos cards**

Após o grid de KPIs e antes das duas colunas (transferências + solicitações):

```typescript
      {/* Auditoria — desvio médio */}
      {auditSummary._avg.deviationPercent !== null && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-gray-900 text-sm">Desvio Médio de Frete Hoje</h2>
            </div>
            <Link href="/auditoria" className="text-xs text-orange-600 hover:underline font-medium">
              Ver auditoria completa
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <p className={cn(
              "text-3xl font-bold",
              (auditSummary._avg.deviationPercent ?? 0) > 15
                ? "text-red-600"
                : (auditSummary._avg.deviationPercent ?? 0) > 0
                ? "text-yellow-600"
                : "text-green-600"
            )}>
              {(auditSummary._avg.deviationPercent ?? 0) > 0 ? "+" : ""}
              {(auditSummary._avg.deviationPercent ?? 0).toFixed(1)}%
            </p>
            <div>
              <p className="text-xs text-gray-500">
                Baseado em {auditSummary._count.id} cotações do dia
              </p>
              <p className="text-xs text-gray-400">
                Sugerido vs Cobrado — tolerância padrão 15%
              </p>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verificar compilação**

```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "dashboard"
```

Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/dashboard/page.tsx
git commit -m "feat: adicionar seção financeira e de auditoria no dashboard"
```

---

## Task 7 — Tela /auditoria

**Files:**
- Create: `app/(app)/auditoria/page.tsx`

- [ ] **Step 1: Criar tela de auditoria como Client Component**

```typescript
// app/(app)/auditoria/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertOctagon, CheckCircle2, AlertTriangle, ArrowUpDown, MessageSquare } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

// ──────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────

interface AuditItem {
  id: string;
  invoiceNumber: string | null;
  storeId: string;
  suggestedFreight: number | null;
  chargedFreight: number | null;
  freightDeviation: number | null;
  deviationPercent: number | null;
  deviationClassification: "WITHIN_RULE" | "BELOW_RULE" | "ABOVE_RULE" | null;
  justificationRequired: boolean;
  justification: string | null;
  justifiedAt: string | null;
  routeSource: "GOOGLE_MAPS" | "HAVERSINE" | null;
  createdAt: string;
  deliveryRequest: { invoiceNumber: string; customerName: string } | null;
  seller: { id: string; name: string } | null;
  justifiedBy: { id: string; name: string } | null;
}

interface AuditListResponse {
  items: AuditItem[];
  total: number;
  page: number;
  totalPages: number;
}

// ──────────────────────────────────────────────
// CLASSIFICAÇÃO — BADGE
// ──────────────────────────────────────────────

function DeviationBadge({ classification, percent }: {
  classification: AuditItem["deviationClassification"];
  percent: number | null;
}) {
  if (!classification || percent === null) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  const configs = {
    WITHIN_RULE: { color: "bg-green-100 text-green-800 border-green-200", label: "Dentro da regra", icon: CheckCircle2 },
    BELOW_RULE: { color: "bg-yellow-100 text-yellow-800 border-yellow-200", label: "Abaixo (subsídio)", icon: AlertTriangle },
    ABOVE_RULE: { color: "bg-red-100 text-red-800 border-red-200", label: "Acima (overcharge)", icon: AlertOctagon },
  };
  const config = configs[classification];
  const Icon = config.icon;

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium", config.color)}>
      <Icon className="w-3 h-3" />
      {percent > 0 ? "+" : ""}{percent.toFixed(1)}%
    </span>
  );
}

// ──────────────────────────────────────────────
// MODAL DE JUSTIFICATIVA
// ──────────────────────────────────────────────

function JustificationModal({
  auditId,
  invoiceNumber,
  onClose,
  onSaved,
}: {
  auditId: string;
  invoiceNumber: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (text.trim().length < 10) {
      setError("Justificativa deve ter pelo menos 10 caracteres.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auditoria/frete/${auditId}/justificativa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ justification: text }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Erro ao salvar");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar justificativa");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-5 h-5 text-orange-500" />
          <h2 className="font-bold text-gray-900">Justificativa de Desvio</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          NF <strong>{invoiceNumber}</strong> — O frete cobrado está acima da tolerância.
          Esta justificativa será registrada com seu usuário e data/hora.
        </p>
        <textarea
          className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
          rows={4}
          placeholder="Descreva o motivo do desvio (mínimo 10 caracteres)..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2 rounded-lg text-sm transition"
          >
            {saving ? "Salvando..." : "Salvar Justificativa"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ──────────────────────────────────────────────

export default function AuditoriaPage() {
  const [data, setData] = useState<AuditListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [classification, setClassification] = useState("");
  const [modalAudit, setModalAudit] = useState<{ id: string; invoiceNumber: string } | null>(null);

  const fetchAudits = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "50",
        ...(pendingOnly ? { pendente: "true" } : {}),
        ...(classification ? { classification } : {}),
      });
      const res = await fetch(`/api/auditoria/frete?${params}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, [page, pendingOnly, classification]);

  useEffect(() => { fetchAudits(); }, [fetchAudits]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Auditoria de Frete</h1>
        <p className="text-gray-500 text-sm mt-1">
          Controle de desvio entre frete sugerido e cobrado — governança do frete
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-5">
        <label className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition",
          pendingOnly
            ? "bg-red-50 border-red-300 text-red-700 font-medium"
            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
        )}>
          <input
            type="checkbox"
            className="w-3.5 h-3.5 accent-red-500"
            checked={pendingOnly}
            onChange={(e) => { setPendingOnly(e.target.checked); setPage(1); }}
          />
          Apenas pendentes de justificativa
        </label>

        <select
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          value={classification}
          onChange={(e) => { setClassification(e.target.value); setPage(1); }}
        >
          <option value="">Todas as classificações</option>
          <option value="ABOVE_RULE">Acima da regra (overcharge)</option>
          <option value="WITHIN_RULE">Dentro da regra</option>
          <option value="BELOW_RULE">Abaixo (subsídio)</option>
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Pedido</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Vendedor</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Sugerido</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Cobrado</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 flex items-center justify-end gap-1">
                  <ArrowUpDown className="w-3 h-3" /> Desvio
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Classificação</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Rota</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400 text-sm">
                    Carregando...
                  </td>
                </tr>
              ) : data?.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400 text-sm">
                    Nenhum registro encontrado
                  </td>
                </tr>
              ) : (
                data?.items.map((item) => (
                  <tr
                    key={item.id}
                    className={cn(
                      "hover:bg-gray-50 transition-colors",
                      item.justificationRequired && !item.justification && "bg-red-50/30"
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        NF {item.deliveryRequest?.invoiceNumber ?? item.invoiceNumber}
                      </p>
                      <p className="text-xs text-gray-400 truncate max-w-[140px]">
                        {item.deliveryRequest?.customerName ?? "—"}
                      </p>
                      <p className="text-xs text-gray-300">{formatDate(item.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {item.seller?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {item.suggestedFreight != null
                        ? formatCurrency(item.suggestedFreight)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {item.chargedFreight != null
                        ? formatCurrency(item.chargedFreight)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.freightDeviation != null ? (
                        <span className={cn(
                          "font-semibold",
                          item.freightDeviation > 0 ? "text-red-600" :
                          item.freightDeviation < 0 ? "text-yellow-600" : "text-green-600"
                        )}>
                          {item.freightDeviation > 0 ? "+" : ""}
                          {formatCurrency(item.freightDeviation)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <DeviationBadge
                        classification={item.deviationClassification}
                        percent={item.deviationPercent}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.routeSource === "HAVERSINE" ? (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200 font-medium">
                          ~estimada
                        </span>
                      ) : item.routeSource === "GOOGLE_MAPS" ? (
                        <span className="text-xs text-green-600">Maps ✓</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.justificationRequired ? (
                        item.justification ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
                            Justificado
                          </span>
                        ) : (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full border border-red-200 font-medium animate-pulse">
                            Pendente
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.justificationRequired && !item.justification && (
                        <button
                          onClick={() =>
                            setModalAudit({
                              id: item.id,
                              invoiceNumber:
                                item.deliveryRequest?.invoiceNumber ??
                                item.invoiceNumber ??
                                item.id,
                            })
                          }
                          className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-lg font-medium transition"
                        >
                          Justificar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {data.total} registros · página {data.page} de {data.totalPages}
            </p>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
              >
                Anterior
              </button>
              <button
                disabled={page === data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de justificativa */}
      {modalAudit && (
        <JustificationModal
          auditId={modalAudit.id}
          invoiceNumber={modalAudit.invoiceNumber}
          onClose={() => setModalAudit(null)}
          onSaved={() => {
            setModalAudit(null);
            fetchAudits();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar compilação**

```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "auditoria/page"
```

Expected: sem erros.

- [ ] **Step 3: Verificar que link /auditoria existe no sidebar**

```bash
grep -rn "auditoria" "C:/Users/Alberto/OneDrive - Atual Comercio de Tintas e Materiais para Pintura/Claude/Projects/sistema-logistica/components" 2>/dev/null | head -5
```

Se o sidebar não tiver link para /auditoria, adicionar no componente de navegação.

- [ ] **Step 4: Rodar suite completa de testes**

```bash
npm test 2>&1 | tail -10
```

Expected: todos os testes passando (22+ existentes + 10 novos).

- [ ] **Step 5: Commit final**

```bash
git add app/(app)/auditoria/ app/api/auditoria/
git commit -m "feat: tela de auditoria /auditoria com tabela, filtros e modal de justificativa"
```

---

## Self-Review

### Cobertura do spec

| Requisito | Task |
|-----------|------|
| deviationAmount, deviationPercent | Task 1 (computeDeviation) |
| deviationClassification (WITHIN/BELOW/ABOVE) | Task 1 (classifyDeviation) |
| tolerancePercent via AuditConfig | Task 0 (schema) + Task 1 (getToleranceForStore) |
| justificationRequired + bloquear despacho | Task 1 (isJustificationRequired) + Task 3 (hard gate) |
| justification + justifiedById + justifiedAt | Task 1 (addJustification) + Task 4 (API) |
| routeSource (GOOGLE_MAPS/CACHE/HAVERSINE) | Task 0 (enum) + Task 2 (integração) |
| sellerId desnormalizado para ranking | Task 0 (schema) + Task 2 (integração) |
| GET /api/auditoria/frete com filtros | Task 4 |
| POST justificativa | Task 4 |
| GET /api/auditoria/kpis | Task 5 |
| KPIs financeiros (subsídio, custo, frete) | Task 1 (getKPIs) |
| KPIs operacionais (urgente%, lalamove%) | Task 1 (getKPIs) |
| KPIs de comportamento (ranking vendedores) | Task 1 (getKPIs) |
| KPIs de qualidade (haversine%, duração média) | Task 1 (getKPIs) |
| Dashboard com seção financeira | Task 6 |
| Tela /auditoria com tabela + badge + modal | Task 7 |
| Integração com criação de solicitação | Task 2 |
| Integração com despacho (gate) | Task 3 |

### Placeholder scan
Nenhum TBD, TODO ou "similar ao task N" detectado.

### Type consistency
- `DeviationClassification` enum em Prisma → importado em `audit.service.ts` e `auditoria/page.tsx`
- `FreightKPIs` definido em `types/index.ts` e retornado por `getKPIs`
- `checkAuditGate` retorna `{ blocked, reason?, auditId? }` — consumido em `despacho/route.ts`
- `createOrUpdateInitialAudit` parâmetros correspondem ao schema de `FreightAudit` expandido
- `AuditItem` na tela corresponde ao shape retornado por `getAuditList` (via Prisma include)
