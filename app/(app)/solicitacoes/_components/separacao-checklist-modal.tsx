"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Package, Loader2, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
}

interface SeparacaoChecklistModalProps {
  requestId: string;
  displayLabel: string;
  items: Item[];
  onClose: () => void;
}

export function SeparacaoChecklistModal({
  requestId,
  displayLabel,
  items,
  onClose,
}: SeparacaoChecklistModalProps) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [markAllWarning, setMarkAllWarning] = useState(false); // primeiro clique em "marcar todos"
  const [confirming, setConfirming] = useState(false);         // etapa final de confirmação
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = items.length > 0 && checked.size === items.length;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // se usuário começa a marcar manualmente, descarta o aviso de "marcar todos"
    setMarkAllWarning(false);
    setConfirming(false);
  }

  function handleMarkAllClick() {
    if (!markAllWarning) {
      // primeiro clique: exibe aviso
      setMarkAllWarning(true);
      return;
    }
    // segundo clique (confirmação): executa
    setChecked(new Set(items.map((i) => i.id)));
    setMarkAllWarning(false);
  }

  function handleConfirmClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    submit();
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/solicitacoes/${requestId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "READY" }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? "Erro ao confirmar separação");
        setConfirming(false);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("Erro de conexão. Tente novamente.");
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
          style={{ backgroundColor: "var(--color-surface)" }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div>
              <h2
                className="text-[15px] font-bold"
                style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}
              >
                Confirmar Separação
              </h2>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--color-muted-text)" }}>
                {displayLabel} — verifique fisicamente cada item
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4" style={{ color: "var(--color-muted-text)" }} />
            </button>
          </div>

          {/* Marcar todos — ação com aviso progressivo */}
          <div className="px-5 pt-3 pb-1 flex-shrink-0">
            {!markAllWarning ? (
              <button
                onClick={handleMarkAllClick}
                className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                Marcar todos como separados
              </button>
            ) : (
              <div
                className="flex items-start gap-2 rounded-lg p-3"
                style={{ backgroundColor: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)" }}
              >
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-amber-800">
                    Confirme que verificou cada item fisicamente
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Use só se todos os itens já estão separados. Não é possível desfazer.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleMarkAllClick}
                      className="text-[12px] font-semibold text-amber-700 hover:text-amber-800"
                    >
                      Sim, marcar todos →
                    </button>
                    <span className="text-amber-300">·</span>
                    <button
                      onClick={() => setMarkAllWarning(false)}
                      className="text-[12px] text-amber-600 hover:text-amber-700"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Lista de itens */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
            {items.map((item) => {
              const isChecked = checked.has(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                    isChecked
                      ? "border-green-300 bg-green-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                      isChecked ? "border-green-500 bg-green-500" : "border-gray-300"
                    )}
                  >
                    {isChecked && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </div>
                  <Package className="w-4 h-4 flex-shrink-0 text-gray-400" />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[13px] font-medium truncate", isChecked ? "text-green-800" : "text-gray-900")}>
                      {item.productName}
                    </p>
                    <p className="text-[11px] text-gray-400 font-mono">{item.productCode}</p>
                  </div>
                  <span className={cn("text-[12px] font-semibold flex-shrink-0", isChecked ? "text-green-700" : "text-gray-500")}>
                    {item.quantity} {item.unit}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div
            className="px-5 py-4 border-t flex-shrink-0 space-y-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            {/* Banner de confirmação final */}
            {confirming && (
              <div
                className="flex items-start gap-2 rounded-lg p-3"
                style={{ backgroundColor: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.2)" }}
              >
                <ShieldCheck className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-green-800">
                  A solicitação avançará para <strong>Pronto para Despacho</strong> e não poderá voltar para Pendente. Confirmar?
                </p>
              </div>
            )}

            {error && (
              <p className="text-[12px] text-red-600">{error}</p>
            )}

            <button
              onClick={handleConfirmClick}
              disabled={!allChecked || loading}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              )}
              style={{
                backgroundColor: !allChecked
                  ? "#9CA3AF"
                  : confirming
                  ? "#15803D"
                  : "#16A34A",
              }}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : !allChecked ? (
                `${checked.size} de ${items.length} itens marcados`
              ) : confirming ? (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Sim, avançar para Pronto
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Confirmar separação
                </>
              )}
            </button>

            {confirming && !loading && (
              <button
                onClick={() => setConfirming(false)}
                className="w-full text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                Voltar e revisar
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
