"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { DataTable, StatusBadge, EmptyState } from "@/components/ui";
import type { Column } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { Zap, ArrowLeftRight, FileText } from "lucide-react";

export interface SolicitacaoRow {
  id: string;
  invoiceNumber: string;
  isUrgent: boolean;
  itemCount: number;
  storeCode: string;
  customerName: string;
  sellerName: string;
  status: string;
  hasActiveTransfer: boolean;
  chargedFreight: number | null;
  suggestedPrice: number | null;
  createdAt: string; // ISO string — serializable from server component
}

interface SolicitacoesTableProps {
  data: SolicitacaoRow[];
}

const columns: Column<SolicitacaoRow>[] = [
  {
    key: "invoiceNumber",
    header: "NF",
    width: "160px",
    render: (row) => (
      <div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-slate-900">{row.invoiceNumber}</span>
          {row.isUrgent && <Zap className="w-3 h-3 text-red-500" />}
        </div>
        <span className="text-xs text-slate-400">
          {row.itemCount} iten{row.itemCount !== 1 ? "s" : ""}
        </span>
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
