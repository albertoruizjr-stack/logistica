import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, MapPin, Phone, Package, CheckCircle2, AlertTriangle } from "lucide-react";
import DeliveryActions from "./_components/delivery-actions";
import NavigateButton from "./_components/navigate-button";
import { isDeliveryAssignedToDriver } from "@/lib/driver-ownership";
import { isDeliveryPhotoRequired } from "@/services/system-config.service";

export default async function EntregaDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "DRIVER") redirect("/dashboard");

  const driver = await prisma.driver.findFirst({
    where: { userId: session.userId },
    select: { id: true },
  });
  if (!driver) redirect("/motorista");

  const dr = await prisma.deliveryRequest.findUnique({
    where: { id: params.id },
    include: {
      items:  { select: { id: true, productName: true, quantity: true, unit: true } },
      proofs: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!dr) notFound();

  const requirePhoto = await isDeliveryPhotoRequired();

  // Garante que essa entrega pertence ao motorista logado.
  // Considera tanto a Route (fase ROTEIRIZADO) quanto o Dispatch (fase DISPATCHED).
  const isMine = await isDeliveryAssignedToDriver(dr.id, driver.id);
  if (!isMine) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
        <AlertTriangle className="w-5 h-5 text-amber-600 mb-2" />
        <p className="font-semibold text-amber-900">Entrega não é sua</p>
        <p className="text-amber-800 text-xs mt-1">
          Essa entrega não está atribuída pra você.
        </p>
        <Link href="/motorista" className="text-xs text-orange-600 underline mt-3 inline-block">
          ← Voltar pra minhas rotas
        </Link>
      </div>
    );
  }

  const docLabel = dr.invoiceNumber
    ? `NF ${dr.invoiceNumber}`
    : dr.orderNumber
      ? `PD ${dr.orderNumber}`
      : `#${dr.id.slice(-6)}`;

  const isDelivered = dr.status === "DELIVERED";
  const isOccurrence = dr.status === "OCORRENCIA";

  const telHref = dr.customerPhone ? `tel:${dr.customerPhone.replace(/\D/g, "")}` : null;

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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Entrega</p>
            <h1 className="text-xl font-bold text-gray-900 mt-0.5">{docLabel}</h1>
            <p className="text-sm text-gray-700 mt-1">{dr.customerName}</p>
          </div>
          {isDelivered && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
              <CheckCircle2 className="w-3 h-3" />
              Entregue
            </span>
          )}
          {isOccurrence && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
              <AlertTriangle className="w-3 h-3" />
              Ocorrência
            </span>
          )}
        </div>

        {/* Endereço + ações rápidas */}
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
            <p className="text-gray-800">
              {dr.deliveryAddress}
              {dr.deliveryComplement && <><br /><span className="text-gray-600">{dr.deliveryComplement}</span></>}
              {dr.deliveryCity && <><br /><span className="text-gray-600">{dr.deliveryCity}</span></>}
            </p>
          </div>

          <div className="flex gap-2">
            <NavigateButton address={[dr.deliveryAddress, dr.deliveryCity].filter(Boolean).join(", ")} />
            {telHref ? (
              <a
                href={telHref}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold bg-green-500 text-white py-3 rounded-lg active:bg-green-600"
              >
                <Phone className="w-4 h-4" />
                Ligar
              </a>
            ) : (
              <button
                disabled
                className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold bg-gray-200 text-gray-500 py-3 rounded-lg"
              >
                <Phone className="w-4 h-4" />
                Sem telefone
              </button>
            )}
          </div>
        </div>

        {dr.notes && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Observações</p>
            <p className="text-sm text-gray-800 whitespace-pre-line">{dr.notes}</p>
          </div>
        )}
      </div>

      {/* Itens */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2 flex items-center gap-1">
          <Package className="w-3 h-3" />
          Itens ({dr.items.length})
        </p>
        <ul className="space-y-1 text-sm">
          {dr.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <span className="font-semibold text-gray-700 flex-shrink-0">{item.quantity}{item.unit}</span>
              <span className="text-gray-700">{item.productName}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Ações de entrega (apenas se não estiver entregue/cancelado) */}
      {!isDelivered && dr.status !== "CANCELLED" && (
        <DeliveryActions
          deliveryRequestId={dr.id}
          requirePhoto={requirePhoto}
          existingProofs={dr.proofs.map((p) => ({
            id:        p.id,
            type:      p.type,
            photoUrl:  p.photoUrl,
            createdAt: p.createdAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
