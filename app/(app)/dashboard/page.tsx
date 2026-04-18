import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_COLORS,
  TRANSFER_STATUS_LABELS,
  TRANSFER_STATUS_COLORS,
  TRANSFER_PRIORITY_LABELS,
  TRANSFER_PRIORITY_COLORS,
  DISPATCH_MODAL_LABELS,
} from "@/lib/constants";
import {
  Truck, ArrowLeftRight, Clock, CheckCircle,
  AlertTriangle, TrendingUp, Users, Package,
  DollarSign, AlertOctagon
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // busca KPIs em paralelo
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
  ]);

  const kpis = [
    {
      label: "Solicitações Pendentes",
      value: pendingDeliveries,
      icon: Package,
      color: "text-yellow-600",
      bg: "bg-yellow-50",
      href: "/solicitacoes?status=PENDING",
    },
    {
      label: "Em Trânsito",
      value: inTransitDeliveries,
      icon: Truck,
      color: "text-blue-600",
      bg: "bg-blue-50",
      href: "/despacho",
    },
    {
      label: "Entregues Hoje",
      value: deliveredToday,
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50",
      href: "/solicitacoes?status=DELIVERED",
    },
    {
      label: "Transferências Pendentes",
      value: pendingTransfers,
      icon: ArrowLeftRight,
      color: urgentTransfers > 0 ? "text-red-600" : "text-purple-600",
      bg: urgentTransfers > 0 ? "bg-red-50" : "bg-purple-50",
      href: "/transferencias",
      alert: urgentTransfers > 0 ? `${urgentTransfers} urgentes` : undefined,
    },
    {
      label: "Transferências em Trânsito",
      value: transfersInTransit,
      icon: Clock,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      href: "/transferencias?status=IN_TRANSIT",
    },
    {
      label: "Despachos Pendentes",
      value: pendingDispatches,
      icon: AlertTriangle,
      color: "text-orange-600",
      bg: "bg-orange-50",
      href: "/despacho",
    },
    {
      label: "Motoristas Disponíveis",
      value: activeDrivers,
      icon: Users,
      color: "text-teal-600",
      bg: "bg-teal-50",
      href: "/rastreamento",
    },
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
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard Logístico</h1>
        <p className="text-gray-500 text-sm mt-1">
          {new Date().toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <Link
            key={kpi.label}
            href={kpi.href}
            className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={cn("p-2 rounded-lg", kpi.bg)}>
                <kpi.icon className={cn("w-5 h-5", kpi.color)} />
              </div>
              {kpi.alert && (
                <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {kpi.alert}
                </span>
              )}
            </div>
            <p className="text-2xl font-bold text-gray-900 group-hover:text-orange-600 transition-colors">
              {kpi.value}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 leading-tight">{kpi.label}</p>
          </Link>
        ))}
      </div>

      {/* Auditoria — desvio médio */}
      {auditSummary._count.id > 0 && (
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transferências ativas */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-gray-900 text-sm">Transferências Ativas</h2>
            </div>
            <Link
              href="/transferencias"
              className="text-xs text-orange-600 hover:underline font-medium"
            >
              Ver todas
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentTransfers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                Nenhuma transferência ativa
              </p>
            ) : (
              recentTransfers.map((transfer) => (
                <Link
                  key={transfer.id}
                  href={`/transferencias/${transfer.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-gray-900">
                        {transfer.fromStore.code} → {transfer.toStore.code}
                      </span>
                      <span className={cn(
                        "text-xs px-1.5 py-0.5 rounded border font-medium",
                        TRANSFER_PRIORITY_COLORS[transfer.priority]
                      )}>
                        {TRANSFER_PRIORITY_LABELS[transfer.priority]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {transfer.items.length} {transfer.items.length === 1 ? "item" : "itens"} •{" "}
                      {formatRelativeTime(transfer.requestedAt)}
                    </p>
                  </div>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium border",
                    TRANSFER_STATUS_COLORS[transfer.status]
                  )}>
                    {TRANSFER_STATUS_LABELS[transfer.status]}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Solicitações de hoje */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-gray-900 text-sm">Solicitações de Hoje</h2>
              <span className="text-xs text-gray-400">({deliveriesToday})</span>
            </div>
            <Link
              href="/solicitacoes"
              className="text-xs text-orange-600 hover:underline font-medium"
            >
              Ver todas
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentDeliveries.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                Nenhuma solicitação hoje
              </p>
            ) : (
              recentDeliveries.map((req) => (
                <Link
                  key={req.id}
                  href={`/solicitacoes/${req.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-gray-900">
                        NF {req.invoiceNumber}
                      </span>
                      <span className="text-xs text-gray-400">— Loja {req.store.code}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">
                      {req.customerName} • {formatRelativeTime(req.createdAt)}
                    </p>
                  </div>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    DELIVERY_STATUS_COLORS[req.status]
                  )}>
                    {DELIVERY_STATUS_LABELS[req.status]}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
