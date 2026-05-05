// app/(app)/torre/ruptura/page.tsx
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShoppingCart, ArrowLeftRight, PackageX } from "lucide-react";
import { PageHeader } from "@/components/ui";
import type { AbcClassificationValue } from "@prisma/client";

interface SearchParams {
  storeId?: string;
}

// Cores e labels para curva ABC
const ABC_CONFIG: Record<AbcClassificationValue, { label: string; color: string; bg: string; order: number }> = {
  A: { label: "A", color: "#B91C1C", bg: "rgba(220,38,38,0.08)", order: 0 },
  B: { label: "B", color: "#B45309", bg: "rgba(217,119,6,0.08)", order: 1 },
  C: { label: "C", color: "#4B5563", bg: "rgba(75,85,99,0.08)", order: 2 },
};

function formatAge(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SlaChip({ status, minutesLeft }: { status: string; minutesLeft: number }) {
  if (status === "OVERDUE") {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#FEF2F2", color: "#B91C1C" }}>
        VENCIDO
      </span>
    );
  }
  if (status === "AT_RISK") {
    const h = Math.floor(minutesLeft / 60);
    const label = h > 0 ? `${h}h restantes` : `${minutesLeft}min`;
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#FFFBEB", color: "#92400E" }}>
        ⚠ {label}
      </span>
    );
  }
  const h = Math.floor(minutesLeft / 60);
  const label = h > 0 ? `${h}h` : `${minutesLeft}min`;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#F4F4F4", color: "#737373" }}>
      {label}
    </span>
  );
}

