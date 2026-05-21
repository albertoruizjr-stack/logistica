"use client";

import { useState, useRef } from "react";
import { X, Loader2, Camera, CheckCircle2, FileSignature, Package } from "lucide-react";
import { compressImage } from "@/lib/image-compress";
import type { OperationalCard } from "./types";

interface Props {
  card:          OperationalCard;
  requirePhoto?: boolean;
  onClose:       () => void;
  onSuccess:     () => void;
}

function formatRef(card: OperationalCard) {
  if (card.orderNumber)   return `PD ${card.orderNumber}`;
  if (card.invoiceNumber) return `NF ${card.invoiceNumber}`;
  return `#${card.id.slice(-6).toUpperCase()}`;
}

// Modal de finalização manual pelo operador. Exige canhoto + material (igual ao
// motorista) e envia pro endpoint dedicado, que auto-avança a entrega até DELIVERED.
export function MarkDeliveredModal({ card, requirePhoto = true, onClose, onSuccess }: Props) {
  const receiptRef  = useRef<HTMLInputElement>(null);
  const materialRef = useRef<HTMLInputElement>(null);

  const [receiptFile,  setReceiptFile]  = useState<File | null>(null);
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [preparing,    setPreparing]    = useState<"receipt" | "material" | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  async function handlePick(slot: "receipt" | "material", raw: File | null) {
    if (!raw) return;
    setError(null);
    setPreparing(slot);
    try {
      const compressed = await compressImage(raw);
      if (slot === "receipt") setReceiptFile(compressed);
      else                    setMaterialFile(compressed);
    } catch {
      if (slot === "receipt") setReceiptFile(raw);
      else                    setMaterialFile(raw);
    } finally {
      setPreparing(null);
    }
  }

  const canSubmit = requirePhoto ? Boolean(receiptFile && materialFile) : true;

  async function handleSubmit() {
    if (!canSubmit) {
      setError("Anexe as duas fotos: canhoto e material.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      if (receiptFile)  fd.append("receipt",  receiptFile);
      if (materialFile) fd.append("material", materialFile);
      const res = await fetch(`/api/operacao/entregas/${card.id}/concluir`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({ success: false, error: `Erro ${res.status}` }));
      if (!res.ok || !json.success) {
        setError(json.error ?? `Erro ${res.status}`);
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  const slots: { slot: "receipt" | "material"; label: string; icon: typeof Camera; file: File | null; ref: typeof receiptRef }[] = [
    { slot: "receipt",  label: "Canhoto assinado", icon: FileSignature, file: receiptFile,  ref: receiptRef },
    { slot: "material", label: "Material na obra",  icon: Package,       file: materialFile, ref: materialRef },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-sm rounded-xl overflow-hidden" style={{ backgroundColor: "#111318", border: "1px solid #1E2530" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #1E2530" }}>
          <div>
            <p className="text-[13px] font-bold" style={{ color: "#E5E7EB" }}>Marcar entregue</p>
            <p className="text-[11px] mt-0.5" style={{ color: "#4B5563" }}>{formatRef(card)} · {card.customerName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "#6B7280" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Slots de foto */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-[11px]" style={{ color: "#6B7280" }}>
            {requirePhoto
              ? "Anexe o comprovante da entrega (obrigatório)."
              : "Foto opcional — você pode anexar o comprovante se quiser."}
          </p>
          {slots.map(({ slot, label, icon: Icon, file, ref }) => (
            <div key={slot}>
              <input
                ref={ref}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handlePick(slot, e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => ref.current?.click()}
                disabled={preparing === slot || loading}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-medium transition-colors"
                style={{
                  backgroundColor: file ? "#16A34A22" : "#0D1117",
                  border: file ? "1px solid #16A34A44" : "1px solid #1E2530",
                  color: file ? "#86EFAC" : "#9CA3AF",
                }}
              >
                {preparing === slot
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : file ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                {file ? `${label} ✓` : label}
                {!file && <Camera className="w-3.5 h-3.5 ml-auto" style={{ color: "#4B5563" }} />}
              </button>
            </div>
          ))}
        </div>

        {error && (
          <div className="mx-5 mb-3 px-3 py-2 rounded-lg text-[11px]" style={{ backgroundColor: "#EF444422", color: "#F87171", border: "1px solid #EF444433" }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 flex gap-2 justify-end" style={{ borderTop: "1px solid #1E2530" }}>
          <button onClick={onClose} disabled={loading} className="px-4 py-2 rounded-lg text-[12px] font-medium" style={{ backgroundColor: "#1E2530", color: "#9CA3AF" }}>
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !canSubmit}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold"
            style={{
              backgroundColor: "#16A34A33",
              color: "#86EFAC",
              border: "1px solid #16A34A44",
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            {loading ? "Finalizando…" : "Confirmar entrega"}
          </button>
        </div>
      </div>
    </div>
  );
}
