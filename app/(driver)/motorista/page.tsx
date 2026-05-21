import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Truck, MapPin, Clock, CheckCircle2, AlertTriangle, Store } from "lucide-react";
import IniciarRotaButton from "./_components/iniciar-rota-button";

interface SequenceStop {
  stopPosition:       number | null;
  deliveryRequestId?: string;
  type?:              "DELIVERY" | "STORE_VISIT" | "EXTRA_STOP";
  storeId?:           string;
  address?:           string;
  notes?:             string;
  stopId?:            string;
  eta:                string | number | null;
}

export default async function MotoristaHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "DRIVER") redirect("/dashboard");

  const driver = await prisma.driver.findFirst({
    where:   { userId: session.userId },
    select:  { id: true, name: true },
  });

  if (!driver) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
        <AlertTriangle className="w-5 h-5 text-amber-600 mb-2" />
        <p className="font-semibold text-amber-900">Motorista não vinculado</p>
        <p className="text-amber-800 text-xs mt-1">
          Sua conta de motorista ainda não foi configurada no sistema. Avise o operador logístico.
        </p>
      </div>
    );
  }

  // Rotas ativas (ainda não despachadas) e despachadas (em rota) do motorista
  const routes = await prisma.route.findMany({
    where: {
      driverId: driver.id,
      status:   { in: ["ACTIVE", "DISPATCHED"] },
    },
    include: { wave: { select: { name: true, date: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (routes.length === 0) {
    return (
      <div className="text-center py-12">
        <Truck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-lg font-semibold text-gray-700">Nenhuma rota ativa</p>
        <p className="text-sm text-gray-500 mt-1">Sua próxima rota aparece aqui quando for distribuída.</p>
      </div>
    );
  }

  // Coleta IDs de entregas reais (paradas extras não têm deliveryRequestId)
  const allStopIds = routes.flatMap((r) => {
    const seq = (r.sequenceJson as unknown as SequenceStop[] | null) ?? [];
    return seq
      .filter((s) => !s.type || s.type === "DELIVERY")
      .map((s) => s.deliveryRequestId)
      .filter((id): id is string => Boolean(id));
  });

  // Coleta storeIds das paradas extras tipo STORE_VISIT
  const allStoreIds = routes.flatMap((r) => {
    const seq = (r.sequenceJson as unknown as SequenceStop[] | null) ?? [];
    return seq
      .filter((s) => s.type === "STORE_VISIT" && s.storeId)
      .map((s) => s.storeId!);
  });

  const [stopsMeta, stopsStores] = await Promise.all([
    allStopIds.length > 0
      ? prisma.deliveryRequest.findMany({
          where:  { id: { in: allStopIds } },
          select: {
            id:              true,
            status:          true,
            orderNumber:     true,
            invoiceNumber:   true,
            customerName:    true,
            deliveryAddress: true,
          },
        })
      : Promise.resolve([]),
    allStoreIds.length > 0
      ? prisma.store.findMany({
          where:  { id: { in: allStoreIds } },
          select: { id: true, code: true, name: true, address: true },
        })
      : Promise.resolve([]),
  ]);
  const metaMap  = new Map(stopsMeta.map((s) => [s.id, s]));
  const storeMap = new Map(stopsStores.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      {routes.map((route) => {
        const sequence = ((route.sequenceJson as unknown as SequenceStop[] | null) ?? [])
          .slice()
          .sort((a, b) => (a.stopPosition ?? 0) - (b.stopPosition ?? 0));

        const deliveryStops = sequence.filter((s) => !s.type || s.type === "DELIVERY");
        const totalParadas = deliveryStops.length;  // só conta entregas reais
        const entregues = deliveryStops.filter((s) => {
          const m = s.deliveryRequestId ? metaMap.get(s.deliveryRequestId) : null;
          return m?.status === "DELIVERED";
        }).length;

        const isDispatched = route.status === "DISPATCHED";

        return (
          <div key={route.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            {/* Header da rota */}
            <div className={isDispatched ? "px-4 py-3 bg-orange-50 border-b border-orange-200" : "px-4 py-3 bg-blue-50 border-b border-blue-200"}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-base font-bold text-gray-900">{route.wave?.name ?? route.name ?? "Rota"}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {(route.wave?.date ?? route.date).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                    {route.estimatedReturnAt && (
                      <> · retorno {route.estimatedReturnAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-gray-700">{entregues}/{totalParadas}</p>
                  <p className="text-[10px] text-gray-500">entregues</p>
                </div>
              </div>

              {/* Início de rota: botão de foto (não iniciada) ou status "iniciada às" */}
              {route.startedAt ? (
                <p className="mt-2 text-xs font-semibold text-green-700 flex items-center gap-1">
                  <Truck className="w-3.5 h-3.5" />
                  Rota iniciada às {route.startedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              ) : (
                <IniciarRotaButton routeId={route.id} />
              )}
            </div>

            {/* Lista de paradas */}
            <ol className="divide-y divide-gray-100">
              {sequence.map((stop, idx) => {
                const etaStr = stop.eta
                  ? new Date(stop.eta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                  : null;

                // Parada extra (loja ou endereço livre) — não clicável, sem botão "entregar"
                if (stop.type === "STORE_VISIT" || stop.type === "EXTRA_STOP") {
                  const isStore = stop.type === "STORE_VISIT";
                  const store = isStore && stop.storeId ? storeMap.get(stop.storeId) : null;
                  const title = isStore
                    ? store ? `Loja ${store.code} — ${store.name}` : "Loja"
                    : "Parada extra";
                  const addr = isStore ? (store?.address ?? "—") : (stop.address ?? "—");
                  return (
                    <li key={stop.stopId ?? `extra-${idx}`} className="bg-indigo-50/60 border-l-2 border-indigo-400">
                      <div className="flex items-start gap-3 px-4 py-3">
                        <span className="w-9 h-9 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                          {stop.stopPosition ?? idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-indigo-900 flex items-center gap-1.5">
                            <Store className="w-3.5 h-3.5" />
                            {title}
                          </p>
                          <p className="text-xs text-indigo-700 mt-0.5 truncate">{addr}</p>
                          {stop.notes && (
                            <p className="text-xs text-indigo-800 mt-1 font-medium">📝 {stop.notes}</p>
                          )}
                        </div>
                        {etaStr && (
                          <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {etaStr}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                }

                // Entrega normal
                const drId = stop.deliveryRequestId!;
                const meta = metaMap.get(drId);
                const docLabel = meta?.invoiceNumber
                  ? `NF ${meta.invoiceNumber}`
                  : meta?.orderNumber
                    ? `PD ${meta.orderNumber}`
                    : `#${drId.slice(-6)}`;
                const isDelivered = meta?.status === "DELIVERED";

                return (
                  <li key={drId}>
                    <Link
                      href={`/motorista/entrega/${drId}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 active:bg-gray-100"
                    >
                      <div className="flex-shrink-0">
                        {isDelivered ? (
                          <span className="w-9 h-9 rounded-full bg-green-500 text-white flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5" />
                          </span>
                        ) : (
                          <span className="w-9 h-9 rounded-full bg-gray-900 text-white text-sm font-bold flex items-center justify-center">
                            {stop.stopPosition ?? idx + 1}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={isDelivered ? "text-sm font-semibold text-gray-500 line-through" : "text-sm font-semibold text-gray-900"}>
                          {docLabel}{meta && ` · ${meta.customerName}`}
                        </p>
                        <p className="text-xs text-gray-600 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{meta?.deliveryAddress ?? "—"}</span>
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {etaStr && (
                          <p className="text-xs font-semibold text-gray-700 flex items-center gap-1 justify-end">
                            <Clock className="w-3 h-3" />
                            {etaStr}
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
