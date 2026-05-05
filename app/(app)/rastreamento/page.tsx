import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DispatchStatus } from "@prisma/client";
import { MapPin } from "lucide-react";
import { DriverCards, type DriverCardData } from "@/components/rastreamento/driver-cards";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic"; // sempre busca dados frescos

export default async function RastreamentoPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!["ADMIN", "OPERATOR"].includes(session.role)) {
    redirect("/dashboard");
  }

  const drivers = await prisma.driver.findMany({
    where: { active: true },
    include: {
      store: { select: { code: true, name: true } },
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
    },
    orderBy: [
      { available: "asc" }, // ocupados primeiro
      { name: "asc" },
    ],
  });

  // serializa para o Client Component (Dates → strings)
  const driverData: DriverCardData[] = drivers.map((d) => ({
    id: d.id,
    name: d.name,
    phone: d.phone,
    vehicleType: d.vehicleType,
    licensePlate: d.licensePlate,
    available: d.available,
    store: d.store,
    lastLocation: d.locations[0]
      ? {
          lat: d.locations[0].lat,
          lng: d.locations[0].lng,
          speed: d.locations[0].speed,
          timestamp: d.locations[0].timestamp.toISOString(),
          source: d.locations[0].source,
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
  }));

  const totalActive = driverData.filter(
    (d) => !d.available || d.activeDispatches.length > 0
  ).length;

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
            <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <MapPin className="w-3.5 h-3.5 text-orange-400" />
              Localização via APP ou GPS
            </div>
          </>
        }
      />

      <DriverCards initialDrivers={driverData} />
    </div>
  );
}
