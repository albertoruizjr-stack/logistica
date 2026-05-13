"use client";

import { X, Lock, User, Clock } from "lucide-react";
import type { ClaimInfo } from "@/services/claim.service";

interface ClaimConflictModalProps {
  claim:   ClaimInfo;
  onClose: () => void;
}

const LOCK_REASON_LABEL: Record<string, string> = {
  SEPARACAO:    "em separação",
  FISCAL:       "na fase fiscal",
  ROTEIRIZACAO: "em roteirização",
  DESPACHO:     "no despacho",
  OCORRENCIA:   "resolvendo ocorrência",
};

export function ClaimConflictModal({ claim, onClose }: ClaimConflictModalProps) {
  const lockedAtStr = new Date(claim.lockedAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  const reasonLabel = LOCK_REASON_LABEL[claim.lockReason] ?? claim.lockReason;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-sm rounded-xl overflow-hidden"
        style={{ backgroundColor: "#111318", border: "1px solid #EF444433" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #1E2530" }}
        >
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" style={{ color: "#EF4444" }} />
            <span className="text-[13px] font-bold" style={{ color: "#E5E7EB" }}>
              Card em uso
            </span>
          </div>
          <button onClick={onClose} style={{ color: "#6B7280" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-[12px] leading-relaxed" style={{ color: "#9CA3AF" }}>
            Esta solicitação está sendo operada por outro operador no momento.
            Aguarde a conclusão antes de prosseguir.
          </p>

          {/* Info do operador */}
          <div
            className="rounded-lg p-4 space-y-2"
            style={{ backgroundColor: "#0D1117", border: "1px solid #1E2530" }}
          >
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#6B7280" }} />
              <span className="text-[12px] font-semibold" style={{ color: "#E5E7EB" }}>
                {claim.lockedByName}
              </span>
              <span className="text-[11px]" style={{ color: "#4B5563" }}>
                {reasonLabel}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#6B7280" }} />
              <span className="text-[11px]" style={{ color: "#6B7280" }}>
                Desde {lockedAtStr} — expira em{" "}
                <span style={{ color: claim.minutesLeft <= 2 ? "#FCD34D" : "#9CA3AF" }}>
                  {claim.minutesLeft} min
                </span>
              </span>
            </div>
          </div>

          {claim.minutesLeft <= 2 && (
            <p className="text-[11px]" style={{ color: "#FCD34D" }}>
              O lock expira em breve. Você poderá prosseguir automaticamente.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-[12px] font-semibold"
            style={{ backgroundColor: "#1E2530", color: "#9CA3AF" }}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
