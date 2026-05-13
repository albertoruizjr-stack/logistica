// ──────────────────────────────────────────────
// SERVIÇO DE ANALYTICS OPERACIONAL
//
// Queries agregadas sobre OperationalMetricsSnapshot.
// Projetado para queries rápidas via índices — nunca
// recalcula em tempo real sobre dados brutos.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { DeliveryRequestStatus, Prisma } from "@prisma/client";

// ── Tipos públicos ───────────────────────────────────────────────────────────

export type AnalyticsPeriod = "today" | "week" | "month";

export interface StageMetric {
  status:          DeliveryRequestStatus;
  label:           string;
  avgDurationMin:  number;   // média em minutos
  p90DurationMin:  number;   // p90 em minutos (aproximado via percentile)
  count:           number;   // snapshots concluídos no período
  thresholdMin:    number;   // threshold de "stuck" em minutos
  isBottleneck:    boolean;  // avg > threshold
}

export interface SLAMetrics {
  total:          number;
  delivered:      number;
  withinSLA:      number;
  outsideSLA:     number;
  compliancePct:  number;
  byType: {
    slaType:       string;
    total:         number;
    withinSLA:     number;
    compliancePct: number;
    avgDurationMin: number;
  }[];
}

export interface OperatorMetric {
  operatorId:    string;
  operatorName:  string;
  totalActions:  number;
  avgDurationMin: number;
  statusBreakdown: { status: string; count: number }[];
}

export interface StoreMetric {
  storeId:       string;
  storeCode:     string;
  storeName:     string;
  totalRequests: number;
  delivered:     number;
  avgDurationMin: number;
}

export interface HourlyBucket {
  hour:    number; // 0-23
  dow:     number; // 0=Sun ... 6=Sat
  count:   number;
}

export interface AnalyticsSummary {
  period:          AnalyticsPeriod;
  periodStart:     Date;
  stages:          StageMetric[];
  sla:             SLAMetrics;
  operators:       OperatorMetric[];
  stores:          StoreMetric[];
  hourlyHeatmap:   HourlyBucket[];
  currentStuck:    { status: string; count: number; label: string }[];
  fetchedAt:       Date;
}

// ── SLA thresholds (em segundos) ─────────────────────────────────────────────

const SLA_SECONDS: Record<string, number> = {
  STANDARD:  36 * 3600,  // 36h
  URGENT:     8 * 3600,  //  8h
  EXPRESS:    4 * 3600,  //  4h
  SCHEDULED: 48 * 3600,  // 48h (conservador)
};

// ── Stuck thresholds por status ───────────────────────────────────────────────

export const STUCK_THRESHOLD_MIN: Partial<Record<DeliveryRequestStatus, number>> = {
  [DeliveryRequestStatus.PENDING]:             30,
  [DeliveryRequestStatus.AWAITING_ITEMS]:      45,
  [DeliveryRequestStatus.AWAITING_TRANSFER]:  120,
  [DeliveryRequestStatus.SEPARADO]:            30,
  [DeliveryRequestStatus.AGUARDANDO_NF]:       60,
  [DeliveryRequestStatus.NF_EMITIDA]:          30,
  [DeliveryRequestStatus.NF_VINCULADA]:        15,
  [DeliveryRequestStatus.PRONTO_ROTEIRIZACAO]: 45,
  [DeliveryRequestStatus.ROTEIRIZADO]:         30,
  [DeliveryRequestStatus.DISPATCHED]:          60,
  [DeliveryRequestStatus.IN_TRANSIT]:         180,
  [DeliveryRequestStatus.OCORRENCIA]:         120,
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:             "Pendente",
  AWAITING_ITEMS:      "Separação de itens",
  AWAITING_TRANSFER:   "Aguardando transferência",
  SEPARADO:            "Separado",
  AGUARDANDO_NF:       "Aguardando NF",
  NF_EMITIDA:          "NF emitida",
  NF_VINCULADA:        "NF vinculada",
  PRONTO_ROTEIRIZACAO: "Pronto roteirização",
  ROTEIRIZADO:         "Roteirizado",
  DISPATCHED:          "Despachado",
  IN_TRANSIT:          "Em trânsito",
  DELIVERED:           "Entregue",
  OCORRENCIA:          "Ocorrência",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPeriodStart(period: AnalyticsPeriod): Date {
  const now = new Date();
  switch (period) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "week":  return new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    case "month": return new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  }
}

