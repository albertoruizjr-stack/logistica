"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, CheckCircle, XCircle, AlertTriangle, FileText,
  ArrowLeftRight, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────
// Tipos de ação no fluxo de 5 etapas
// ──────────────────────────────────────────────
type ActionType =
  | "indicate-origin"   // PENDING → AWAITING_APPROVAL (loja destino indica origem)
  | "approve"           // AWAITING_APPROVAL → READY_TO_COLLECT (loja origem aprova com TE/NF)
  | "reject-at-origin"  // AWAITING_APPROVAL → PENDING (loja origem recusa)
  | "cancel"            // qualquer não-terminal → CANCELLED
  | "patch-status";     // fallback legado (IN_TRANSIT → RECEIVED, etc.)

interface NextAction {
  label: string;
  type: ActionType;
  nextStatus?: string;  // só usado quando type === "patch-status"
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const NEXT_ACTIONS: Record<string, NextAction[]> = {
  // Fluxo novo de 5 etapas
  PENDING: [
    { label: "Indicar origem", type: "indicate-origin", icon: ArrowLeftRight, color: "text-amber-700 border-amber-200 hover:bg-amber-50" },
    { label: "Cancelar",       type: "cancel",          icon: XCircle,        color: "text-red-600 border-red-200 hover:bg-red-50" },
  ],
  AWAITING_APPROVAL: [
    { label: "Aprovar com TE/NF", type: "approve",          icon: CheckCircle, color: "text-blue-600 border-blue-200 hover:bg-blue-50" },
    { label: "Recusar",           type: "reject-at-origin", icon: RotateCcw,   color: "text-amber-700 border-amber-200 hover:bg-amber-50" },
    { label: "Cancelar",          type: "cancel",           icon: XCircle,     color: "text-red-600 border-red-200 hover:bg-red-50" },
  ],
  READY_TO_COLLECT: [
    { label: "Cancelar", type: "cancel", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" },
  ],
  IN_TRANSIT: [
    { label: "Cancelar", type: "cancel", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" },
  ],

  // Legados — transferências criadas antes do redesign continuam funcionando
  APPROVED:  [{ label: "Cancelar", type: "cancel", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" }],
  PREPARING: [{ label: "Cancelar", type: "cancel", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" }],
  PREPARED:  [{ label: "Cancelar", type: "cancel", icon: XCircle, color: "text-red-600 border-red-200 hover:bg-red-50" }],

  // Status terminais — sem ações
  DELIVERED: [],
  RECEIVED:  [],
  CANCELLED: [],
};

type ActiveModal = "cancel" | "approve" | "indicate-origin" | "reject" | null;

interface Props {
  transferId: string;
  currentStatus: string;
  priority: string;
  /** Loja destino (para filtrar candidatas de origem). Necessário para o fluxo novo PENDING. */
  toStoreId?: string;
  /** Quando false, mostra os botões em modo "somente leitura" (cinza) */
  canAct?: boolean;
  /** Nome/code da loja origem — usado na mensagem quando o user não pode agir */
  originStoreCode?: string;
}

interface StoreOption {
  id: string;
  code: string;
  name: string;
}

export function TransferActionsPanel({
  transferId,
  currentStatus,
  priority,
  toStoreId,
  canAct = true,
  originStoreCode,
}: Props) {
  const router = useRouter();
  const [loading, setLoading]         = useState<ActionType | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [error, setError]             = useState<string | null>(null);

  // Inputs dos modais
  const [reason, setReason]           = useState("");
  const [docType, setDocType]         = useState<"TE" | "NF">("TE");
  const [docNumber, setDocNumber]     = useState("");
  const [fromStoreId, setFromStoreId] = useState("");

  // Candidatas de origem (carregadas quando o modal indicate-origin abre)
  const [stores, setStores]               = useState<StoreOption[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);

  const actions = NEXT_ACTIONS[currentStatus] ?? [];

  useEffect(() => {
    if (activeModal !== "indicate-origin" || stores.length > 0) return;
    setStoresLoading(true);
    fetch("/api/stores")
      .then((r) => r.json())
      .then((json) => {
        const list: StoreOption[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        setStores(list.filter((s) => s.id !== toStoreId));
      })
      .catch(() => setError("Falha ao carregar lojas candidatas"))
      .finally(() => setStoresLoading(false));
  }, [activeModal, stores.length, toStoreId]);

  if (actions.length === 0) return null;

  async function callJson(
    url: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    actionType: ActionType,
  ) {
    setLoading(actionType);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) {
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

  function openModal(action: NextAction) {
    if (!canAct) return;
    setError(null);
    if (action.type === "cancel")           setActiveModal("cancel");
    else if (action.type === "approve")     setActiveModal("approve");
    else if (action.type === "indicate-origin") setActiveModal("indicate-origin");
    else if (action.type === "reject-at-origin") setActiveModal("reject");
    else if (action.type === "patch-status" && action.nextStatus) {
      // Fluxo legado direto (sem confirmação)
      void callJson(`/api/transferencias/${transferId}`, "PATCH", { status: action.nextStatus }, action.type);
    }
  }

  function closeModal() {
    setActiveModal(null);
    setReason(""); setDocNumber(""); setDocType("TE"); setFromStoreId("");
    setError(null);
  }

  async function handleIndicateOrigin() {
    if (!fromStoreId) { setError("Selecione uma loja"); return; }
    const ok = await callJson(
      `/api/transferencias/${transferId}/indicate-origin`,
      "POST",
      { fromStoreId },
      "indicate-origin",
    );
    if (ok) closeModal();
  }

  async function handleApprove() {
    const num = docNumber.trim();
    if (!num) { setError(`Informe o número da ${docType}`); return; }
    const body = docType === "TE" ? { teNumber: num } : { nfCitelNumero: num };
    const ok = await callJson(
      `/api/transferencias/${transferId}/approve`,
      "POST",
      body,
      "approve",
    );
    if (ok) closeModal();
  }

  async function handleReject() {
    if (reason.trim().length < 3) { setError("Informe o motivo (mín. 3 caracteres)"); return; }
    const ok = await callJson(
      `/api/transferencias/${transferId}/reject-at-origin`,
      "POST",
      { reason: reason.trim() },
      "reject-at-origin",
    );
    if (ok) closeModal();
  }

  async function handleCancel() {
    if (reason.trim().length < 10) { setError("Informe o motivo (mín. 10 caracteres)"); return; }
    const ok = await callJson(
      `/api/transferencias/${transferId}/cancel`,
      "POST",
      { reason: reason.trim() },
      "cancel",
    );
    if (ok) closeModal();
  }

  return (
    <>
      <div className={cn(
        "border-t px-5 py-3 flex items-center gap-2 flex-wrap",
        priority === "URGENT" ? "border-red-100" : "border-gray-100",
      )}>
        <span className="text-xs text-gray-400 mr-1">Ações:</span>
        {actions.map((action) => (
          <button
            key={action.type + "-" + (action.nextStatus ?? "")}
            onClick={() => openModal(action)}
            disabled={!canAct || loading !== null}
            title={!canAct ? `Apenas operadores da Loja ${originStoreCode ?? "origem"} podem agir` : undefined}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
              canAct ? action.color : "text-gray-400 border-gray-200",
            )}
          >
            {loading === action.type ? (
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

      {/* Modal: Indicar origem (PENDING → AWAITING_APPROVAL) */}
      {activeModal === "indicate-origin" && (
        <ModalShell
          title="Indicar loja origem"
          subtitle="Escolha qual loja vai fornecer o material desta transferência."
          icon={<ArrowLeftRight className="w-5 h-5 text-amber-600" />}
          loading={loading !== null}
          onClose={closeModal}
        >
          <label className="block text-[11.5px] font-semibold text-gray-700">
            Loja origem <span className="text-red-500">*</span>
          </label>
          {storesLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-gray-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Carregando lojas…
            </div>
          ) : (
            <select
              value={fromStoreId}
              onChange={(e) => setFromStoreId(e.target.value)}
              disabled={loading !== null}
              className="w-full px-3 py-2 rounded-lg text-[12.5px] border border-gray-300 outline-none disabled:opacity-50 focus:border-amber-400"
            >
              <option value="">Selecione…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          )}
          {error && <p className="text-[11px] text-red-600 font-medium">{error}</p>}
          <ModalFooter
            primaryLabel="Indicar origem"
            primaryIcon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            primaryColor="bg-amber-600 hover:bg-amber-700"
            primaryDisabled={!fromStoreId}
            onPrimary={handleIndicateOrigin}
            loading={loading === "indicate-origin"}
            onCancel={closeModal}
          />
        </ModalShell>
      )}

      {/* Modal: Aprovar (AWAITING_APPROVAL → READY_TO_COLLECT) com TE ou NF */}
      {activeModal === "approve" && (
        <ModalShell
          title="Aprovar transferência"
          subtitle={<>Informe o documento: uma <b>TE</b> (comprovante, não fiscal) ou uma <b>NF</b> (fiscal).</>}
          icon={<FileText className="w-5 h-5 text-blue-500" />}
          loading={loading !== null}
          onClose={closeModal}
        >
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
                    t === "NF" && "border-l border-gray-300",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
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
          <ModalFooter
            primaryLabel="Aprovar transferência"
            primaryIcon={<CheckCircle className="w-3.5 h-3.5" />}
            primaryColor="bg-blue-600 hover:bg-blue-700"
            primaryDisabled={docNumber.trim().length === 0}
            onPrimary={handleApprove}
            loading={loading === "approve"}
            onCancel={closeModal}
          />
        </ModalShell>
      )}

      {/* Modal: Recusar (AWAITING_APPROVAL → PENDING) */}
      {activeModal === "reject" && (
        <ModalShell
          title="Recusar indicação de origem"
          subtitle="A transferência volta para Pendente — a loja destino poderá indicar outra origem."
          icon={<RotateCcw className="w-5 h-5 text-amber-600" />}
          loading={loading !== null}
          onClose={closeModal}
        >
          <label className="block text-[11.5px] font-semibold text-gray-700">
            Motivo <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Ex: estoque físico real não confere com o sistema."
            disabled={loading !== null}
            className="w-full px-3 py-2 rounded-lg text-[12.5px] border border-gray-300 outline-none disabled:opacity-50 resize-none focus:border-amber-400"
          />
          {error && <p className="text-[11px] text-red-600 font-medium">{error}</p>}
          <ModalFooter
            primaryLabel="Recusar"
            primaryIcon={<RotateCcw className="w-3.5 h-3.5" />}
            primaryColor="bg-amber-600 hover:bg-amber-700"
            primaryDisabled={reason.trim().length < 3}
            onPrimary={handleReject}
            loading={loading === "reject-at-origin"}
            onCancel={closeModal}
          />
        </ModalShell>
      )}

      {/* Modal: Cancelar (qualquer não-terminal → CANCELLED) */}
      {activeModal === "cancel" && (
        <ModalShell
          title="Cancelar transferência"
          subtitle={<>O ledger será liberado conforme a etapa atual. Esta ação não pode ser desfeita.</>}
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          loading={loading !== null}
          onClose={closeModal}
        >
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
          <ModalFooter
            primaryLabel="Cancelar transferência"
            primaryIcon={<XCircle className="w-3.5 h-3.5" />}
            primaryColor="bg-red-600 hover:bg-red-700"
            primaryDisabled={reason.trim().length < 10}
            onPrimary={handleCancel}
            loading={loading === "cancel"}
            onCancel={closeModal}
          />
        </ModalShell>
      )}
    </>
  );
}

// ──────────────────────────────────────────────
// Helpers de modal — extraídos para reduzir repetição visual
// ──────────────────────────────────────────────

interface ModalShellProps {
  title: string;
  subtitle: React.ReactNode;
  icon: React.ReactNode;
  loading: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function ModalShell({ title, subtitle, icon, loading, onClose, children }: ModalShellProps) {
  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[2px]" onClick={() => !loading && onClose()} />
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-2.5">
            <div className="flex-shrink-0 mt-0.5">{icon}</div>
            <div className="min-w-0">
              <h2 className="text-[14px] font-bold text-gray-900 leading-tight">{title}</h2>
              <p className="text-[11.5px] text-gray-500 mt-1 leading-relaxed">{subtitle}</p>
            </div>
          </div>
          <div className="px-5 py-4 space-y-3">{children}</div>
        </div>
      </div>
    </>
  );
}

interface ModalFooterProps {
  primaryLabel: string;
  primaryIcon: React.ReactNode;
  primaryColor: string;
  primaryDisabled: boolean;
  loading: boolean;
  onPrimary: () => void;
  onCancel: () => void;
}

function ModalFooter({
  primaryLabel, primaryIcon, primaryColor, primaryDisabled, loading, onPrimary, onCancel,
}: ModalFooterProps) {
  return (
    <div className="px-5 py-3 -mx-5 -mb-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
      <button
        onClick={onCancel}
        disabled={loading}
        className="px-4 py-2 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
      >
        Voltar
      </button>
      <button
        onClick={onPrimary}
        disabled={loading || primaryDisabled}
        className={cn(
          "px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-50 flex items-center gap-1.5",
          primaryColor,
        )}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : primaryIcon}
        {primaryLabel}
      </button>
    </div>
  );
}
