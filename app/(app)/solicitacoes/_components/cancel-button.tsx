"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle, Loader2, AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// Status que não permitem cancelamento de forma alguma
const TERMINAL = new Set(["DELIVERED", "CANCELLED"]);

// Status que permitem cancelamento sem restrição de role
const CANCELLABLE = new Set([
  "AWAITING_ITEMS", "PENDING", "AWAITING_TRANSFER", "READY", "DISPATCHED",
]);

interface CancelSolicitacaoButtonProps {
  requestId: string;
  invoiceNumber: string;
  currentStatus: string;
  userRole: string;
}

export function CancelSolicitacaoButton({
  requestId,
  invoiceNumber,
  currentStatus,
  userRole,
}: CancelSolicitacaoButtonProps) {
  const router = useRouter();
  const isAdmin = userRole === "ADMIN";
  const isInTransit = currentStatus === "IN_TRANSIT";

  const [step, setStep] = useState<"idle" | "confirm" | "modal">("idle");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Não exibe nada em estados terminais
  if (TERMINAL.has(currentStatus)) return null;

  async function doCancel(opts: { force?: boolean; cancellationReason?: string } = {}) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/solicitacoes/${requestId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "CANCELLED",
          ...(opts.force ? { forceCancel: true, cancellationReason: opts.cancellationReason } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? "Erro ao cancelar");
        return;
      }
      router.refresh();
      setStep("idle");
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  // ── IN_TRANSIT: bloqueado para não-admin ─────────────────
  if (isInTransit && !isAdmin) {
    return (
      <div className="flex items-center gap-2">
        <button
          disabled
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-200 text-gray-300 cursor-not-allowed"
        >
          <Lock className="w-3.5 h-3.5" />
          Cancelar entrega
        </button>
        <span className="text-[11px] text-gray-400 max-w-[200px] leading-tight">
          Não disponível — motorista em rota. Contate um administrador.
        </span>
      </div>
    );
  }

  // ── IN_TRANSIT + ADMIN: abre modal ───────────────────────
  if (isInTransit && isAdmin) {
    return (
      <>
        <button
          onClick={() => { setStep("modal"); setError(null); setReason(""); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          Cancelar entrega
        </button>

        {step === "modal" && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
              onClick={() => !loading && setStep("idle")}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="w-full max-w-md rounded-2xl shadow-2xl"
                style={{ backgroundColor: "var(--color-surface)" }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div
                  className="px-5 py-4 border-b"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <h2
                    className="text-[15px] font-bold text-red-700"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Cancelar entrega em trânsito
                  </h2>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--color-muted-text)" }}>
                    NF {invoiceNumber}
                  </p>
                </div>

                {/* Aviso */}
                <div className="px-5 pt-4">
                  <div
                    className="flex gap-2.5 rounded-xl p-3"
                    style={{ backgroundColor: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)" }}
                  >
                    <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-[12px] text-red-800">
                      O motorista já está em rota com os produtos. Você precisará entrar em contato para interromper a entrega. Esta ação não pode ser desfeita.
                    </p>
                  </div>
                </div>

                {/* Motivo */}
                <div className="px-5 pt-4 pb-2">
                  <label
                    className="block text-[11px] font-semibold uppercase mb-1.5"
                    style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}
                  >
                    Motivo do cancelamento <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="Descreva o motivo (mínimo 10 caracteres)..."
                    disabled={loading}
                    className="w-full px-3 py-2.5 rounded-lg text-[13px] border resize-none focus:outline-none disabled:opacity-50"
                    style={{ borderColor: "var(--color-border)", backgroundColor: "white" }}
                  />
                  <p className="text-[11px] mt-1" style={{ color: reason.length < 10 ? "#DC2626" : "#A3A3A3" }}>
                    {reason.length < 10
                      ? `Faltam ${10 - reason.length} caracteres`
                      : "Motivo registrado nas notas da solicitação"}
                  </p>
                </div>

                {/* Footer */}
                <div
                  className="px-5 py-4 border-t flex gap-3"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <button
                    onClick={() => !loading && setStep("idle")}
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={() => doCancel({ force: true, cancellationReason: reason })}
                    disabled={reason.length < 10 || loading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-red-600 hover:bg-red-700"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        Confirmar cancelamento
                      </>
                    )}
                  </button>
                </div>

                {error && (
                  <p className="px-5 pb-4 text-[12px] text-red-600">{error}</p>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  // ── Estados normais: confirmação em dois passos ───────────
  if (!CANCELLABLE.has(currentStatus)) return null;

  return (
    <div className="flex items-center gap-2">
      {step === "idle" && (
        <button
          onClick={() => setStep("confirm")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-200 text-gray-400 hover:border-red-200 hover:text-red-600 hover:bg-red-50 transition-all"
        >
          <XCircle className="w-3.5 h-3.5" />
          Cancelar
        </button>
      )}

      {step === "confirm" && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ backgroundColor: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)" }}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          <span className="text-[12px] text-red-700">Confirma cancelamento?</span>
          <button
            onClick={() => doCancel()}
            disabled={loading}
            className="flex items-center gap-1 text-[12px] font-bold text-white bg-red-600 hover:bg-red-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Sim, cancelar"}
          </button>
          <button
            onClick={() => { setStep("idle"); setError(null); }}
            disabled={loading}
            className="text-[12px] text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            Voltar
          </button>
        </div>
      )}

      {error && step === "idle" && (
        <p className="text-[12px] text-red-600">{error}</p>
      )}
    </div>
  );
}
