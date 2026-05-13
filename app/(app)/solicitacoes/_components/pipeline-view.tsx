"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Zap, Clock, Calendar, ChevronDown, ChevronRight,
  AlertTriangle, ArrowLeftRight, Package, Truck, Navigation,
  CheckCircle2,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { SeparacaoChecklistModal } from "./separacao-checklist-modal";
import { SolicitacaoDetailDrawer } from "./solicitacao-detail-drawer";

// ─── Tipos ────────────────────────────────────────────────

export interface SolicitacaoCardData {
  id: string;
  orderNumber: string | null;
  orderStoreCode: string | null;
  invoiceNumber: string | null;
  nfLinkError: string | null;
  erpAlertCount: number;
  erpAlertSeverity: string | null; // CRITICAL | WARNING | INFO | null
  status: string;
  deliveryType: string;
  scheduledFor: string | null;
  createdAt: string;
  customerName: string;
  storeCode: string;
  sellerName: string;
  itemCount: number;
  missingItemCount: number;
  activeTransferId: string | null;
  items: {
    id: string;
    productCode: string;
    productName: string;
    quantity: number;
    unit: string;
    availableAtStore: boolean;
  }[];
}

// ─── Helpers de prioridade ─────────────────────────────────

type Priority = "URGENTE" | "HOJE" | "NORMAL";

function getPriority(row: Pick<SolicitacaoCardData, "deliveryType" | "scheduledFor">): Priority {
  if (row.deliveryType === "URGENT") return "URGENTE";
  if (row.scheduledFor) {
    const today = new Date().toDateString();
    if (new Date(row.scheduledFor).toDateString() === today) return "HOJE";
  }
  return "NORMAL";
}

const PRIORITY_CONFIG: Record<Priority, {
  label: string;
  icon: typeof Zap;
  bg: string;
  text: string;
}> = {
  URGENTE: { label: "Urgente", icon: Zap,      bg: "rgba(220,38,38,0.10)",  text: "#B91C1C" },
  HOJE:    { label: "Hoje",    icon: Clock,     bg: "rgba(249,115,22,0.10)", text: "#C2410C" },
  NORMAL:  { label: "Normal",  icon: Calendar,  bg: "rgba(115,115,115,0.08)", text: "#525252" },
};

// ─── Helpers de SLA ────────────────────────────────────────

type SlaStatus = "ok" | "warn" | "critical";

function getSla(createdAt: string, status: string): SlaStatus {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (status === "AWAITING_ITEMS") {
    if (mins > 60) return "critical";
    if (mins > 30) return "warn";
  }
  if (status === "READY") {
    if (mins > 240) return "critical";
    if (mins > 120) return "warn";
  }
  return "ok";
}

const SLA_STYLES: Record<SlaStatus, string> = {
  ok:       "text-gray-400",
  warn:     "text-amber-600",
  critical: "text-red-600 font-semibold",
};

// ─── Config de seções ──────────────────────────────────────

const SECTION_CONFIG: Record<string, {
  label: string;
  note?: string;
  accentBorder?: string;
  accentBg?: string;
  hasSla?: boolean;
}> = {
  AWAITING_ITEMS: {
    label: "Aguardando Itens",
    note: "Itens não definidos — precisa de ação antes de seguir",
    accentBorder: "border-amber-300",
    accentBg: "bg-amber-50",
    hasSla: true,
  },
  PENDING: {
    label: "Pendente",
    note: "Aguardando confirmação de separação",
  },
  AWAITING_TRANSFER: {
    label: "Aguardando Transferência",
    note: "Bloqueadas por itens de outras lojas",
  },
  SEPARADO: {
    label: "Separado",
    note: "Saiu do estoque — aguardando NF",
  },
  AGUARDANDO_NF: {
    label: "Aguardando NF",
    note: "Pedido separado, NF ainda não foi emitida",
  },
  NF_VINCULADA: {
    label: "NF Emitida",
    note: "NF saiu do Citel e foi vinculada — pronta para roteirização",
  },
  PRONTO_ROTEIRIZACAO: {
    label: "Pronto p/ Roteirização",
    note: "Aguardando ser incluído numa rota",
  },
  ROTEIRIZADO: {
    label: "Roteirizado",
    note: "Já está numa rota — aguardando despacho",
  },
  READY: {
    label: "Pronto para Despacho",
    accentBorder: "border-blue-300",
    accentBg: "bg-blue-50",
    hasSla: true,
  },
  OCORRENCIA: {
    label: "Ocorrência",
    note: "Anomalia na entrega — precisa de resolução",
    accentBorder: "border-red-300",
    accentBg: "bg-red-50",
    hasSla: true,
  },
  DISPATCHED: { label: "Despachado" },
  IN_TRANSIT:  { label: "Em Trânsito" },
  DELIVERED:   { label: "Entregue" },
  CANCELLED:   { label: "Cancelado" },
};

