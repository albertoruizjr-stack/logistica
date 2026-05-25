"use client";

import { useState } from "react";
import { X, Loader2, Search, AlertTriangle, CheckCircle2, Package } from "lucide-react";
import type { OperationalCard } from "./types";

interface Preview {
  orderNumber:     string;
  customerName:    string;
  customerDoc:     string | null;
  deliveryAddress: string;
  itemCount:       number;
  totalWeightKg:   number;
  isEntregaCD:     boolean;
}

interface Props {
  card:      OperationalCard;
  onClose:   () => void;
  onSuccess: () => void;
}

export function CorrigirPedidoModal({ card, onClose, onSuccess }: Props) {
  const [num,     setNum]     = useState(card.orderNumber ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState<"preview" | "apply" | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  async function call(dryRun: boolean) {
    setError(null);
    setLoading(dryRun ? "preview" : "apply");
    try {
      const res = await fetch(`/api/solicitacoes/${card.id}/corrigir-pedido`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ newOrderNumber: num.trim(), dryRun }),
      });
      const json = await res.json().catch(() => ({ success: false, error: `Erro ${res.status}` }));
      if (!res.ok || !json.success) { setError(json.error ?? `Erro ${res.status}`); return false; }
      if (dryRun) setPreview(json.data.preview as Preview);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
      return false;
    } finally {
      setLoading(null);
    }
  }

  async function handleApply() {
    const ok = await call(false);
    if (ok) { onSuccess(); onClose(); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-xl overflow-hidden" style={{ backgroundColor: "#111318", border: "1px solid #1E2530" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #1E2530" }}>
          <div>
            <p className="text-[13px] font-bold" style={{ color: "#E5E7EB" }}>Corrigir número do pedido</p>
            <p className="text-[11px] mt-0.5" style={{ color: "#4B5563" }}>Atual: PD {card.orderNumber} · {card.customerName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "#6B7280" }}><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <label className="block text-[11px] font-semibold" style={{ color: "#9CA3AF" }}>Número correto do pedido (PD)</label>
          <div className="flex gap-2">
            <input
              value={num}
              onChange={(e) => { setNum(e.target.value); setPreview(null); }}
              className="flex-1 px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ backgroundColor: "#0D1117", border: "1px solid #1E2530", color: "#E5E7EB" }}
              placeholder="Ex: 11640"
            />
            <button
              onClick={() => call(true)}
              disabled={loading !== null || num.trim().length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold"
              style={{ backgroundColor: "#1E2530", color: "#9CA3AF", opacity: num.trim() ? 1 : 0.5 }}
            >
              {loading === "preview" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Buscar
            </button>
          </div>

          {preview && (
            <div className="rounded-lg p-3 space-y-1" style={{ backgroundColor: "#0D1117", border: "1px solid #16A34A33" }}>
              <p className="text-[12px] font-bold" style={{ color: "#86EFAC" }}>{preview.customerName}</p>
              {preview.customerDoc && <p className="text-[10px]" style={{ color: "#6B7280" }}>Doc: {preview.customerDoc}</p>}
              <p className="text-[10px]" style={{ color: "#9CA3AF" }}>{preview.deliveryAddress}</p>
              <p className="text-[10px] flex items-center gap-1" style={{ color: "#6B7280" }}>
                <Package className="w-2.5 h-2.5" /> {preview.itemCount} {preview.itemCount === 1 ? "item" : "itens"} · {preview.totalWeightKg.toFixed(1)} kg
                {preview.isEntregaCD && " · entrega CD"}
              </p>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg text-[11px] flex items-start gap-1.5" style={{ backgroundColor: "#EF444422", color: "#F87171", border: "1px solid #EF444433" }}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 flex gap-2 justify-end" style={{ borderTop: "1px solid #1E2530" }}>
          <button onClick={onClose} disabled={loading !== null} className="px-4 py-2 rounded-lg text-[12px] font-medium" style={{ backgroundColor: "#1E2530", color: "#9CA3AF" }}>
            Cancelar
          </button>
          <button
            onClick={handleApply}
            disabled={loading !== null || !preview}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold"
            style={{ backgroundColor: "#16A34A33", color: "#86EFAC", border: "1px solid #16A34A44", opacity: preview ? 1 : 0.5 }}
          >
            {loading === "apply" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Confirmar correção
          </button>
        </div>
      </div>
    </div>
  );
}
