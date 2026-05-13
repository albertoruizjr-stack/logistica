// app/(app)/torre/divergencias/page.tsx
//
// Painel de divergências Citel × físico.
// Mostra todos os items que foram resolvidos como "produto em estoque"
// (ou seja, o Citel acusava falta mas a loja tinha fisicamente),
// agregados por SKU+loja para a Jane priorizar análise de saneamento.

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PackageCheck, Activity } from "lucide-react";
import { PageHeader } from "@/components/ui";

interface SearchParams {
  storeId?: string;
  range?: "7d" | "30d" | "90d" | "all";
}

interface DivergenceRow {
  productCode: string;
  productName: string;
  storeCode: string;
  occurrences: bigint;
  totalQty: number;
  unit: string | null;
  lastResolvedAt: Date;
  manualCount: bigint;
  autoCount: bigint;
}

interface RecentRow {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit: string | null;
  storeCode: string;
  resolvedByName: string | null;
  resolvedAt: Date;
  trigger: string;
  notes: string | null;
}

const RANGE_LABEL: Record<NonNullable<SearchParams["range"]>, string> = {
  "7d":  "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  "all": "Todo o período",
};

function rangeStartDate(range: SearchParams["range"]): Date | null {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : null;
  if (days == null) return null;
  return new Date(Date.now() - days * 86_400_000);
}

function formatAge(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function TriggerBadge({ trigger }: { trigger: string }) {
  if (trigger === "MANUAL") {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: "rgba(99,102,241,0.10)", color: "#4338CA" }}>
        manual
      </span>
    );
  }
  if (trigger === "AUTO_PROMOTE") {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: "rgba(217,119,6,0.10)", color: "#92400E" }}>
        auto
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: "#F4F4F4", color: "#737373" }}>
      {trigger.toLowerCase()}
    </span>
  );
}

