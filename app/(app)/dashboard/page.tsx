import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { TRANSFER_PRIORITY_LABELS, TRANSFER_PRIORITY_COLORS } from "@/lib/constants";
import {
  Truck, ArrowLeftRight, Clock, CheckCircle,
  AlertTriangle, TrendingUp, Users, Package,
  DollarSign, AlertOctagon, ChevronRight, Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { PageHeader, MetricCard, StatusBadge } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";

type MetricVariant = "default" | "urgent" | "warning" | "success" | "danger";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[10px] font-semibold uppercase mb-3"
      style={{ letterSpacing: "0.14em", color: "#A3A3A3", fontFamily: "var(--font-body)" }}
    >
      {children}
    </p>
  );
}

function KpiLink({
  href,
  label,
  value,
  icon,
  variant,
}: {
  href: string;
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant: MetricVariant;
}) {
  return (
    <Link href={href} className="block hover:opacity-90 transition-opacity">
      <MetricCard label={label} value={value} icon={icon} variant={variant} />
    </Link>
  );
}

// Card de custo logístico do dia — separa frota própria (custo fixo afundado, exibida
// como CONTAGEM de entregas) de Lalamove (custo marginal real em R$). Estilo alinhado
// ao MetricCard para manter consistência visual na grade do Financeiro.
function CustoLogisticoCard({
  frotaCount,
  lalamoveCount,
  lalamoveGasto,
}: {
  frotaCount: number;
  lalamoveCount: number;
  lalamoveGasto: number;
}) {
  return (
    <Link href="/auditoria" className="block hover:opacity-90 transition-opacity">
      <div
        className="bg-white rounded-xl p-5 transition-shadow hover:shadow-md"
        style={{ border: "1px solid var(--color-border)" }}
      >
        <div className="flex items-start justify-between mb-4">
          <p
            className="text-[10px] font-semibold uppercase"
            style={{ letterSpacing: "0.12em", color: "#A3A3A3", fontFamily: "var(--font-body)" }}
          >
            Custo Logístico Hoje
          </p>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#F4F4F4" }}
          >
            <DollarSign className="w-4 h-4" style={{ color: "#737373" }} />
          </div>
        </div>

        <p
          className="text-[24px] font-bold leading-none tabular-nums"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}
        >
          {formatCurrency(lalamoveGasto)}
          <span className="text-[13px] font-medium ml-1.5" style={{ color: "#A3A3A3" }}>
            em Lalamove
          </span>
        </p>

        <div className="mt-4 pt-3 space-y-1.5" style={{ borderTop: "1px solid var(--color-border)" }}>
          <div className="flex items-center justify-between">
            <span className="text-[12px]" style={{ color: "#737373" }}>
              🚐 Frota própria
            </span>
            <span className="text-[12px] font-medium tabular-nums" style={{ color: "var(--color-body-text)" }}>
              {frotaCount} {frotaCount === 1 ? "entrega" : "entregas"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px]" style={{ color: "#737373" }}>
              🛵 Lalamove
            </span>
            <span className="text-[12px] font-medium tabular-nums" style={{ color: "var(--color-body-text)" }}>
              {lalamoveCount} · {formatCurrency(lalamoveGasto)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Início do dia às 12h (horário de Brasília = UTC-3, então 12h BRT = 15h UTC)
  const todayNoon = new Date(today);
  todayNoon.setUTCHours(15, 0, 0, 0); // 15h UTC = 12h Brasília

  const [
    pendingDeliveries,
    deliveriesToday,
    inTransitDeliveries,
    deliveredToday,
    pendingTransfers,
    urgentTransfers,
    transfersInTransit,
    pendingDispatches,
    activeDrivers,
    recentDeliveries,
    recentTransfers,
    auditSummary,
    pendingJustifications,
    oldestPendingDispatch,
    oldestUrgentTransfer,
    oldestPendingJustification,
    sameDayToday,
    sameDayAfterCutoff,
    sameDayExceptionsToday,
    dispatchesHoje,
    lalamoveDispatchesHoje,
  ] = await Promise.all([
    prisma.deliveryRequest.count({ where: { status: { in: ["PENDING", "AWAITING_ITEMS", "AWAITING_TRANSFER", "READY"] } } }),
    prisma.deliveryRequest.count({ where: { createdAt: { gte: today } } }),
    prisma.deliveryRequest.count({ where: { status: "IN_TRANSIT" } }),
    prisma.deliveryRequest.count({ where: { status: "DELIVERED", updatedAt: { gte: today } } }),
    prisma.transfer.count({ where: { status: { in: ["PENDING", "APPROVED", "PREPARING"] } } }),
    prisma.transfer.count({ where: { priority: "URGENT", status: { notIn: ["RECEIVED", "CANCELLED"] } } }),
    prisma.transfer.count({ where: { status: "IN_TRANSIT" } }),
    prisma.dispatch.count({ where: { status: { in: ["PENDING", "ASSIGNED"] } } }),
    prisma.driver.count({ where: { active: true, available: true } }),
    prisma.deliveryRequest.findMany({
      where: { createdAt: { gte: today } },
      include: {
        store: { select: { code: true } },
        seller: { select: { name: true } },
        freightQuote: { select: { distanceKm: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.transfer.findMany({
      where: { status: { notIn: ["RECEIVED", "CANCELLED"] } },
      include: {
        fromStore: { select: { code: true, name: true } },
        toStore: { select: { code: true, name: true } },
        items: { select: { id: true } },
      },
      orderBy: [{ priority: "asc" }, { requestedAt: "desc" }],
      take: 6,
    }),
    prisma.freightAudit.aggregate({
      _avg: { deviationPercent: true },
      _sum: { chargedFreight: true, estimatedCost: true },
      _count: { id: true },
      where: { createdAt: { gte: today } },
    }),
    prisma.freightAudit.count({
      where: { createdAt: { gte: today }, justificationRequired: true, justification: null },
    }),
    prisma.dispatch.findFirst({
      where: { status: { in: ["PENDING", "ASSIGNED"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.transfer.findFirst({
      where: { priority: "URGENT", status: { notIn: ["RECEIVED", "CANCELLED"] } },
      orderBy: { requestedAt: "asc" },
      select: { requestedAt: true },
    }),
    prisma.freightAudit.findFirst({
      where: { createdAt: { gte: today }, justificationRequired: true, justification: null },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    // same-day KPIs — requerem schema migrado (campos slaType, sameDayRequested)
    prisma.deliveryRequest.count({
      where: { createdAt: { gte: today }, deliveryType: "URGENT" },
    }),
    prisma.deliveryRequest.count({
      where: { createdAt: { gte: todayNoon }, deliveryType: "URGENT" },
    }),
    prisma.deliveryRequest.count({
      where: { createdAt: { gte: today }, sameDayRequested: true },
    }),
    // custo logístico de hoje agregado por modal — frota própria (contagem) vs Lalamove (R$)
    prisma.dispatch.groupBy({
      by: ["modal"],
      where: { dispatchedAt: { gte: today } },
      _count: { _all: true },
      _sum: { actualCost: true, estimatedCost: true },
    }),
    // Linhas Lalamove de hoje — soma per-row (actualCost ?? estimatedCost) pra não
    // perder o estimado das corridas ainda pendentes quando algumas já concluíram.
    prisma.dispatch.findMany({
      where: { modal: "LALAMOVE", dispatchedAt: { gte: today } },
      select: { actualCost: true, estimatedCost: true },
    }),
  ]);

  // Custo logístico de hoje — split frota própria (sunk cost, conta entregas) x Lalamove (R$)
  const frotaCount = dispatchesHoje.find((d) => d.modal === "INTERNAL_ROUTE")?._count._all ?? 0;
  const lalamoveGasto = lalamoveDispatchesHoje.reduce(
    (acc, d) => acc + (d.actualCost ?? d.estimatedCost ?? 0),
    0,
  );
  const lalamoveCount = lalamoveDispatchesHoje.length;

  // Alertas que justificam CTA imediato — ordem: despachos → transferências urgentes → justificativas
  const alertItems: { message: string; time: string | null; href: string; cta: string }[] = [];
  if (pendingDispatches > 0) {
    alertItems.push({
      message: `${pendingDispatches} ${pendingDispatches === 1 ? "despacho pendente" : "despachos pendentes"} aguardando saída`,
      time: oldestPendingDispatch ? formatRelativeTime(oldestPendingDispatch.createdAt) : null,
      href: "/despacho",
      cta: "Ir para Despacho",
    });
  }
  if (urgentTransfers > 0) {
    alertItems.push({
      message: `${urgentTransfers} ${urgentTransfers === 1 ? "transferência urgente" : "transferências urgentes"} em aberto`,
      time: oldestUrgentTransfer ? formatRelativeTime(oldestUrgentTransfer.requestedAt) : null,
      href: "/transferencias",
      cta: "Ver transferências",
    });
  }
  if (pendingJustifications > 0) {
    alertItems.push({
      message: `${pendingJustifications} ${pendingJustifications === 1 ? "justificativa de frete pendente" : "justificativas de frete pendentes"}`,
      time: oldestPendingJustification ? formatRelativeTime(oldestPendingJustification.createdAt) : null,
      href: "/auditoria?pendente=true",
      cta: "Ver itens",
    });
  }

  const MAX_ALERTS = 3;
  const visibleAlerts = alertItems.slice(0, MAX_ALERTS);
  const hiddenAlertsCount = alertItems.length - visibleAlerts.length;

  const deviationPct = auditSummary._avg.deviationPercent ?? 0;
  const deviationVariant: MetricVariant =
    deviationPct > 15 ? "danger" : deviationPct > 0 ? "warning" : "success";

  return (
    <div>
      <PageHeader
        title="Dashboard Logístico"
        description={new Date().toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      />

      {/* Banner de alertas — só aparece quando há itens críticos */}
      {alertItems.length > 0 && (
        <div
          className="rounded-xl mb-6 overflow-hidden"
          style={{ border: "1px solid rgba(220,38,38,0.2)", backgroundColor: "rgba(254,242,242,1)" }}
        >
          <div
            className="flex items-center gap-2 px-4 py-2.5"
            style={{ backgroundColor: "rgba(220,38,38,0.08)", borderBottom: "1px solid rgba(220,38,38,0.12)" }}
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#DC2626" }} />
            <p className="text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.1em", color: "#DC2626" }}>
              Atenção necessária
            </p>
          </div>
          <div className="divide-y divide-red-100">
            {visibleAlerts.map((alert) => (
              <div key={alert.href} className="flex items-center justify-between px-4 py-3 gap-4">
                <div className="flex items-baseline gap-2 min-w-0">
                  <p className="text-[13px]" style={{ color: "#7F1D1D" }}>
                    {alert.message}
                  </p>
                  {alert.time && (
                    <span className="text-[11px] flex-shrink-0" style={{ color: "#B91C1C" }}>
                      · {alert.time}
                    </span>
                  )}
                </div>
                <Link
                  href={alert.href}
                  className="flex items-center gap-1 text-[12px] font-semibold flex-shrink-0 transition-opacity hover:opacity-70"
                  style={{ color: "#DC2626" }}
                >
                  {alert.cta}
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
            {hiddenAlertsCount > 0 && (
              <div className="px-4 py-2.5">
                <p className="text-[12px]" style={{ color: "#B91C1C" }}>
                  + {hiddenAlertsCount} {hiddenAlertsCount === 1 ? "outro alerta" : "outros alertas"} — verifique as seções abaixo
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ENTREGAS */}
      <div className="mb-6">
        <SectionLabel>Entregas</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiLink href="/solicitacoes?status=PENDING" label="Pendentes"     value={pendingDeliveries}   icon={Package}       variant="warning" />
          <KpiLink href="/despacho"                    label="Em Trânsito"   value={inTransitDeliveries} icon={Truck}         variant="default" />
          <KpiLink href="/solicitacoes?status=DELIVERED" label="Entregues Hoje" value={deliveredToday}   icon={CheckCircle}   variant="success" />
          <KpiLink href="/despacho"                    label="Aguardando Despacho" value={pendingDispatches} icon={AlertTriangle} variant={pendingDispatches > 0 ? "urgent" : "default"} />
        </div>
      </div>

      {/* TRANSFERÊNCIAS */}
      <div className="mb-6">
        <SectionLabel>Transferências</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiLink href="/transferencias"              label="Pendentes"      value={pendingTransfers}   icon={ArrowLeftRight} variant={urgentTransfers > 0 ? "danger" : "default"} />
          <KpiLink href="/transferencias?status=IN_TRANSIT" label="Em Trânsito" value={transfersInTransit} icon={Clock}       variant="default" />
          <KpiLink href="/rastreamento"                label="Motoristas Disp." value={activeDrivers}   icon={Users}         variant="default" />
        </div>
      </div>

      {/* FINANCEIRO */}
      <div className="mb-6">
        <SectionLabel>Financeiro</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiLink href="/auditoria"              label="Frete Faturado Hoje"  value={formatCurrency(auditSummary._sum.chargedFreight ?? 0)} icon={TrendingUp}  variant="success" />
          <CustoLogisticoCard frotaCount={frotaCount} lalamoveCount={lalamoveCount} lalamoveGasto={lalamoveGasto} />
          <KpiLink href="/auditoria?pendente=true" label="Justific. Pendentes" value={pendingJustifications} icon={AlertOctagon} variant={pendingJustifications > 0 ? "danger" : "default"} />
        </div>
      </div>

      {/* SAME DAY */}
      {sameDayToday > 0 && (
        <div className="mb-6">
          <SectionLabel>Same Day</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <KpiLink
              href="/solicitacoes?deliveryType=URGENT"
              label="Urgentes hoje"
              value={sameDayToday}
              icon={Zap}
              variant={sameDayToday > 0 ? "urgent" : "default"}
            />
            <KpiLink
              href="/solicitacoes?deliveryType=URGENT"
              label="Urgentes após 12h"
              value={sameDayAfterCutoff}
              icon={Clock}
              variant={sameDayAfterCutoff > 0 ? "warning" : "default"}
            />
            <KpiLink
              href="/solicitacoes?sameDayRequested=true"
              label="Exceções same-day"
              value={sameDayExceptionsToday}
              icon={AlertTriangle}
              variant={sameDayExceptionsToday > 0 ? "danger" : "default"}
            />
          </div>
        </div>
      )}

      {/* Desvio médio — só exibe quando há cotações no dia */}
      {auditSummary._count.id > 0 && (
        <div
          className="mb-6 rounded-xl p-4 flex items-center gap-4"
          style={{ backgroundColor: "white", border: "1px solid var(--color-border)" }}
        >
          <div>
            <p className="text-[10px] font-semibold uppercase mb-1" style={{ letterSpacing: "0.12em", color: "#A3A3A3" }}>
              Desvio médio de frete hoje
            </p>
            <p
              className="text-[28px] font-bold leading-none tabular-nums"
              style={{
                fontFamily: "var(--font-display)",
                color: deviationPct > 15 ? "#DC2626" : deviationPct > 0 ? "#D97706" : "#16A34A",
              }}
            >
              {deviationPct > 0 ? "+" : ""}{deviationPct.toFixed(1)}%
            </p>
          </div>
          <div className="flex-1">
            <p className="text-[12px]" style={{ color: "#737373" }}>
              Baseado em {auditSummary._count.id} {auditSummary._count.id === 1 ? "cotação" : "cotações"} do dia
            </p>
            <p className="text-[11px]" style={{ color: "#A3A3A3" }}>
              Sugerido vs Cobrado · tolerância padrão 15%
            </p>
          </div>
          <Link
            href="/auditoria"
            className="text-[12px] font-medium flex items-center gap-1 flex-shrink-0 transition-opacity hover:opacity-70"
            style={{ color: "var(--color-primary)" }}
          >
            Ver auditoria <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Listas: Transferências ativas + Solicitações de hoje */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl" style={{ border: "1px solid var(--color-border)" }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
              <h2 className="text-[13px] font-semibold" style={{ color: "var(--color-body-text)" }}>
                Transferências Ativas
              </h2>
            </div>
            <Link href="/transferencias" className="text-[12px] font-medium flex items-center gap-0.5 transition-opacity hover:opacity-70" style={{ color: "var(--color-primary)" }}>
              Ver todas <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {recentTransfers.length === 0 ? (
              <p className="text-[13px] text-center py-8" style={{ color: "#A3A3A3" }}>
                Nenhuma transferência ativa
              </p>
            ) : (
              recentTransfers.map((transfer) => (
                <Link
                  key={transfer.id}
                  href={`/transferencias/${transfer.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px] font-medium" style={{ color: "var(--color-body-text)" }}>
                        {transfer.fromStore.code} → {transfer.toStore.code}
                      </span>
                      <span className={cn("text-[11px] px-1.5 py-0.5 rounded border font-medium", TRANSFER_PRIORITY_COLORS[transfer.priority])}>
                        {TRANSFER_PRIORITY_LABELS[transfer.priority]}
                      </span>
                    </div>
                    <p className="text-[11px]" style={{ color: "#A3A3A3" }}>
                      {transfer.items.length} {transfer.items.length === 1 ? "item" : "itens"} · {formatRelativeTime(transfer.requestedAt)}
                    </p>
                  </div>
                  <StatusBadge status={transfer.status as StatusVariant} />
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl" style={{ border: "1px solid var(--color-border)" }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
              <h2 className="text-[13px] font-semibold" style={{ color: "var(--color-body-text)" }}>
                Solicitações de Hoje
              </h2>
              <span className="text-[11px]" style={{ color: "#A3A3A3" }}>({deliveriesToday})</span>
            </div>
            <Link href="/solicitacoes" className="text-[12px] font-medium flex items-center gap-0.5 transition-opacity hover:opacity-70" style={{ color: "var(--color-primary)" }}>
              Ver todas <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {recentDeliveries.length === 0 ? (
              <p className="text-[13px] text-center py-8" style={{ color: "#A3A3A3" }}>
                Nenhuma solicitação hoje
              </p>
            ) : (
              recentDeliveries.map((req) => (
                <Link
                  key={req.id}
                  href={`/solicitacoes/${req.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px] font-medium" style={{ color: "var(--color-body-text)" }}>
                        NF {req.invoiceNumber}
                      </span>
                      <span className="text-[11px]" style={{ color: "#A3A3A3" }}>— Loja {req.store.code}</span>
                    </div>
                    <p className="text-[11px] truncate" style={{ color: "#A3A3A3" }}>
                      {req.customerName} · {formatRelativeTime(req.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={req.status as StatusVariant} />
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
