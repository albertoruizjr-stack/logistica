import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { DeliveryRequestStatus, DeliveryType } from "@prisma/client";
import { TRANSFER_PRIORITY_LABELS, TRANSFER_PRIORITY_COLORS, DISPATCH_MODAL_LABELS } from "@/lib/constants";
import { cn, formatCurrency, formatDateTime, formatRelativeTime } from "@/lib/utils";
import {
  ArrowLeft, Package, Truck, User, MapPin, FileText,
  ArrowLeftRight, Clock, CheckCircle2, AlertTriangle,
  Zap, Phone, CreditCard,
} from "lucide-react";
import Link from "next/link";
import { PageHeader, StatusBadge, KeyValueList } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";
import { CancelSolicitacaoButton } from "../_components/cancel-button";

// Ordem linear do ciclo de vida (AWAITING_* são variantes do segundo passo)
const STATUS_STEPS: { status: DeliveryRequestStatus[]; label: string }[] = [
  { status: [DeliveryRequestStatus.PENDING],                                                   label: "Pendente" },
  { status: [DeliveryRequestStatus.AWAITING_ITEMS, DeliveryRequestStatus.AWAITING_TRANSFER],   label: "Separando" },
  { status: [DeliveryRequestStatus.READY],                                                     label: "Pronto" },
  { status: [DeliveryRequestStatus.DISPATCHED],                                                label: "Despachado" },
  { status: [DeliveryRequestStatus.IN_TRANSIT],                                               label: "Em Trânsito" },
  { status: [DeliveryRequestStatus.DELIVERED],                                                 label: "Entregue" },
];

function getStepIndex(status: DeliveryRequestStatus): number {
  return STATUS_STEPS.findIndex((s) => s.status.includes(status));
}

