"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronDown, CheckCircle, ArrowRight, Truck, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRANSFER_STATUS_LABELS } from "@/lib/constants";

// mapeamento das ações disponíveis por status atual
const NEXT_ACTIONS: Record<string, { label: string; nextStatus: string; icon: React.ComponentType<{ className?: string }>; color: string }[]> = {
  PENDING: [
    { label: "Aprovar", nextStatus: "APPROVED", icon: CheckCircle, color: "text-blue-600 border-blue-200 hover:bg-blue-50" },
    { label: "Cancelar", nextStatus: "CANCELLED", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" },
  ],
  APPROVED: [
    { label: "Iniciar preparação", nextStatus: "PREPARING", icon: ArrowRight, color: "text-purple-600 border-purple-200 hover:bg-purple-50" },
    { label: "Cancelar", nextStatus: "CANCELLED", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" },
  ],
  PREPARING: [
    { label: "Despachar", nextStatus: "IN_TRANSIT", icon: Truck, color: "text-orange-600 border-orange-200 hover:bg-orange-50" },
    { label: "Cancelar", nextStatus: "CANCELLED", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" },
  ],
  IN_TRANSIT: [
    { label: "Confirmar recebimento", nextStatus: "RECEIVED", icon: CheckCircle, color: "text-green-600 border-green-200 hover:bg-green-50" },
  ],
  RECEIVED: [],
  CANCELLED: [],
};

interface Props {
  transferId: string;
  currentStatus: string;
  priority: string;
}

export function TransferActionsPanel({ transferId, currentStatus, priority }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const actions = NEXT_ACTIONS[currentStatus] ?? [];

  if (actions.length === 0) return null;

  async function handleAction(nextStatus: string) {
    setLoading(nextStatus);
    try {
      const res = await fetch(`/api/transferencias/${transferId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        alert(json.error ?? "Erro ao atualizar transferência");
        return;
      }

      router.refresh();
    } catch {
      alert("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className={cn(
      "border-t px-5 py-3 flex items-center gap-2",
      priority === "URGENT" ? "border-red-100" : "border-gray-100"
    )}>
      <span className="text-xs text-gray-400 mr-1">Ações:</span>
      {actions.map((action) => (
        <button
          key={action.nextStatus}
          onClick={() => handleAction(action.nextStatus)}
          disabled={loading !== null}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50",
            action.color
          )}
        >
          {loading === action.nextStatus ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <action.icon className="w-3 h-3" />
          )}
          {action.label}
        </button>
      ))}
    </div>
  );
}
