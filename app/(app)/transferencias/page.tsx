import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { listTransfers } from "@/services/transferencia.service";
import { TransferStatus, TransferPriority } from "@prisma/client";
import {
  TRANSFER_STATUS_LABELS, TRANSFER_STATUS_COLORS,
  TRANSFER_PRIORITY_LABELS, TRANSFER_PRIORITY_COLORS,
} from "@/lib/constants";
import { cn, formatRelativeTime, formatDateTime } from "@/lib/utils";
import {
  ArrowLeftRight, Plus, Package, Clock, CheckCircle2,
  AlertTriangle, Filter
} from "lucide-react";
import Link from "next/link";
import { TransferActionsPanel } from "@/components/transferencias/transfer-actions";

interface SearchParams {
  status?: string;
  priority?: string;
  fromStore?: string;
  toStore?: string;
}

export default async function TransferenciasPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!["ADMIN", "OPERATOR"].includes(session.role)) {
    redirect("/dashboard");
  }

  // define status padrão: todos os não concluídos
  const statusFilter = searchParams.status
    ? [searchParams.status as TransferStatus]
    : [
        TransferStatus.PENDING,
        TransferStatus.APPROVED,
        TransferStatus.PREPARING,
        TransferStatus.IN_TRANSIT,
      ];

  const [{ transfers, total }, stores, countByStatus] = await Promise.all([
    listTransfers({
      status: statusFilter,
      priority: searchParams.priority as TransferPriority | undefined,
      fromStoreId: searchParams.fromStore,
      toStoreId: searchParams.toStore,
      limit: 50,
    }),
    prisma.store.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    // contagem por status para as abas
    Promise.all(
      Object.values(TransferStatus).map(async (s) => ({
        status: s,
        count: await prisma.transfer.count({ where: { status: s } }),
      }))
    ),
  ]);

  const countMap = Object.fromEntries(countByStatus.map((c) => [c.status, c.count]));
  const urgentCount = transfers.filter((t) => t.priority === TransferPriority.URGENT).length;

  const statusTabs = [
    { label: "Todas ativas", value: null },
    { label: "Pendentes", value: TransferStatus.PENDING },
    { label: "Aprovadas", value: TransferStatus.APPROVED },
    { label: "Em preparação", value: TransferStatus.PREPARING },
    { label: "Em trânsito", value: TransferStatus.IN_TRANSIT },
    { label: "Recebidas", value: TransferStatus.RECEIVED },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Transferências</h1>
            {urgentCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                {urgentCount} urgente{urgentCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-gray-500 text-sm mt-1">
            {total} transferência{total !== 1 ? "s" : ""} no filtro atual
          </p>
        </div>
        <Link
          href="/transferencias/nova"
          className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-orange-600 transition"
        >
          <Plus className="w-4 h-4" />
          Nova transferência
        </Link>
      </div>

      {/* Abas de status */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto">
        {statusTabs.map((tab) => {
          const isActive = tab.value === null
            ? !searchParams.status
            : searchParams.status === tab.value;

          const count = tab.value ? countMap[tab.value] ?? 0 : null;

          return (
            <Link
              key={tab.label}
              href={tab.value ? `/transferencias?status=${tab.value}` : "/transferencias"}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5",
                isActive
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {tab.label}
              {count !== null && count > 0 && (
                <span className={cn(
                  "text-xs px-1.5 py-0.5 rounded-full",
                  isActive ? "bg-orange-100 text-orange-700" : "bg-gray-200 text-gray-600"
                )}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Filtros de loja */}
      <div className="flex items-center gap-3 mb-5">
        <Filter className="w-4 h-4 text-gray-400" />
        <div className="flex gap-2">
          {["Todas as lojas", ...stores.map((s) => s.code)].map((code) => (
            <Link
              key={code}
              href={
                code === "Todas as lojas"
                  ? `/transferencias${searchParams.status ? `?status=${searchParams.status}` : ""}`
                  : `/transferencias?${searchParams.status ? `status=${searchParams.status}&` : ""}fromStore=${stores.find((s) => s.code === code)?.id}`
              }
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                (code === "Todas as lojas" && !searchParams.fromStore) ||
                  (code !== "Todas as lojas" &&
                    searchParams.fromStore === stores.find((s) => s.code === code)?.id)
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              )}
            >
              {code}
            </Link>
          ))}
        </div>
      </div>

      {/* Lista de transferências */}
      {transfers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <ArrowLeftRight className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Nenhuma transferência no filtro selecionado</p>
          <p className="text-sm text-gray-400 mt-1">
            Crie uma nova transferência ou ajuste os filtros
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {transfers.map((transfer) => (
            <div
              key={transfer.id}
              className={cn(
                "bg-white rounded-xl border transition-shadow hover:shadow-md",
                transfer.priority === TransferPriority.URGENT
                  ? "border-red-200 bg-red-50/30"
                  : "border-gray-200"
              )}
            >
              {/* Header do card */}
              <div className="flex items-center gap-4 px-5 py-4">
                {/* Rota */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold bg-gray-100 text-gray-700 px-2 py-1 rounded">
                      {transfer.fromStore.code}
                    </span>
                    <ArrowLeftRight className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-bold bg-gray-100 text-gray-700 px-2 py-1 rounded">
                      {transfer.toStore.code}
                    </span>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium border",
                    TRANSFER_PRIORITY_COLORS[transfer.priority]
                  )}>
                    {TRANSFER_PRIORITY_LABELS[transfer.priority]}
                  </span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium border",
                    TRANSFER_STATUS_COLORS[transfer.status]
                  )}>
                    {TRANSFER_STATUS_LABELS[transfer.status]}
                  </span>
                  {transfer.deliveryRequest && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Package className="w-3 h-3" />
                      NF {transfer.deliveryRequest.invoiceNumber}
                    </span>
                  )}
                </div>

                {/* Meta */}
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">
                    {formatRelativeTime(transfer.requestedAt)}
                  </p>
                  <p className="text-xs font-medium text-gray-700 mt-0.5">
                    {transfer.items.length} {transfer.items.length === 1 ? "item" : "itens"}
                  </p>
                </div>

                {/* Link detalhe */}
                <Link
                  href={`/transferencias/${transfer.id}`}
                  className="ml-2 text-xs text-orange-600 hover:underline font-medium flex-shrink-0"
                >
                  Ver detalhes →
                </Link>
              </div>

              {/* Itens */}
              <div className="px-5 pb-3">
                <div className="flex flex-wrap gap-2">
                  {transfer.items.slice(0, 4).map((item) => (
                    <span
                      key={item.id}
                      className="text-xs bg-gray-50 border border-gray-200 text-gray-600 px-2 py-1 rounded"
                    >
                      {item.quantity}× {item.productName}
                    </span>
                  ))}
                  {transfer.items.length > 4 && (
                    <span className="text-xs text-gray-400">
                      +{transfer.items.length - 4} mais
                    </span>
                  )}
                </div>
              </div>

              {/* Ações rápidas (Client Component) */}
              <TransferActionsPanel
                transferId={transfer.id}
                currentStatus={transfer.status}
                priority={transfer.priority}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
