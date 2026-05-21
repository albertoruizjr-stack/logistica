import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, AlertTriangle, Package } from "lucide-react";
import { isTransferPickupStop, type RouteSequenceEntry } from "@/lib/route-sequence";
import { isTransferCollectPhotoRequired } from "@/services/system-config.service";
import ColetaActions from "./_components/coleta-actions";

// Tela de coleta de transferências de UMA loja de origem numa rota do motorista.
// Rota: /motorista/coleta/[routeId]?store={storeId}
export default async function ColetaPage({
  params,
  searchParams,
}: {
  params: { routeId: string };
  searchParams: { store?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "DRIVER") redirect("/dashboard");

  const driver = await prisma.driver.findFirst({
    where:  { userId: session.userId },
    select: { id: true },
  });
  if (!driver) redirect("/motorista");

  const storeId = searchParams.store;

  // Carrega a rota e confirma que é do motorista logado.
  const route = await prisma.route.findUnique({
    where:  { id: params.routeId },
    select: { id: true, driverId: true, sequenceJson: true },
  });

  if (!route || route.driverId !== driver.id) {
    return (
      <ColetaErro mensagem="Essa rota não está atribuída pra você." />
    );
  }

  const sequence = (route.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];

  // Acha a parada de coleta da loja indicada (ou a única, se não veio store).
  const pickupStops = sequence.filter(isTransferPickupStop);
  const stop = storeId
    ? pickupStops.find((s) => s.storeId === storeId)
    : pickupStops.length === 1
      ? pickupStops[0]
      : undefined;

  if (!stop) {
    return <ColetaErro mensagem="Parada de coleta não encontrada nessa rota." />;
  }

  const transferIds = (stop.transferIds ?? []).filter((id) => Boolean(id));
  if (transferIds.length === 0) {
    return <ColetaErro mensagem="Nenhuma transferência nessa parada de coleta." />;
  }

  // Carrega as transferências da parada (documento + itens + loja de origem).
  const transfers = await prisma.transfer.findMany({
    where: { id: { in: transferIds } },
    select: {
      id:            true,
      teNumber:      true,
      nfCitelNumero: true,
      status:        true,
      fromStore:     { select: { code: true, name: true } },
      _count:        { select: { items: true } },
    },
  });

  const fromStore = transfers[0]?.fromStore ?? null;
  const requirePhoto = await isTransferCollectPhotoRequired();

  // Já coletadas (IN_TRANSIT/RECEIVED) não são selecionáveis de novo.
  const pendentes = transfers.filter((t) => t.status === "APPROVED" || t.status === "PREPARED");
  const jaColetadas = transfers.filter((t) => t.status === "IN_TRANSIT" || t.status === "RECEIVED");

  return (
    <div className="space-y-4">
      <Link
        href="/motorista"
        className="inline-flex items-center gap-1 text-sm text-orange-600 hover:underline"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar
      </Link>

      {/* Cabeçalho */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Coleta de transferência</p>
        <h1 className="text-xl font-bold text-gray-900 mt-0.5 flex items-center gap-2">
          <Package className="w-5 h-5 text-indigo-600" />
          {fromStore ? `Loja ${fromStore.code} — ${fromStore.name}` : "Coleta"}
        </h1>
        <p className="text-sm text-gray-700 mt-1">
          {transfers.length} transferência{transfers.length > 1 ? "s" : ""} nesta parada
        </p>
      </div>

      {jaColetadas.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm">
          <p className="font-semibold text-green-800">
            {jaColetadas.length} já coletada{jaColetadas.length > 1 ? "s" : ""}
          </p>
          <ul className="mt-1 space-y-0.5 text-green-700 text-xs">
            {jaColetadas.map((t) => (
              <li key={t.id}>{docLabel(t)} · {t._count.items} {t._count.items === 1 ? "item" : "itens"}</li>
            ))}
          </ul>
        </div>
      )}

      {pendentes.length > 0 ? (
        <ColetaActions
          routeId={route.id}
          requirePhoto={requirePhoto}
          transfers={pendentes.map((t) => ({
            id:       t.id,
            doc:      docLabel(t),
            itemCount: t._count.items,
          }))}
        />
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-6 text-center text-sm text-gray-600">
          Todas as transferências dessa parada já foram coletadas.
        </div>
      )}
    </div>
  );
}

// Rótulo do documento: TE prevalece, senão NF, senão ID curto.
function docLabel(t: { teNumber: string | null; nfCitelNumero: string | null; id: string }): string {
  if (t.teNumber)      return `TE ${t.teNumber}`;
  if (t.nfCitelNumero) return `NF ${t.nfCitelNumero}`;
  return `#${t.id.slice(-6)}`;
}

function ColetaErro({ mensagem }: { mensagem: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
      <AlertTriangle className="w-5 h-5 text-amber-600 mb-2" />
      <p className="font-semibold text-amber-900">Coleta indisponível</p>
      <p className="text-amber-800 text-xs mt-1">{mensagem}</p>
      <Link href="/motorista" className="text-xs text-orange-600 underline mt-3 inline-block">
        ← Voltar pra minhas rotas
      </Link>
    </div>
  );
}
