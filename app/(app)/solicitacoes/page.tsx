import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { DeliveryRequestStatus, DeliveryType } from "@prisma/client";
import { StatusTabs } from "./_components/status-tabs";
import { PipelineView } from "./_components/pipeline-view";
import type { SolicitacaoCardData } from "./_components/pipeline-view";
import { NfLinkAdminPanel } from "./_components/nf-link-admin-panel";

// ─── Config de abas ────────────────────────────────────────


// Aba "Ativas" cobre TODO o ciclo de vida operacional até a saída pra rota.
// Inclui as fases novas (Separação, Fiscal, Roteirização) que antes ficavam órfãs.
const ACTIVE_STATUSES: DeliveryRequestStatus[] = [
  "AWAITING_ITEMS", "PENDING", "AWAITING_TRANSFER",
  "SEPARADO",
  "AGUARDANDO_NF", "NF_VINCULADA",
  "PRONTO_ROTEIRIZACAO", "ROTEIRIZADO",
  "READY",
  "OCORRENCIA",
];

const TAB_STATUSES: Record<string, DeliveryRequestStatus[]> = {
  ativas:    ACTIVE_STATUSES,
  rota:      ["DISPATCHED", "IN_TRANSIT"],
  entregues: ["DELIVERED"],
  canceladas: ["CANCELLED"],
};

const TAB_SECTIONS: Record<string, string[]> = {
  ativas:    ACTIVE_STATUSES,
  rota:      ["DISPATCHED", "IN_TRANSIT"],
  entregues: ["DELIVERED"],
  canceladas: ["CANCELLED"],
};

// ─── Ordenação por prioridade ──────────────────────────────
//
// 0 → NF crítica (MULTIPLE_NF, PD_CANCELLED) — risco de despacho sem resolução
// 1 → URGENT
// 2 → PARTIAL_BILLING — risco operacional acima de "entrega hoje"
// 3 → scheduledFor hoje
// 4 → READY parado > 2h
// 5 → AWAITING_ITEMS parado > 30min
// 6 → normal (desempate: mais antiga primeiro)

function priorityOrder(row: SolicitacaoCardData): number {
  const err = row.nfLinkError;

  // 0 — ERP crítico (pedido cancelado/bloqueado no Autcom — risco de despacho indevido)
  if (row.erpAlertSeverity === "CRITICAL") return 0;
  // 1 — erros críticos NF sem revisão
  if (err === "MULTIPLE_NF" || err === "PD_CANCELLED_IN_CITEL") return 1;
  // 2 — urgente
  if (row.deliveryType === DeliveryType.URGENT) return 2;
  // 3 — faturamento parcial ativo (não revisado)
  if (err === "PARTIAL_BILLING") return 3;
  // 4 — entrega hoje
  const today = new Date().toDateString();
  if (row.scheduledFor && new Date(row.scheduledFor).toDateString() === today) return 4;
  // 5 — PD não encontrado (possível número errado)
  if (err === "PD_NOT_FOUND") return 5;
  // 6 — alerta ERP de warning (itens/endereço alterados)
  if (row.erpAlertCount > 0) return 6;
  // 7 — READY parado > 2h
  const ageMs = Date.now() - new Date(row.createdAt).getTime();
  if (row.status === "READY"          && ageMs > 2 * 3_600_000) return 7;
  // 8 — AWAITING_ITEMS parado > 30min
  if (row.status === "AWAITING_ITEMS" && ageMs > 30 * 60_000)   return 8;
  // 9 — normal (inclui estados revisados — já foram reconhecidos pelo operador)
  return 9;
}