// ─── Componente do card ────────────────────────────────────

function SolicitacaoCard({
  row,
  onConfirmSeparacao,
  onOpenDetail,
}: {
  row: SolicitacaoCardData;
  onConfirmSeparacao: (row: SolicitacaoCardData) => void;
  onOpenDetail: (id: string) => void;
}) {
  const priority = getPriority(row);
  const sla = getSla(row.createdAt, row.status);
  const pConfig = PRIORITY_CONFIG[priority];
  const PriorityIcon = pConfig.icon;
  const router = useRouter();
  const [markingReviewed, setMarkingReviewed] = useState(false);

  async function handleMarkReviewed(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (markingReviewed) return;
    setMarkingReviewed(true);
    try {
      await fetch(`/api/solicitacoes/${row.id}/nf-review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });
      router.refresh();
    } finally {
      setMarkingReviewed(false);
    }
  }

  const isCriticalReady = row.status === "READY" && sla === "critical";
  const hasNfCritical   = !row.invoiceNumber &&
    (row.nfLinkError === "MULTIPLE_NF" || row.nfLinkError === "PD_CANCELLED_IN_CITEL");
  const hasNfWarning    = !row.invoiceNumber && row.nfLinkError === "PARTIAL_BILLING";

  // linha descritiva por status
  const infoLine = (() => {
    switch (row.status) {
      case "AWAITING_ITEMS":
        return (
          <span className="text-amber-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Criada sem itens — defina antes de separar
          </span>
        );
      case "PENDING":
        return (
          <span className="text-gray-500">
            {row.itemCount} {row.itemCount === 1 ? "item" : "itens"} disponíveis na loja
          </span>
        );
      case "AWAITING_TRANSFER":
        return (
          <span className="text-orange-700 flex items-center gap-1">
            <ArrowLeftRight className="w-3 h-3" />
            {row.missingItemCount} de {row.itemCount} {row.itemCount === 1 ? "item" : "itens"} aguardando transferência
          </span>
        );
      case "READY":
        return (
          <span className={cn(
            "flex items-center gap-1",
            sla === "critical" ? "text-red-700 font-medium" : "text-blue-700"
          )}>
            <Package className="w-3 h-3" />
            {row.itemCount} {row.itemCount === 1 ? "item separado" : "itens separados"} — aguardando despacho
            {sla === "critical" && <span className="ml-1 text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">PARADO</span>}
          </span>
        );
      case "DISPATCHED":
        return <span className="text-purple-700">Despachado</span>;
      case "IN_TRANSIT":
        return (
          <span className="text-cyan-700 flex items-center gap-1">
            <Navigation className="w-3 h-3" />
            Motorista a caminho
          </span>
        );
      case "DELIVERED":
        return (
          <span className="text-green-700 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Entregue
          </span>
        );
      default:
        return null;
    }
  })();

  // botão de ação principal
  const actionButton = (() => {
    switch (row.status) {
      case "AWAITING_ITEMS":
        return (
          <Link
            href={`/solicitacoes/${row.id}`}
            className="text-[12px] font-semibold text-amber-700 hover:text-amber-800 whitespace-nowrap flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            Definir itens <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        );
      case "PENDING":
        return (
          <button
            onClick={(e) => { e.stopPropagation(); onConfirmSeparacao(row); }}
            className="text-[12px] font-semibold text-orange-600 hover:text-orange-700 whitespace-nowrap flex items-center gap-1"
          >
            Confirmar separação <ChevronRight className="w-3.5 h-3.5" />
          </button>
        );
      case "AWAITING_TRANSFER":
        // O Jhow confirma a transferência diretamente pelo drawer — não cria aqui.
        // Por isso o botão "Criar transferência" foi removido; click no card abre o drawer.
        return (
          <span className="text-[12px] font-medium text-gray-500 whitespace-nowrap flex items-center gap-1">
            Ver detalhes <ChevronRight className="w-3.5 h-3.5" />
          </span>
        );
      case "READY":
        return (
          <Link
            href={`/despacho?solicitacaoId=${row.id}`}
            className="text-[12px] font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            Despachar <Truck className="w-3.5 h-3.5" />
          </Link>
        );
      case "DISPATCHED":
      case "IN_TRANSIT":
        return (
          <Link
            href="/rastreamento"
            className="text-[12px] font-semibold text-gray-600 hover:text-gray-800 whitespace-nowrap flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            Rastrear <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        );
      default:
        return (
          <Link
            href={`/solicitacoes/${row.id}`}
            className="text-[12px] font-medium text-gray-500 hover:text-gray-700 whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            Ver detalhes →
          </Link>
        );
    }
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(row.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenDetail(row.id); } }}
      className={cn(
        "flex items-center gap-4 px-4 py-3.5 transition-colors border-b last:border-0 cursor-pointer",
        isCriticalReady || hasNfCritical
          ? "bg-red-50 hover:bg-red-100 border-l-4 border-l-red-400 pl-3"
          : hasNfWarning
          ? "bg-orange-50 hover:bg-orange-100 border-l-4 border-l-orange-400 pl-3"
          : "hover:bg-gray-50"
      )}
      style={{ borderColor: isCriticalReady ? undefined : "var(--color-border)" }}
    >
      {/* Prioridade */}
      <span
        className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg flex-shrink-0"
        style={{ backgroundColor: pConfig.bg, color: pConfig.text }}
      >
        <PriorityIcon className="w-3 h-3" />
        {pConfig.label}
      </span>

      {/* Info principal */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-[13px] font-semibold text-gray-900">
            {row.orderNumber
              ? `PD ${row.orderNumber}${row.orderStoreCode ? ` · Loja ${row.orderStoreCode}` : ""}`
              : row.invoiceNumber
                ? `NF ${row.invoiceNumber}`
                : `#${row.id.slice(-6)}`}
          </span>
          {!row.invoiceNumber && (() => {
            switch (row.nfLinkError) {
              case "PARTIAL_BILLING":
                return (
                  <>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 flex items-center gap-1"
                      style={{ backgroundColor: "rgba(234,88,12,0.15)", color: "#C2410C" }}
                      title="Alguns itens ainda não foram faturados. Verificar com a loja/financeiro."
                    >
                      <AlertTriangle className="w-2.5 h-2.5" />
                      FATURAMENTO PARCIAL — VERIFICAR
                    </span>
                    <button
                      onClick={handleMarkReviewed}
                      disabled={markingReviewed}
                      className="text-[9px] font-semibold underline underline-offset-2 flex-shrink-0 disabled:opacity-50"
                      style={{ color: "#C2410C" }}
                      title="Registrar que este estado foi revisado pelo operador"
                    >
                      {markingReviewed ? "…" : "Marcar revisado"}
                    </button>
                  </>
                );
              case "PARTIAL_BILLING_REVIEWED":
                return (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: "rgba(22,163,74,0.10)", color: "#15803D" }}
                    title="Faturamento parcial reconhecido. Sistema vinculará automaticamente quando concluído."
                  >
                    PARCIAL REVISADO
                  </span>
                );
              case "MULTIPLE_NF":
                return (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: "rgba(220,38,38,0.15)", color: "#B91C1C" }}
                    title="PD gerou mais de uma NF. Vinculação manual necessária."
                  >
                    MÚLTIPLAS NF — REVISAR
                  </span>
                );
              case "MULTIPLE_NF_REVIEWED":
                return (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: "rgba(22,163,74,0.10)", color: "#15803D" }}
                    title="Múltiplas NFs confirmadas pelo operador antes do despacho."
                  >
                    NF REVISADA
                  </span>
                );
              case "PD_CANCELLED_IN_CITEL":
                return (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: "rgba(220,38,38,0.15)", color: "#B91C1C" }}
                    title="PD foi cancelado no Autcom. Verificar com loja/vendedor."
                  >
                    PD CANCELADO
                  </span>
                );
              case "PD_NOT_FOUND":
                return (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: "rgba(115,115,115,0.12)", color: "#525252" }}
                    title="PD não encontrado no Autcom após múltiplas tentativas. Conferir número do pedido."
                  >
                    PD NÃO ENCONTRADO
                  </span>
                );
              default:
                return (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">
                    AGUARDANDO NF
                  </span>
                );
            }
          })()}
          {row.erpAlertCount > 0 && (() => {
            const isCrit = row.erpAlertSeverity === "CRITICAL";
            return (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 flex items-center gap-1"
                style={isCrit
                  ? { backgroundColor: "rgba(220,38,38,0.13)", color: "#B91C1C" }
                  : { backgroundColor: "rgba(217,119,6,0.13)", color: "#92400E" }
                }
                title={isCrit
                  ? "Alerta crítico do ERP — pedido pode ter sido cancelado ou alterado"
                  : "Divergência no ERP — item ou endereço alterado após criação"
                }
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                {isCrit ? `ERP CRÍTICO (${row.erpAlertCount})` : `ERP ${row.erpAlertCount} alerta${row.erpAlertCount > 1 ? "s" : ""}`}
              </span>
            );
          })()}
          <span className="text-[12px] text-gray-400">·</span>
          <span
            className={cn("text-[11px]", SLA_STYLES[sla])}
            title={sla === "critical" ? "SLA ultrapassado" : undefined}
          >
            {sla === "critical" && "⚠ "}
            {formatRelativeTime(row.createdAt)}
            {sla === "warn" && " ⚠"}
          </span>
        </div>
        <p className="text-[13px] text-gray-700 truncate">{row.customerName}</p>
        <p className="text-[11px] mt-0.5">{infoLine}</p>
        <p className="text-[11px] mt-1 text-gray-400">
          Responsável: <span className="font-medium text-gray-600">Loja {row.storeCode}</span>
          <span className="mx-1.5">·</span>
          Solicitante: {row.sellerName}
        </p>
      </div>

      {/* Ação */}
      <div className="flex-shrink-0">{actionButton}</div>
    </div>
  );
}

