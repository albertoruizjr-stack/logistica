import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listWaves } from "@/services/routing-wave.service";
import { PageHeader, EmptyState } from "@/components/ui";
import { Map, Truck, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import NovaWaveForm from "./_components/nova-wave-form";
import SyncDriversButton from "./_components/sync-drivers-button";
import DeleteWaveButton from "./_components/delete-wave-button";
import { VEHICLE_CAPACITY } from "@/services/citel-stock.service";
import { type RouteSequenceEntry, extractTransferIds } from "@/lib/route-sequence";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

// Resolve capacidade default por tipo (quando Driver.maxLoadKg é null).
// Aceita variações: "moto", "Moto", "MOTO" → MOTO, "fiorino"/"FIORINO" → FIORINO, etc.
function resolveDefaultCapacityKg(vehicleType: string | null): number {
  if (!vehicleType) return 500;
  const normalized = vehicleType.toUpperCase().trim();
  // mapeia variações comuns
  const key =
    normalized.includes("MOTO")     ? "MOTO"     :
    normalized.includes("FIORINO")  ? "FIORINO"  :
    normalized.includes("VAN")      ? "VAN"      :
    normalized.includes("CAMINH")   ? "CAMINHAO" :
    normalized.includes("CARRO")    ? "CARRO"    :
    null;
  if (!key) return 500;
  return VEHICLE_CAPACITY[key as keyof typeof VEHICLE_CAPACITY].maxWeightKg;
}

const WAVE_STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:       { bg: "bg-gray-100",   text: "text-gray-700",   label: "Rascunho" },
  SENT:        { bg: "bg-blue-100",   text: "text-blue-700",   label: "Otimizando" },
  OPTIMIZED:   { bg: "bg-indigo-100", text: "text-indigo-700", label: "Otimizada" },
  DISTRIBUTED: { bg: "bg-green-100",  text: "text-green-700",  label: "Distribuída" },
  DISPATCHED:  { bg: "bg-purple-100", text: "text-purple-700", label: "Despachada" },
  COMPLETED:   { bg: "bg-emerald-100", text: "text-emerald-700", label: "Concluída" },
  FAILED:      { bg: "bg-red-100",    text: "text-red-700",    label: "Falhou" },
};