// ─── Page ──────────────────────────────────────────────────

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: { tab?: string; storeId?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const currentTab = TAB_STATUSES[searchParams.tab ?? ""] ? (searchParams.tab ?? "ativas") : "ativas";
  const tabStatuses = TAB_STATUSES[currentTab];

  const storeFilter =
    session.role === "SELLER"
      ? session.storeId
      : (searchParams.storeId ?? undefined);

  const whereBase = storeFilter ? { storeId: storeFilter } : {};

  // ── Contagens por status para as abas ──
  const counts = await prisma.deliveryRequest.groupBy({
    by: ["status"],
    _count: { id: true },
    where: whereBase,
  });

  const countMap: Partial<Record<string, number>> = Object.fromEntries(
    counts.map((c) => [c.status, c._count.id])
  );

  const tabCounts = {
    ativas:    ACTIVE_STATUSES.reduce((s, k) => s + (countMap[k] ?? 0), 0),
    rota:      ["DISPATCHED", "IN_TRANSIT"].reduce((s, k) => s + (countMap[k] ?? 0), 0),
    entregues: countMap.DELIVERED ?? 0,
    canceladas: countMap.CANCELLED ?? 0,
  };

  // ── Dados do painel NF-link (apenas ADMIN) ──
  const nfLinkData =
    session.role === "ADMIN"
      ? await (async () => {
          const [jobs, pendingCount, needsReview] = await Promise.all([
            prisma.nfLinkJob.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
            prisma.deliveryRequest.count({
              where: { invoiceNumber: null, orderNumber: { not: null }, status: { notIn: ["CANCELLED", "DELIVERED"] } },
            }),
            prisma.deliveryRequest.count({
              where: { nfLinkError: { in: ["MULTIPLE_NF", "PD_CANCELLED_IN_CITEL", "PARTIAL_BILLING", "PD_NOT_FOUND"] } },
            }),
          ]);
          return {
            jobs: jobs.map((j) => ({
              ...j,
              startedAt:  j.startedAt.toISOString(),
              finishedAt: j.finishedAt?.toISOString() ?? null,
            })),
            pendingCount,
            needsReview,
          };
        })()
      : null;

  // ── Dados da aba atual ──
  const requests = await prisma.deliveryRequest.findMany({
    where: {
      status: { in: tabStatuses },
      ...whereBase,
    },
    include: {
      store:      { select: { code: true } },
      orderStore: { select: { code: true } },
      seller:     { select: { name: true } },
      items:      { select: { id: true, productCode: true, productName: true, quantity: true, unit: true, availableAtStore: true } },
      transfers: {
        where: { status: { notIn: ["RECEIVED", "CANCELLED"] } },
        select: { id: true, status: true },
        take: 1,
        orderBy: { requestedAt: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  });

  // ── Avalia responsabilidade pra cada solicitação (controla visibilidade do botão na lista) ──
  // Importa local pra não vazar lógica de servidor em outros lugares
  const { getResponsibility, canUserAct } = await import("@/services/responsavel.service");

  // ── Alertas ERP abertos por solicitação ──
  // Usa raw SQL porque ERPSyncAlert ainda não está no Prisma client gerado.
  // O .catch(() => []) garante que a página funciona antes da migration rodar.
  const requestIds = requests.map((r) => r.id);
  type ERPAlertAggRow = { deliveryRequestId: string; alertCount: bigint; topSeverity: string };
  const erpAlertRows: ERPAlertAggRow[] = requestIds.length > 0
    ? await prisma.$queryRawUnsafe<ERPAlertAggRow[]>(
        `SELECT "deliveryRequestId",
                COUNT(*) AS "alertCount",
                (ARRAY_AGG(severity ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END))[1] AS "topSeverity"
         FROM erp_sync_alerts
         WHERE "deliveryRequestId" = ANY($1::text[]) AND "isResolved" = FALSE
         GROUP BY "deliveryRequestId"`,
        requestIds,
      ).catch(() => [] as ERPAlertAggRow[])
    : [];

  const erpAlertMap = new Map(
    erpAlertRows.map((r) => [r.deliveryRequestId, { count: Number(r.alertCount), severity: r.topSeverity }]),
  );

  // ── Serializa e ordena ──
  const rows: SolicitacaoCardData[] = requests
    .map((req) => {
      const responsibility = getResponsibility({
        status:          req.status,
        storeId:         req.storeId,
        dispatchStoreId: req.dispatchStoreId,
        entregaPeloCD:   req.entregaPeloCD,
      });
      const canActOnNextStage = canUserAct(
        { role: session.role, storeId: session.storeId ?? "" },
        responsibility,
      );

      return {
        id:              req.id,
        orderNumber:     req.orderNumber,
        orderStoreCode:  req.orderStore?.code ?? null,
        invoiceNumber:   req.invoiceNumber,
        nfLinkError:     req.nfLinkError,
        erpAlertCount:   erpAlertMap.get(req.id)?.count ?? 0,
        erpAlertSeverity: erpAlertMap.get(req.id)?.severity ?? null,
        status:          req.status,
        deliveryType:    req.deliveryType,
        scheduledFor:    req.scheduledFor?.toISOString() ?? null,
        createdAt:       req.createdAt.toISOString(),
        customerName:    req.customerName,
        storeCode:       req.store.code,
        sellerName:      req.seller.name,
        itemCount:       req.items.length,
        missingItemCount: req.items.filter((i) => !i.availableAtStore).length,
        activeTransferId: req.transfers[0]?.id ?? null,
        canActOnNextStage,
        items:           req.items.map((i) => ({
          id:              i.id,
          productCode:     i.productCode,
          productName:     i.productName,
          quantity:        i.quantity,
          unit:            i.unit,
          availableAtStore: i.availableAtStore,
        })),
      };
    })
    .sort((a, b) => {
      const pa = priorityOrder(a);
      const pb = priorityOrder(b);
      if (pa !== pb) return pa - pb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  const tabs = [
    { key: "ativas",    label: "Ativas",    count: tabCounts.ativas },
    { key: "rota",      label: "Em Rota",   count: tabCounts.rota },
    { key: "entregues", label: "Entregues", count: tabCounts.entregues },
    { key: "canceladas", label: "Canceladas", count: tabCounts.canceladas },
  ];

  return (
    <div className="space-y-0">
      {/* Cabeçalho */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <h1
            className="text-[18px] font-bold"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}
          >
            Solicitações
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--color-muted-text)" }}>
            Centro de operação — {rows.length} registro{rows.length !== 1 ? "s" : ""} nesta aba
          </p>
        </div>
        {session.role !== "SELLER" && (
          <Link
            href="/solicitacoes/nova"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            <Plus className="w-4 h-4" />
            Nova solicitação
          </Link>
        )}
      </div>

      {/* Painel NF-link — apenas ADMIN */}
      {nfLinkData && (
        <div className="px-6 pt-4 pb-0">
          <NfLinkAdminPanel initialData={nfLinkData} />
        </div>
      )}

      {/* Abas */}
      <div
        className={`bg-white border-b px-6 ${nfLinkData ? "mt-4" : ""}`}
        style={{ borderColor: "var(--color-border)" }}
      >
        <Suspense fallback={<div className="h-11" />}>
          <StatusTabs tabs={tabs} currentTab={currentTab} />
        </Suspense>
      </div>

      {/* Pipeline */}
      <div className="bg-gray-50 min-h-[60vh]">
        <PipelineView rows={rows} sections={TAB_SECTIONS[currentTab]} />
      </div>
    </div>
  );
}