export default async function DivergenciasPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) redirect("/dashboard");

  const range = (searchParams.range ?? "30d") as NonNullable<SearchParams["range"]>;
  const since = rangeStartDate(range);

  const stores = await prisma.store.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  const selectedStore = searchParams.storeId
    ? stores.find((s) => s.id === searchParams.storeId)
    : null;

  // Filtros condicionais
  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (since) {
    params.push(since);
    whereParts.push(`"resolvedAt" >= $${params.length}`);
  }
  if (selectedStore) {
    params.push(selectedStore.code);
    whereParts.push(`"storeCode" = $${params.length}`);
  }
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // Agregação por SKU+loja
  const aggregated = await prisma.$queryRawUnsafe<DivergenceRow[]>(
    `SELECT
       "productCode",
       MAX("productName")  AS "productName",
       "storeCode",
       COUNT(*)            AS occurrences,
       SUM(quantity)       AS "totalQty",
       MAX(unit)           AS unit,
       MAX("resolvedAt")   AS "lastResolvedAt",
       COUNT(*) FILTER (WHERE trigger = 'MANUAL')       AS "manualCount",
       COUNT(*) FILTER (WHERE trigger = 'AUTO_PROMOTE') AS "autoCount"
     FROM stock_divergence_log
     ${whereClause}
     GROUP BY "productCode", "storeCode"
     ORDER BY occurrences DESC, "lastResolvedAt" DESC
     LIMIT 100`,
    ...params,
  );

  // Recentes (timeline)
  const recent = await prisma.$queryRawUnsafe<RecentRow[]>(
    `SELECT id, "productCode", "productName", quantity, unit,
            "storeCode", "resolvedByName", "resolvedAt", trigger, notes
       FROM stock_divergence_log
       ${whereClause}
       ORDER BY "resolvedAt" DESC
       LIMIT 30`,
    ...params,
  );

  // Métricas
  const totalEvents = aggregated.reduce((sum, r) => sum + Number(r.occurrences), 0);
  const distinctSkus = new Set(aggregated.map((r) => r.productCode)).size;
  const distinctStores = new Set(aggregated.map((r) => r.storeCode)).size;

  return (
    <div>
      <PageHeader
        title="Divergências de Estoque"
        description={
          selectedStore
            ? `Loja ${selectedStore.code} — ${RANGE_LABEL[range]}`
            : `Todas as lojas — ${RANGE_LABEL[range]}`
        }
        actions={
          <Link
            href="/torre"
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "#737373", border: "1px solid var(--color-border)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar
          </Link>
        }
      />

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(Object.keys(RANGE_LABEL) as Array<keyof typeof RANGE_LABEL>).map((r) => {
          const active = range === r;
          const href = new URLSearchParams();
          if (selectedStore) href.set("storeId", selectedStore.id);
          if (r !== "30d") href.set("range", r);
          const search = href.toString();
          return (
            <Link
              key={r}
              href={search ? `/torre/divergencias?${search}` : "/torre/divergencias"}
              className="text-[12px] px-3 py-1.5 rounded-full font-medium transition-all"
              style={{
                backgroundColor: active ? "#111111" : "#F4F4F4",
                color: active ? "white" : "#737373",
              }}
            >
              {RANGE_LABEL[r]}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Link
          href={range === "30d" ? "/torre/divergencias" : `/torre/divergencias?range=${range}`}
          className="text-[12px] px-3 py-1.5 rounded-full font-medium transition-all"
          style={{
            backgroundColor: !searchParams.storeId ? "#111111" : "#F4F4F4",
            color: !searchParams.storeId ? "white" : "#737373",
          }}
        >
          Todas
        </Link>
        {stores.map((s) => {
          const active = searchParams.storeId === s.id;
          const qs = new URLSearchParams({ storeId: s.id });
          if (range !== "30d") qs.set("range", range);
          return (
            <Link
              key={s.id}
              href={`/torre/divergencias?${qs.toString()}`}
              className="text-[12px] px-3 py-1.5 rounded-full font-medium transition-all"
              style={{
                backgroundColor: active ? "#111111" : "#F4F4F4",
                color: active ? "white" : "#737373",
              }}
            >
              {s.code}
            </Link>
          );
        })}
      </div>

      {/* Resumo */}
      {aggregated.length > 0 && (
        <div
          className="flex items-center gap-6 px-4 py-3 rounded-xl mb-6 text-[12px]"
          style={{ backgroundColor: "#F9F9F9", border: "1px solid var(--color-border)" }}
        >
          <span style={{ color: "#737373" }}>
            <strong style={{ color: "var(--color-body-text)" }}>{totalEvents}</strong> evento{totalEvents > 1 ? "s" : ""}
          </span>
          <span style={{ color: "#737373" }}>
            <strong style={{ color: "var(--color-body-text)" }}>{distinctSkus}</strong> SKU{distinctSkus > 1 ? "s" : ""}
          </span>
          {!selectedStore && (
            <span style={{ color: "#737373" }}>
              em <strong style={{ color: "var(--color-body-text)" }}>{distinctStores}</strong> loja{distinctStores > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Lista vazia */}
      {aggregated.length === 0 ? (
        <div
          className="rounded-xl p-16 flex flex-col items-center gap-3"
          style={{ border: "1px dashed var(--color-border)" }}
        >
          <PackageCheck className="w-10 h-10" style={{ color: "#D4D4D4" }} />
          <p className="text-[14px] font-medium" style={{ color: "#A3A3A3" }}>
            Nenhuma divergência registrada
          </p>
          <p className="text-[12px]" style={{ color: "#C4C4C4" }}>
            Quando um item for resolvido como "produto em estoque", aparecerá aqui.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Ranking — coluna principal */}
          <div className="lg:col-span-2">
            <h2 className="text-[13px] font-semibold mb-3"
                style={{ color: "var(--color-body-text)", fontFamily: "var(--font-display)" }}>
              Ranking por SKU + Loja
            </h2>
            <div className="bg-white rounded-xl overflow-hidden"
                 style={{ border: "1px solid var(--color-border)" }}>
              <div className="grid grid-cols-12 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide"
                   style={{ backgroundColor: "#FAFAFA", color: "#737373",
                            borderBottom: "1px solid var(--color-border)" }}>
                <div className="col-span-1">#</div>
                <div className="col-span-5">Produto</div>
                <div className="col-span-1 text-center">Loja</div>
                <div className="col-span-2 text-center">Ocorr.</div>
                <div className="col-span-2 text-right">Qtd. total</div>
                <div className="col-span-1 text-right">Última</div>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {aggregated.map((row, idx) => {
                  const occ = Number(row.occurrences);
                  const isHot = occ >= 3;
                  return (
                    <div key={`${row.productCode}-${row.storeCode}`}
                         className="grid grid-cols-12 px-4 py-2.5 items-center">
                      <div className="col-span-1 text-[11px] tabular-nums"
                           style={{ color: "#A3A3A3" }}>
                        {idx + 1}
                      </div>
                      <div className="col-span-5 min-w-0">
                        <p className="text-[12px] font-medium truncate"
                           style={{ color: "var(--color-body-text)" }}>
                          {row.productName}
                        </p>
                        <p className="text-[10.5px] font-mono" style={{ color: "#A3A3A3" }}>
                          {row.productCode}
                        </p>
                      </div>
                      <div className="col-span-1 text-center text-[11.5px] font-semibold"
                           style={{ color: "var(--color-body-text)" }}>
                        {row.storeCode}
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="text-[12px] font-bold tabular-nums px-2 py-0.5 rounded"
                              style={{
                                backgroundColor: isHot ? "rgba(220,38,38,0.10)" : "rgba(99,102,241,0.10)",
                                color: isHot ? "#B91C1C" : "#4338CA",
                                fontFamily: "var(--font-display)",
                              }}>
                          {occ}
                        </span>
                      </div>
                      <div className="col-span-2 text-right tabular-nums text-[12px]"
                           style={{ color: "var(--color-body-text)" }}>
                        {row.totalQty.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                        <span className="text-[10px] ml-1" style={{ color: "#A3A3A3" }}>
                          {row.unit}
                        </span>
                      </div>
                      <div className="col-span-1 text-right text-[10.5px]"
                           style={{ color: "#A3A3A3" }}>
                        {formatAge(new Date(row.lastResolvedAt))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Timeline — coluna lateral */}
          <div>
            <h2 className="text-[13px] font-semibold mb-3 flex items-center gap-2"
                style={{ color: "var(--color-body-text)", fontFamily: "var(--font-display)" }}>
              <Activity className="w-3.5 h-3.5" style={{ color: "#737373" }} />
              Atividade recente
            </h2>
            <div className="bg-white rounded-xl overflow-hidden"
                 style={{ border: "1px solid var(--color-border)" }}>
              <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recent.map((r) => (
                  <div key={r.id} className="px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] font-semibold"
                            style={{ color: "var(--color-body-text)" }}>
                        Loja {r.storeCode}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <TriggerBadge trigger={r.trigger} />
                        <span className="text-[10px]" style={{ color: "#A3A3A3" }}>
                          há {formatAge(new Date(r.resolvedAt))}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11.5px] font-medium truncate"
                       style={{ color: "var(--color-body-text)" }}>
                      {r.productName}
                    </p>
                    <p className="text-[10.5px] font-mono mt-0.5" style={{ color: "#A3A3A3" }}>
                      {r.productCode} · {r.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} {r.unit}
                    </p>
                    {r.resolvedByName && (
                      <p className="text-[10px] mt-1" style={{ color: "#A3A3A3" }}>
                        por {r.resolvedByName}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
