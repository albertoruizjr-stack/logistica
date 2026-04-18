import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listPendingDispatches } from "@/services/despacho.service";
import { prisma } from "@/lib/prisma";
import {
  DISPATCH_MODAL_LABELS, DELIVERY_STATUS_LABELS, DELIVERY_STATUS_COLORS,
  TRANSFER_PRIORITY_LABELS, TRANSFER_PRIORITY_COLORS,
} from "@/lib/constants";
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";
import {
  Truck, Zap, ArrowLeftRight, Package, AlertTriangle,
  Users, Clock, CheckCircle
} from "lucide-react";
import { DispatchActionPanel } from "@/components/despacho/dispatch-actions";

export default async function DespachoPainel() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!["ADMIN", "OPERATOR"].includes(session.role)) {
    redirect("/dashboard");
  }

  const [dispatches, drivers, readyForDispatch] = await Promise.all([
    listPendingDispatches(),
    prisma.driver.findMany({
      where: { active: true },
      include: { store: { select: { code: true } } },
      orderBy: [{ available: "desc" }, { name: "asc" }],
    }),
    // solicitações prontas para despacho mas ainda sem despacho criado
    prisma.deliveryRequest.findMany({
      where: { status: "READY" },
      include: {
        store: { select: { code: true, name: true } },
        freightQuote: { select: { distanceKm: true, deliveryType: true, suggestedPrice: true } },
        seller: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const pendingCount = dispatches.filter((d) => d.status === "PENDING").length;
  const inTransitCount = dispatches.filter((d) => d.status === "IN_TRANSIT").length;
  const availableDrivers = drivers.filter((d) => d.available).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Painel de Despacho</h1>
        <p className="text-gray-500 text-sm mt-1">
          Gerencie rotas internas, Lalamove e transferências em andamento
        </p>
      </div>

      {/* Resumo rápido */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Prontos para despacho", value: readyForDispatch.length, icon: Package, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Despachos pendentes", value: pendingCount, icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50" },
          { label: "Em trânsito", value: inTransitCount, icon: Truck, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Motoristas disponíveis", value: availableDrivers, icon: Users, color: "text-green-600", bg: "bg-green-50" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center mb-3", kpi.bg)}>
              <kpi.icon className={cn("w-5 h-5", kpi.color)} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{kpi.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Solicitações prontas para despacho */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Package className="w-4 h-4 text-orange-500" />
            Prontos para despacho
            {readyForDispatch.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5 rounded-full">
                {readyForDispatch.length}
              </span>
            )}
          </h2>

          {readyForDispatch.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 py-10 text-center">
              <CheckCircle className="w-10 h-10 text-green-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Nenhuma solicitação aguardando despacho</p>
            </div>
          ) : (
            readyForDispatch.map((req) => (
              <div key={req.id} className={cn(
                "bg-white rounded-xl border p-5",
                req.deliveryType === "URGENT"
                  ? "border-red-200 bg-red-50/20"
                  : "border-gray-200"
              )}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">NF {req.invoiceNumber}</span>
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

                {/* Ações de despacho */}
                <DispatchActionPanel
                  deliveryRequestId={req.id}
                  deliveryType={req.deliveryType}
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
            {drivers.map((driver) => (
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
                    driver.available
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  )}>
                    {driver.available ? "Disponível" : "Em rota"}
                  </span>
                </div>
              </div>
            ))}
            {drivers.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">
                Nenhum motorista cadastrado
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
