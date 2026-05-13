// app/(app)/torre/page.tsx
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Clock, Siren, PackageCheck, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { MetricCard } from "@/components/ui/metric-card";
import { StoreHealthCard } from "./_components/store-health-card";
import { SyncButton } from "./_components/sync-button";
import type { StoreHealthColor } from "@/types/torre";

const HEALTH_ORDER: Record<StoreHealthColor, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

export default async function TorreDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) redirect("/dashboard");

  const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] as const;

  const since30d = new Date(Date.now() - 30 * 86_400_000);
  const [openAlerts, stores, lastSync, overdueCount, divergenceStats] = await Promise.all([
    // Alertas abertos com contagem de itens e data de criação
    prisma.controlTowerAlert.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      select: {
        storeId: true,
        severity: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.store.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.citelSyncJob.findFirst({
      where: { type: "STOCK", status: { in: ["SUCCESS", "PARTIAL"] } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.controlTowerAlert.count({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] }, slaStatus: "OVERDUE" },
    }),
    prisma.$queryRawUnsafe<Array<{ events: bigint; skus: bigint }>>(
      `SELECT COUNT(*) AS events, COUNT(DISTINCT "productCode") AS skus
         FROM stock_divergence_log
         WHERE "resolvedAt" >= $1`,
      since30d,
    ),
  ]);

  const divergenceEvents = Number(divergenceStats[0]?.events ?? 0);
  const divergenceSkus   = Number(divergenceStats[0]?.skus   ?? 0);

  // Agrega por loja: contadores, item count e data do alerta mais antigo
  const storeMap = new Map<string, {
    CRITICAL: number; WARNING: number; INFO: number;
    itemCount: number; oldestAt: Date | null;
  }>();

  for (const a of openAlerts) {
    if (!storeMap.has(a.storeId)) {
      storeMap.set(a.storeId, { CRITICAL: 0, WARNING: 0, INFO: 0, itemCount: 0, oldestAt: null });
    }
    const entry = storeMap.get(a.storeId)!;
    const sev = a.severity as "CRITICAL" | "WARNING" | "INFO";
    entry[sev]++;
    entry.itemCount += a._count.items;
    if (!entry.oldestAt || a.createdAt < entry.oldestAt) entry.oldestAt = a.createdAt;
  }

  // Monta lista de saúde ordenada: RED → YELLOW → GREEN
  const storeHealth = stores
    .map((s) => {
      const c = storeMap.get(s.id) ?? { CRITICAL: 0, WARNING: 0, INFO: 0, itemCount: 0, oldestAt: null };
      const health: StoreHealthColor = c.CRITICAL > 0 ? "RED" : c.WARNING > 0 ? "YELLOW" : "GREEN";
      return {
        storeId: s.id,
        storeCode: s.code,
        storeName: s.name,
        health,
        criticalCount: c.CRITICAL,
        warningCount: c.WARNING,
        infoCount: c.INFO,
        itemCount: c.itemCount,
        // Serializa para string — Server→Client Components não aceitam Date
        oldestAlertAt: c.oldestAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]);

  const totalCritical = openAlerts.filter((a) => a.severity === "CRITICAL").length;
  const totalOpen = openAlerts.length;
  const redStores = storeHealth.filter((s) => s.health === "RED").length;
  const yellowStores = storeHealth.filter((s) => s.health === "YELLOW").length;

  return (
    <div>
      <PageHeader
        title="Torre de Controle"
        description="Monitoramento de estoque em tempo real"
        actions={<SyncButton />}
      />

      {/* Métricas globais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Alertas Críticos"
          value={totalCritical}
          icon={Siren}
          variant={totalCritical > 0 ? "danger" : "default"}
        />
        <MetricCard
          label="Total Alertas Abertos"
          value={totalOpen}
          icon={AlertTriangle}
          variant={totalOpen > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="SLA Vencido"
          value={overdueCount}
          icon={Clock}
          variant={overdueCount > 0 ? "urgent" : "default"}
        />
        <MetricCard
          label="Lojas com Problema"
          value={redStores + yellowStores}
          icon={AlertTriangle}
          variant={redStores > 0 ? "danger" : yellowStores > 0 ? "warning" : "default"}
        />
      </div>

      {/* Atalho: Divergências de estoque (Citel × físico) */}
      <Link
        href="/torre/divergencias"
        className="block mb-8 rounded-xl px-5 py-4 transition-colors group"
        style={{
          backgroundColor: divergenceEvents > 0 ? "rgba(99,102,241,0.04)" : "#FAFAFA",
          border: `1px solid ${divergenceEvents > 0 ? "rgba(99,102,241,0.20)" : "var(--color-border)"}`,
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: divergenceEvents > 0 ? "rgba(99,102,241,0.10)" : "#F4F4F4",
              color: divergenceEvents > 0 ? "#4338CA" : "#737373",
            }}
          >
            <PackageCheck className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[13px] font-semibold"
              style={{ color: "var(--color-body-text)", fontFamily: "var(--font-display)" }}
            >
              Divergências de Estoque
            </p>
            <p className="text-[11.5px] mt-0.5" style={{ color: "#737373" }}>
              {divergenceEvents > 0
                ? `${divergenceEvents} evento${divergenceEvents > 1 ? "s" : ""} em ${divergenceSkus} SKU${divergenceSkus > 1 ? "s" : ""} nos últimos 30 dias`
                : "Sem divergências registradas nos últimos 30 dias"}
            </p>
          </div>
          <ArrowRight
            className="w-4 h-4 transition-transform group-hover:translate-x-1"
            style={{ color: "#A3A3A3" }}
          />
        </div>
      </Link>

      {/* Cabeçalho da lista */}
      <div className="flex items-center gap-4 mb-3">
        <h2
          className="text-[13px] font-semibold"
          style={{ color: "var(--color-body-text)", fontFamily: "var(--font-display)" }}
        >
          Status por loja
        </h2>
        <div className="flex items-center gap-4 ml-auto">
          {(
            [
              { color: "#DC2626", label: "Crítico" },
              { color: "#D97706", label: "Atenção" },
              { color: "#16A34A", label: "Normal" },
            ] as const
          ).map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[11px]" style={{ color: "#A3A3A3" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cards das lojas */}
      <div className="space-y-2">
        {storeHealth.map((store) => (
          <StoreHealthCard key={store.storeId} {...store} />
        ))}
      </div>

      {storeHealth.length === 0 && (
        <div
          className="rounded-xl p-10 text-center"
          style={{ border: "1px dashed var(--color-border)" }}
        >
          <p className="text-[13px]" style={{ color: "#A3A3A3" }}>
            Nenhuma loja ativa encontrada.
          </p>
        </div>
      )}
    </div>
  );
}
