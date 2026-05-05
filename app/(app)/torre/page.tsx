// app/(app)/torre/page.tsx
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AlertTriangle, Clock, Siren } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { MetricCard } from "@/components/ui/metric-card";
import { StoreHealthCard } from "./_components/store-health-card";
import { SyncButton } from "./_components/sync-button";
import type { StoreHealthColor } from "@/types/torre";

const HEALTH_ORDER: Record<StoreHealthColor, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

export default async function TorreDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!["ADMIN", "OPERATOR"].includes(session.role)) redirect("/dashboard");

  const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] as const;

  const [openAlerts, stores, lastSync, overdueCount] = await Promise.all([
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
  ]);

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