function secToMin(s: number): number {
  return Math.round(s / 60);
}

// ── Métricas por etapa ───────────────────────────────────────────────────────

async function getStageMetrics(periodStart: Date): Promise<StageMetric[]> {
  // Agrupa snapshots concluídos por status no período
  const rows = await prisma.operationalMetricsSnapshot.groupBy({
    by: ["status"],
    where: {
      exitedAt:       { not: null, gte: periodStart },
      durationSeconds: { not: null },
    },
    _avg:   { durationSeconds: true },
    _count: { id: true },
  });

  // P90 via $queryRaw (Prisma groupBy não suporta percentile)
  const p90Rows = await prisma.$queryRaw<{ status: string; p90: number }[]>`
    SELECT status, PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY "durationSeconds") AS p90
    FROM operational_metrics_snapshots
    WHERE "exitedAt" IS NOT NULL
      AND "exitedAt" >= ${periodStart}
      AND "durationSeconds" IS NOT NULL
    GROUP BY status
  `;
  const p90Map = new Map(p90Rows.map((r) => [r.status, Number(r.p90)]));

  const operationalStatuses = Object.keys(STUCK_THRESHOLD_MIN) as DeliveryRequestStatus[];

  return operationalStatuses.map((status) => {
    const row   = rows.find((r) => r.status === status);
    const avg   = row?._avg.durationSeconds ?? 0;
    const count = row?._count.id ?? 0;
    const p90   = p90Map.get(status) ?? avg;
    const thresholdMin = STUCK_THRESHOLD_MIN[status] ?? 60;

    return {
      status,
      label:          STATUS_LABEL[status] ?? status,
      avgDurationMin:  secToMin(avg),
      p90DurationMin:  secToMin(p90),
      count,
      thresholdMin,
      isBottleneck:    secToMin(avg) > thresholdMin,
    };
  });
}

// ── SLA Compliance ───────────────────────────────────────────────────────────

async function getSLAMetrics(periodStart: Date): Promise<SLAMetrics> {
  const delivered = await prisma.deliveryRequest.findMany({
    where: {
      status:    DeliveryRequestStatus.DELIVERED,
      updatedAt: { gte: periodStart },
    },
    select: {
      id: true,
      slaType: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const byType = new Map<string, { total: number; within: number; totalSec: number }>();

  for (const req of delivered) {
    const durationSec = (req.updatedAt.getTime() - req.createdAt.getTime()) / 1000;
    const threshold   = SLA_SECONDS[req.slaType] ?? SLA_SECONDS.STANDARD;
    const withinSLA   = durationSec <= threshold;
    const key         = req.slaType as string;

    if (!byType.has(key)) byType.set(key, { total: 0, within: 0, totalSec: 0 });
    const entry = byType.get(key)!;
    entry.total++;
    entry.totalSec += durationSec;
    if (withinSLA) entry.within++;
  }

  const total       = delivered.length;
  const withinSLA   = [...byType.values()].reduce((s, e) => s + e.within, 0);
  const outsideSLA  = total - withinSLA;

  return {
    total,
    delivered: total,
    withinSLA,
    outsideSLA,
    compliancePct: total > 0 ? Math.round((withinSLA / total) * 100) : 0,
    byType: [...byType.entries()].map(([slaType, e]) => ({
      slaType,
      total:          e.total,
      withinSLA:      e.within,
      compliancePct:  e.total > 0 ? Math.round((e.within / e.total) * 100) : 0,
      avgDurationMin: secToMin(e.totalSec / (e.total || 1)),
    })),
  };
}

// ── Métricas por operador ────────────────────────────────────────────────────

async function getOperatorMetrics(periodStart: Date): Promise<OperatorMetric[]> {
  const rows = await prisma.operationalMetricsSnapshot.groupBy({
    by: ["operatorId", "operatorName", "status"],
    where: {
      operatorId: { not: null },
      exitedAt:   { not: null, gte: periodStart },
    },
    _count: { id: true },
    _avg:   { durationSeconds: true },
  });

  const byOperator = new Map<string, OperatorMetric>();

  for (const row of rows) {
    if (!row.operatorId) continue;
    const key = row.operatorId;

    if (!byOperator.has(key)) {
      byOperator.set(key, {
        operatorId:      row.operatorId,
        operatorName:    row.operatorName ?? row.operatorId,
        totalActions:    0,
        avgDurationMin:  0,
        statusBreakdown: [],
      });
    }

    const op = byOperator.get(key)!;
    const count = row._count.id;
    const avg   = row._avg.durationSeconds ?? 0;

    op.totalActions += count;
    // Running weighted average
    const prev = op.avgDurationMin * (op.totalActions - count);
    op.avgDurationMin = secToMin((prev * 60 + avg * count) / op.totalActions);
    op.statusBreakdown.push({ status: row.status, count });
  }

  return [...byOperator.values()]
    .sort((a, b) => b.totalActions - a.totalActions)
    .slice(0, 10); // top 10 operadores
}

// ── Métricas por loja ─────────────────────────────────────────────────────────

async function getStoreMetrics(periodStart: Date): Promise<StoreMetric[]> {
  const stores = await prisma.store.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true },
  });

  const snapRows = await prisma.operationalMetricsSnapshot.groupBy({
    by: ["storeId"],
    where: { enteredAt: { gte: periodStart } },
    _count: { id: true },
    _avg:   { durationSeconds: true },
  });

  const deliveredRows = await prisma.deliveryRequest.groupBy({
    by: ["storeId"],
    where: {
      status:    DeliveryRequestStatus.DELIVERED,
      updatedAt: { gte: periodStart },
    },
    _count: { id: true },
  });

  const snapMap     = new Map(snapRows.map((r) => [r.storeId, r]));
  const deliveredMap = new Map(deliveredRows.map((r) => [r.storeId, r._count.id]));

  return stores.map((s) => {
    const snap = snapMap.get(s.id);
    return {
      storeId:        s.id,
      storeCode:      s.code,
      storeName:      s.name,
      totalRequests:  snap?._count.id ?? 0,
      delivered:      deliveredMap.get(s.id) ?? 0,
      avgDurationMin: secToMin(snap?._avg.durationSeconds ?? 0),
    };
  }).sort((a, b) => b.totalRequests - a.totalRequests);
}

