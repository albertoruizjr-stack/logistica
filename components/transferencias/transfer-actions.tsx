"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle, ArrowRight, Truck, XCircle, AlertTriangle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

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
    { label: "Marcar como separada", nextStatus: "PREPARED", icon: CheckCircle, color: "text-teal-600 border-teal-200 hover:bg-teal-50" },
    { label: "Cancelar", nextStatus: "CANCELLED", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" },
  ],
  PREPARED: [
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
  /** Quando false, mostra os botões em modo "somente leitura" (cinza) */
  canAct?: boolean;
  /** Nome/code da loja origem — usado na mensagem quando o user não pode agir */
  originStoreCode?: string;
}

export function TransferActionsPanel({ transferId, currentStatus, priority, canAct = true, originStoreCode }: Props) {
  const router = useRouter();
  const [loading,      setLoading]      = useState<string | null>(null);
  const [cancelModal,  setCancelModal]  = useState(false);
  const [reason,       setReason]       = useState("");
  const [error,        setError]        = useState<string | null>(null);
  // Aprovação com documento (TE ou NF)
  const [approveModal, setApproveModal] = useState(false);
  const [docType,      setDocType]      = useState<"TE" | "NF">("TE");
  const [docNumber,    setDocNumber]    = useState("");

  const actions = NEXT_ACTIONS[currentStatus] ?? [];
  if (actions.length === 0) return null;

  async function patchStatus(nextStatus: string, extra: Record<string, unknown> = {}) {
    setLoading(nextStatus);
    setError(null);
    try {
      const res = await fetch(`/api/transferencias/${transferId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, ...extra }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao atualizar transferência");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Erro de conexão. Tente novamente.");
      return false;
    } finally {
      setLoading(null);
    }
  }

  async function handleAction(nextStatus: string) {
    if (!canAct) return;
    if (nextStatus === "CANCELLED") {
      setCancelModal(true);
      return;
    }
    if (nextStatus === "APPROVED") {
      setError(null);
      setApproveModal(true);
      return;
    }
    await patchStatus(nextStatus);
  }

  async function handleConfirmApprove() {
    const num = docNumber.trim();
    if (!num) {
      setError(`Informe o número da ${docType} para aprovar`);
      return;
    }
    const ok = await patchStatus("APPROVED", { docType, docNumber: num });
    if (ok) {
      setApproveModal(false);
      setDocNumber("");
      setDocType("TE");
    }
  }

  async function handleConfirmCancel() {
    if (reason.trim().length < 10) {
      setError("Informe o motivo do cancelamento (mín. 10 caracteres)");
      return;
    }
    const ok = await patchStatus("CANCELLED", { cancellationReason: reason.trim() });
    if (ok) {
      setCancelModal(false);
      setReason("");
    }
  }

  return (
    <>
      <div className={cn(
        "border-t px-5 py-3 flex items-center gap-2 flex-wrap",
        priority === "URGENT" ? "border-red-100" : "border-gray-100"
      )}>
        <span className="text-xs text-gray-400 mr-1">Ações:</span>
        {actions.map((action) => (
          <button
            key={action.nextStatus}
            onClick={() => handleAction(action.nextStatus)}
            disabled={!canAct || loading !== null}
            title={!canAct ? `Apenas operadores da Loja ${originStoreCode ?? "origem"} podem agir` : undefined}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
              canAct ? action.color : "text-gray-400 border-gray-200"
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
        {!canAct && originStoreCode && (
          <span className="text-[11px] text-gray-400 ml-1">
            Aprovação/cancelamento pela Loja {originStoreCode}
          </span>
        )}
      </div>

      {/* Modal de cancelamento — motivo obrigatório */}
      {cancelModal && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[2px]" onClick={() => !loading && setCancelModal(false)} />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold text-gray-900 leading-tight">Cancelar transferência</h2>
                  <p className="text-[11.5px] text-gray-500 mt-1 leading-relaxed">
                    O pedido voltará para <b>Aguardando transferência</b> e o Jhow será notificado para criar uma nova transferência no Autcom.
                  </p>
                </div>
              </div>
              <div className="px-5 py-4 space-y-2">
                <label className="block text-[11.5px] font-semibold text-gray-700">
                  Motivo do cancelamento <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Ex: O estoque do produto na nossa loja está zerado no momento. Aguardando reposição."
                  disabled={loading !== null}
                  className="w-full px-3 py-2 rounded-lg text-[12.5px] border border-gray-300 outline-none disabled:opacity-50 resize-none focus:border-red-400"
                />
                <p className="text-[10.5px] text-gray-400">
                  Mínimo 10 caracteres. {reason.trim().length}/10
                </p>
                {error && <p className="text-[11px] text-red-600 font-medium">{error}</p>}
              </div>
              <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
                <button
                  onClick={() => { setCancelModal(false); setReason(""); setError(null); }}
                  disabled={loading !== null}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                  Voltar
                </button>
                <button
                  onClick={handleConfirmCancel}
                  disabled={loading !== null || reason.trim().length < 10}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
                  {loading === "CANCELLED" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  Cancelar transferência
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal de aprovação — documento (TE ou NF) obrigatório */}
      {approveModal && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[2px]" onClick={() => !loading && setApproveModal(false)} />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-2.5">
                <FileText className="w-5 h-5 flex-shrink-0 mt-0.5 text-blue-500" />
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold text-gray-900 leading-tight">Aprovar transferência</h2>
                  <p className="text-[11.5px] text-gray-500 mt-1 leading-relaxed">
                    Informe o documento da transferência: uma <b>TE</b> (comprovante, não fiscal) ou uma <b>NF</b> (fiscal).
                  </p>
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                {/* Toggle TE | NF */}
                <div>
                  <span className="block text-[11.5px] font-semibold text-gray-700 mb-1.5">
                    Tipo de documento <span className="text-red-500">*</span>
                  </span>
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden w-fit">
                    {(["TE", "NF"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setDocType(t); setError(null); }}
                        disabled={loading !== null}
                        className={cn(
                          "px-4 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50",
                          docType === t ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50",
                          t === "NF" && "border-l border-gray-300"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Número do documento */}
                <div className="space-y-1.5">
                  <label className="block text-[11.5px] font-semibold text-gray-700">
                    Número da {docType} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder={docType === "TE" ? "Ex: 12345" : "Ex: 000123456"}
                    disabled={loading !== null}
                    className="w-full px-3 py-2 rounded-lg text-[12.5px] border border-gray-300 outline-none disabled:opacity-50 focus:border-blue-400"
                  />
                </div>
                {error && <p className="text-[11px] text-red-600 font-medium">{error}</p>}
              </div>
              <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
                <button
                  onClick={() => { setApproveModal(false); setDocNumber(""); setDocType("TE"); setError(null); }}
                  disabled={loading !== null}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                  Voltar
                </button>
                <button
                  onClick={handleConfirmApprove}
                  disabled={loading !== null || docNumber.trim().length === 0}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                  {loading === "APPROVED" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Aprovar transferência
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
