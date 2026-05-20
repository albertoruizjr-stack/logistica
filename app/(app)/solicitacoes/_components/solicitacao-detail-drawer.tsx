"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  X, Loader2, User, Phone, CreditCard, MapPin, Package,
  Truck, Weight, ShoppingCart, ExternalLink, Calendar, Clock,
  AlertTriangle, CheckCircle2, RefreshCw, ArrowLeftRight, Search,
  Receipt,
} from "lucide-react";
import { cn, formatCurrency, formatDateTime, formatRelativeTime } from "@/lib/utils";
import { TransferItemLinkModal } from "./transfer-item-link-modal";

// ─── Tipos ──────────────────────────────────────────────────

interface SolicitacaoDetail {
  id:                string;
  orderNumber:       string | null;
  orderStoreCode:    string | null;
  invoiceNumber:     string | null;
  invoiceStoreCode:  string | null;
  status:            string;
  deliveryType:      string;
  scheduledFor:      string | null;
  createdAt:         string;
  customerName:      string;
  customerPhone:     string | null;
  customerDoc:       string | null;
  deliveryAddress:   string;
  storeId:           string;
  storeCode:         string;
  storeName:         string;
  sellerName:        string;
  chargedFreight:    number;
  items: {
    id: string;
    productCode: string;
    productName: string;
    quantity: number;
    unit: string;
    availableAtStore: boolean;
    grossWeight: number | null;
  }[];
  itemCount:         number;
  totalWeightKg:     number;
  dispatch: {
    driverName:     string | null;
    driverPhone:    string | null;
    modal:          string;
    status:         string;
    dispatchedAt:   string | null;
    completedAt:    string | null;
    lalamoveStatus: string | null;
    shareLink:      string | null;
  } | null;
  notes:             string | null;
  currentUserRole:    string;
  currentUserStoreId: string;
  // Responsabilidade pela próxima ação (Fase A)
  entregaPeloCD?:     boolean;
  dispatchStoreId?:   string | null;
  responsibility?: {
    responsibleStoreId:   string;
    responsibleStoreCode: string | null;
    primaryRole:          string;
    fallbackRoles:        string[];
    actionLabel:          string;
    responsibleUsers:     Array<{ id: string; name: string; role: string }>;
  } | null;
  transfers: TransferSummary[];
}

interface TransferSummary {
  id:            string;
  status:        "PENDING" | "APPROVED" | "PREPARING" | "DISPATCHED" | "RECEIVED" | "CANCELLED";
  priority:      string;
  fromStoreCode: string;
  fromStoreName: string;
  toStoreCode:   string;
  nfCitelNumero: string | null;
  requestedAt:   string;
  approvedAt:    string | null;
  dispatchedAt:  string | null;
  notes:         string | null;
  items: {
    id: string;
    productCode: string;
    productName: string;
    quantity: number;
    unit: string;
    linkedCitelPD:        string | null;
    linkedCitelStoreCode: string | null;
    linkedAt:             string | null;
  }[];
}

const TRANSFER_STATUS_FALLBACK = { label: "—", color: "#525252", bg: "rgba(115,115,115,0.12)" };

const TRANSFER_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:    { label: "Aguardando confirmação no Autcom", color: "#92400E", bg: "rgba(217,119,6,0.12)"  },
  APPROVED:   { label: "Confirmada · aguardando coleta",   color: "#1E40AF", bg: "rgba(37,99,235,0.12)"  },
  PREPARING:  { label: "Em separação na loja origem",      color: "#1E40AF", bg: "rgba(37,99,235,0.12)"  },
  PREPARED:   { label: "Separada · aguardando coleta",     color: "#0F766E", bg: "rgba(20,184,166,0.12)" },
  IN_TRANSIT: { label: "Em trânsito",                      color: "#155E75", bg: "rgba(8,145,178,0.12)"  },
  RECEIVED:   { label: "Recebida",                         color: "#15803D", bg: "rgba(22,163,74,0.12)"  },
  CANCELLED:  { label: "Cancelada",                        color: "#991B1B", bg: "rgba(220,38,38,0.12)"  },
};

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:            { label: "Pendente",                color: "#92400E", bg: "rgba(217,119,6,0.10)"  },
  AWAITING_ITEMS:     { label: "Aguardando itens",         color: "#92400E", bg: "rgba(217,119,6,0.10)"  },
  AWAITING_TRANSFER:  { label: "Aguardando transferência", color: "#92400E", bg: "rgba(217,119,6,0.10)"  },
  READY:              { label: "Pronto p/ despacho",       color: "#1E40AF", bg: "rgba(37,99,235,0.10)"  },
  DISPATCHED:         { label: "Despachado",               color: "#1E40AF", bg: "rgba(37,99,235,0.10)"  },
  IN_TRANSIT:         { label: "Em trânsito",              color: "#155E75", bg: "rgba(8,145,178,0.10)"  },
  DELIVERED:          { label: "Entregue",                 color: "#15803D", bg: "rgba(22,163,74,0.10)"  },
  CANCELLED:          { label: "Cancelado",                color: "#991B1B", bg: "rgba(220,38,38,0.10)"  },
};

// ─── Componente ──────────────────────────────────────────────

interface Props {
  requestId: string | null;
  onClose: () => void;
}

