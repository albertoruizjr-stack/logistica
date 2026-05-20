import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listPendingDispatches } from "@/services/despacho.service";
import { prisma } from "@/lib/prisma";
import { DISPATCH_MODAL_LABELS } from "@/lib/constants";
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";
import {
  Truck, Zap, ArrowLeftRight, Package,
  Users, Clock, CheckCircle, Map as MapIcon, type LucideIcon,
} from "lucide-react";
import { DispatchActionPanel } from "@/components/despacho/dispatch-actions";
import { PageHeader, MetricCard, EmptyState, AlertBanner } from "@/components/ui";
import RouteDispatchPanel from "./_components/route-dispatch-panel";
import { extractDeliveryRequestIds, type RouteSequenceEntry } from "@/lib/route-sequence";

export default async function DespachoPainel() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
    redirect("/dashboard");
  }

  const [dispatches, drivers, readyForDispatch, activeRoutes] = await Promise.all([
    listPendingDispatches(),
    prisma.driver.findMany({
      where: { active: true },
      include: { store: { select: { code: true } } },
      orderBy: [{ available: "desc" }, { name: "asc" }],
    }),
    prisma.deliveryRequest.findMany({
      where: { status: "READY" },
      include: {
        store: { select: { code: true, name: true } },
        freightQuote: { select: { distanceKm: true, deliveryType: true, suggestedPrice: true } },
        seller: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.route.findMany({
      where: { status: "ACTIVE" },
      include: {
        driver: { select: { id: true, name: true, phone: true, vehicleType: true } },
        wave:   { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Coleta metadados das DRs nas rotas ativas (uma query única).
  // extractDeliveryRequestIds descarta paradas manuais (sem deliveryRequestId) —
  // mandar undefined pra dentro de { id: { in: [...] } } quebraria a query.
  const routeStopIds = activeRoutes.flatMap((r) => {
    const seq = (r.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
    return extractDeliveryRequestIds(seq);
  });
  const routeStopsMeta = routeStopIds.length > 0
    ? await prisma.deliveryRequest.findMany({
        where: { id: { in: routeStopIds } },
        select: {
          id:              true,
          orderNumber:     true,
          invoiceNumber:   true,
          customerName:    true,
          customerPhone:   true,
          deliveryAddress: true,
          deliveryCity:    true,
          totalWeightKg:   true,
          totalLatas:      true,
          volumeBreakdown: true,
        },
      })
    : [];
  const routeStopsMetaMapped = routeStopsMeta.map((d) => ({
    deliveryRequestId: d.id,
    orderNumber:       d.orderNumber,
    invoiceNumber:     d.invoiceNumber,
    customerName:      d.customerName,
    customerPhone:     d.customerPhone,
    deliveryAddress:   d.deliveryAddress,
    deliveryCity:      d.deliveryCity,
    totalWeightKg:     d.totalWeightKg,
    totalLatas:        d.totalLatas,
    volumeBreakdown:   (d.volumeBreakdown as Record<string, number> | null) ?? null,
  }));

  const pendingCount = dispatches.filter((d) => d.status === "PENDING").length;
  const inTransitCount = dispatches.filter((d) => d.status === "IN_TRANSIT").length;
  const availableDrivers = drivers.filter((d) => d.available).length;

  const kpis: { label: string; value: number; icon: LucideIcon; variant: "default" | "warning" | "success" }[] = [
    { label: "Rotas prontas",          value: activeRoutes.length,    icon: MapIcon, variant: "default"  },
    { label: "Prontos (individual)",   value: readyForDispatch.length, icon: Package, variant: "default"  },
    { label: "Despachos pendentes",    value: pendingCount,            icon: Clock,   variant: "warning"  },
    { label: "Motoristas disponíveis", value: availableDrivers,        icon: Users,   variant: "success"  },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Painel de Despacho"
        description="Gerencie rotas internas, Lalamove e transferências em andamento"
      />

      {/* Resumo rápido */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi) => (
          <MetricCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            variant={kpi.variant}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Solicitações prontas para despacho */}
        <div className="lg:col-span-2 space-y-4">
          {/* Rotas otimizadas pelo Spoke — agrupamento de várias DRs por motorista */}
          {activeRoutes.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <MapIcon className="w-4 h-4 text-orange-500" />
                Rotas prontas (otimizadas)
                <span className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5 rounded-full">
                  {activeRoutes.length}
                </span>
              </h2>
              {activeRoutes.map((route) => {
                const seq = (route.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
                return (
                  <RouteDispatchPanel
                    key={route.id}
                    route={{
                      id:                route.id,
                      name:              route.name,
                      status:            route.status,
                      waveName:          route.wave?.name ?? null,
                      driver:            route.driver,
                      stopCount:         route.stopCount,
                      totalWeightKg:     route.totalWeightKg,
                      estimatedReturnAt: route.estimatedReturnAt?.toISOString() ?? null,
                      sequenceJson:      seq,
                    }}
                    stopsMeta={routeStopsMetaMapped.filter((m) =>
                      seq.some((s) => s.deliveryRequestId === m.deliveryRequestId),
                    )}
                  />
                );
              })}
            </>
          )}

          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mt-2">
            <Package className="w-4 h-4 text-orange-500" />
            Prontos para despacho individual
            {readyForDispatch.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5 rounded-full">
                {readyForDispatch.length}
              </span>
            )}
          </h2>

          {readyForDispatch.length === 0 ? (
            <EmptyState
              icon={CheckCircle}
              title="Nenhuma solicitação aguardando despacho"
            />
          ) : (
            readyForDispatch.map((req) => (
              <div key={req.id} className={cn(
                "bg-white rounded-xl border p-5",
                req.deliveryType === "URGENT" ? "border-red-200 bg-red-50/20" : "border-gray-200"
              )}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">
                        {req.orderNumber
                          ? `PD ${req.orderNumber} · ${req.store.code}`
                          : req.invoiceNumber
                          ? `NF ${req.invoiceNumber}`
                          : `#${req.id.slice(-6)}`}
                      </span>
                      {req.deliveryType === "URGENT" && (
                        <span className="flex items-center gap-0.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                          <Zap className="w-2.5 h-2.5" /> Urgente
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Loja {req.store.code} • {req.seller.name}
                    </p>
                  </div>
                  <div className="text-right">
                    {req.freightQuote && (
                      <p className="text-sm font-semibold text-gray-900">
                        {req.freightQuote.distanceKm.toFixed(1)} km
                      </p>
                    )}
                    <p className="text-xs text-gray-400">{formatRelativeTime(req.createdAt)}</p>
                  </div>
                </div>

                {req.freightQuote && (
                  <div className="flex items-center gap-3 mb-4 text-xs text-gray-500">
                    <span>Frete sugerido: <strong className="text-gray-900">{formatCurrency(req.freightQuote.suggestedPrice)}</strong></span>
                    <span>•</span>
                    <span>Tipo: <strong className="text-gray-900">
                      {req.deliveryType === "URGENT" ? "Lalamove recomendado" : "Rota interna"}
                    </strong></span>
                  </div>
                )}

                {req.nfLinkError === "PARTIAL_BILLING" && (
                  <AlertBanner
                    variant="warning"
                    title="Faturamento parcial — verificar antes de despachar"
                    description="Alguns itens deste PD ainda não foram faturados. O sistema tentará vincular a NF automaticamente."
                  />
                )}
                {req.nfLinkError === "MULTIPLE_NF" && (
                  <AlertBanner
                    variant="danger"
                    title="Múltiplas NFs — confirmação necessária"
                    description="Este PD gerou mais de uma NF. Confirme abaixo que a situação foi verificada antes de despachar."
                  />
                )}
                {req.nfLinkError === "PD_CANCELLED_IN_CITEL" && (
                  <AlertBanner
                    variant="danger"
                    title="PD cancelado no Autcom"
                    description="Verificar com a loja se houve novo pedido antes de prosseguir com o despacho."
                  />
                )}
                <DispatchActionPanel
                  deliveryRequestId={req.id}
                  deliveryType={req.deliveryType}
                  nfLinkError={req.nfLinkError}
                  drivers={drivers.map((d) => ({
                    id: d.id,
                    name: d.name,
                    available: d.available,
                    storeCode: d.store.code,
                  }))}
                />
              </div>
            ))
          )}

          {/* Despachos em andamento */}
          {dispatches.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mt-6">
                <Truck className="w-4 h-4 text-blue-500" />
                Em andamento
              </h2>
              {dispatches.map((dispatch) => (
                <div key={dispatch.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded-full",
                        dispatch.modal === "LALAMOVE"
                          ? "bg-purple-100 text-purple-700"
                          : dispatch.modal === "INTERNAL_ROUTE"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                      )}>
                        {DISPATCH_MODAL_LABELS[dispatch.modal]}
                      </span>
                      <span className="text-xs text-gray-400">{formatRelativeTime(dispatch.createdAt)}</span>
                    </div>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      dispatch.status === "IN_TRANSIT"
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-yellow-100 text-yellow-700"
                    )}>
                      {dispatch.status === "IN_TRANSIT" ? "Em trânsito" : "Aguardando"}
                    </span>
                  </div>

                  {dispatch.deliveryRequest && (
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">NF {dispatch.deliveryRequest.invoiceNumber}</span>
                      {" — "}{dispatch.deliveryRequest.customerName}
                    </p>
                  )}
                  {dispatch.transfer && (
                    <p className="text-sm text-gray-700 flex items-center gap-1.5">
                      <ArrowLeftRight className="w-3.5 h-3.5 text-gray-400" />
                      Transferência {dispatch.transfer.fromStore.code} → {dispatch.transfer.toStore.code}
                    </p>
                  )}
                  {dispatch.driver && (
                    <p className="text-xs text-gray-400 mt-1">
                      Motorista: {dispatch.driver.name} — {dispatch.driver.phone}
                    </p>
                  )}
                  {dispatch.lalamoveOrder && (
                    <p className="text-xs text-gray-400 mt-1">
                      Lalamove: {dispatch.lalamoveOrder.status}
                      {dispatch.lalamoveOrder.driverName && ` — ${dispatch.lalamoveOrder.driverName}`}
                    </p>
                  )}
                  {dispatch.estimatedCost && (
                    <p className="text-xs text-gray-500 mt-1">
                      Custo previsto: {formatCurrency(dispatch.estimatedCost)}
                    </p>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Painel de motoristas */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-green-500" />
            Motoristas
          </h2>
          <div className="space-y-2">
            {drivers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Nenhum motorista cadastrado</p>
            ) : (
              drivers.map((driver) => (
                <div
                  key={driver.id}
                  className={cn(
                    "bg-white rounded-xl border p-4",
                    driver.available ? "border-green-200" : "border-gray-200"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{driver.name}</p>
                      <p className="text-xs text-gray-400">
                        Loja {driver.store.code} • {driver.vehicleType ?? "veículo"}
                      </p>
                    </div>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      driver.available ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    )}>
                      {driver.available ? "Disponível" : "Em rota"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