export default async function RupturaPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!["ADMIN", "OPERATOR"].includes(session.role)) redirect("/dashboard");

  const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] as const;

  // Busca lojas ativas para o seletor de filtro
  const [stores, alerts] = await Promise.all([
    prisma.store.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.controlTowerAlert.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        type: "ABAIXO_MINIMO",
        ...(searchParams.storeId ? { storeId: searchParams.storeId } : {}),
      },
      orderBy: [{ severity: "asc" }, { slaDeadline: "asc" }],
      select: {
        id: true,
        storeId: true,
        severity: true,
        actionType: true,
        slaDeadline: true,
        slaStatus: true,
        createdAt: true,
        store: { select: { code: true, name: true } },
        items: {
          orderBy: { abcClassification: "asc" },
          select: {
            id: true,
            productCode: true,
            productName: true,
            abcClassification: true,
            metricValue: true,
            metricUnit: true,
          },
        },
      },
    }),
  ]);

  const selectedStore = searchParams.storeId
    ? stores.find((s) => s.id === searchParams.storeId)
    : null;

  const now = Date.now();
  const totalSkus = alerts.reduce((sum, a) => sum + a.items.length, 0);
  const criticalAlerts = alerts.filter((a) => a.severity === "CRITICAL");

  return (
    <div>
      <PageHeader
        title="Ruptura de Estoque"
        description={
          selectedStore
            ? `Loja ${selectedStore.code} — ${selectedStore.name.replace(/^Loja\s+/i, "").replace(/\s*\(\d+\)$/, "")}`
            : "Todas as lojas"
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

      {/* Filtro por loja */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Link
          href="/torre/ruptura"
          className="text-[12px] px-3 py-1.5 rounded-full font-medium transition-all"
          style={{
            backgroundColor: !searchParams.storeId ? "#111111" : "#F4F4F4",
            color: !searchParams.storeId ? "white" : "#737373",
          }}
        >
          Todas
        </Link>
        {stores.map((s) => (
          <Link
            key={s.id}
            href={`/torre/ruptura?storeId=${s.id}`}
            className="text-[12px] px-3 py-1.5 rounded-full font-medium transition-all"
            style={{
              backgroundColor: searchParams.storeId === s.id ? "#111111" : "#F4F4F4",
              color: searchParams.storeId === s.id ? "white" : "#737373",
            }}
          >
            {s.code}
          </Link>
        ))}
      </div>

      {/* Resumo rápido */}
      {alerts.length > 0 && (
        <div
          className="flex items-center gap-6 px-4 py-3 rounded-xl mb-6 text-[12px]"
          style={{ backgroundColor: "#F9F9F9", border: "1px solid var(--color-border)" }}
        >
          <span style={{ color: "#737373" }}>
            <strong style={{ color: "var(--color-body-text)" }}>{alerts.length}</strong> alerta{alerts.length > 1 ? "s" : ""}
          </span>
          <span style={{ color: "#737373" }}>
            <strong style={{ color: "var(--color-body-text)" }}>{totalSkus}</strong> SKU{totalSkus > 1 ? "s" : ""} em ruptura
          </span>
          {criticalAlerts.length > 0 && (
            <span style={{ color: "#B91C1C" }}>
              <strong>{criticalAlerts.length}</strong> crítico{criticalAlerts.length > 1 ? "s" : ""} (curva A)
            </span>
          )}
        </div>
      )}

      {/* Lista de alertas */}
      {alerts.length === 0 ? (
        <div
          className="rounded-xl p-16 flex flex-col items-center gap-3"
          style={{ border: "1px dashed var(--color-border)" }}
        >
          <PackageX className="w-10 h-10" style={{ color: "#D4D4D4" }} />
          <p className="text-[14px] font-medium" style={{ color: "#A3A3A3" }}>
            Nenhuma ruptura encontrada
          </p>
          <p className="text-[12px]" style={{ color: "#C4C4C4" }}>
            {selectedStore ? `Loja ${selectedStore.code} está com estoque adequado.` : "Todas as lojas estão com estoque adequado."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const minutesLeft = Math.round((alert.slaDeadline.getTime() - now) / 60_000);
            const storeName = alert.store.name.replace(/^Loja\s+/i, "").replace(/\s*\(\d+\)$/, "");
            const isCritical = alert.severity === "CRITICAL";

            return (
              <div
                key={alert.id}
                className="bg-white rounded-xl overflow-hidden"
                style={{
                  border: `1px solid ${isCritical ? "rgba(220,38,38,0.25)" : "var(--color-border)"}`,
                }}
              >
                {/* Cabeçalho do alerta */}
                <div
                  className="px-4 py-3 flex items-center justify-between gap-3"
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    backgroundColor: isCritical ? "rgba(220,38,38,0.03)" : "#FAFAFA",
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: isCritical ? "#DC2626" : "#D97706" }}
                    />
                    {!searchParams.storeId && (
                      <span
                        className="text-[12px] font-semibold"
                        style={{ color: "var(--color-body-text)" }}
                      >
                        {alert.store.code} — {storeName}
                      </span>
                    )}
                    <span className="text-[11px]" style={{ color: "#A3A3A3" }}>
                      aberto há {formatAge(alert.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <SlaChip status={alert.slaStatus} minutesLeft={minutesLeft} />
                    {/* CTA de ação */}
                    {alert.actionType === "PLACE_PURCHASE_ORDER" ? (
                      <span
                        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg"
                        style={{ backgroundColor: "rgba(22,163,74,0.08)", color: "#15803D" }}
                      >
                        <ShoppingCart className="w-3 h-3" />
                        Comprar
                      </span>
                    ) : (
                      <span
                        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg"
                        style={{ backgroundColor: "rgba(59,130,246,0.08)", color: "#1D4ED8" }}
                      >
                        <ArrowLeftRight className="w-3 h-3" />
                        Transferir
                      </span>
                    )}
                  </div>
                </div>

                {/* SKUs afetados */}
                <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                  {alert.items.map((item) => {
                    const abc = item.abcClassification as AbcClassificationValue | null;
                    const abcCfg = abc ? ABC_CONFIG[abc] : null;

                    return (
                      <div key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {abcCfg && (
                            <span
                              className="text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: abcCfg.bg, color: abcCfg.color }}
                            >
                              {abcCfg.label}
                            </span>
                          )}
                          <div className="min-w-0">
                            <p
                              className="text-[12px] font-medium truncate"
                              style={{ color: "var(--color-body-text)" }}
                            >
                              {item.productName}
                            </p>
                            <p className="text-[11px]" style={{ color: "#A3A3A3" }}>
                              {item.productCode}
                            </p>
                          </div>
                        </div>

                        {/* Quantidade disponível */}
                        <div className="flex-shrink-0 text-right">
                          <p
                            className="text-[13px] font-bold tabular-nums"
                            style={{
                              color: item.metricValue <= 0 ? "#DC2626" : "#D97706",
                              fontFamily: "var(--font-display)",
                            }}
                          >
                            {item.metricValue}
                          </p>
                          <p className="text-[10px]" style={{ color: "#A3A3A3" }}>
                            {item.metricUnit}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