export function SolicitacaoDetailDrawer({ requestId, onClose }: Props) {
  const [data,    setData]    = useState<SolicitacaoDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [refreshing,   setRefreshing]   = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshOk,    setRefreshOk]    = useState<string | null>(null);

  const loadData = useCallback(async (id: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/solicitacoes/${id}`, { signal });
      const json = await res.json();
      if (signal?.aborted) return;
      if (!json.success) {
        setError(json.error ?? "Erro ao carregar solicitação");
        setData(null);
      } else {
        setData(json.data);
      }
    } catch (e) {
      if (signal?.aborted) return;
      setError("Erro de conexão");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!requestId) {
      setData(null);
      setError(null);
      setRefreshError(null);
      setRefreshOk(null);
      return;
    }
    const ctrl = new AbortController();
    void loadData(requestId, ctrl.signal);
    return () => ctrl.abort();
  }, [requestId, loadData]);

  const [confirmingTransfer, setConfirmingTransfer] = useState<string | null>(null);
  const [promotingSeparation, setPromotingSeparation] = useState(false);
  const [resolvingItem, setResolvingItem] = useState<string | null>(null);
  const [advancingStage, setAdvancingStage] = useState(false);
  const [nfModalOpen, setNfModalOpen] = useState(false);
  const [nfNumberInput, setNfNumberInput] = useState("");
  const [submittingNf, setSubmittingNf] = useState(false);
  const [nfError, setNfError] = useState<string | null>(null);
  const [nfPeekLoading, setNfPeekLoading] = useState(false);
  const [nfPeekMessage, setNfPeekMessage] = useState<string | null>(null);
  const [nfPeekOptions, setNfPeekOptions] = useState<Array<{
    number: string; storeCode: string; storeId: string | null;
    itemCount: number; dataFaturamento: string | null;
  }>>([]);
  const [selectedInvoiceStoreId, setSelectedInvoiceStoreId] = useState<string | null>(null);
  const [linkingModal, setLinkingModal] = useState<{
    transferId: string;
    itemId:     string;
    productCode: string;
    productName: string;
    neededQty:  number;
    unit:       string;
  } | null>(null);

  async function handleResolveByStock(transferId: string, itemId: string) {
    if (resolvingItem) return;
    setResolvingItem(itemId);
    setRefreshError(null);
    try {
      const res = await fetch(`/api/transferencias/${transferId}/items/${itemId}/resolve-by-stock`, { method: "POST" });
      const json = await res.json();
      if (!json.success) {
        setRefreshError(json.error ?? "Falha ao resolver item por estoque");
      } else if (requestId) {
        await loadData(requestId);
      }
    } catch {
      setRefreshError("Erro de conexão");
    } finally {
      setResolvingItem(null);
    }
  }

  async function handleAdvanceStage(toStatus: string) {
    if (!requestId || advancingStage) return;
    setAdvancingStage(true);
    setRefreshError(null);
    try {
      const res = await fetch(`/api/operacao/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, toStatus }),
      });
      const json = await res.json();
      if (!json.success) {
        setRefreshError(json.error ?? "Falha ao avançar o pedido");
      } else {
        await loadData(requestId);
      }
    } catch {
      setRefreshError("Erro de conexão");
    } finally {
      setAdvancingStage(false);
    }
  }

  async function openNfModal() {
    if (!requestId) return;
    setNfNumberInput("");
    setNfError(null);
    setNfPeekMessage(null);
    setNfPeekOptions([]);
    setSelectedInvoiceStoreId(null);
    setNfModalOpen(true);
    setNfPeekLoading(true);
    try {
      const res = await fetch(`/api/solicitacoes/${requestId}/peek-nf`);
      const json = await res.json();
      if (!json.success) {
        setNfPeekMessage(json.error ?? "Não foi possível consultar o Citel");
        return;
      }
      const invoices = (json.data?.invoices ?? []) as Array<{
        number: string; storeCode: string; storeId: string | null;
        itemCount: number; dataFaturamento: string | null;
      }>;
      if (invoices.length === 0) {
        setNfPeekMessage(json.data?.message ?? "PD ainda não foi faturado no Citel");
        return;
      }
      setNfPeekOptions(invoices);
      // Pré-preenche com a NF de maior contagem (já vem ordenado desc)
      setNfNumberInput(invoices[0].number);
      setSelectedInvoiceStoreId(invoices[0].storeId);
    } catch {
      setNfPeekMessage("Erro de conexão ao consultar o Citel");
    } finally {
      setNfPeekLoading(false);
    }
  }

  async function handleSubmitNf() {
    if (!requestId || !data || submittingNf) return;
    const trimmed = nfNumberInput.trim();
    if (trimmed.length === 0) {
      setNfError("Informe o número da NF emitida no Citel");
      return;
    }
    setSubmittingNf(true);
    setNfError(null);
    try {
      // 1) Vincula a NF (preenche invoiceNumber + invoiceStoreId)
      const linkRes = await fetch(`/api/solicitacoes/${requestId}/vincular-nf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber:  trimmed,
          invoiceStoreId: selectedInvoiceStoreId ?? data.storeId,
        }),
      });
      const linkJson = await linkRes.json();
      if (!linkJson.success) {
        setNfError(linkJson.error ?? "Falha ao vincular NF");
        return;
      }
      // 2) Avança o estado para NF_VINCULADA
      const advRes = await fetch(`/api/operacao/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, toStatus: "NF_VINCULADA" }),
      });
      const advJson = await advRes.json();
      if (!advJson.success) {
        setNfError(advJson.error ?? "NF vinculada, mas falhou ao avançar o pedido");
        return;
      }
      setNfModalOpen(false);
      setNfNumberInput("");
      await loadData(requestId);
    } catch {
      setNfError("Erro de conexão");
    } finally {
      setSubmittingNf(false);
    }
  }

  async function handlePromoteToSeparation() {
    if (!requestId || promotingSeparation) return;
    setPromotingSeparation(true);
    setRefreshError(null);
    try {
      const res = await fetch(`/api/solicitacoes/${requestId}/seguir-separacao`, { method: "POST" });
      const json = await res.json();
      if (!json.success) {
        setRefreshError(json.error ?? "Falha ao promover para separação");
      } else {
        setRefreshOk("Pedido promovido para Separação");
        await loadData(requestId);
      }
    } catch {
      setRefreshError("Erro de conexão");
    } finally {
      setPromotingSeparation(false);
    }
  }

  async function handleConfirmTransfer(transferId: string) {
    if (confirmingTransfer) return;
    setConfirmingTransfer(transferId);
    try {
      const res = await fetch(`/api/transferencias/${transferId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      const json = await res.json();
      if (!json.success) {
        setRefreshError(json.error ?? "Falha ao confirmar transferência");
      } else if (requestId) {
        await loadData(requestId);
      }
    } catch {
      setRefreshError("Erro de conexão");
    } finally {
      setConfirmingTransfer(null);
    }
  }

  async function handleRefreshFromErp() {
    if (!requestId || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    setRefreshOk(null);
    try {
      const res = await fetch(`/api/solicitacoes/${requestId}/refresh-citel`, { method: "POST" });
      const json = await res.json();
      if (!json.success) {
        setRefreshError(json.error ?? "Falha ao recarregar do ERP");
      } else {
        const d = json.data;
        const parts: string[] = [];
        if (d.itemsLoaded) parts.push(`${d.itemsLoaded} ${d.itemsLoaded === 1 ? "item carregado" : "itens carregados"}`);
        if (d.transferCreated && d.autoLinkTotal > 0) {
          if (d.autoLinkedCount === d.autoLinkTotal) {
            parts.push(`✓ ${d.autoLinkedCount} de ${d.autoLinkTotal} vinculados automaticamente`);
          } else if (d.autoLinkedCount > 0) {
            parts.push(`${d.autoLinkedCount} de ${d.autoLinkTotal} vinculados · ${d.autoLinkTotal - d.autoLinkedCount} precisam de confirmação manual`);
          } else {
            parts.push(`${d.autoLinkTotal} ${d.autoLinkTotal === 1 ? "item precisa" : "itens precisam"} de vínculo manual`);
          }
        } else if (d.transferCreated) {
          parts.push("transferência criada");
        }
        setRefreshOk(parts.join(" · "));
        await loadData(requestId);
      }
    } catch {
      setRefreshError("Erro de conexão com o ERP");
    } finally {
      setRefreshing(false);
    }
  }

  // ESC para fechar
  useEffect(() => {
    if (!requestId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestId, onClose]);

  if (!requestId) return null;

  const statusConfig = data ? (STATUS_LABEL[data.status] ?? { label: data.status, color: "#525252", bg: "rgba(115,115,115,0.08)" }) : null;
  const docTitle = data?.orderNumber
    ? `PD ${data.orderNumber}${data.orderStoreCode ? ` · Loja ${data.orderStoreCode}` : ""}`
    : data?.invoiceNumber
      ? `NF ${data.invoiceNumber}`
      : data ? `Solicitação #${data.id.slice(-6)}` : "Carregando…";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col shadow-2xl"
           style={{ backgroundColor: "var(--color-surface)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
             style={{ borderColor: "var(--color-border)" }}>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold truncate"
                style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}>
              {docTitle}
            </h2>
            {data && (
              <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--color-muted-text)" }}>
                Loja {data.storeCode} · {formatRelativeTime(data.createdAt)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {data?.orderNumber && data.status !== "CANCELLED" && data.status !== "DELIVERED" && (
              <button onClick={handleRefreshFromErp}
                      disabled={refreshing}
                      title="Atualizar com dados frescos do ERP (itens, peso, estoque)"
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100 disabled:opacity-50">
                {refreshing
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--color-primary)" }} />
                  : <RefreshCw className="w-3.5 h-3.5" style={{ color: "var(--color-muted-text)" }} />}
              </button>
            )}
            <button onClick={onClose}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100">
              <X className="w-4 h-4" style={{ color: "var(--color-muted-text)" }} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-primary)" }} />
              <p className="text-[12px]" style={{ color: "var(--color-muted-text)" }}>Carregando solicitação…</p>
            </div>
          )}

          {error && !loading && (
            <div className="px-6 py-8 flex flex-col items-center text-center gap-2">
              <AlertTriangle className="w-6 h-6" style={{ color: "#DC2626" }} />
              <p className="text-[13px] font-medium" style={{ color: "var(--color-body-text)" }}>
                Não foi possível carregar
              </p>
              <p className="text-[12px]" style={{ color: "var(--color-muted-text)" }}>{error}</p>
            </div>
          )}

          {data && !loading && (
            <div className="px-6 py-5 space-y-5">

              {/* Banner: dados do ERP em branco */}
              {data.orderNumber && data.itemCount === 0 && data.status !== "CANCELLED" && data.status !== "DELIVERED" && (
                <div className="rounded-lg px-3.5 py-3"
                     style={{ backgroundColor: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.25)" }}>
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#D97706" }} />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold leading-tight" style={{ color: "#92400E" }}>
                        Itens não carregados do ERP
                      </p>
                      <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: "var(--color-muted-text)" }}>
                        Esta solicitação foi criada quando a Citel estava indisponível. Clique abaixo para buscar os itens, peso e disponibilidade de estoque agora.
                      </p>
                    </div>
                  </div>
                  <button onClick={handleRefreshFromErp}
                          disabled={refreshing}
                          className="w-full flex items-center justify-center gap-2 text-[12px] font-semibold py-2 rounded-lg transition-colors disabled:opacity-60"
                          style={{ backgroundColor: "#D97706", color: "white" }}>
                    {refreshing
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando Citel…</>
                      : <><RefreshCw className="w-3.5 h-3.5" /> Recarregar do ERP</>}
                  </button>
                  {refreshError && (
                    <p className="text-[11px] mt-2 font-medium" style={{ color: "#B91C1C" }}>
                      {refreshError}
                    </p>
                  )}
                </div>
              )}

              {refreshOk && (
                <div className="rounded-lg px-3.5 py-2.5 flex items-start gap-2"
                     style={{ backgroundColor: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.25)" }}>
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#16A34A" }} />
                  <p className="text-[12px] font-medium" style={{ color: "#15803D" }}>{refreshOk}</p>
                </div>
              )}

              {/* Status + tipo */}
              <div className="flex items-center gap-2">
                {statusConfig && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase"
                        style={{ backgroundColor: statusConfig.bg, color: statusConfig.color, letterSpacing: "0.04em" }}>
                    {statusConfig.label}
                  </span>
                )}
                {data.deliveryType === "URGENT" && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase flex items-center gap-1"
                        style={{ backgroundColor: "rgba(220,38,38,0.10)", color: "#B91C1C", letterSpacing: "0.04em" }}>
                    Urgente
                  </span>
                )}
                {data.invoiceNumber && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase"
                        style={{ backgroundColor: "rgba(22,163,74,0.08)", color: "#15803D", letterSpacing: "0.04em" }}>
                    NF {data.invoiceNumber}
                  </span>
                )}
              </div>

              {/* Próxima ação — botão pro responsável; mensagem informativa pros demais */}
              {(() => {
                // Mapa status atual → próxima ação principal
                const NEXT_ACTION: Record<string, { label: string; toStatus: string }> = {
                  PENDING:             { label: "Confirmar separação",     toStatus: "SEPARADO"            },
                  AWAITING_TRANSFER:   { label: "Seguir para Separação",   toStatus: "SEPARADO"            },
                  // SEPARADO renderiza bloco especial (aguardando NF automática), não botão.
                  // Por isso não está mais aqui — cai no fallback que mostra o bloco custom abaixo.
                  AGUARDANDO_NF:       { label: "NF emitida no Citel",     toStatus: "NF_VINCULADA"        },
                  NF_VINCULADA:        { label: "Liberar para Roteirização", toStatus: "PRONTO_ROTEIRIZACAO" },
                  PRONTO_ROTEIRIZACAO: { label: "Roteirizar",              toStatus: "ROTEIRIZADO"         },
                  ROTEIRIZADO:         { label: "Despachar",               toStatus: "DISPATCHED"          },
                  IN_TRANSIT:          { label: "Confirmar Entrega",       toStatus: "DELIVERED"           },
                };
                // Estado SEPARADO: NF é vinculada automaticamente pelo cron Citel.
                // Mostramos bloco passivo + botão "Verificar agora" pra forçar imediato.
                if (data.status === "SEPARADO") {
                  return (
                    <SeparadoAutoNfBlock
                      deliveryRequestId={data.id}
                      onLinked={() => loadData(data.id)}
                    />
                  );
                }

                const action = NEXT_ACTION[data.status];
                if (!action) return null;

                // Regra de visibilidade (Fase A):
                //   - ADMIN sempre pode agir (override global)
                //   - Senão: precisa estar na loja responsável E ter role compatível
                const resp = data.responsibility;
                const isAdmin = data.currentUserRole === "ADMIN";
                const canAct  = isAdmin || (
                  !!resp &&
                  data.currentUserStoreId === resp.responsibleStoreId &&
                  [resp.primaryRole, ...resp.fallbackRoles].includes(data.currentUserRole)
                );

                if (canAct) {
                  // Casos especiais:
                  //  - AWAITING_TRANSFER usa handler dedicado (auto-resolve transfers)
                  //  - AGUARDANDO_NF abre modal pra capturar número da NF antes de avançar
                  const isPromote = data.status === "AWAITING_TRANSFER";
                  const isNfStep  = data.status === "AGUARDANDO_NF";
                  const onClick   = isPromote
                    ? handlePromoteToSeparation
                    : isNfStep
                      ? openNfModal
                      : () => handleAdvanceStage(action.toStatus);
                  const busy = isPromote ? promotingSeparation : isNfStep ? submittingNf : advancingStage;
                  return (
                    <section>
                      <p className="text-[10.5px] font-semibold uppercase mb-1.5"
                         style={{ letterSpacing: "0.10em", color: "var(--color-muted-text)" }}>
                        Próxima ação
                      </p>
                      <button onClick={onClick}
                              disabled={busy}
                              className="w-full flex items-center justify-center gap-2 text-[13px] font-bold py-3 rounded-lg transition-all disabled:opacity-60"
                              style={{ backgroundColor: "var(--color-primary)", color: "white", boxShadow: "0 2px 8px rgba(249,115,22,0.25)" }}
                              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-primary-dark)"}
                              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-primary)"}>
                        {busy
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando…</>
                          : <><CheckCircle2 className="w-4 h-4" /> {action.label}</>}
                      </button>
                    </section>
                  );
                }

                // Não-responsável: mostra mensagem informativa com quem deve agir
                if (!resp) return null;
                const ROLE_LABEL: Record<string, string> = {
                  STOCK_OPERATOR:     "Estoque",
                  LOGISTICS_OPERATOR: "Logística",
                  STORE_LEADER:       "Líder",
                  OPERATOR:           "Operador",
                };
                const names = resp.responsibleUsers.length > 0
                  ? resp.responsibleUsers.map(u => `${u.name} (${ROLE_LABEL[u.role] ?? u.role})`).join(", ")
                  : `${ROLE_LABEL[resp.primaryRole] ?? resp.primaryRole} da loja`;
                const storeLabel = resp.responsibleStoreCode ? ` — Loja ${resp.responsibleStoreCode}` : "";
                return (
                  <section>
                    <p className="text-[10.5px] font-semibold uppercase mb-1.5"
                       style={{ letterSpacing: "0.10em", color: "var(--color-muted-text)" }}>
                      Próxima ação
                    </p>
                    <div className="rounded-lg px-3.5 py-3 text-[12.5px] leading-snug"
                         style={{ backgroundColor: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.18)", color: "var(--color-body-text)" }}>
                      <p className="font-semibold mb-0.5">Aguardando {resp.actionLabel}</p>
                      <p style={{ color: "var(--color-muted-text)" }}>
                        Responsável: {names}{storeLabel}
                      </p>
                    </div>
                  </section>
                );
              })()}

              {/* Destinatário */}
              <section>
                <SectionTitle icon={User} label="Destinatário" color="#6366F1" />
                <div className="rounded-lg px-3.5 py-3"
                     style={{ backgroundColor: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.15)" }}>
                  <p className="text-[14px] font-semibold leading-tight mb-1.5"
                     style={{ color: "var(--color-body-text)" }}>
                    {data.customerName}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]"
                       style={{ color: "var(--color-muted-text)" }}>
                    {data.customerPhone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {data.customerPhone}
                      </span>
                    )}
                    {data.customerDoc && (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <CreditCard className="w-3 h-3" /> {data.customerDoc}
                      </span>
                    )}
                  </div>
                </div>
              </section>

              {/* Stats: peso + itens + frete */}
              <section className="grid grid-cols-3 gap-2">
                <StatBox icon={Weight}       label="Peso"   value={`${data.totalWeightKg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`} color="#F97316" />
                <StatBox icon={ShoppingCart} label="Itens"  value={`${data.itemCount}`}                                                            color="#6366F1" />
                <StatBox icon={Truck}        label="Frete"  value={formatCurrency(data.chargedFreight)}                                            color="#0EA5E9" />
              </section>

              {/* Sem Transfer ativa mas há itens faltando — botão pra solicitar */}
              {data.status === "AWAITING_TRANSFER" && data.transfers.length === 0 && (
                <section>
                  <div className="rounded-lg px-3.5 py-3"
                       style={{ backgroundColor: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.25)" }}>
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#D97706" }} />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold leading-tight" style={{ color: "#92400E" }}>
                          Transferência pendente
                        </p>
                        <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: "var(--color-muted-text)" }}>
                          Há itens faltando no estoque desta loja. Clique no botão abaixo para registrar a solicitação de transferência — em seguida você confirma um PD do Autcom por item.
                        </p>
                      </div>
                    </div>
                    <button onClick={handleRefreshFromErp}
                            disabled={refreshing}
                            className="w-full flex items-center justify-center gap-2 text-[12px] font-semibold py-2 rounded-lg transition-colors disabled:opacity-60"
                            style={{ backgroundColor: "#D97706", color: "white" }}>
                      {refreshing
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Solicitando…</>
                        : <><ArrowLeftRight className="w-3.5 h-3.5" /> Transferência solicitada</>}
                    </button>
                  </div>
                </section>
              )}

              {/* Transferências necessárias — botão por item */}
              {data.transfers.length > 0 && (
                <section>
                  <SectionTitle icon={ArrowLeftRight} label={`Transferências (${data.transfers.length})`} color="#D97706" />
                  <div className="space-y-2">
                    {data.transfers.map(t => {
                      const tconf = TRANSFER_STATUS_LABEL[t.status] ?? TRANSFER_STATUS_FALLBACK;
                      const canLink = ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(data.currentUserRole);
                      const linkedCount = t.items.filter(i => i.linkedCitelPD !== null).length;
                      const allLinked = linkedCount === t.items.length && t.items.length > 0;

                      return (
                        <div key={t.id} className="rounded-lg overflow-hidden"
                             style={{ border: "1px solid var(--color-border)" }}>
                          {/* cabeçalho da transfer */}
                          <div className="px-3.5 py-2.5"
                               style={{ backgroundColor: tconf.bg }}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10.5px] font-bold uppercase"
                                    style={{ color: tconf.color, letterSpacing: "0.06em" }}>
                                {tconf.label}
                              </span>
                              <span className="text-[10px] font-mono"
                                    style={{ color: tconf.color, opacity: .75 }}>
                                {formatRelativeTime(t.requestedAt)}
                              </span>
                            </div>
                            <p className="text-[11.5px]" style={{ color: tconf.color }}>
                              {linkedCount} de {t.items.length} {t.items.length === 1 ? "item confirmado" : "itens confirmados"} no Autcom
                            </p>
                          </div>

                          {/* lista de items com botão individual */}
                          <div className="divide-y">
                            {t.items.map(item => {
                              const linked = item.linkedCitelPD !== null;
                              const resolvedByStock = item.linkedCitelPD === "RESOLVED_BY_STOCK";
                              return (
                                <div key={item.id} className="px-3.5 py-2.5">
                                  <div className="flex items-start gap-2">
                                    {/* indicador */}
                                    {linked ? (
                                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#16A34A" }} />
                                    ) : (
                                      <div className="w-3.5 h-3.5 rounded-full flex-shrink-0 mt-0.5 border-2 border-dashed" style={{ borderColor: "#D97706" }} />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[12px] font-medium leading-tight"
                                         style={{ color: linked ? "var(--color-muted-text)" : "var(--color-body-text)" }}>
                                        {item.productName}
                                      </p>
                                      <p className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--color-muted-text)" }}>
                                        {item.productCode} · {item.quantity} {item.unit}
                                      </p>
                                      {linked && resolvedByStock && (
                                        <p className="text-[10.5px] mt-1 font-medium inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                                           style={{ backgroundColor: "rgba(99,102,241,0.10)", color: "#4338CA" }}>
                                          <Package className="w-2.5 h-2.5" />
                                          Resolvido — produto encontrado em estoque
                                        </p>
                                      )}
                                      {linked && !resolvedByStock && (
                                        <p className="text-[10.5px] mt-1 font-medium inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                                           style={{ backgroundColor: "rgba(22,163,74,0.10)", color: "#15803D" }}>
                                          <CheckCircle2 className="w-2.5 h-2.5" />
                                          PD {item.linkedCitelPD?.replace(/^0+/, "")} · Loja {item.linkedCitelStoreCode}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  {!linked && canLink && (
                                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                                      <button
                                        onClick={() => setLinkingModal({
                                          transferId: t.id, itemId: item.id,
                                          productCode: item.productCode, productName: item.productName,
                                          neededQty: item.quantity, unit: item.unit,
                                        })}
                                        className="flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg transition-colors"
                                        style={{ backgroundColor: "rgba(217,119,6,0.08)", color: "#92400E", border: "1px solid rgba(217,119,6,0.25)" }}
                                        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(217,119,6,0.15)"}
                                        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(217,119,6,0.08)"}
                                      >
                                        <Search className="w-3 h-3" /> Buscar PD no Autcom
                                      </button>
                                      <button
                                        onClick={() => handleResolveByStock(t.id, item.id)}
                                        disabled={resolvingItem === item.id}
                                        title="O produto estava em estoque na loja, mesmo o Citel acusando falta"
                                        className="flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                        style={{ backgroundColor: "rgba(99,102,241,0.08)", color: "#4338CA", border: "1px solid rgba(99,102,241,0.25)" }}
                                        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(99,102,241,0.15)"}
                                        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(99,102,241,0.08)"}
                                      >
                                        {resolvingItem === item.id
                                          ? <><Loader2 className="w-3 h-3 animate-spin" /> Resolvendo</>
                                          : <><Package className="w-3 h-3" /> Em estoque</>}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* todas as transferências confirmadas — só info */}
                          {allLinked && (
                            <div className="px-3.5 py-2 border-t flex items-center gap-2"
                                 style={{ borderColor: "var(--color-border)", backgroundColor: "rgba(22,163,74,0.05)" }}>
                              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#16A34A" }} />
                              <p className="text-[11px] font-medium" style={{ color: "#15803D" }}>
                                Todos os itens confirmados no Autcom.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Botão "Seguir para Separação" foi movido pro bloco "Próxima ação" no topo. */}

              {/* Modal de busca de PD interno */}
              {linkingModal && (
                <TransferItemLinkModal
                  transferId={linkingModal.transferId}
                  itemId={linkingModal.itemId}
                  productCode={linkingModal.productCode}
                  productName={linkingModal.productName}
                  neededQty={linkingModal.neededQty}
                  unit={linkingModal.unit}
                  onClose={() => setLinkingModal(null)}
                  onLinked={(allLinked) => {
                    setLinkingModal(null);
                    if (requestId) void loadData(requestId);
                    if (allLinked) setRefreshOk("Todas as transferências confirmadas — pedido em Separação");
                  }}
                />
              )}

              {/* Modal: confirmar emissão da NF no Citel */}
              {nfModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center px-4"
                     style={{ backgroundColor: "rgba(17,17,17,0.45)" }}
                     onClick={() => !submittingNf && setNfModalOpen(false)}>
                  <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl"
                       style={{ border: "1px solid var(--color-border)" }}
                       onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                           style={{ backgroundColor: "rgba(249,115,22,0.10)", color: "var(--color-primary)" }}>
                        <Receipt className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-semibold leading-tight"
                            style={{ color: "var(--color-body-text)", fontFamily: "var(--font-display)" }}>
                          NF emitida no Citel
                        </h3>
                        <p className="text-[11.5px] mt-1" style={{ color: "var(--color-muted-text)" }}>
                          Informe o número da nota fiscal emitida pela {data.storeCode} para vincular ao PD {data.orderNumber ?? data.id.slice(-6)}.
                        </p>
                      </div>
                    </div>

                    {nfPeekLoading && (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg mb-3 text-[11.5px]"
                           style={{ backgroundColor: "#FAFAFA", color: "var(--color-muted-text)",
                                    border: "1px solid var(--color-border)" }}>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Consultando NF no Citel…
                      </div>
                    )}

                    {!nfPeekLoading && nfPeekOptions.length === 1 && (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg mb-3 text-[11.5px]"
                           style={{ backgroundColor: "rgba(22,163,74,0.06)", color: "#15803D",
                                    border: "1px solid rgba(22,163,74,0.20)" }}>
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>
                          NF encontrada no Citel — emitida pela loja {nfPeekOptions[0].storeCode}
                          {nfPeekOptions[0].dataFaturamento && ` em ${nfPeekOptions[0].dataFaturamento}`}.
                        </span>
                      </div>
                    )}

                    {!nfPeekLoading && nfPeekOptions.length > 1 && (
                      <div className="mb-3">
                        <p className="text-[11px] font-semibold uppercase mb-1.5"
                           style={{ letterSpacing: "0.10em", color: "var(--color-muted-text)" }}>
                          {nfPeekOptions.length} NFs emitidas — escolha uma
                        </p>
                        <div className="space-y-1.5">
                          {nfPeekOptions.map(opt => {
                            const selected = nfNumberInput === opt.number && selectedInvoiceStoreId === opt.storeId;
                            return (
                              <button
                                key={`${opt.number}-${opt.storeCode}`}
                                onClick={() => {
                                  setNfNumberInput(opt.number);
                                  setSelectedInvoiceStoreId(opt.storeId);
                                  if (nfError) setNfError(null);
                                }}
                                className="w-full text-left px-3 py-2 rounded-lg transition-colors"
                                style={{
                                  backgroundColor: selected ? "rgba(249,115,22,0.10)" : "#FAFAFA",
                                  border: `1px solid ${selected ? "var(--color-primary)" : "var(--color-border)"}`,
                                }}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[12.5px] font-mono font-semibold tabular-nums"
                                        style={{ color: "var(--color-body-text)" }}>
                                    NF {opt.number}
                                  </span>
                                  <span className="text-[10.5px]" style={{ color: "var(--color-muted-text)" }}>
                                    Loja {opt.storeCode} · {opt.itemCount} item{opt.itemCount > 1 ? "s" : ""}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {!nfPeekLoading && nfPeekOptions.length === 0 && nfPeekMessage && (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg mb-3 text-[11.5px]"
                           style={{ backgroundColor: "rgba(217,119,6,0.06)", color: "#92400E",
                                    border: "1px solid rgba(217,119,6,0.20)" }}>
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>{nfPeekMessage}. Digite o número manualmente abaixo.</span>
                      </div>
                    )}

                    <label className="block text-[11px] font-semibold uppercase mb-1.5"
                           style={{ letterSpacing: "0.10em", color: "var(--color-muted-text)" }}>
                      Número da NF
                    </label>
                    <input
                      type="text"
                      autoFocus
                      inputMode="numeric"
                      value={nfNumberInput}
                      onChange={(e) => {
                        setNfNumberInput(e.target.value);
                        if (nfError) setNfError(null);
                        // Editou manualmente: não usa mais a loja pré-selecionada
                        setSelectedInvoiceStoreId(null);
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleSubmitNf(); }}
                      placeholder="ex.: 123456"
                      disabled={submittingNf || nfPeekLoading}
                      className="w-full px-3 py-2.5 rounded-lg text-[14px] font-mono tabular-nums focus:outline-none focus:ring-2 disabled:opacity-50"
                      style={{ border: "1px solid var(--color-border)" }}
                    />

                    {nfError && (
                      <p className="text-[11.5px] mt-2 flex items-start gap-1.5"
                         style={{ color: "#B91C1C" }}>
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        {nfError}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mt-5">
                      <button
                        onClick={() => setNfModalOpen(false)}
                        disabled={submittingNf}
                        className="flex-1 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
                        style={{ color: "var(--color-muted-text)", border: "1px solid var(--color-border)" }}
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => void handleSubmitNf()}
                        disabled={submittingNf || nfNumberInput.trim().length === 0}
                        className="flex-[2] flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-bold transition-colors disabled:opacity-50"
                        style={{ backgroundColor: "var(--color-primary)", color: "white" }}
                      >
                        {submittingNf
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Vinculando…</>
                          : <><CheckCircle2 className="w-4 h-4" /> Vincular e avançar</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Endereço de entrega */}
              <section>
                <SectionTitle icon={MapPin} label="Endereço de entrega" color="#9CA3AF" />
                <div className="rounded-lg px-3.5 py-3"
                     style={{ border: "1px solid var(--color-border)" }}>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--color-body-text)" }}>
                    {data.deliveryAddress}
                  </p>
                </div>
              </section>

              {/* Agendamento */}
              {data.scheduledFor && (
                <section>
                  <SectionTitle icon={Calendar} label="Agendamento" color="#9CA3AF" />
                  <div className="rounded-lg px-3.5 py-2.5 flex items-center justify-between"
                       style={{ border: "1px solid var(--color-border)" }}>
                    <p className="text-[12.5px]" style={{ color: "var(--color-body-text)" }}>
                      {formatDateTime(new Date(data.scheduledFor))}
                    </p>
                    <Clock className="w-3.5 h-3.5" style={{ color: "var(--color-muted-text)" }} />
                  </div>
                </section>
              )}

              {/* Itens */}
              {data.items.length > 0 && (
                <section>
                  <SectionTitle icon={Package} label={`Itens (${data.items.length})`} color="#9CA3AF" />
                  <div className="rounded-lg divide-y overflow-hidden"
                       style={{ border: "1px solid var(--color-border)" }}>
                    {data.items.map(item => (
                      <div key={item.id} className="px-3.5 py-2.5 flex items-start gap-2">
                        <div className={cn("w-1 self-stretch rounded-full flex-shrink-0", item.availableAtStore ? "bg-green-300" : "bg-amber-300")} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium leading-tight truncate"
                             style={{ color: "var(--color-body-text)" }}>
                            {item.productName}
                          </p>
                          <p className="text-[10.5px] mt-0.5 font-mono" style={{ color: "var(--color-muted-text)" }}>
                            {item.productCode}
                          </p>
                          {!item.availableAtStore && (
                            <p className="text-[10px] mt-1 font-semibold inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                               style={{ backgroundColor: "rgba(217,119,6,0.10)", color: "#92400E" }}>
                              Faltam {item.quantity} {item.unit} — transferir
                            </p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[12px] font-semibold whitespace-nowrap"
                             style={{ color: "var(--color-body-text)" }}>
                            {item.quantity} {item.unit}
                          </p>
                          {item.grossWeight !== null && item.grossWeight > 0 && (
                            <p className="text-[10px]" style={{ color: "var(--color-muted-text)" }}>
                              {(item.grossWeight * item.quantity).toFixed(2)} kg
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Despacho */}
              {data.dispatch && (data.dispatch.driverName || data.dispatch.dispatchedAt) && (
                <section>
                  <SectionTitle icon={Truck} label="Despacho" color="#0EA5E9" />
                  <div className="rounded-lg px-3.5 py-3 space-y-1.5"
                       style={{ backgroundColor: "rgba(14,165,233,0.04)", border: "1px solid rgba(14,165,233,0.15)" }}>
                    {data.dispatch.driverName && (
                      <div className="flex items-center justify-between text-[12px]">
                        <span style={{ color: "var(--color-muted-text)" }}>Motorista</span>
                        <span className="font-medium" style={{ color: "var(--color-body-text)" }}>
                          {data.dispatch.driverName}
                          {data.dispatch.driverPhone && <span className="ml-2 text-[11px]" style={{ color: "var(--color-muted-text)" }}>· {data.dispatch.driverPhone}</span>}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[12px]">
                      <span style={{ color: "var(--color-muted-text)" }}>Modal</span>
                      <span className="font-medium uppercase text-[11px]" style={{ color: "var(--color-body-text)" }}>
                        {data.dispatch.modal}
                      </span>
                    </div>
                    {data.dispatch.dispatchedAt && (
                      <div className="flex items-center justify-between text-[12px]">
                        <span style={{ color: "var(--color-muted-text)" }}>Despachado</span>
                        <span style={{ color: "var(--color-body-text)" }}>
                          {formatRelativeTime(data.dispatch.dispatchedAt)}
                        </span>
                      </div>
                    )}
                    {data.dispatch.completedAt && (
                      <div className="flex items-center justify-between text-[12px]">
                        <span style={{ color: "var(--color-muted-text)" }}>Entregue</span>
                        <span style={{ color: "#15803D" }} className="font-medium inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {formatRelativeTime(data.dispatch.completedAt)}
                        </span>
                      </div>
                    )}
                    {data.dispatch.shareLink && (
                      <a href={data.dispatch.shareLink} target="_blank" rel="noreferrer"
                         onClick={e => e.stopPropagation()}
                         className="block text-[11.5px] font-medium pt-1 mt-1 border-t"
                         style={{ color: "#0EA5E9", borderColor: "rgba(14,165,233,0.15)" }}>
                        Acompanhar entrega ao vivo →
                      </a>
                    )}
                  </div>
                </section>
              )}

              {/* Observações */}
              {data.notes && (
                <section>
                  <SectionTitle icon={Package} label="Observações" color="#9CA3AF" />
                  <p className="text-[12.5px] leading-relaxed px-3.5 py-3 rounded-lg whitespace-pre-line"
                     style={{ color: "var(--color-body-text)", border: "1px solid var(--color-border)" }}>
                    {data.notes}
                  </p>
                </section>
              )}

              {/* Vendedor */}
              <section className="text-[11px] flex items-center justify-between"
                       style={{ color: "var(--color-muted-text)" }}>
                <span>Vendedor</span>
                <span style={{ color: "var(--color-body-text)" }}>{data.sellerName}</span>
              </section>

            </div>
          )}
        </div>

        {/* Footer com link pra página completa */}
        {data && (
          <div className="px-6 py-3 border-t flex-shrink-0"
               style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg)" }}>
            <Link href={`/solicitacoes/${data.id}`}
                  className="flex items-center justify-center gap-1.5 text-[12.5px] font-medium py-2 rounded-lg transition-colors hover:bg-gray-100"
                  style={{ color: "var(--color-primary)" }}>
              Abrir página completa <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Subcomponentes ──────────────────────────────────────────

function SectionTitle({ icon: Icon, label, color }: { icon: typeof User; label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="w-3 h-3" style={{ color }} />
      <span className="font-semibold uppercase text-[10px]"
            style={{ color, letterSpacing: "0.08em" }}>
        {label}
      </span>
    </div>
  );
}

function StatBox({ icon: Icon, label, value, color }: { icon: typeof User; label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg px-3 py-2 flex items-center gap-2"
         style={{ backgroundColor: `${color}0F`, border: `1px solid ${color}22` }}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
      <div className="min-w-0">
        <p className="text-[10px]" style={{ color: "#9CA3AF" }}>{label}</p>
        <p className="text-[12px] font-bold leading-tight" style={{ color: "var(--color-body-text)" }}>{value}</p>
      </div>
    </div>
  );
}

// ─── Bloco "Aguardando NF (automática)" ─────────────────────────────
// Mostrado quando a DR está em SEPARADO. O cron Citel vincula a NF e promove
// o status sem intervenção. Botão "Verificar agora" força check imediato.
function SeparadoAutoNfBlock({
  deliveryRequestId,
  onLinked,
}: {
  deliveryRequestId: string;
  onLinked: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "info" | "error"; message: string } | null>(null);

  async function handleCheck() {
    setChecking(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/solicitacoes/${deliveryRequestId}/check-nf`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({ kind: "error", message: json.error ?? "Erro ao verificar NF" });
        return;
      }
      const r = json.data as { type: string; invoiceNumber?: string; message?: string };
      if (r.type === "linked") {
        setFeedback({ kind: "ok", message: `NF ${r.invoiceNumber} vinculada — liberando para roteirização` });
        // Pequeno delay pra o usuário ver a mensagem, depois recarrega o detalhe
        setTimeout(onLinked, 1200);
      } else {
        setFeedback({ kind: "info", message: r.message ?? "Sem NF disponível ainda" });
      }
    } catch (e) {
      setFeedback({ kind: "error", message: e instanceof Error ? e.message : "Erro de rede" });
    } finally {
      setChecking(false);
    }
  }

  return (
    <section>
      <p className="text-[10.5px] font-semibold uppercase mb-1.5"
         style={{ letterSpacing: "0.10em", color: "var(--color-muted-text)" }}>
        Próxima ação
      </p>
      <div className="rounded-lg px-3.5 py-3"
           style={{ backgroundColor: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.20)" }}>
        <div className="flex items-start gap-2.5 mb-2">
          <Receipt className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "rgb(99,102,241)" }} />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold" style={{ color: "var(--color-body-text)" }}>
              Aguardando NF do Citel
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted-text)" }}>
              O sistema vincula a NF e libera para roteirização automaticamente assim que ela for emitida.
            </p>
          </div>
        </div>
        <button
          onClick={handleCheck}
          disabled={checking}
          className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold py-2 rounded-md disabled:opacity-60"
          style={{ backgroundColor: "white", border: "1px solid rgba(99,102,241,0.30)", color: "rgb(79,70,229)" }}
        >
          {checking
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando Citel…</>
            : <><RefreshCw className="w-3.5 h-3.5" /> Verificar NF agora</>}
        </button>
        {feedback && (
          <p
            className="text-[11px] mt-2 px-2 py-1.5 rounded"
            style={{
              backgroundColor:
                feedback.kind === "ok"    ? "rgba(34,197,94,0.10)" :
                feedback.kind === "error" ? "rgba(239,68,68,0.10)" :
                                            "rgba(99,102,241,0.08)",
              color:
                feedback.kind === "ok"    ? "rgb(21,128,61)"   :
                feedback.kind === "error" ? "rgb(185,28,28)"   :
                                            "var(--color-body-text)",
            }}
          >
            {feedback.message}
          </p>
        )}
      </div>
    </section>
  );
}
