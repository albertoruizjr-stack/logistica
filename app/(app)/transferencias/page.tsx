import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listTransfers } from "@/services/transferencia.service";
import { TransferStatus, TransferPriority } from "@prisma/client";
import {
  TRANSFER_PRIORITY_LABELS, TRANSFER_PRIORITY_COLORS,
} from "@/lib/constants";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  ArrowLeftRight, Plus, Package,
} from "lucide-react";
import Link from "next/link";
import { TransferActionsPanel } from "@/components/transferencias/transfer-actions";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";
import TransferenciasFilters from "./_components/transferencias-filters";

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
      <PageHeader
        title="Transferências"
        description={`${total} transferência${total !== 1 ? "s" : ""} no filtro atual`}
        actions={
          <>
            {urgentCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                {urgentCount} urgente{urgentCount > 1 ? "s" : ""}
              </span>
            )}
            <Link
              href="/transferencias/nova"
              className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition"
            >
              <Plus className="w-4 h-4" />
              Nova transferência
            </Link>
          </>
        }
      />

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

      <Suspense
        fallback={<div className="h-12 bg-slate-50 border border-slate-200 rounded-lg animate-pulse mb-5" />}
      >
        <TransferenciasFilters stores={stores} />
      </Suspense>

      {/* Lista de transferências */}
      {transfers.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Nenhuma transferência no filtro selecionado"
          description="Crie uma nova transferência ou ajuste os filtros."
        />
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
                  <StatusBadge status={transfer.status as StatusVariant} />
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
