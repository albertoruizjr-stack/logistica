"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { DataTable, StatusBadge, EmptyState } from "@/components/ui";
import type { Column } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { Zap, ArrowLeftRight, FileText, AlertTriangle } from "lucide-react";

export interface SolicitacaoRow {
  id: string;
  orderNumber: string | null;
  orderStoreCode: string | null;
  invoiceNumber: string | null;
  nfLinkError: string | null;
  isUrgent: boolean;
  itemCount: number;
  storeCode: string;
  customerName: string;
  sellerName: string;
  status: string;
  hasActiveTransfer: boolean;
  chargedFreight: number | null;
  suggestedPrice: number | null;
  createdAt: string;
}

interface SolicitacoesTableProps {
  data: SolicitacaoRow[];
}

const columns: Column<SolicitacaoRow>[] = [
  {
    key: "orderNumber",
    header: "Pedido / NF",
    width: "170px",
    render: (row) => (
      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-slate-900">
            {row.orderNumber
              ? `PD ${row.orderNumber}${row.orderStoreCode ? ` · ${row.orderStoreCode}` : ""}`
              : row.invoiceNumber
                ? `NF ${row.invoiceNumber}`
                : `#${row.id.slice(-6)}`}
          </span>
          {row.isUrgent && <Zap className="w-3 h-3 text-red-500" />}
          {row.status === "AWAITING_ITEMS" && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "rgba(217,119,6,0.12)", color: "#92400E" }}
              title="Itens não definidos — pendente definição"
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              Definir itens
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {!row.invoiceNumber && (() => {
            switch (row.nfLinkError) {
              case "PARTIAL_BILLING":
                return (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ backgroundColor: "rgba(234,88,12,0.12)", color: "#C2410C" }}
                    title="Faturamento parcial — verificar com a loja."
                  >
                    <AlertTriangle className="w-2.5 h-2.5" />
                    Parc. faturado
                  </span>
                );
              case "MULTIPLE_NF":
                return (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ backgroundColor: "rgba(220,38,38,0.10)", color: "#B91C1C" }}
                    title="Múltiplas NFs para este PD — vinculação manual."
                  >
                    Múltiplas NF
                  </span>
                );
              case "PD_CANCELLED_IN_CITEL":
                return (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ backgroundColor: "rgba(220,38,38,0.10)", color: "#B91C1C" }}
                  >
                    PD cancelado
                  </span>
                );
              case "PD_NOT_FOUND":
                return (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ backgroundColor: "rgba(115,115,115,0.10)", color: "#525252" }}
                    title="PD não encontrado após múltiplas tentativas. Conferir número."
                  >
                    PD não encontrado
                  </span>
                );
              default:
                return (
                  <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-amber-50 text-amber-700 whitespace-nowrap">
                    Sem NF
                  </span>
                );
            }
          })()}
          <span className="text-xs text-slate-400">
            {row.status === "AWAITING_ITEMS"
              ? "Sem itens — pendente definição"
              : `${row.itemCount} iten${row.itemCount !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>
    ),
  },
  {
    key: "storeCode",
    header: "Loja",
    width: "80px",
    render: (row) => (
      <span className="text-xs font-medium text-slate-600">{row.storeCode}</span>
    ),
  },
  {
    key: "customerName",
    header: "Cliente",
    truncate: true,
    render: (row) => (
      <div>
        <p className="text-sm text-slate-900 truncate max-w-[180px]">{row.customerName}</p>
        <p className="text-xs text-slate-400 truncate max-w-[180px]">{row.sellerName}</p>
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    width: "160px",
    render: (row) => (
      <div className="flex flex-col gap-1">
        <StatusBadge status={row.status as StatusVariant} showIcon />
        {row.hasActiveTransfer && (
          <span className="text-xs text-orange-600 flex items-center gap-0.5">
            <ArrowLeftRight className="w-2.5 h-2.5" />
            Transferência
          </span>
        )}
      </div>
    ),
  },
  {
    key: "chargedFreight",
    header: "Frete",
    width: "120px",
    render: (row) => {
      if (row.chargedFreight == null)
        return <span className="text-slate-400">—</span>;
      const diff =
        row.suggestedPrice != null
          ? row.chargedFreight - row.suggestedPrice
          : null;
      return (
        <div>
          <p className="text-sm font-medium text-slate-900">
            {formatCurrency(row.chargedFreight)}
          </p>
          {row.suggestedPrice != null && (
            <p
              className={cn(
                "text-xs",
                diff === 0
                  ? "text-slate-400"
                  : diff! > 0
                  ? "text-green-600"
                  : "text-red-500"
              )}
            >
              Sug: {formatCurrency(row.suggestedPrice)}
            </p>
          )}
        </div>
      );
    },
  },
  {
    key: "createdAt",
    header: "Criado",
    width: "100px",
    render: (row) => (
      <span className="text-xs text-slate-400">
        {formatRelativeTime(row.createdAt)}
      </span>
    ),
  },
];

export default function SolicitacoesTable({ data }: SolicitacoesTableProps) {
  const router = useRouter();

  return (
    <DataTable
      columns={columns}
      data={data}
      onRowClick={(row) => router.push(`/solicitacoes/${row.id}`)}
      rowActions={(row) => (
        <Link
          href={`/solicitacoes/${row.id}`}
          className="text-xs text-orange-600 hover:underline font-medium whitespace-nowrap"
          onClick={(e) => e.stopPropagation()}
        >
          Ver →
        </Link>
      )}
      emptyState={
        <EmptyState
          icon={FileText}
          title="Nenhuma solicitação encontrada"
          description="Tente ajustar os filtros ou criar uma nova solicitação."
        />
      }
    />
  );
}
