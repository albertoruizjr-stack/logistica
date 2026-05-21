import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DispatchStatus } from "@prisma/client";
import { MapPin } from "lucide-react";
import { DriverCards, type DriverCardData } from "@/components/rastreamento/driver-cards";
import { LalamoveTrackingCards, type LalamoveRide } from "@/components/rastreamento/lalamove-tracking-cards";
import ResyncRoutesButton from "@/components/rastreamento/resync-routes-button";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic"; // sempre busca dados frescos

export default async function RastreamentoPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
    redirect("/dashboard");
  }

  const drivers = await prisma.driver.findMany({
    where: { active: true },
    include: {
      store: { select: { code: true, name: true, lat: true, lng: true } },
      // última localização conhecida
      locations: {
        orderBy: { timestamp: "desc" },
        take: 1,
        select: {
          lat: true,
          lng: true,
          speed: true,
          timestamp: true,
          source: true,
        },
      },
      // despachos ativos (não concluídos, não falhados)
      dispatches: {
        where: {
          status: { in: [DispatchStatus.ASSIGNED, DispatchStatus.IN_TRANSIT] },
        },
        select: {
          id: true,
          modal: true,
          status: true,
          transfer: {
            select: {
              fromStore: { select: { code: true } },
              toStore:   { select: { code: true } },
            },
          },
          deliveryRequest: {
            select: { invoiceNumber: true, customerName: true },
          },
        },
      },
      // rota DISPATCHED atual (uma por vez) — pra mostrar progresso e mapa
      routes: {
        where:   { status: "DISPATCHED" },
        take:    1,
        orderBy: { createdAt: "desc" },
        select: {
          id:                true,
          name:              true,
          sequenceJson:      true,
          stopCount:         true,
          estimatedReturnAt: true,
        },
      },
    },
    orderBy: [
      { available: "asc" }, // ocupados primeiro
      { name: "asc" },
    ],
  });

  // Coleta DRs de todas as rotas em uma query — evita N+1.
  const allRouteStopIds = drivers.flatMap((d) =>
    d.routes.flatMap((r) => {
      const seq = (r.sequenceJson as unknown as Array<{ deliveryRequestId: string }> | null) ?? [];
      return seq.map((s) => s.deliveryRequestId);
    }),
  );

  const routeStopMeta = allRouteStopIds.length > 0
    ? await prisma.deliveryRequest.findMany({
        where:  { id: { in: allRouteStopIds } },
        select: {
          id:              true,
          status:          true,
          invoiceNumber:   true,
          orderNumber:     true,
          customerName:    true,
          deliveryAddress: true,
          deliveryLat:     true,
          deliveryLng:     true,
        },
      })
    : [];
  const stopMetaMap = new Map(routeStopMeta.map((s) => [s.id, s]));

  // serializa para o Client Component (Dates → strings)
  const driverData: DriverCardData[] = drivers.map((d) => {
    const route = d.routes[0] ?? null;
    const seq   = (route?.sequenceJson as unknown as Array<{
      stopPosition: number | null;
      deliveryRequestId: string;
      eta: string | number | null;
    }> | null) ?? [];

    const stops = seq.map((s) => {
      const meta = stopMetaMap.get(s.deliveryRequestId);
      return {
        deliveryRequestId: s.deliveryRequestId,
        stopPosition:      s.stopPosition,
        eta:               s.eta ? new Date(s.eta).toISOString() : null,
        status:            meta?.status ?? "UNKNOWN",
        docLabel:          meta?.invoiceNumber
          ? `NF ${meta.invoiceNumber}`
          : meta?.orderNumber
            ? `PD ${meta.orderNumber}`
            : `#${s.deliveryRequestId.slice(-6)}`,
        customerName:      meta?.customerName ?? null,
        address:           meta?.deliveryAddress ?? null,
        lat:               meta?.deliveryLat ?? null,
        lng:               meta?.deliveryLng ?? null,
      };
    });

    return {
      id: d.id,
      name: d.name,
      phone: d.phone,
      vehicleType: d.vehicleType,
      licensePlate: d.licensePlate,
      available: d.available,
      store: { code: d.store.code, name: d.store.name, lat: d.store.lat, lng: d.store.lng },
      lastLocation: d.locations[0]
        ? {
            lat: d.locations[0].lat,
            lng: d.locations[0].lng,
            speed: d.locations[0].speed,
            timestamp: d.locations[0].timestamp.toISOString(),
            source: d.locations[0].source,
          }
        : null,
      activeRoute: route
        ? {
            id:                route.id,
            name:              route.name,
            stopCount:         route.stopCount ?? stops.length,
            estimatedReturnAt: route.estimatedReturnAt?.toISOString() ?? null,
            stops,
          }
        : null,
      activeDispatches: d.dispatches.map((dp) => ({
        id: dp.id,
        modal: dp.modal,
        status: dp.status,
        transfer: dp.transfer
          ? {
              fromStore: { code: dp.transfer.fromStore.code },
              toStore:   { code: dp.transfer.toStore.code },
            }
          : null,
        deliveryRequest: dp.deliveryRequest
          ? {
              invoiceNumber: dp.deliveryRequest.invoiceNumber ?? "",
              customerName:  dp.deliveryRequest.customerName,
            }
          : null,
      })),
    };
  });

  // Corridas Lalamove ativas — alimentadas pelo webhook (status/motorista/preço)
  const lalamoveOrders = await prisma.lalamoveOrder.findMany({
    where: { internalStatus: { in: [DispatchStatus.PENDING, DispatchStatus.ASSIGNED, DispatchStatus.IN_TRANSIT] } },
    include: { dispatch: { include: { deliveryRequest: { select: { customerName: true, customerPhone: true, deliveryAddress: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  const rides: LalamoveRide[] = lalamoveOrders.map((o) => ({
    orderId: o.lalamoveOrderId,
    vehicle: o.dispatch?.notes?.match(/LALAPRO|UV_FIORINO|VAN|TRUCK330|TRUCK3_5T/)?.[0] ?? "LALAPRO",
    status: o.status,
    driverName: o.driverName, driverPhone: o.driverPhone, driverPlate: o.driverPlate,
    price: o.finalPrice ?? o.estimatedPrice, shareLink: o.shareLink,
    customerName: o.dispatch?.deliveryRequest?.customerName ?? "Cliente",
    customerPhone: o.dispatch?.deliveryRequest?.customerPhone ?? null,
    address: o.dispatch?.deliveryRequest?.deliveryAddress ?? "",
  }));

  const totalActive = driverData.filter(
    (d) => !d.available || d.activeDispatches.length > 0
  ).length;

  // Botão de ressincronização — só para quem pode despachar rotas (Alberto, Jane, operadores)
  const canResync = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"].includes(session.role);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Rastreamento"
        description={`${driverData.length} motorista${driverData.length !== 1 ? "s" : ""} cadastrado${driverData.length !== 1 ? "s" : ""} · atualiza automaticamente a cada 30s`}
        actions={
          <>
            {totalActive > 0 && (
              <span className="bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {totalActive} em rota
              </span>
            )}
            {canResync && <ResyncRoutesButton />}
            <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <MapPin className="w-3.5 h-3.5 text-orange-400" />
              Localização via APP ou GPS
            </div>
          </>
        }
      />

      <DriverCards initialDrivers={driverData} />

      <section className="mt-8">
        <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">
          Corridas Lalamove{rides.length > 0 ? ` (${rides.length})` : ""}
        </h2>
        <LalamoveTrackingCards rides={rides} />
      </section>
    </div>
  );
}
