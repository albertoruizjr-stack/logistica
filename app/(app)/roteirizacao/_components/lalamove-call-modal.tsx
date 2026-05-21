"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, AlertTriangle, Truck } from "lucide-react";
import { LALAMOVE_VEHICLE_LABELS } from "@/lib/constants";

interface Props {
  delivery: { id: string; label: string; address: string };
  onClose: () => void;
}

const VEHICLES = Object.keys(LALAMOVE_VEHICLE_LABELS) as Array<keyof typeof LALAMOVE_VEHICLE_LABELS>;

export function LalamoveCallModal({ delivery, onClose }: Props) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState("UV_FIORINO");
  const [quote, setQuote] = useState<{ quotationId: string; price: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cotar() {
    setLoading(true);
    setError(null);
    setQuote(null);
    try {
      const res = await fetch("/api/lalamove/cotacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryRequestId: delivery.id, serviceType: vehicle }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        setError(j.error ?? "Erro ao cotar");
        return;
      }
      setQuote({ quotationId: j.data.quotationId, price: j.data.price });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  async function confirmar() {
    if (!quote) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/roteirizacao/lalamove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryRequestId: delivery.id,
          serviceType: vehicle,
          quotationId: quote.quotationId,
          estimatedPrice: quote.price,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        setError((j.error ?? "Erro ao confirmar") + " — cote novamente.");
        setQuote(null);
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px]"
        onClick={() => !loading && onClose()}
      />

      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden border border-gray-200">

          {/* Header */}
          <div className="px-5 py-3.5 border-b border-gray-200 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900 leading-tight flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-orange-500 flex-shrink-0" />
                Chamar Lalamove
              </h2>
              <p className="text-xs text-gray-500 mt-1 leading-tight truncate">{delivery.label}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-tight truncate">{delivery.address}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 disabled:opacity-50 flex-shrink-0"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de veículo</label>
              <select
                value={vehicle}
                onChange={(e) => {
                  setVehicle(e.target.value);
                  setQuote(null);
                }}
                disabled={loading}
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 outline-none focus:border-orange-400 bg-white disabled:opacity-50"
              >
                {VEHICLES.map((v) => (
                  <option key={v} value={v}>
                    {LALAMOVE_VEHICLE_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>

            {/* Preço cotado */}
            {quote && (
              <div className="rounded-lg px-3 py-2.5 bg-green-50 border border-green-200">
                <p className="text-[11px] text-green-700 font-medium">Preço estimado</p>
                <p className="text-lg font-bold text-green-800">R$ {quote.price.toFixed(2)}</p>
              </div>
            )}

            {/* Erro */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              Cancelar
            </button>
            {quote ? (
              <button
                type="button"
                onClick={confirmar}
                disabled={loading}
                className="flex items-center gap-2 bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar
              </button>
            ) : (
              <button
                type="button"
                onClick={cotar}
                disabled={loading}
                className="flex items-center gap-2 bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Cotar
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