export default async function SolicitacaoDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const request = await prisma.deliveryRequest.findUnique({
    where: { id: params.id },
    include: {
      store:        { select: { id: true, code: true, name: true } },
      orderStore:   { select: { code: true, name: true } },
      invoiceStore: { select: { code: true, name: true } },
      seller:       { select: { id: true, name: true, email: true } },
      freightQuote: {
        include: { zone: { select: { name: true, minKm: true, maxKm: true } } },
      },
      items:     { orderBy: { createdAt: "asc" } },
      transfers: {
        include: {
          fromStore: { select: { code: true } },
          toStore:   { select: { code: true } },
          items:     { select: { id: true } },
        },
        orderBy: { requestedAt: "desc" },
      },
      dispatch: {
        include: {
          driver:        { select: { name: true, phone: true } },
          lalamoveOrder: { select: { status: true, driverName: true, shareLink: true } },
        },
      },
      audit: {
        select: {
          suggestedFreight: true,
          chargedFreight: true,
          freightDeviation: true,
          deviationPercent: true,
          deviationClassification: true,
          justificationRequired: true,
          justification: true,
        },
      },
    },
  });

  if (!request) notFound();

  // role guard: SELLER só vê sua própria loja
  if (session.role === "SELLER" && request.storeId !== session.storeId) {
    redirect("/solicitacoes");
  }

  const isCancelled = request.status === DeliveryRequestStatus.CANCELLED;
  const isDelivered = request.status === DeliveryRequestStatus.DELIVERED;
  const isFinished  = isCancelled || isDelivered;
  const currentStep = getStepIndex(request.status);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link
        href="/solicitacoes"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para solicitações
      </Link>

      <PageHeader
        title={
          request.orderNumber
            ? `PD ${request.orderNumber}${request.orderStore ? ` · Loja ${request.orderStore.code}` : ""}`
            : request.invoiceNumber
              ? `NF ${request.invoiceNumber}`
              : `Solicitação #${request.id.slice(-6)}`
        }
        description={`Loja ${request.store.code} · solicitada ${formatRelativeTime(request.createdAt)}`}
        actions={
          <div className="flex items-center gap-3">
            {!request.invoiceNumber && (
              <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-700 border border-amber-200">
                AGUARDANDO NF
              </span>
            )}
            <CancelSolicitacaoButton
              requestId={request.id}
              invoiceNumber={
                request.orderNumber ?? request.invoiceNumber ?? request.id.slice(-6)
              }
              currentStatus={request.status}
              userRole={session.role}
            />
            {request.deliveryType === DeliveryType.URGENT && (
              <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium border border-red-200">
                <Zap className="w-3 h-3" /> Urgente
              </span>
            )}
            <StatusBadge status={request.status as StatusVariant} size="md" showIcon />
          </div>
        }
      />

      {/* Barra de progresso */}
      {!isCancelled && (
        <div className="flex items-center gap-0 mb-8 overflow-x-auto">
          {STATUS_STEPS.map((step, idx) => {
            const done    = idx < currentStep;
            const current = idx === currentStep;
            const future  = idx > currentStep;

            return (
              <div key={idx} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors",
                    done    && "bg-green-500 border-green-500 text-white",
                    current && "bg-orange-500 border-orange-500 text-white ring-2 ring-orange-200",
                    future  && "bg-white border-gray-200 text-gray-400",
                  )}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                  </div>
                  <span className={cn(
                    "text-xs mt-1 whitespace-nowrap font-medium",
                    done    && "text-green-600",
                    current && "text-orange-600",
                    future  && "text-gray-400",
                  )}>
                    {step.label}
                  </span>
                </div>
                {idx < STATUS_STEPS.length - 1 && (
                  <div className={cn(
                    "flex-1 h-0.5 mx-2 mt-[-1rem] transition-colors",
                    done ? "bg-green-400" : "bg-gray-200"
                  )} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {isCancelled && (
        <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-2 text-sm text-gray-500">
          <AlertTriangle className="w-4 h-4 text-gray-400 flex-shrink-0" />
          Esta solicitação foi cancelada.
        </div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Coluna esquerda */}
        <div className="col-span-2 space-y-5">

          {/* Itens */}
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Package className="w-4 h-4 text-gray-400" />
              <h2 className="font-semibold text-gray-800">
                Itens ({request.items.length})
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left px-5 py-3">Produto</th>
                  <th className="text-right px-5 py-3">Qtd</th>
                  <th className="text-center px-5 py-3">Disponível</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {request.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{item.productName}</p>
                      <p className="text-xs text-gray-400 font-mono">{item.productCode}</p>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {item.availableAtStore ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          Na loja
                        </span>
                      ) : (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                          Transferência
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Despacho */}
          {request.dispatch && (
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <Truck className="w-4 h-4 text-gray-400" />
                <h2 className="font-semibold text-gray-800">Despacho</h2>
                <span className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full ml-1",
                  request.dispatch.modal === "LALAMOVE"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-blue-100 text-blue-700"
                )}>
                  {DISPATCH_MODAL_LABELS[request.dispatch.modal]}
                </span>
              </div>
              <div className="p-5">
                <KeyValueList
                  columns={1}
                  items={[
                    ...(request.dispatch.driver ? [{
                      label: "Motorista",
                      value: (
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-gray-400" />
                          {request.dispatch.driver.name}
                          {request.dispatch.driver.phone && (
                            <span className="text-gray-400 font-normal">· {request.dispatch.driver.phone}</span>
                          )}
                        </span>
                      ),
                    }] : []),
                    ...(request.dispatch.lalamoveOrder ? [{
                      label: "Lalamove",
                      value: (
                        <span className="flex items-center gap-2">
                          <span>{request.dispatch.lalamoveOrder.status}</span>
                          {request.dispatch.lalamoveOrder.driverName && (
                            <span className="text-gray-400 font-normal">· {request.dispatch.lalamoveOrder.driverName}</span>
                          )}
                          {request.dispatch.lalamoveOrder.shareLink && (
                            <a
                              href={request.dispatch.lalamoveOrder.shareLink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-orange-600 hover:underline text-xs"
                            >
                              Rastrear →
                            </a>
                          )}
                        </span>
                      ),
                    }] : []),
                    {
                      label: "Criado em",
                      value: formatDateTime(request.dispatch.createdAt),
                    },
                  ]}
                />
              </div>
            </section>
          )}

          {/* Transferências vinculadas */}
          {request.transfers.length > 0 && (
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-gray-400" />
                <h2 className="font-semibold text-gray-800">
                  Transferências vinculadas ({request.transfers.length})
                </h2>
              </div>
              <div className="divide-y divide-gray-50">
                {request.transfers.map((transfer) => (
                  <Link
                    key={transfer.id}
                    href={`/transferencias/${transfer.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-gray-900">
                          {transfer.fromStore.code} → {transfer.toStore.code}
                        </span>
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded border font-medium",
                          TRANSFER_PRIORITY_COLORS[transfer.priority]
                        )}>
                          {TRANSFER_PRIORITY_LABELS[transfer.priority]}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {transfer.items.length} {transfer.items.length === 1 ? "item" : "itens"} ·{" "}
                        {formatRelativeTime(transfer.requestedAt)}
                      </p>
                    </div>
                    <StatusBadge status={transfer.status as StatusVariant} />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Coluna direita */}
        <div className="space-y-5">

          {/* Cliente */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Cliente
            </h3>
            <KeyValueList
              columns={1}
              items={[
                { label: "Nome",    value: request.customerName },
                ...(request.customerPhone ? [{ label: "Telefone", value: (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3 text-gray-400" />
                    {request.customerPhone}
                  </span>
                )}] : []),
                ...(request.customerDoc ? [{ label: "CPF/CNPJ", value: (
                  <span className="flex items-center gap-1">
                    <CreditCard className="w-3 h-3 text-gray-400" />
                    {request.customerDoc}
                  </span>
                )}] : []),
                { label: "Endereço", value: (
                  <span className="flex items-start gap-1">
                    <MapPin className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
                    {request.deliveryAddress}
                  </span>
                ), fullWidth: true },
              ]}
            />
          </section>

          {/* Frete */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3 flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" /> Frete
            </h3>
            <KeyValueList
              columns={1}
              items={[
                ...(request.freightQuote ? [
                  { label: "Sugerido",  value: request.freightQuote.suggestedPrice != null ? formatCurrency(request.freightQuote.suggestedPrice) : "—" },
                  { label: "Distância", value: `${request.freightQuote.distanceKm.toFixed(1)} km` },
                  ...(request.freightQuote.zone ? [{ label: "Zona", value: request.freightQuote.zone.name }] : []),
                ] : []),
                ...(request.chargedFreight != null ? [{
                  label: "Cobrado",
                  value: (
                    <span className={cn(
                      "font-semibold",
                      request.audit?.deviationClassification === "ABOVE_RULE" ? "text-red-600" :
                      request.audit?.deviationClassification === "BELOW_RULE" ? "text-amber-600" :
                      "text-green-600"
                    )}>
                      {formatCurrency(request.chargedFreight)}
                    </span>
                  ),
                }] : []),
                ...(request.totalValue != null ? [{
                  label: "Valor NF",
                  value: formatCurrency(request.totalValue),
                }] : []),
              ]}
            />

            {/* Badge de desvio */}
            {request.audit?.deviationClassification && request.audit.deviationPercent != null && (
              <div className={cn(
                "mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium",
                request.audit.deviationClassification === "ABOVE_RULE"  && "bg-red-50 text-red-700 border border-red-200",
                request.audit.deviationClassification === "WITHIN_RULE" && "bg-green-50 text-green-700 border border-green-200",
                request.audit.deviationClassification === "BELOW_RULE"  && "bg-amber-50 text-amber-700 border border-amber-200",
              )}>
                <span>
                  Desvio: {request.audit.deviationPercent > 0 ? "+" : ""}
                  {request.audit.deviationPercent.toFixed(1)}%
                </span>
                {request.audit.justificationRequired && !request.audit.justification && (
                  <Link href="/auditoria" className="underline ml-1">Justificar →</Link>
                )}
                {request.audit.justification && (
                  <span className="text-green-600">✓ Justificado</span>
                )}
              </div>
            )}
          </section>

          {/* Vendedor + datas */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Informações
            </h3>
            <KeyValueList
              columns={1}
              items={[
                { label: "Vendedor",    value: request.seller.name },
                { label: "Loja",        value: `${request.store.code} — ${request.store.name}` },
                { label: "Criada em",   value: formatDateTime(request.createdAt) },
                ...(request.scheduledFor ? [{
                  label: "Agendada para",
                  value: formatDateTime(request.scheduledFor),
                }] : []),
              ]}
            />
          </section>

          {/* Notas */}
          {request.notes && (
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Observações
              </h3>
              <p className="text-sm text-gray-700 italic">"{request.notes}"</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
