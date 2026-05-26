import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, Truck, Package, Store } from "lucide-react";
import EntregaTransferActions from "./_components/entrega-actions";

export default async function EntregarTransferenciaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "DRIVER") redirect("/dashboard");

  const driver = await prisma.driver.findFirst({
    where:  { userId: session.userId },
    select: { id: true, name: true },
  });
  if (!driver) redirect("/motorista");

  const { id } = await params;
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: {
      fromStore: { select: { code: true, name: true } },
      toStore:   { select: { code: true, name: true, address: true } },
      items:     true,
      dispatch:  { select: { driverId: true } },
    },
  });
  if (!transfer) notFound();
  if (transfer.dispatch?.driverId !== driver.id) {
    // Motorista não pode entregar transferência que não é dele
    redirect("/motorista");
  }

  const item = transfer.items[0]; // auto-split garante 1 item por Transfer
  const isInTransit = transfer.status === "IN_TRANSIT";

  return (
    <div className="space-y-4">
      <Link
        href="/motorista"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-orange-700 font-bold">
          <Truck className="w-4 h-4" />
          Entrega de transferência
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-gray-400 uppercase">Origem</p>
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-1">
              <Store className="w-3.5 h-3.5 text-gray-400" />
              {transfer.fromStore?.code ?? "?"}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase">Destino (entregar aqui)</p>
            <p className="text-sm font-semibold text-orange-700 flex items-center gap-1">
              <Store className="w-3.5 h-3.5 text-orange-400" />
              {transfer.toStore.code} — {transfer.toStore.name}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">{transfer.toStore.address}</p>
          </div>
        </div>
        {item && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
            <p className="text-[10px] text-gray-400 uppercase mb-0.5">Material</p>
            <p className="text-sm font-medium text-gray-800 flex items-center gap-1">
              <Package className="w-3.5 h-3.5 text-gray-400" />
              {item.quantity} {item.unit} · {item.productName}
            </p>
            <p className="text-[10px] text-gray-500 font-mono mt-0.5">{item.productCode}</p>
            {(item.teNumber || item.nfCitelNumero) && (
              <p className="text-[11px] text-gray-600 mt-1">
                Doc: {item.teNumber ? `TE ${item.teNumber}` : `NF ${item.nfCitelNumero}`}
              </p>
            )}
          </div>
        )}
      </div>

      {!isInTransit ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
          <p className="font-semibold text-amber-900">
            Esta transferência não está em rota
          </p>
          <p className="text-amber-800 text-xs mt-1">
            Status atual: <b>{transfer.status}</b>. Só é possível entregar transferências
            em IN_TRANSIT.
          </p>
        </div>
      ) : item ? (
        <EntregaTransferActions
          transferId={transfer.id}
          expectedQty={item.quantity}
          unit={item.unit}
        />
      ) : null}
    </div>
  );
}
