"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { OperationalCard, ActionDefinition, OperationalAction } from "./types";

interface ActionModalProps {
  card:     OperationalCard;
  action:   ActionDefinition;
  onClose:  () => void;
  onSubmit: (payload: OperationalAction) => Promise<void>;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING:             "Pendente",
  AWAITING_ITEMS:      "Separação de itens",
  AWAITING_TRANSFER:   "Aguardando transferência",
  SEPARADO:            "Separado",
  AGUARDANDO_NF:       "Aguardando NF",
  NF_EMITIDA:          "NF emitida",
  NF_VINCULADA:        "NF vinculada",
  PRONTO_ROTEIRIZACAO: "Pronto para roteirização",
  ROTEIRIZADO:         "Roteirizado",
  DISPATCHED:          "Despachado",
  IN_TRANSIT:          "Em trânsito",
  OCORRENCIA:          "Ocorrência",
  CANCELLED:           "Cancelado",
};

function formatRef(card: OperationalCard) {
  if (card.orderNumber) return `PD ${card.orderNumber}`;
  if (card.invoiceNumber) return `NF ${card.invoiceNumber}`;
  return `#${card.id.slice(-6).toUpperCase()}`;
}

export function ActionModal({ card, action, onClose, onSubmit }: ActionModalProps) {
  const [values,   setValues]   = useState<Record<string, string | boolean>>({});
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const fields = action.fields ?? [];

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    // Validação de campos obrigatórios
    for (const field of fields) {
      const val = values[field.key] as string | undefined;
      if (field.required && (!val || val.trim() === "")) {
        setError(`Campo obrigatório: ${field.label}`);
        return;
      }
      if (field.minLength && val && val.length < field.minLength) {
        setError(`${field.label} deve ter pelo menos ${field.minLength} caracteres`);
        return;
      }
    }

    setLoading(true);
    setError(null);

    const payload: OperationalAction = {
      requestId: card.id,
      toStatus:  action.toStatus,
      ...(values as Omit<OperationalAction, "requestId" | "toStatus">),
    };

    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao executar ação");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-sm rounded-xl overflow-hidden"
        style={{ backgroundColor: "#111318", border: "1px solid #1E2530" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #1E2530" }}
        >
          <div>
            <p className="text-[13px] font-bold" style={{ color: "#E5E7EB" }}>
              {action.label}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "#4B5563" }}>
              {formatRef(card)} · {card.customerName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "#6B7280" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Transição visual */}
        <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid #1E2530" }}>
          <span className="text-[11px] px-2 py-0.5 rounded" style={{ backgroundColor: "#1E2530", color: "#6B7280" }}>
            {STATUS_LABEL[card.status] ?? card.status}
          </span>
          <span style={{ color: "#374151" }}>→</span>
          <span className="text-[11px] px-2 py-0.5 rounded" style={{ backgroundColor: "#16A34A22", color: "#86EFAC", border: "1px solid #16A34A33" }}>
            {STATUS_LABEL[action.toStatus] ?? action.toStatus}
          </span>
        </div>

        {/* Campos */}
        {fields.length > 0 && (
          <div className="px-5 py-4 space-y-3">
            {fields.map((field) => (
              <div key={field.key}>
                <label className="block text-[11px] font-medium mb-1.5" style={{ color: "#9CA3AF" }}>
                  {field.label}
                  {field.required && <span style={{ color: "#EF4444" }}> *</span>}
                </label>

                {field.type === "select" ? (
                  <select
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) => set(field.key, e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                    style={{
                      backgroundColor: "#0D1117",
                      border:          "1px solid #1E2530",
                      color:           "#E5E7EB",
                    }}
                  >
                    <option value="">Selecione…</option>
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    rows={3}
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) => set(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full rounded-lg px-3 py-2 text-[12px] outline-none resize-none"
                    style={{
                      backgroundColor: "#0D1117",
                      border:          "1px solid #1E2530",
                      color:           "#E5E7EB",
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={(values[field.key] as string) ?? ""}
                    onChange={(e) => set(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                    style={{
                      backgroundColor: "#0D1117",
                      border:          "1px solid #1E2530",
                      color:           "#E5E7EB",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="mx-5 mb-3 px-3 py-2 rounded-lg text-[11px]" style={{ backgroundColor: "#EF444422", color: "#F87171", border: "1px solid #EF444433" }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 flex gap-2 justify-end" style={{ borderTop: "1px solid #1E2530" }}>
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-[12px] font-medium transition-colors"
            style={{ backgroundColor: "#1E2530", color: "#9CA3AF" }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors"
            style={{
              backgroundColor: action.variant === "danger" ? "#EF444433" : "#16A34A33",
              color:           action.variant === "danger" ? "#F87171"   : "#86EFAC",
              border:          action.variant === "danger" ? "1px solid #EF444444" : "1px solid #16A34A44",
            }}
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            {loading ? "Executando…" : action.label}
          </button>
        </div>
      </div>
    </div>
  );
}