// ── Heatmap horário (dow × hour) ──────────────────────────────────────────────

async function getHourlyHeatmap(periodStart: Date): Promise<HourlyBucket[]> {
  const rows = await prisma.$queryRaw<{ hour: number; dow: number; count: bigint }[]>`
    SELECT
      EXTRACT(HOUR FROM "enteredAt" AT TIME ZONE 'America/Sao_Paulo')::int AS hour,
      EXTRACT(DOW  FROM "enteredAt" AT TIME ZONE 'America/Sao_Paulo')::int AS dow,
      COUNT(*) AS count
    FROM operational_metrics_snapshots
    WHERE "enteredAt" >= ${periodStart}
    GROUP BY hour, dow
    ORDER BY dow, hour
  `;

  return rows.map((r) => ({
    hour:  r.hour,
    dow:   r.dow,
    count: Number(r.count),
  }));
}

// ── Cards stuck atualmente (sem join com snapshots) ──────────────────────────

async function getCurrentStuck(): Promise<{ status: string; count: number; label: string }[]> {
  const now    = new Date();
  const result: { status: string; count: number; label: string }[] = [];

  for (const [status, thresholdMin] of Object.entries(STUCK_THRESHOLD_MIN)) {
    const cutoff = new Date(now.getTime() - thresholdMin * 60_000);
    const count  = await prisma.deliveryRequest.count({
      where: {
        status:    status as DeliveryRequestStatus,
        updatedAt: { lte: cutoff },
      },
    });
    if (count > 0) {
      result.push({
        status,
        count,
        label: STATUS_LABEL[status] ?? status,
      });
    }
  }

  return result.sort((a, b) => b.count - a.count);
}

// ── Summary completo ─────────────────────────────────────────────────────────

export async function getAnalyticsSummary(period: AnalyticsPeriod = "week"): Promise<AnalyticsSummary> {
  const periodStart = getPeriodStart(period);

  const [stages, sla, operators, stores, hourlyHeatmap, currentStuck] = await Promise.all([
    getStageMetrics(periodStart),
    getSLAMetrics(periodStart),
    getOperatorMetrics(periodStart),
    getStoreMetrics(periodStart),
    getHourlyHeatmap(periodStart),
    getCurrentStuck(),
  ]);

  return {
    period,
    periodStart,
    stages,
    sla,
    operators,
    stores,
    hourlyHeatmap,
    currentStuck,
    fetchedAt: new Date(),
  };
}
