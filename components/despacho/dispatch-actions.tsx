"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Truck, Zap, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Driver {
  id: string;
  name: string;
  available: boolean;
  storeCode: string;
}

interface Props {
  deliveryRequestId: string;
  deliveryType: string;
  drivers: Driver[];
  nfLinkError?: string | null;
}

export function DispatchActionPanel({ deliveryRequestId, deliveryType, drivers, nfLinkError }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectedModal, setSelectedModal] = useState<string>(
    deliveryType === "URGENT" ? "LALAMOVE" : "INTERNAL_ROUTE"
  );
  const [selectedDriverId, setSelectedDriverId]     = useState("");
  const [estimatedCost, setEstimatedCost]           = useState("");
  const [multiNfConfirmed, setMultiNfConfirmed]     = useState(false);

  const requiresMultiNfConfirm = nfLinkError === "MULTIPLE_NF";

  async function handleDispatch() {
    setLoading(true);
    try {
      // Registra revisão antes de despachar (fire-and-forget — não bloqueia o despacho)
      if (requiresMultiNfConfirm && multiNfConfirmed) {
        fetch(`/api/solicitacoes/${deliveryRequestId}/nf-review`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        }).catch(() => null);
      }

      const res = await fetch("/api/despacho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryRequestId,
          modal: selectedModal,
          driverId: selectedModal === "INTERNAL_ROUTE" ? selectedDriverId || undefined : undefined,
          estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        alert(json.error ?? "Erro ao despachar");
        return;
      }

      router.refresh();
    } catch {
      alert("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  const availableDrivers = drivers.filter((d) => d.available);

  return (
    <div className="border-t border-gray-100 pt-4 mt-2">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Seleção de modal */}
        <div className="flex gap-2">
          {[
            { value: "INTERNAL_ROUTE", label: "Rota interna", icon: Truck },
            { value: "LALAMOVE", label: "Lalamove", icon: Zap },
            { value: "EXCEPTION", label: "Exceção", icon: AlertTriangle },
          ].map((modal) => (
            <button
              key={modal.value}
              type="button"
              onClick={() => setSelectedModal(modal.value)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors",
                selectedModal === modal.value
                  ? modal.value === "LALAMOVE"
                    ? "bg-purple-500 text-white border-purple-500"
                    : modal.value === "EXCEPTION"
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-blue-500 text-white border-blue-500"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              )}
            >
              <modal.icon className="w-3 h-3" />
              {modal.label}
            </button>
          ))}
        </div>

        {/* Seleção de motorista (rota interna) */}
        {selectedModal === "INTERNAL_ROUTE" && (
          <select
            value={selectedDriverId}
            onChange={(e) => setSelectedDriverId(e.target.value)}
            className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Motorista (opcional)</option>
            {availableDrivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — Loja {d.storeCode}
              </option>
            ))}
          </select>
        )}

        {/* Custo estimado */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">R$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            placeholder="Custo prev."
            className="w-24 text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Confirmação obrigatória para MULTIPLE_NF */}
        {requiresMultiNfConfirm && (
          <label className="w-full flex items-center gap-2 text-xs text-red-700 cursor-pointer select-none mt-1">
            <input
              type="checkbox"
              checked={multiNfConfirmed}
              onChange={(e) => setMultiNfConfirmed(e.target.checked)}
              className="w-3.5 h-3.5 accent-red-600 cursor-pointer"
            />
            Confirmo que as NFs foram verificadas e o despacho está autorizado
          </label>
        )}

        {/* Botão despachar */}
        <button
          onClick={handleDispatch}
          disabled={loading || (requiresMultiNfConfirm && !multiNfConfirmed)}
          className="ml-auto flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-60 transition"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Truck className="w-3 h-3" />
          )}
          Despachar
        </button>
      </div>
    </div>
  );
}