export default async function RoteirizacaoPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.role)) redirect("/dashboard");

  // Janela do dia (local) — para filtrar rotas candidatas do dia.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const [eligibleRequests, availableDrivers, recentWaves, rawTransfers, activeRoutes] = await Promise.all([
    prisma.deliveryRequest.findMany({
      where: {
        status: "PRONTO_ROTEIRIZACAO",
        deliveryAddress: { not: "" },
      },
      select: {
        id:              true,
        orderNumber:     true,
        invoiceNumber:   true,
        customerName:    true,
        deliveryAddress: true,
        deliveryCity:    true,
        totalWeightKg:   true,
        totalLatas:      true,
        volumeBreakdown: true,
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.driver.findMany({
      where:   { active: true, available: true },
      select: {
        id:            true,
        name:          true,
        vehicleType:   true,
        maxLoadKg:     true,
        spokeDriverId: true,
        email:         true,
      },
      orderBy: { name: "asc" },
    }),
    listWaves({ limit: 10 }),
    // Transferências disponíveis para coleta. APPROVED e PREPARED são ambos
    // "para coletar" até a migração que aposenta PREPARED.
    prisma.transfer.findMany({
      where: {
        status: { in: ["APPROVED", "PREPARED"] },
      },
      select: {
        id:            true,
        teNumber:      true,
        nfCitelNumero: true,
        fromStore:     { select: { id: true, code: true, name: true, lat: true, lng: true } },
        toStore:       { select: { code: true, name: true } },
        _count:        { select: { items: true } },
      },
      orderBy: { requestedAt: "asc" },
      take: 200,
    }),
    // Rotas ativas/despachadas do dia — candidatas para "Incluir na rota" e base
    // para excluir transferências que já estão em alguma rota.
    prisma.route.findMany({
      where: {
        status: { in: ["ACTIVE", "DISPATCHED"] },
        date:   { gte: startOfToday, lte: endOfToday },
      },
      select: {
        id:           true,
        name:         true,
        status:       true,
        sequenceJson: true,
        driver:       { select: { name: true, store: { select: { lat: true, lng: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Conjunto de transferências já presentes em alguma rota ativa (TRANSFER_PICKUP).
  const transferIdsOnRoutes = new Set<string>();
  for (const r of activeRoutes) {
    const seq = (r.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
    for (const id of extractTransferIds(seq)) transferIdsOnRoutes.add(id);
  }

  // Coletas elegíveis = transferências para coletar que NÃO estão em rota ativa.
  const eligibleCollections = rawTransfers
    .filter((t) => !transferIdsOnRoutes.has(t.id))
    .map((t) => ({
      id:            t.id,
      doc:           t.teNumber ? `TE ${t.teNumber}` : t.nfCitelNumero ? `NF ${t.nfCitelNumero}` : `#${t.id.slice(-6)}`,
      fromStoreId:   t.fromStore.id,
      fromStoreCode: t.fromStore.code,
      fromStoreName: t.fromStore.name,
      fromLat:       t.fromStore.lat,
      fromLng:       t.fromStore.lng,
      toStoreCode:   t.toStore.code,
      itemCount:     t._count.items,
    }));

  // Rotas candidatas para o seletor de "Incluir na rota".
  // Pra recomendar o motorista mais próximo, coletamos coords das paradas de entrega
  // da rota (deliveryLat/Lng das DRs) e, como fallback, a coord da loja do motorista.
  const deliveryStopIds = activeRoutes.flatMap((r) => {
    const seq = (r.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
    return seq
      .map((s) => s.deliveryRequestId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  });
  const deliveryCoords =
    deliveryStopIds.length > 0
      ? await prisma.deliveryRequest.findMany({
          where:  { id: { in: deliveryStopIds } },
          select: { id: true, deliveryLat: true, deliveryLng: true },
        })
      : [];
  // Lookup por id (objeto simples — evita colidir com o ícone `Map` do lucide-react).
  const coordById: Record<string, { deliveryLat: number | null; deliveryLng: number | null }> = {};
  for (const d of deliveryCoords) coordById[d.id] = d;

  const candidateRoutes = activeRoutes.map((r) => {
    const seq = (r.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
    const stopCoords: { lat: number; lng: number }[] = [];
    for (const s of seq) {
      if (s.deliveryRequestId) {
        const c = coordById[s.deliveryRequestId];
        if (c?.deliveryLat != null && c?.deliveryLng != null) {
          stopCoords.push({ lat: c.deliveryLat, lng: c.deliveryLng });
        }
      } else if (s.lat != null && s.lng != null) {
        stopCoords.push({ lat: s.lat, lng: s.lng });
      }
    }
    // Fallback: loja do motorista quando não há coords de paradas.
    if (stopCoords.length === 0 && r.driver.store && r.driver.store.lat != null && r.driver.store.lng != null) {
      stopCoords.push({ lat: r.driver.store.lat, lng: r.driver.store.lng });
    }
    return {
      id:         r.id,
      name:       r.name ?? "Rota sem nome",
      status:     r.status,
      driverName: r.driver.name,
      stopCount:  seq.length,
      stopCoords,
    };
  });

  const today = new Date();
  const todayLabel = today.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const period = today.getHours() < 12 ? "Manhã" : today.getHours() < 17 ? "Tarde" : "Noite";
  const suggestedName = `${period} ${todayLabel}`;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Roteirização"
        description={`Crie ondas de entregas otimizadas pelo Spoke · ${eligibleRequests.length} elegíveis · ${eligibleCollections.length} coletas · ${availableDrivers.length} motoristas disponíveis`}
        actions={<SyncDriversButton />}
      />

      <div className="grid grid-cols-3 gap-5">
        {/* Form de nova wave (2/3) */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Map className="w-4 h-4 text-orange-500" />
            Nova wave
          </h2>
          <NovaWaveForm
            suggestedName={suggestedName}
            eligibleRequests={eligibleRequests.map((r) => ({
              ...r,
              volumeBreakdown: (r.volumeBreakdown as Record<string, number> | null) ?? null,
            }))}
            availableDrivers={availableDrivers.map((d) => ({
              id:          d.id,
              name:        d.name,
              vehicleType: d.vehicleType,
              // Resolve capacidade: maxLoadKg do banco > default por vehicleType > 500 genérico.
              maxLoadKg:   d.maxLoadKg ?? resolveDefaultCapacityKg(d.vehicleType),
              hasSpokeId:  Boolean(d.spokeDriverId),
              hasEmail:    Boolean(d.email),
            }))}
            eligibleCollections={eligibleCollections}
            candidateRoutes={candidateRoutes}
          />
        </div>

        {/* Histórico de waves (1/3) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-500" />
            Waves recentes
          </h2>

          {recentWaves.length === 0 ? (
            <EmptyState
              icon={Map}
              title="Nenhuma wave criada ainda"
              description="A primeira wave aparece aqui depois de criada."
            />
          ) : (
            <ul className="space-y-2 max-h-[600px] overflow-y-auto">
              {recentWaves.map((w) => {
                const cfg = WAVE_STATUS_COLORS[w.status] ?? { bg: "bg-gray-100", text: "text-gray-700", label: w.status };
                const driverCount = w.routes.length;
                const stopCount   = w.routes.reduce((s, r) => s + (r.stopCount ?? 0), 0);
                const canDelete = w.status !== "DISPATCHED" && w.status !== "COMPLETED";
                return (
                  <li key={w.id} className="relative group">
                    <Link
                      href={`/roteirizacao/${w.id}`}
                      className="block rounded-lg border border-gray-200 px-3 py-2.5 pr-8 hover:border-orange-300 hover:bg-orange-50/30 transition"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{w.name}</p>
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1",
                          cfg.bg, cfg.text,
                        )}>
                          {w.status === "FAILED" && <AlertTriangle className="w-2.5 h-2.5" />}
                          {w.status === "DISTRIBUTED" && <CheckCircle2 className="w-2.5 h-2.5" />}
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-500">
                        <span className="flex items-center gap-1">
                          <Truck className="w-3 h-3" /> {driverCount} mot.
                        </span>
                        <span>{stopCount} paradas</span>
                        <span className="ml-auto">{formatRelativeTime(w.createdAt)}</span>
                      </div>
                      {w.errorMessage && (
                        <p className="text-[10px] text-red-600 mt-1 truncate">{w.errorMessage}</p>
                      )}
                    </Link>
                    {canDelete && (
                      <div className="absolute top-2 right-2 opacity-50 group-hover:opacity-100 transition-opacity">
                        <DeleteWaveButton waveId={w.id} waveName={w.name} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
