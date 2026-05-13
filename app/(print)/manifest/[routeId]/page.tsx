import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PrintTrigger from "./_components/print-trigger";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"];

interface SequenceStop {
  stopPosition:      number | null;
  deliveryRequestId: string;
  eta:               string | number | null;
}

export default async function ManifestPrintPage({
  params,
}: {
  params: { routeId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.role)) redirect("/dashboard");

  const route = await prisma.route.findUnique({
    where: { id: params.routeId },
    include: {
      driver: { select: { name: true, phone: true, vehicleType: true, licensePlate: true } },
      wave:   { select: { name: true, date: true } },
    },
  });
  if (!route) notFound();

  const sequence = (route.sequenceJson as unknown as SequenceStop[] | null) ?? [];
  const drIds = sequence.map((s) => s.deliveryRequestId);

  const stopsMeta = drIds.length > 0
    ? await prisma.deliveryRequest.findMany({
        where: { id: { in: drIds } },
        select: {
          id:                true,
          orderNumber:       true,
          invoiceNumber:     true,
          customerName:      true,
          customerPhone:     true,
          deliveryAddress:   true,
          deliveryComplement: true,
          deliveryCity:      true,
          totalWeightKg:     true,
          totalLatas:        true,
          notes:             true,
        },
      })
    : [];
  const metaMap = new Map(stopsMeta.map((s) => [s.id, s]));

  const ordered = sequence
    .slice()
    .sort((a, b) => (a.stopPosition ?? 0) - (b.stopPosition ?? 0));

  const totalPeso = stopsMeta.reduce((s, m) => s + (m.totalWeightKg ?? 0), 0);
  const totalLatas = stopsMeta.reduce((s, m) => s + (m.totalLatas ?? 0), 0);

  const dateStr = (route.wave?.date ?? route.date).toLocaleDateString("pt-BR", { timeZone: "UTC" });

  return (
    <>
      <PrintTrigger />

      <div className="max-w-3xl mx-auto p-8 print:p-4 print:max-w-none">
        {/* Cabeçalho */}
        <header className="border-b-2 border-black pb-3 mb-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Manifesto de Carga</h1>
              <p className="text-sm text-gray-700 mt-0.5">Mestre da Pintura · Logística</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold">{dateStr}</p>
              <p className="text-gray-600">{route.wave?.name ?? route.name ?? "Rota"}</p>
            </div>
          </div>
        </header>

        {/* Motorista + KPIs */}
        <section className="grid grid-cols-3 gap-4 mb-6 text-sm">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Motorista</p>
            <p className="font-bold text-base">{route.driver.name}</p>
            <p className="text-xs text-gray-600">{route.driver.phone}</p>
            {(route.driver.vehicleType || route.driver.licensePlate) && (
              <p className="text-xs text-gray-600">
                {route.driver.vehicleType ?? "—"}
                {route.driver.licensePlate && ` · ${route.driver.licensePlate}`}
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Carga</p>
            <p className="font-bold text-base">{ordered.length} parada{ordered.length !== 1 ? "s" : ""}</p>
            <p className="text-xs text-gray-600">{totalLatas} latas · {totalPeso.toFixed(0)} kg</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Retorno previsto</p>
            <p className="font-bold text-base">
              {route.estimatedReturnAt
                ? route.estimatedReturnAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                : "—"}
            </p>
          </div>
        </section>

        {/* Sequência de paradas */}
        <ol className="border-2 border-black">
          {ordered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-500 italic">
              Rota sem paradas registradas
            </li>
          )}
          {ordered.map((stop, idx) => {
            const meta = metaMap.get(stop.deliveryRequestId);
            // Regra: depois que NF é vinculada, o documento físico que vai com a carga é a NF.
            // Sem NF, mostra o PD como referência interna.
            const docLabel = meta?.invoiceNumber
              ? `NF ${meta.invoiceNumber}`
              : meta?.orderNumber
                ? `PD ${meta.orderNumber}`
                : `#${stop.deliveryRequestId.slice(-6)}`;
            const etaStr = stop.eta
              ? new Date(stop.eta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
              : null;

            return (
              <li
                key={`${stop.deliveryRequestId}-${idx}`}
                className="grid grid-cols-[3rem_1fr_8rem] gap-3 px-4 py-3 border-b border-gray-300 last:border-b-0 break-inside-avoid"
              >
                {/* Número grande da parada */}
                <div className="flex items-center justify-center">
                  <span className="w-10 h-10 rounded-full bg-black text-white text-base font-bold flex items-center justify-center">
                    {stop.stopPosition ?? idx + 1}
                  </span>
                </div>

                {/* Bloco principal */}
                <div className="min-w-0">
                  <p className="text-base font-bold">
                    {docLabel}
                    {meta && <span className="ml-2 font-normal text-gray-800">· {meta.customerName}</span>}
                  </p>
                  <p className="text-sm text-gray-800 mt-0.5">
                    {meta?.deliveryAddress ?? "—"}
                    {meta?.deliveryComplement && ` — ${meta.deliveryComplement}`}
                    {meta?.deliveryCity && ` · ${meta.deliveryCity}`}
                  </p>
                  {meta?.customerPhone && (
                    <p className="text-xs text-gray-700 mt-0.5">📞 {meta.customerPhone}</p>
                  )}
                  {meta?.notes && (
                    <p className="text-xs text-gray-700 mt-1 italic border-l-2 border-gray-400 pl-2">
                      {meta.notes}
                    </p>
                  )}
                </div>

                {/* Lateral direita: peso + ETA */}
                <div className="text-right text-xs text-gray-700 space-y-0.5">
                  {meta?.totalLatas != null && meta.totalLatas > 0 && <p>{meta.totalLatas} latas</p>}
                  {meta?.totalWeightKg != null && <p>{meta.totalWeightKg.toFixed(0)} kg</p>}
                  {etaStr && <p className="font-semibold text-black">{etaStr}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