// ─── Seção colapsável ──────────────────────────────────────

function PipelineSection({
  status,
  rows,
  onConfirmSeparacao,
  onOpenDetail,
  defaultOpen = true,
}: {
  status: string;
  rows: SolicitacaoCardData[];
  onConfirmSeparacao: (row: SolicitacaoCardData) => void;
  onOpenDetail: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const config = SECTION_CONFIG[status] ?? { label: status };
  const hasCritical = rows.some((r) => getSla(r.createdAt, r.status) === "critical");

  if (rows.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden",
        config.accentBorder ?? "border-gray-200",
        hasCritical && status === "AWAITING_ITEMS" ? "border-red-300" : ""
      )}
    >
      {/* Cabeçalho da seção */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
          open
            ? config.accentBg ?? "bg-gray-50"
            : "bg-white hover:bg-gray-50"
        )}
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
        <span className="text-[13px] font-semibold text-gray-800 flex-1">
          {config.label}
        </span>
        {config.note && open && (
          <span className="text-[11px] text-gray-400 hidden sm:block">{config.note}</span>
        )}
        <span className="text-[12px] font-bold text-gray-500 flex-shrink-0">
          {rows.length}
        </span>
        {hasCritical && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 flex-shrink-0">
            SLA
          </span>
        )}
      </button>

      {/* Cards */}
      {open && (
        <div className="bg-white divide-y" style={{ borderColor: "var(--color-border)" }}>
          {rows.map((row) => (
            <SolicitacaoCard
              key={row.id}
              row={row}
              onConfirmSeparacao={onConfirmSeparacao}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── View principal ────────────────────────────────────────

interface PipelineViewProps {
  rows: SolicitacaoCardData[];
  sections: string[];
}

export function PipelineView({ rows, sections }: PipelineViewProps) {
  const [checklistTarget,   setChecklistTarget]   = useState<SolicitacaoCardData | null>(null);
  const [detailRequestId,   setDetailRequestId]   = useState<string | null>(null);

  // agrupa por status
  const grouped = new Map<string, SolicitacaoCardData[]>();
  for (const status of sections) grouped.set(status, []);
  for (const row of rows) {
    const bucket = grouped.get(row.status);
    if (bucket) bucket.push(row);
  }

  const totalVisible = rows.length;

  if (totalVisible === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="w-10 h-10 text-gray-200 mb-3" />
        <p className="text-[14px] font-medium text-gray-500">Nenhuma solicitação nesta aba</p>
        <p className="text-[12px] text-gray-400 mt-1">As solicitações aparecerão aqui conforme criadas.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 p-4">
        {sections.map((status) => (
          <PipelineSection
            key={status}
            status={status}
            rows={grouped.get(status) ?? []}
            onConfirmSeparacao={setChecklistTarget}
            onOpenDetail={setDetailRequestId}
            defaultOpen={["AWAITING_ITEMS", "PENDING", "READY"].includes(status)}
          />
        ))}
      </div>

      {checklistTarget && (
        <SeparacaoChecklistModal
          requestId={checklistTarget.id}
          displayLabel={
            checklistTarget.orderNumber
              ? `PD ${checklistTarget.orderNumber}`
              : checklistTarget.invoiceNumber
                ? `NF ${checklistTarget.invoiceNumber}`
                : `Solicitação #${checklistTarget.id.slice(-6)}`
          }
          items={checklistTarget.items}
          onClose={() => setChecklistTarget(null)}
        />
      )}

      <SolicitacaoDetailDrawer
        requestId={detailRequestId}
        onClose={() => setDetailRequestId(null)}
      />
    </>
  );
}
