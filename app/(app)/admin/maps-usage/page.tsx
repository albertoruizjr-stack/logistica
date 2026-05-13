// app/(app)/admin/maps-usage/page.tsx
// Dashboard de uso diário do Google Maps — visível apenas para ADMIN e OPERATOR.
// Exibe chamadas por endpoint, taxa de cache hit, e custo estimado.

import { redirect }        from "next/navigation";
import { getSession }      from "@/lib/auth";
import { prisma }          from "@/lib/prisma";

// Custo aproximado em USD por chamada (referência: preços Google 2024)
const COST_PER_CALL: Record<string, number> = {
  COMPUTE_ROUTES: 0.005,  // $5 por 1.000 chamadas
  GEOCODE:        0.005,  // $5 por 1.000 chamadas
};

export default async function MapsUsagePage() {
  const session = await getSession();
  if (!session || !["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
    redirect("/");
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Agrupa por endpoint para o dia atual
  const rawStats = await prisma.mapsUsageLog.groupBy({
    by:        ["endpoint"],
    where:     { createdAt: { gte: startOfDay } },
    _count:    { id: true },
    _sum:      { cacheHit: true } as never, // hack: cacheHit é Boolean, não Int
  });

  // Conta separado cache hits e total
  const totalToday = await prisma.mapsUsageLog.count({
    where: { createdAt: { gte: startOfDay } },
  });
  const cacheHitsToday = await prisma.mapsUsageLog.count({
    where: { createdAt: { gte: startOfDay }, cacheHit: true },
  });
  const quotaExceeded = await prisma.mapsUsageLog.count({
    where: { createdAt: { gte: startOfDay }, endpoint: "MAPS_QUOTA_EXCEEDED" },
  });
  const haversineCount = await prisma.mapsUsageLog.count({
    where: { createdAt: { gte: startOfDay }, endpoint: "HAVERSINE_FALLBACK" },
  });

  // Stats por endpoint (só billable)
  const byEndpoint = await prisma.mapsUsageLog.groupBy({
    by:     ["endpoint"],
    where:  { createdAt: { gte: startOfDay } },
    _count: { id: true },
  });

  const billableCount = byEndpoint
    .filter((e) => ["COMPUTE_ROUTES", "GEOCODE"].includes(e.endpoint))
    .reduce((sum, e) => sum + e._count.id, 0);

  const estimatedCostUSD = byEndpoint.reduce((sum, e) => {
    const rate = COST_PER_CALL[e.endpoint] ?? 0;
    return sum + rate * e._count.id;
  }, 0);

  const cacheHitRate = totalToday > 0
    ? ((cacheHitsToday / totalToday) * 100).toFixed(1)
    : "0";

  const limit = parseInt(process.env.MAX_MAPS_CALLS_PER_DAY ?? "500", 10);
  const alertThreshold = parseInt(process.env.MAPS_USAGE_ALERT_THRESHOLD ?? "400", 10);
  const isNearLimit = billableCount >= alertThreshold;
  const isOverLimit = billableCount >= limit;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Uso Google Maps — Hoje</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        </p>
      </div>

      {/* Banner de alerta */}
      {isOverLimit && (
        <div className="rounded-md bg-red-50 border border-red-300 p-4 text-red-800 text-sm">
          <strong>Quota diária atingida</strong> — chamadas bloqueadas preventivamente.
          Novas consultas usarão Nominatim (fallback). Verifique o painel Google Cloud Console.
        </div>
      )}
      {isNearLimit && !isOverLimit && (
        <div className="rounded-md bg-yellow-50 border border-yellow-300 p-4 text-yellow-800 text-sm">
          <strong>Atenção:</strong> {billableCount} de {limit} chamadas usadas hoje ({Math.round((billableCount / limit) * 100)}%).
        </div>
      )}

      {/* Cards principais */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Chamadas billable" value={billableCount} sub={`limite: ${limit}`} />
        <StatCard label="Cache hits" value={cacheHitsToday} sub={`${cacheHitRate}% do total`} />
        <StatCard label="Haversine fallback" value={haversineCount} />
        <StatCard label="Quota bloqueada" value={quotaExceeded} warn={quotaExceeded > 0} />
      </div>

      {/* Custo estimado */}
      <div className="rounded-md border p-4 space-y-1">
        <p className="text-sm font-medium text-muted-foreground">Custo estimado hoje (USD)</p>
        <p className="text-3xl font-bold">${estimatedCostUSD.toFixed(4)}</p>
        <p className="text-xs text-muted-foreground">
          Baseado em $0,005/chamada (Routes + Geocoding). Acesse o Google Cloud Console para valores exatos.
        </p>
      </div>

      {/* Detalhe por endpoint */}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Endpoint</th>
              <th className="text-right px-4 py-2">Chamadas</th>
              <th className="text-right px-4 py-2">Custo est. (USD)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {byEndpoint.map((row) => (
              <tr key={row.endpoint}>
                <td className="px-4 py-2 font-mono text-xs">{row.endpoint}</td>
                <td className="px-4 py-2 text-right">{row._count.id}</td>
                <td className="px-4 py-2 text-right">
                  {((COST_PER_CALL[row.endpoint] ?? 0) * row._count.id).toFixed(4)}
                </td>
              </tr>
            ))}
            {byEndpoint.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhuma chamada registrada hoje.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, warn,
}: {
  label: string; value: number; sub?: string; warn?: boolean;
}) {
  return (
    <div className={`rounded-md border p-4 space-y-1 ${warn ? "border-red-300 bg-red-50" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${warn ? "text-red-700" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
