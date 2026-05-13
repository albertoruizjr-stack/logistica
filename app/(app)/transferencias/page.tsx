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
  view?: string;     // "para-coletar" | "em-rota" — agrupamentos funcionais
  status?: string;   // status pontual (mantido por compat com deeplinks)
  priority?: string;
  fromStore?: string;
  toStore?: string;
}

// Roles que veem tudo (sem auto-filtro por loja)
const GLOBAL_VIEW_ROLES = new Set(["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR", "STOCK_OPERATOR"]);

// Agrupamentos funcionais de status
const VIEW_STATUS_GROUPS: Record<string, TransferStatus[]> = {
  "para-coletar": [TransferStatus.APPROVED, TransferStatus.PREPARING, TransferStatus.PREPARED],
  "em-rota":      [TransferStatus.IN_TRANSIT],
};

// Status considerados "ativos" (default quando nenhum filtro está aplicado)
const ACTIVE_STATUSES: TransferStatus[] = [
  TransferStatus.PENDING,
  TransferStatus.APPROVED,
  TransferStatus.PREPARING,
  TransferStatus.PREPARED,
  TransferStatus.IN_TRANSIT,
];

export default async function TransferenciasPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER", "SELLER"].includes(session.role)) {
    redirect("/dashboard");
  }

  const isGlobalViewer = GLOBAL_VIEW_ROLES.has(session.role);

  // resolve status filtrado a partir de view OU status OU default
  const statusFilter: TransferStatus[] = searchParams.view && VIEW_STATUS_GROUPS[searchParams.view]
    ? VIEW_STATUS_GROUPS[searchParams.view]
    : searchParams.status
      ? [searchParams.status as TransferStatus]
      : ACTIVE_STATUSES;

  // STORE_LEADER e SELLER → auto-filtro pela sua loja (origem OU destino)
  const myUser = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { storeId: true, store: { select: { code: true } } },
  });
  const myStoreCode = myUser?.store?.code ?? null;
  const myStoreId   = myUser?.storeId ?? null;

  const relatedToStoreId = !isGlobalViewer && myStoreId ? myStoreId : undefined;

  const [{ transfers, total }, stores] = await Promise.all([
    listTransfers({
      status: statusFilter,
      priority: searchParams.priority as TransferPriority | undefined,
      fromStoreId: isGlobalViewer ? searchParams.fromStore : undefined,
      toStoreId:   isGlobalViewer ? searchParams.toStore   : undefined,
      relatedToStoreId,
      limit: 50,
    }),
    prisma.store.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  // Contagens por aba — respeitando filtro de loja do usuário.
  // Uma única groupBy substitui 5 counts paralelos (evita esgotar o connection pool).
  const baseWhere = relatedToStoreId
    ? { OR: [{ fromStoreId: relatedToStoreId }, { toStoreId: relatedToStoreId }] }
    : {};

  const countsByStatus = await prisma.transfer.groupBy({
    by:    ["status"],
    where: baseWhere,
    _count: { _all: true },
  });

  const countMap = new Map<TransferStatus, number>(
    countsByStatus.map((c) => [c.status, c._count._all]),
  );
  const sumStatuses = (statuses: TransferStatus[]) =>
    statuses.reduce((sum, s) => sum + (countMap.get(s) ?? 0), 0);

  const countActive        = sumStatuses(ACTIVE_STATUSES);
  const countPending       = countMap.get(TransferStatus.PENDING)  ?? 0;
  const countParaColetar   = sumStatuses(VIEW_STATUS_GROUPS["para-coletar"]);
  const countEmRota        = sumStatuses(VIEW_STATUS_GROUPS["em-rota"]);
  const countRecebidas     = countMap.get(TransferStatus.RECEIVED) ?? 0;

  const urgentCount = transfers.filter((t) => t.priority === TransferPriority.URGENT).length;
  const isAdminOrLogistics = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"].includes(session.role);

  type TabDef = {
    label: string;
    href: string;
    count: number;
    isActive: boolean;
  };

  const currentView = searchParams.view ?? null;
  const currentStatus = searchParams.status ?? null;
  const noFilterActive = !currentView && !currentStatus;

  const tabs: TabDef[] = [
    {
      label: "Todas ativas",
      href: "/transferencias",
      count: countActive,
      isActive: noFilterActive,
    },
    {
      label: "Aguard. aprovação",
      href: "/transferencias?status=PENDING",
      count: countPending,
      isActive: currentStatus === "PENDING",
    },
    {
      label: "Para coletar",
      href: "/transferencias?view=para-coletar",
      count: countParaColetar,
      isActive: currentView === "para-coletar",
    },
    {
      label: "Em rota",
      href: "/transferencias?view=em-rota",
      count: countEmRota,
      isActive: currentView === "em-rota",
    },
    {
      label: "Recebidas",
      href: "/transferencias?status=RECEIVED",
      count: countRecebidas,
      isActive: currentStatus === "RECEIVED",
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Transferências"
        description={
          isGlobalViewer
            ? `${total} transferência${total !== 1 ? "s" : ""} no filtro atual`
            : `${total} transferência${total !== 1 ? "s" : ""} envolvendo a Loja ${myStoreCode ?? "—"}`
        }
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

      {/* Abas funcionais */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5",
              tab.isActive
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-full",
                tab.isActive ? "bg-orange-100 text-orange-700" : "bg-gray-200 text-gray-600"
              )}>
                {tab.count}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Filtros de prioridade e loja — apenas para visão global */}
      {isGlobalViewer && (
        <Suspense
          fallback={<div className="h-12 bg-slate-50 border border-slate-200 rounded-lg animate-pulse mb-5" />}
        >
          <TransferenciasFilters stores={stores} />
        </Suspense>
      )}

      {/* Lista de transferências */}
      {transfers.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Nenhuma transferência no filtro selecionado"
          description={
            isGlobalViewer
              ? "Crie uma nova transferência ou ajuste os filtros."
              : "Nenhuma transferência envolvendo sua loja no momento."
          }
        />
      ) : (
        <div className="space-y-3">
          {transfers.map((transfer) => {
            const isIncoming  = transfer.toStoreId   === myStoreId;
            const isOutgoing  = transfer.fromStoreId === myStoreId;

            return (
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
                      <span className={cn(
                        "text-xs font-bold px-2 py-1 rounded",
                        isOutgoing ? "bg-orange-100 text-orange-800" : "bg-gray-100 text-gray-700"
                      )}>
                        {transfer.fromStore.code}
                      </span>
                      <ArrowLeftRight className="w-3.5 h-3.5 text-gray-400" />
                      <span className={cn(
                        "text-xs font-bold px-2 py-1 rounded",
                        isIncoming ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                      )}>
                        {transfer.toStore.code}
                      </span>
                    </div>
                    {!isGlobalViewer && (isIncoming || isOutgoing) && (
                      <span className="text-[10px] uppercase font-semibold tracking-wide text-gray-400">
                        {isIncoming ? "chegando" : "saindo"}
                      </span>
                    )}
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

                {/* Painel de ações — origem real considerando linkedCitelStoreCode */}
                {(() => {
                  const originStoreCode = transfer.items.find((i) => i.linkedCitelStoreCode)?.linkedCitelStoreCode
                                       ?? transfer.fromStore.code;
                  const canAct = isAdminOrLogistics || myStoreCode === originStoreCode || (isIncoming && session.role === "STORE_LEADER");
                  return (
                    <TransferActionsPanel
                      transferId={transfer.id}
                      currentStatus={transfer.status}
                      priority={transfer.priority}
                      canAct={canAct}
                      originStoreCode={originStoreCode}
                    />
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
