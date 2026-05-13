import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Activity } from "lucide-react";
import { getAnalyticsSummary, type AnalyticsPeriod } from "@/services/analytics.service";
import { StageTimingChart } from "@/components/operacao/analytics/StageTimingChart";
import { SLAWidget }        from "@/components/operacao/analytics/SLAWidget";
import { HourlyHeatmap }    from "@/components/operacao/analytics/HourlyHeatmap";
import { OperatorTable }    from "@/components/operacao/analytics/OperatorTable";
import { AlertsPanel }      from "@/components/operacao/analytics/AlertsPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics — Operação Logística" };

const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "week",  label: "7 dias" },
  { value: "month", label: "30 dias" },
];

function KPICard({
  label, value, sub, color = "#9CA3AF",
}: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ backgroundColor: "#111318", border: "1px solid #1E2530" }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "#4B5563" }}>
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums" style={{ color, fontFamily: "monospace" }}>
        {value}
      </p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: "#374151" }}>{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: "#111318", border: "1px solid #1E2530" }}
    >
      <h2
        className="text-[11px] font-bold uppercase tracking-widest mb-4"
        style={{ color: "#4B5563" }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

export default async function OperacaoAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) redirect("/dashboard");

  const params = await searchParams;
  const period = (params.period ?? "week") as AnalyticsPeriod;
  const data   = await getAnalyticsSummary(period);

  const bottlenecks     = data.stages.filter((s) => s.isBottleneck);
  const avgTotalMinutes = data.stages
    .filter((s) => s.count > 0)
    .reduce((sum, s) => sum + s.avgDurationMin, 0);

  const peakHour = data.hourlyHeatmap.length > 0
    ? data.hourlyHeatmap.reduce((a, b) => (a.count > b.count ? a : b)).hour
    : null;

  return (
    <div
      className="min-h-screen overflow-y-auto"
      style={{ backgroundColor: "#0D1117", color: "#E5E7EB" }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b"
        style={{ backgroundColor: "#080C10", borderColor: "#1E2530" }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/operacao"
            className="flex items-center gap-1.5 text-[11px] transition-colors"
            style={{ color: "#6B7280" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Fila operacional
          </Link>
          <span style={{ color: "#1E2530" }}>/</span>
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" style={{ color: "#10B981" }} />
            <span className="text-[13px] font-bold" style={{ color: "#E5E7EB" }}>
              Analytics Operacional
            </span>
          </div>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={`/operacao/analytics?period=${opt.value}`}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: period === opt.value ? "#1E2530" : "transparent",
                color:           period === opt.value ? "#E5E7EB"  : "#4B5563",
                border:          period === opt.value ? "1px solid #374151" : "1px solid transparent",
              }}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="px-6 py-5 space-y-4 max-w-7xl mx-auto">

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPICard
            label="Entregas concluídas"
            value={data.sla.delivered}
            sub={`no período de ${period === "today" ? "hoje" : period === "week" ? "7 dias" : "30 dias"}`}
            color="#34D399"
          />
          <KPICard
            label="Compliance SLA"
            value={`${data.sla.compliancePct}%`}
            sub={`${data.sla.withinSLA} dentro / ${data.sla.outsideSLA} fora`}
            color={data.sla.compliancePct >= 90 ? "#34D399" : data.sla.compliancePct >= 70 ? "#FCD34D" : "#F87171"}
          />
          <KPICard
            label="Tempo médio total"
            value={avgTotalMinutes >= 60
              ? `${Math.floor(avgTotalMinutes / 60)}h${avgTotalMinutes % 60 > 0 ? ` ${avgTotalMinutes % 60}m` : ""}`
              : `${avgTotalMinutes}min`}
            sub="soma das etapas com dados"
            color="#60A5FA"
          />
          <KPICard
            label="Pico de volume"
            value={peakHour !== null ? `${peakHour}h00` : "—"}
            sub={`${bottlenecks.length} gargalo${bottlenecks.length !== 1 ? "s" : ""} detectado${bottlenecks.length !== 1 ? "s" : ""}`}
            color={bottlenecks.length > 0 ? "#F87171" : "#9CA3AF"}
          />
        </div>

        {/* Alertas de cards stuck */}
        <Section title="Cards parados além do threshold">
          <AlertsPanel currentStuck={data.currentStuck} />
        </Section>

        {/* Tempo por etapa + SLA */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Section title="Tempo médio por etapa">
              <StageTimingChart stages={data.stages} />
            </Section>
          </div>
          <div>
            <Section title="Compliance SLA">
              <SLAWidget sla={data.sla} />
            </Section>
          </div>
        </div>

        {/* Heatmap */}
        <Section title="Heatmap de volume operacional (BRT)">
          {data.hourlyHeatmap.length === 0 ? (
            <p className="text-[11px] text-center py-4" style={{ color: "#374151" }}>
              Sem dados no período selecionado
            </p>
          ) : (
            <HourlyHeatmap data={data.hourlyHeatmap} />
          )}
        </Section>

        {/* Operadores */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Operadores mais ativos">
            <OperatorTable operators={data.operators} />
          </Section>

          {/* Volume por loja */}
          <Section title="Volume por loja">
            <div className="space-y-2">
              {data.stores.filter((s) => s.totalRequests > 0).map((s) => {
                const max = Math.max(...data.stores.map((x) => x.totalRequests), 1);
                const w   = (s.totalRequests / max) * 100;
                return (
                  <div key={s.storeId}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] font-medium" style={{ color: "#9CA3AF" }}>
                        {s.storeCode} — {s.storeName}
                      </span>
                      <div className="flex gap-3 text-[10px]">
                        <span style={{ color: "#6B7280" }}>{s.totalRequests} transições</span>
                        <span style={{ color: "#34D399" }}>{s.delivered} entregues</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded overflow-hidden" style={{ backgroundColor: "#1E2530" }}>
                      <div className="h-full rounded" style={{ width: `${w}%`, backgroundColor: "#3B82F6" }} />
                    </div>
                  </div>
                );
              })}
              {data.stores.filter((s) => s.totalRequests > 0).length === 0 && (
                <p className="text-[11px] text-center py-4" style={{ color: "#374151" }}>
                  Sem dados de lojas no período
                </p>
              )}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <p className="text-[10px] text-right pb-4" style={{ color: "#1E2530" }}>
          Gerado em {data.fetchedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} BRT
        </p>
      </div>
    </div>
  );
}
