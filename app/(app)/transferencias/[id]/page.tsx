import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { TransferStatus, TransferPriority } from "@prisma/client";
import {
  TRANSFER_STATUS_LABELS,
  TRANSFER_STATUS_COLORS,
  TRANSFER_PRIORITY_LABELS,
  TRANSFER_PRIORITY_COLORS,
} from "@/lib/constants";
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils";
import {
  ArrowLeftRight, ArrowLeft, Package, Clock, CheckCircle2,
  AlertTriangle, Truck, XCircle, User, FileText, Box,
  MapPin, Calendar, ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { TransferActionsPanel } from "@/components/transferencias/transfer-actions";

// ícone e cor de cada evento da timeline — fluxo de 5 etapas + legados
const TIMELINE_CONFIG: Record<TransferStatus, {
  icon: React.ElementType;
  bgColor: string;
  borderColor: string;
  iconColor: string;
}> = {
  // Fluxo novo de 5 etapas
  PENDING:           { icon: Clock,        bgColor: "bg-yellow-50", borderColor: "border-yellow-200", iconColor: "text-yellow-600" },
  AWAITING_APPROVAL: { icon: FileText,     bgColor: "bg-amber-50",  borderColor: "border-amber-200",  iconColor: "text-amber-700"  },
  READY_TO_COLLECT:  { icon: CheckCircle2, bgColor: "bg-teal-50",   borderColor: "border-teal-200",   iconColor: "text-teal-600"   },
  IN_TRANSIT:        { icon: Truck,        bgColor: "bg-orange-50", borderColor: "border-orange-200", iconColor: "text-orange-600" },
  DELIVERED:         { icon: CheckCircle2, bgColor: "bg-green-50",  borderColor: "border-green-200",  iconColor: "text-green-600"  },
  CANCELLED:         { icon: XCircle,      bgColor: "bg-gray-50",   borderColor: "border-gray-200",   iconColor: "text-gray-500"   },
  // Legados — preservados pra timeline de transferências antigas
  APPROVED:          { icon: CheckCircle2, bgColor: "bg-blue-50",   borderColor: "border-blue-200",   iconColor: "text-blue-600"   },
  PREPARING:         { icon: Box,          bgColor: "bg-purple-50", borderColor: "border-purple-200", iconColor: "text-purple-600" },
  PREPARED:          { icon: CheckCircle2, bgColor: "bg-teal-50",   borderColor: "border-teal-200",   iconColor: "text-teal-600"   },
  RECEIVED:          { icon: CheckCircle2, bgColor: "bg-green-50",  borderColor: "border-green-200",  iconColor: "text-green-600"  },
};

export default async function TransferenciaDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER", "SELLER"].includes(session.role)) {
    redirect("/dashboard");
  }

  const transfer = await prisma.transfer.findUnique({
    where: { id: params.id },
    include: {
      fromStore: true,
      toStore: true,
      requestedBy: { select: { id: true, name: true, email: true } },
      approvedBy:  { select: { id: true, name: true } },
      items: { orderBy: { createdAt: "asc" } },
      deliveryRequest: {
        select: {
          id: true,
          invoiceNumber: true,
          customerName: true,
          status: true,
        },
      },
      dispatch: {
        include: { driver: { select: { id: true, name: true, phone: true } } },
      },
      history: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!transfer) notFound();

  // calcula duração total (da solicitação até o estado atual)
  const durationMs = Date.now() - transfer.requestedAt.getTime();
  const durationHours = Math.floor(durationMs / 3_600_000);
  const durationMinutes = Math.floor((durationMs % 3_600_000) / 60_000);

  // busca nomes dos usuários que fizeram transições (changedById)
  const changedByIds = Array.from(
    new Set(transfer.history.map((h) => h.changedById).filter(Boolean) as string[])
  );
  const changedByUsers = changedByIds.length
    ? await prisma.user.findMany({
        where: { id: { in: changedByIds } },
        select: { id: true, name: true },
      })
    : [];
  const userMap = new Map(changedByUsers.map((u) => [u.id, u.name]));

  const isFinished =
    transfer.status === TransferStatus.DELIVERED ||
    transfer.status === TransferStatus.RECEIVED ||  // legado terminal
    transfer.status === TransferStatus.CANCELLED;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Voltar */}
      <Link
        href="/transferencias"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para transferências
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            {transfer.fromStore ? (
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold bg-gray-100 text-gray-800 px-3 py-1 rounded-lg">
                  {transfer.fromStore.code}
                </span>
                <ArrowLeftRight className="w-5 h-5 text-gray-400" />
                <span className="text-lg font-bold bg-gray-100 text-gray-800 px-3 py-1 rounded-lg">
                  {transfer.toStore.code}
                </span>
              </div>
            ) : (
              <span className="text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                🏪 Loja {transfer.toStore.code} precisa — aguarda indicação de origem
              </span>
            )}
            <span className={cn(
              "text-sm px-2.5 py-1 rounded-full font-medium border",
              TRANSFER_PRIORITY_COLORS[transfer.priority]
            )}>
              {TRANSFER_PRIORITY_LABELS[transfer.priority]}
            </span>
            <span className={cn(
              "text-sm px-2.5 py-1 rounded-full font-medium border",
              TRANSFER_STATUS_COLORS[transfer.status]
            )}>
              {TRANSFER_STATUS_LABELS[transfer.status]}
            </span>
          </div>
          <p className="text-sm text-gray-500">
            Solicitada {formatRelativeTime(transfer.requestedAt)} ·{" "}
            {durationHours > 0
              ? `${durationHours}h ${durationMinutes}min no total`
              : `${durationMinutes}min no total`}
          </p>
        </div>
        <p className="text-xs text-gray-400 font-mono">{transfer.id}</p>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Coluna esquerda: timeline + itens */}
        <div className="col-span-2 space-y-5">

          {/* Timeline */}
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <h2 className="font-semibold text-gray-800">Linha do tempo</h2>
            </div>
            <div className="p-5">
              <ol className="relative border-l-2 border-gray-100 space-y-0 ml-3">
                {transfer.history.map((event, idx) => {
                  const cfg = TIMELINE_CONFIG[event.toStatus];
                  const Icon = cfg.icon;
                  const isLast = idx === transfer.history.length - 1;
                  const changedByName = event.changedById
                    ? userMap.get(event.changedById) ?? "Sistema"
                    : "Sistema";

                  return (
                    <li key={event.id} className="relative pl-8 pb-6 last:pb-0">
                      {/* bolinha no eixo */}
                      <div className={cn(
                        "absolute -left-[1.15rem] w-9 h-9 rounded-full border-2 flex items-center justify-center",
                        cfg.bgColor, cfg.borderColor,
                        isLast && !isFinished ? "ring-2 ring-offset-1 ring-orange-300" : ""
                      )}>
                        <Icon className={cn("w-4 h-4", cfg.iconColor)} />
                      </div>

                      {/* conteúdo */}
                      <div className="ml-2">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-gray-800 text-sm">
                            {event.fromStatus
                              ? `${TRANSFER_STATUS_LABELS[event.fromStatus]} → ${TRANSFER_STATUS_LABELS[event.toStatus]}`
                              : TRANSFER_STATUS_LABELS[event.toStatus]}
                          </span>
                          {isLast && !isFinished && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                              atual
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span>{formatDateTime(event.createdAt)}</span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {changedByName}
                          </span>
                        </div>
                        {event.notes && (
                          <p className="text-sm text-gray-600 mt-1.5 italic">
                            "{event.notes}"
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}

                {/* eventos futuros (placeholder) — fluxo de 5 etapas */}
                {!isFinished &&
                  Object.entries(TIMELINE_CONFIG)
                    .filter(([status]) => {
                      const ORDER: TransferStatus[] = [
                        TransferStatus.PENDING,
                        TransferStatus.AWAITING_APPROVAL,
                        TransferStatus.READY_TO_COLLECT,
                        TransferStatus.IN_TRANSIT,
                        TransferStatus.DELIVERED,
                      ];
                      const currentIdx = ORDER.indexOf(transfer.status);
                      // status legado (APPROVED/PREPARED/...) mapeia para READY_TO_COLLECT
                      const effectiveCurrentIdx = currentIdx >= 0
                        ? currentIdx
                        : ORDER.indexOf(TransferStatus.READY_TO_COLLECT);
                      const thisIdx = ORDER.indexOf(status as TransferStatus);
                      return thisIdx > effectiveCurrentIdx;
                    })
                    .map(([status, cfg]) => {
                      const Icon = cfg.icon;
                      return (
                        <li key={status} className="relative pl-8 pb-6 last:pb-0 opacity-40">
                          <div className={cn(
                            "absolute -left-[1.15rem] w-9 h-9 rounded-full border-2 border-dashed flex items-center justify-center bg-white",
                            cfg.borderColor
                          )}>
                            <Icon className={cn("w-4 h-4", cfg.iconColor)} />
                          </div>
                          <div className="ml-2 pt-2">
                            <span className="text-sm text-gray-400">
                              {TRANSFER_STATUS_LABELS[status as TransferStatus]}
                            </span>
                          </div>
                        </li>
                      );
                    })}
              </ol>
            </div>
          </section>

          {/* Itens da transferência */}
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Package className="w-4 h-4 text-gray-400" />
              <h2 className="font-semibold text-gray-800">
                Itens ({transfer.items.length})
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left px-5 py-3">Produto</th>
                  <th className="text-right px-5 py-3">Solicitado</th>
                  <th className="text-right px-5 py-3">Enviado</th>
                  <th className="text-right px-5 py-3">Recebido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transfer.items.map((item) => {
                  const divergence =
                    item.receivedQty != null &&
                    item.sentQty != null &&
                    item.receivedQty !== item.sentQty;

                  return (
                    <tr key={item.id} className={cn(divergence ? "bg-red-50/40" : "")}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">{item.productName}</p>
                        <p className="text-xs text-gray-400 font-mono">{item.productCode}</p>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {item.sentQty != null ? (
                          <span className={cn(
                            item.sentQty < item.quantity ? "text-amber-600" : "text-gray-700"
                          )}>
                            {item.sentQty} {item.unit}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {item.receivedQty != null ? (
                          <span className={cn(
                            divergence ? "text-red-600 font-medium" : "text-green-600"
                          )}>
                            {item.receivedQty} {item.unit}
                            {divergence && " ⚠"}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* Ações (Client Component reutilizado da lista) */}
          {!isFinished && (
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800">Ações</h2>
              </div>
              <div className="p-2">
                <TransferActionsPanel
                  transferId={transfer.id}
                  currentStatus={transfer.status}
                  priority={transfer.priority}
                  toStoreId={transfer.toStoreId}
                />
              </div>
            </section>
          )}
        </div>

        {/* Coluna direita: metadados */}
        <div className="space-y-5">

          {/* Rota */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Rota</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full bg-gray-900 text-white flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold">O</span>
                </div>
                <div>
                  {transfer.fromStore ? (
                    <>
                      <p className="text-sm font-medium text-gray-800">{transfer.fromStore.name}</p>
                      <p className="text-xs text-gray-400">{transfer.fromStore.address}</p>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-amber-700">Aguardando indicação</p>
                  )}
                </div>
              </div>
              <div className="border-l-2 border-dashed border-gray-200 ml-2 h-4" />
              <div className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full bg-orange-500 text-white flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold">D</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{transfer.toStore.name}</p>
                  <p className="text-xs text-gray-400">{transfer.toStore.address}</p>
                </div>
              </div>
            </div>
          </section>

          {/* Fotos de coleta + entrega (quando disponíveis) */}
          {(transfer.collectPhotoUrl || transfer.deliveryPhotoUrl) && (
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Provas fotográficas</h3>
              <div className="grid grid-cols-2 gap-3">
                {transfer.collectPhotoUrl && (
                  <div>
                    <h4 className="text-[11px] font-semibold text-gray-600 mb-1">📸 Coleta</h4>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={transfer.collectPhotoUrl} alt="Coleta" className="rounded-lg border border-gray-200 w-full object-cover aspect-square" />
                    {transfer.collectedAt && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        {formatDateTime(transfer.collectedAt)}
                      </p>
                    )}
                  </div>
                )}
                {transfer.deliveryPhotoUrl && (
                  <div>
                    <h4 className="text-[11px] font-semibold text-gray-600 mb-1">📸 Entrega</h4>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={transfer.deliveryPhotoUrl} alt="Entrega" className="rounded-lg border border-gray-200 w-full object-cover aspect-square" />
                    {transfer.deliveredAt && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        {formatDateTime(transfer.deliveredAt)}
                        {transfer.recipientName && ` — ${transfer.recipientName}`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Pessoas */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Responsáveis</h3>
            <div className="space-y-2.5">
              {transfer.requestedBy && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <div>
                    <p className="text-gray-800 font-medium">{transfer.requestedBy.name}</p>
                    <p className="text-xs text-gray-400">Solicitante</p>
                  </div>
                </div>
              )}
              {transfer.approvedBy && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <div>
                    <p className="text-gray-800 font-medium">{transfer.approvedBy.name}</p>
                    <p className="text-xs text-gray-400">Aprovador</p>
                  </div>
                </div>
              )}
              {transfer.dispatch?.driver && (
                <div className="flex items-center gap-2 text-sm">
                  <Truck className="w-4 h-4 text-orange-400 flex-shrink-0" />
                  <div>
                    <p className="text-gray-800 font-medium">{transfer.dispatch.driver.name}</p>
                    <p className="text-xs text-gray-400">
                      Motorista · {transfer.dispatch.driver.phone}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Datas */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Datas</h3>
            <div className="space-y-2 text-sm">
              {[
                { label: "Solicitada em", date: transfer.requestedAt },
                { label: "Aprovada em",   date: transfer.approvedAt },
                { label: "Preparando em", date: transfer.preparingAt },
                { label: "Despachada em", date: transfer.dispatchedAt },
                { label: "Recebida em",   date: transfer.receivedAt },
                { label: "Cancelada em",  date: transfer.cancelledAt },
                { label: "Previsão chegada", date: transfer.estimatedArrival },
              ]
                .filter((d) => d.date != null)
                .map(({ label, date }) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span className="text-gray-400">{label}</span>
                    <span className="text-gray-700 text-right">
                      {formatDateTime(date!)}
                    </span>
                  </div>
                ))}
            </div>
          </section>

          {/* Solicitação vinculada */}
          {transfer.deliveryRequest && (
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">
                Solicitação vinculada
              </h3>
              <Link
                href={`/solicitacoes/${transfer.deliveryRequest.id}`}
                className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-orange-50 transition-colors group"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800 flex items-center gap-1">
                    <FileText className="w-4 h-4 text-gray-400" />
                    NF {transfer.deliveryRequest.invoiceNumber}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {transfer.deliveryRequest.customerName}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-orange-500 transition-colors" />
              </Link>
            </section>
          )}

          {/* Notas */}
          {(transfer.notes || transfer.internalNotes) && (
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Observações</h3>
              {transfer.notes && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1">Nota do solicitante</p>
                  <p className="text-sm text-gray-700 italic">"{transfer.notes}"</p>
                </div>
              )}
              {transfer.internalNotes && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Nota interna</p>
                  <p className="text-sm text-gray-700 italic">"{transfer.internalNotes}"</p>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
