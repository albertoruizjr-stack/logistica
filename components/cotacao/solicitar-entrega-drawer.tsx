"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X, Loader2, Zap, Calendar, Clock,
  ChevronRight, CheckCircle2, Phone, AlertCircle,
  Search, User, MapPin, ShoppingCart, Package,
  XCircle, Building2, HardHat, Edit3, Check,
  Weight, BarChart2, RefreshCw, Truck,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { CitelEndereco, ERPOrderValidationStatus, DeliveryAddressSource } from "@/types/stock";

// ─── helpers ───────────────────────────────────────────────
function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultScheduledFor(priority: "URGENTE" | "HOJE" | "NORMAL"): string {
  const now = new Date();
  if (priority === "URGENTE") { now.setHours(now.getHours() + 1); return toDatetimeLocal(now); }
  if (priority === "HOJE")    { now.setHours(18, 0, 0, 0); return toDatetimeLocal(now); }
  now.setDate(now.getDate() + 1); now.setHours(12, 0, 0, 0);
  return toDatetimeLocal(now);
}

function formatEndereco(e: CitelEndereco): string {
  return [e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.estado, e.cep]
    .filter(Boolean).join(", ");
}

// ─── schema ────────────────────────────────────────────────
const schema = z
  .object({
    orderNumber:         z.string().min(1, "Informe o número do pedido"),
    orderStoreId:        z.string().min(1, "Selecione a loja do pedido"),
    customerName:        z.string().min(2, "Informe o nome do destinatário"),
    customerPhone:       z.string().min(8, "Informe o telefone (mín. 8 dígitos)"),
    deliveryAddress:     z.string().min(5, "Informe o endereço de entrega"),
    deliveryWindowStart: z.string().optional(),
    deliveryWindowEnd:   z.string().optional(),
    priority:            z.enum(["URGENTE", "HOJE", "NORMAL"]),
    chargedFreight:      z.number({ invalid_type_error: "Informe o valor do frete" }).min(0),
    scheduledFor:        z.string().min(1, "Informe a data/hora prevista"),
    notes:               z.string().optional(),
  })
  .refine(
    (d) => { if (!d.deliveryWindowStart || !d.deliveryWindowEnd) return true;
              return d.deliveryWindowStart < d.deliveryWindowEnd; },
    { message: "Início da janela deve ser anterior ao fim", path: ["deliveryWindowEnd"] }
  );

type FormData = z.infer<typeof schema>;

// ─── constantes ────────────────────────────────────────────
interface StoreOption { id: string; code: string; name: string; }

interface PedidoItem {
  productCode: string; description: string;
  quantity: number; unit: string;
  stockStatus: string; availableStock: number;
}

interface Props {
  open: boolean; onClose: () => void;
  freightQuoteId: string; storeId: string;
  stores: StoreOption[]; suggestedPrice: number;
  isUrgent: boolean; destAddress: string;
}

const LOADING_STEPS = [
  "Buscando cabeçalho do pedido...",
  "Carregando itens e produtos...",
  "Consultando estoque na Citel...",
  "Calculando peso e modal...",
];

const STOCK_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  AVAILABLE:          { label: "Disponível",   color: "#16A34A", bg: "rgba(22,163,74,0.08)"  },
  RESERVED_ELSEWHERE: { label: "Reservado",    color: "#D97706", bg: "rgba(217,119,6,0.08)"  },
  UNAVAILABLE:        { label: "Sem estoque",  color: "#DC2626", bg: "rgba(220,38,38,0.08)"  },
  ZERO_STOCK:         { label: "Zerado",       color: "#DC2626", bg: "rgba(220,38,38,0.08)"  },
  CITEL_DOWN:         { label: "Sem consulta", color: "#737373", bg: "rgba(115,115,115,0.08)" },
};

const BLOCKED_MESSAGES: Record<string, string> = {
  CANCELLED:        "Pedido cancelado — não é possível criar entrega.",
  BLOCKED:          "Pedido bloqueado — entre em contato com a equipe de crédito.",
  APPROVAL_PENDING: "Pedido aguardando aprovação — prossiga após liberação do comercial.",
  ALREADY_FULFILLED: "Pedido já faturado/encerrado — a NF já foi emitida.",
};

const PRIORITY_OPTIONS: {
  value: FormData["priority"]; label: string; description: string; icon: typeof Zap;
  dotColor: string; activeBg: string; activeBorder: string; activeText: string;
}[] = [
  { value: "URGENTE", label: "Urgente",    description: "Entrega imediata — cliente aguardando",     icon: Zap,      dotColor: "#DC2626", activeBg: "bg-red-50",    activeBorder: "border-red-300",    activeText: "text-red-700"    },
  { value: "HOJE",    label: "Hoje",       description: "Entrega no mesmo dia (D0)",                  icon: Clock,    dotColor: "#F97316", activeBg: "bg-orange-50", activeBorder: "border-orange-300", activeText: "text-orange-700" },
  { value: "NORMAL",  label: "Normal",     description: "Entrega no próximo ciclo de rota (D+1)",     icon: Calendar, dotColor: "#737373", activeBg: "bg-gray-50",   activeBorder: "border-gray-300",   activeText: "text-gray-700"   },
];

// ─── componente ────────────────────────────────────────────
export function SolicitarEntregaDrawer({
  open, onClose, freightQuoteId, storeId, stores, suggestedPrice, isUrgent, destAddress,
}: Props) {
  const router = useRouter();

  // lookup state
  type LookupState = "idle" | "loading" | "found" | "not_found" | "citel_down" | "blocked";
  const [erpLookupState, setErpLookupState]   = useState<LookupState>("idle");
  const [loadingStep,    setLoadingStep]       = useState(0);
  const [erpItems,       setErpItems]          = useState<PedidoItem[]>([]);
  const [customerDoc,    setCustomerDoc]       = useState<string | null>(null);
  const [customerAddrObj, setCustomerAddrObj]  = useState<CitelEndereco | null>(null);
  const [deliveryAddrObj, setDeliveryAddrObj]  = useState<CitelEndereco | null>(null);
  const [addrSource,     setAddrSource]        = useState<DeliveryAddressSource | null>(null);
  const [isAlternate,    setIsAlternate]       = useState(false);
  const [erpStatus,      setErpStatus]         = useState<string | null>(null);
  const [validationStatus, setValidationStatus] = useState<ERPOrderValidationStatus | null>(null);
  const [totalWeightKg,  setTotalWeightKg]     = useState<number>(0);
  const [itemCount,      setItemCount]         = useState<number>(0);
  const [isEntregaCD,    setIsEntregaCD]       = useState<boolean>(false);
  const [codigoEmpresaCD, setCodigoEmpresaCD]  = useState<string | null>(null);
  const [stockSummary,   setStockSummary]      = useState<{ available: number; reserved: number; missing: number; unknown: number } | null>(null);
  const [fetchedInMs,    setFetchedInMs]       = useState<number | null>(null);
  const [cacheHit,       setCacheHit]          = useState<boolean>(false);
  // address override
  const [isEditingAddr,  setIsEditingAddr]     = useState(false);
  const [addrOverridden, setAddrOverridden]    = useState(false);
  const [originalAddr,   setOriginalAddr]      = useState<string>("");
  // form
  const [submitError,  setSubmitError]   = useState<string | null>(null);
  const [successData,  setSuccessData]   = useState<{ id: string; orderNumber: string } | null>(null);

  const defaultPriority: FormData["priority"] = isUrgent ? "URGENTE" : "NORMAL";

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: {
        orderNumber: "", orderStoreId: storeId,
        customerName: "", customerPhone: "",
        deliveryAddress: destAddress,
        deliveryWindowStart: "", deliveryWindowEnd: "",
        priority: defaultPriority,
        chargedFreight: suggestedPrice,
        scheduledFor: defaultScheduledFor(defaultPriority),
        notes: "",
      },
    });

  const priority     = watch("priority");
  const orderNumber  = watch("orderNumber");
  const orderStoreId = watch("orderStoreId");

  // animação de steps durante loading
  useEffect(() => {
    if (erpLookupState !== "loading") { setLoadingStep(0); return; }
    const iv = setInterval(() => setLoadingStep(s => (s + 1) % LOADING_STEPS.length), 900);
    return () => clearInterval(iv);
  }, [erpLookupState]);

  useEffect(() => { setValue("scheduledFor", defaultScheduledFor(priority)); }, [priority, setValue]);

  useEffect(() => {
    if (!successData) return;
    const t = setTimeout(() => { router.push(`/solicitacoes/${successData.id}`); onClose(); }, 2000);
    return () => clearTimeout(t);
  }, [successData, router, onClose]);

  // ─── reset ao mudar loja ou número ────────────────────────────────────
  function resetLookup() {
    setErpLookupState("idle");
    setErpItems([]); setCustomerDoc(null);
    setCustomerAddrObj(null); setDeliveryAddrObj(null);
    setAddrSource(null); setIsAlternate(false);
    setErpStatus(null); setValidationStatus(null);
    setTotalWeightKg(0); setItemCount(0); setStockSummary(null);
    setIsEntregaCD(false); setCodigoEmpresaCD(null);
    setFetchedInMs(null); setCacheHit(false);
    setIsEditingAddr(false); setAddrOverridden(false); setOriginalAddr("");
  }

  // ─── busca na Citel ───────────────────────────────────────────────────
  async function handleErpLookup() {
    if (!orderNumber.trim() || !orderStoreId) return;
    const store = stores.find(s => s.id === orderStoreId);
    if (!store) return;

    resetLookup();
    setErpLookupState("loading");

    try {
      const res  = await fetch(
        `/api/erp/pedido?number=${encodeURIComponent(orderNumber.trim())}&storeCode=${encodeURIComponent(store.code)}`
      );
      const json = await res.json();

      if (res.status === 503 || json.code === "CITEL_DOWN") {
        setErpLookupState("citel_down"); return;
      }

      // status 422 = pedido bloqueado (cancelado, faturado, etc.)
      if (res.status === 422) {
        setErpStatus(json.data?.rawStatus ?? null);
        setValidationStatus(json.code as ERPOrderValidationStatus);
        setErpLookupState("blocked"); return;
      }

      if (!res.ok || !json.success) {
        setErpLookupState("not_found"); return;
      }

      const d = json.data;
      if (d.customerName)    setValue("customerName",    d.customerName);
      if (d.customerPhone)   setValue("customerPhone",   d.customerPhone);
      if (d.deliveryAddressStr) setValue("deliveryAddress", d.deliveryAddressStr);

      setCustomerDoc(d.customerDocument ?? null);
      setCustomerAddrObj(d.customerAddressObj ?? null);
      setDeliveryAddrObj(d.deliveryAddressObj ?? null);
      setAddrSource(d.deliveryAddressSource ?? null);
      setIsAlternate(d.isAlternateDelivery ?? false);
      setErpStatus(d.erpOrderStatus ?? null);
      setValidationStatus(d.erpValidationStatus ?? null);
      setTotalWeightKg(d.totalWeightKg ?? 0);
      setItemCount(d.itemCount ?? 0);
      setStockSummary(d.stockSummary ?? null);
      setIsEntregaCD(Boolean(d.isEntregaCD));
      setCodigoEmpresaCD(d.codigoEmpresaCD ?? null);
      setFetchedInMs(d.fetchedInMs ?? null);
      setCacheHit(d.cacheHit ?? false);
      if (d.items?.length) setErpItems(d.items);
      setOriginalAddr(d.deliveryAddressStr ?? "");
      setErpLookupState("found");
    } catch {
      setErpLookupState("citel_down");
    }
  }

  // ─── submit ───────────────────────────────────────────────────────────
  async function onSubmit(data: FormData) {
    if (erpLookupState !== "found") {
      setSubmitError("Busque e valide o pedido na Citel antes de criar a solicitação.");
      return;
    }
    setSubmitError(null);

    try {
      const res = await fetch("/api/solicitacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber:    data.orderNumber.trim(),
          orderStoreId:   data.orderStoreId,
          storeId, freightQuoteId,
          chargedFreight: data.chargedFreight,
          deliveryType:   data.priority === "URGENTE" ? "URGENT" : "STANDARD",
          customerName:   data.customerName.trim(),
          customerPhone:  data.customerPhone.trim(),
          deliveryAddress: data.deliveryAddress.trim(),
          deliveryWindowStart: data.deliveryWindowStart || undefined,
          deliveryWindowEnd:   data.deliveryWindowEnd   || undefined,
          scheduledFor:   new Date(data.scheduledFor).toISOString(),
          notes:          data.notes || undefined,
          // snapshots
          customerDoc:              customerDoc ?? undefined,
          customerAddressSnapshot:  customerAddrObj ? JSON.stringify(customerAddrObj) : undefined,
          deliveryAddressSnapshot:  deliveryAddrObj ? JSON.stringify(deliveryAddrObj) : undefined,
          deliveryAddressSource:    addrOverridden ? "MANUAL_OVERRIDE" : (addrSource ?? undefined),
          deliveryAddressOriginal:  addrOverridden ? originalAddr : undefined,
          erpOrderStatus:           erpStatus ?? undefined,
          erpOrderValidationStatus: validationStatus ?? undefined,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (json.code === "DUPLICATE") {
          setSubmitError(`Já existe uma solicitação para o PD ${data.orderNumber.trim()} nesta loja.`);
        } else {
          setSubmitError(json.error ?? "Erro ao criar solicitação");
        }
        return;
      }

      setSuccessData({ id: json.data.id, orderNumber: data.orderNumber.trim() });
    } catch {
      setSubmitError("Erro de conexão. Tente novamente.");
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
           onClick={!successData ? onClose : undefined} />

      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col shadow-2xl"
           style={{ backgroundColor: "var(--color-surface)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
             style={{ borderColor: "var(--color-border)" }}>
          <div>
            <h2 className="text-[15px] font-bold"
                style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}>
              Solicitar Entrega
            </h2>
            <p className="text-[12px] mt-0.5 truncate max-w-[280px]"
               style={{ color: "var(--color-muted-text)" }}>
              {destAddress}
            </p>
          </div>
          {!successData && (
            <button onClick={onClose}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100">
              <X className="w-4 h-4" style={{ color: "var(--color-muted-text)" }} />
            </button>
          )}
        </div>

        {/* Sucesso */}
        {successData ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
                 style={{ backgroundColor: "rgba(22,163,74,0.1)" }}>
              <CheckCircle2 className="w-8 h-8" style={{ color: "#16A34A" }} />
            </div>
            <div>
              <p className="text-[17px] font-bold mb-1"
                 style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}>
                Solicitação criada!
              </p>
              <p className="text-[13px]" style={{ color: "var(--color-muted-text)" }}>
                PD {successData.orderNumber} registrado. NF será vinculada após emissão.
              </p>
            </div>
            <div className="flex items-center gap-2 mt-2" style={{ color: "#A3A3A3" }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <p className="text-[12px]">Abrindo solicitação...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Frete sugerido */}
            <div className="mx-6 mt-4 px-4 py-3 rounded-lg flex items-center justify-between"
                 style={{ backgroundColor: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.15)" }}>
              <p className="text-[12px]" style={{ color: "var(--color-muted-text)" }}>Frete sugerido pela cotação</p>
              <p className="text-[14px] font-bold" style={{ color: "var(--color-primary)" }}>
                {formatCurrency(suggestedPrice)}
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)}
                  className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* ── Seção: Pedido ── */}
              <div>
                <p className="text-[11px] font-semibold uppercase mb-3"
                   style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}>
                  Pedido (PD)
                </p>

                {/* Loja */}
                <div className="mb-3">
                  <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                    Loja que gerou o pedido
                  </label>
                  <select {...register("orderStoreId")}
                          className="w-full px-3 py-2.5 rounded-lg text-[13px] border focus:outline-none bg-white"
                          style={{ borderColor: errors.orderStoreId ? "#DC2626" : "var(--color-border)" }}
                          onChange={() => resetLookup()}>
                    <option value="">Selecione a loja...</option>
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>Loja {s.code} — {s.name}</option>
                    ))}
                  </select>
                  {errors.orderStoreId && (
                    <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.orderStoreId.message}</p>
                  )}
                </div>

                {/* Número + Buscar */}
                <div>
                  <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                    Número do pedido
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <ShoppingCart className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#A3A3A3" }} />
                      <input {...register("orderNumber", { onChange: () => resetLookup() })} type="text" placeholder="Ex: 45231" autoFocus
                             className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                             style={{ borderColor: errors.orderNumber ? "#DC2626" : "var(--color-border)", backgroundColor: "white" }} />
                    </div>
                    <button type="button" onClick={handleErpLookup}
                            disabled={erpLookupState === "loading" || !orderNumber.trim() || !orderStoreId}
                            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-semibold border transition-colors disabled:opacity-40"
                            style={{
                              backgroundColor: erpLookupState === "found" ? "rgba(22,163,74,0.08)" : "rgba(249,115,22,0.06)",
                              borderColor:     erpLookupState === "found" ? "rgba(22,163,74,0.3)"  : "rgba(249,115,22,0.2)",
                              color:           erpLookupState === "found" ? "#16A34A" : "var(--color-primary)",
                            }}>
                      {erpLookupState === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                       : erpLookupState === "found"  ? <CheckCircle2 className="w-3.5 h-3.5" />
                       : <Search className="w-3.5 h-3.5" />}
                      {erpLookupState === "found" ? "Encontrado" : "Buscar"}
                    </button>
                  </div>
                  {errors.orderNumber && (
                    <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.orderNumber.message}</p>
                  )}

                  {/* ── Loading: steps animados ── */}
                  {erpLookupState === "loading" && (
                    <div className="mt-3 rounded-lg p-3 space-y-2"
                         style={{ backgroundColor: "rgba(249,115,22,0.04)", border: "1px solid rgba(249,115,22,0.12)" }}>
                      {LOADING_STEPS.map((step, i) => (
                        <div key={i} className={cn("flex items-center gap-2 text-[11px] transition-opacity duration-300",
                                                   i === loadingStep ? "opacity-100" : "opacity-30")}>
                          {i === loadingStep
                            ? <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: "var(--color-primary)" }} />
                            : i < loadingStep
                              ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "#16A34A" }} />
                              : <div className="w-3 h-3 rounded-full border flex-shrink-0" style={{ borderColor: "#D1D5DB" }} />}
                          <span style={{ color: i === loadingStep ? "var(--color-primary)" : "#9CA3AF" }}>{step}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Encontrado: painel rico ── */}
                  {erpLookupState === "found" && (
                    <div className="mt-3 space-y-2">

                      {/* status bar */}
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5" style={{ color: "#16A34A" }}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Pedido validado na Citel</span>
                        </div>
                        <span className="text-gray-400">
                          {cacheHit ? "cache" : `${fetchedInMs}ms`}
                        </span>
                      </div>

                      {/* Badge "Entrega CD" — quando o PD foi marcado pra expedição pelo CD */}
                      {isEntregaCD && (
                        <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                             style={{ backgroundColor: "rgba(8,145,178,0.06)", border: "1px solid rgba(8,145,178,0.20)" }}>
                          <Truck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#0891B2" }} />
                          <p className="text-[11.5px] leading-tight" style={{ color: "#155E75" }}>
                            <b>Entrega CD</b> — separação e expedição pela Loja {codigoEmpresaCD ?? "CD"}.
                            Estoque conferido nessa loja.
                          </p>
                        </div>
                      )}

                      {/* identificação do cliente — nome + telefone + CPF/CNPJ */}
                      {(watch("customerName") || watch("customerPhone") || customerDoc) && (
                        <div className="rounded-lg px-3 py-2.5"
                             style={{ backgroundColor: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.15)" }}>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <User className="w-3 h-3 flex-shrink-0" style={{ color: "#6366F1" }} />
                            <span className="font-semibold uppercase text-[10px]" style={{ color: "#6366F1", letterSpacing: "0.08em" }}>Destinatário</span>
                          </div>
                          {watch("customerName") && (
                            <p className="text-[13px] font-semibold leading-tight mb-1.5" style={{ color: "var(--color-body-text)" }}>
                              {watch("customerName")}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--color-muted-text)" }}>
                            {watch("customerPhone") && (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="w-2.5 h-2.5" /> {watch("customerPhone")}
                              </span>
                            )}
                            {customerDoc && (
                              <span className="inline-flex items-center gap-1 font-mono">
                                <Building2 className="w-2.5 h-2.5" /> {customerDoc}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* stats: peso + itens + estoque */}
                      {(totalWeightKg > 0 || itemCount > 0 || stockSummary) && (
                        <div className="grid grid-cols-3 gap-2">
                          {totalWeightKg > 0 && (
                            <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                                 style={{ backgroundColor: "rgba(249,115,22,0.05)", border: "1px solid rgba(249,115,22,0.12)" }}>
                              <Weight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--color-primary)" }} />
                              <div className="min-w-0">
                                <p className="text-[10px]" style={{ color: "#9CA3AF" }}>Peso</p>
                                <p className="text-[12px] font-bold leading-tight" style={{ color: "var(--color-body-text)" }}>
                                  {totalWeightKg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg
                                </p>
                              </div>
                            </div>
                          )}
                          {itemCount > 0 && (
                            <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                                 style={{ backgroundColor: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)" }}>
                              <ShoppingCart className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#6366F1" }} />
                              <div className="min-w-0">
                                <p className="text-[10px]" style={{ color: "#9CA3AF" }}>Itens</p>
                                <p className="text-[12px] font-bold leading-tight" style={{ color: "var(--color-body-text)" }}>
                                  {itemCount} {itemCount === 1 ? "produto" : "produtos"}
                                </p>
                              </div>
                            </div>
                          )}
                          {stockSummary && (() => {
                            const missing = stockSummary.reserved + stockSummary.missing;
                            const unknown = stockSummary.unknown;
                            const total   = stockSummary.available + missing + unknown;
                            // 3 estados visuais: ok / faltando / sem consulta
                            const state = total === 0 || unknown === total
                              ? "unknown"
                              : missing === 0
                                ? "ok"
                                : "missing";
                            const cfg = {
                              ok:      { bg: "rgba(22,163,74,0.06)",  border: "rgba(22,163,74,0.20)", text: "#15803D", label: "Disponível" },
                              missing: { bg: "rgba(217,119,6,0.06)",  border: "rgba(217,119,6,0.25)", text: "#92400E", label: `Faltam ${missing}` },
                              unknown: { bg: "rgba(115,115,115,0.06)",border: "rgba(115,115,115,0.20)", text: "#525252", label: "Sem consulta" },
                            }[state];
                            // Loja onde o estoque foi de fato consultado:
                            //  - se entregaPeloCD = CD (132 etc)
                            //  - senão = a loja origem do PD (orderStoreId → code)
                            const consultedStoreCode = isEntregaCD && codigoEmpresaCD
                              ? codigoEmpresaCD
                              : (stores.find(s => s.id === orderStoreId)?.code ?? "—");
                            return (
                              <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                                   style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}>
                                <BarChart2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: cfg.text }} />
                                <div className="min-w-0">
                                  <p className="text-[10px]" style={{ color: "#9CA3AF" }}>
                                    Estoque · Loja {consultedStoreCode}{isEntregaCD ? " (CD)" : ""}
                                  </p>
                                  <p className="text-[12px] font-bold leading-tight" style={{ color: cfg.text }}>
                                    {cfg.label}
                                  </p>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* endereços */}
                      {customerAddrObj && (
                        <div className="rounded-lg divide-y text-[11px] overflow-hidden"
                             style={{ border: "1px solid var(--color-border)" }}>

                          {/* endereço do cliente */}
                          <div className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Building2 className="w-3 h-3 flex-shrink-0" style={{ color: "#9CA3AF" }} />
                              <span className="font-semibold uppercase text-[10px]" style={{ color: "#9CA3AF", letterSpacing: "0.08em" }}>Endereço do cliente</span>
                            </div>
                            <p style={{ color: "var(--color-body-text)" }}>{formatEndereco(customerAddrObj)}</p>
                          </div>

                          {/* endereço de entrega */}
                          <div className="px-3 py-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                {isAlternate
                                  ? <HardHat className="w-3 h-3 flex-shrink-0" style={{ color: "#D97706" }} />
                                  : <MapPin  className="w-3 h-3 flex-shrink-0" style={{ color: "#9CA3AF" }} />}
                                <span className="font-semibold uppercase text-[10px]"
                                      style={{ color: isAlternate ? "#D97706" : "#9CA3AF", letterSpacing: "0.08em" }}>
                                  Endereço de entrega
                                </span>
                                {isAlternate && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                                        style={{ backgroundColor: "rgba(217,119,6,0.1)", color: "#D97706" }}>
                                    🏗 Obra alternativa
                                  </span>
                                )}
                                {addrOverridden && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                                        style={{ backgroundColor: "rgba(99,102,241,0.1)", color: "#6366F1" }}>
                                    Editado
                                  </span>
                                )}
                              </div>
                              <button type="button" onClick={() => setIsEditingAddr(v => !v)}
                                      className="text-[10px] flex items-center gap-0.5 hover:opacity-70 transition-opacity"
                                      style={{ color: "var(--color-primary)" }}>
                                <Edit3 className="w-2.5 h-2.5" /> Editar
                              </button>
                            </div>

                            {isEditingAddr ? (
                              <div className="space-y-1.5">
                                {/* Sugestão rápida: endereço da cotação (que o vendedor digitou ao cotar) */}
                                {destAddress && destAddress.trim() && destAddress.trim() !== watch("deliveryAddress")?.trim() && (
                                  <button type="button"
                                          onClick={() => { setValue("deliveryAddress", destAddress); setAddrOverridden(true); }}
                                          className="w-full text-left px-2.5 py-2 rounded border transition-colors hover:shadow-sm"
                                          style={{ backgroundColor: "rgba(99,102,241,0.04)", borderColor: "rgba(99,102,241,0.30)" }}>
                                    <div className="flex items-start gap-1.5">
                                      <MapPin className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "#6366F1" }} />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[10.5px] font-bold uppercase mb-0.5"
                                           style={{ color: "#4338CA", letterSpacing: "0.06em" }}>
                                          Usar endereço da cotação
                                        </p>
                                        <p className="text-[11.5px] leading-tight" style={{ color: "var(--color-body-text)" }}>
                                          {destAddress}
                                        </p>
                                      </div>
                                    </div>
                                  </button>
                                )}
                                <textarea {...register("deliveryAddress")} rows={3}
                                          placeholder="Ou edite manualmente o endereço de entrega"
                                          className="w-full px-2.5 py-2 rounded text-[12px] border resize-none focus:outline-none"
                                          style={{ borderColor: "var(--color-border)", backgroundColor: "white" }} />
                                <div className="flex gap-2">
                                  <button type="button"
                                          onClick={() => { setIsEditingAddr(false); setAddrOverridden(true); }}
                                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold text-white"
                                          style={{ backgroundColor: "#16A34A" }}>
                                    <Check className="w-3 h-3" /> Salvar
                                  </button>
                                  <button type="button"
                                          onClick={() => { setValue("deliveryAddress", originalAddr); setIsEditingAddr(false); setAddrOverridden(false); }}
                                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] border"
                                          style={{ color: "#6B7280", borderColor: "#D1D5DB" }}>
                                    <RefreshCw className="w-3 h-3" /> Restaurar
                                  </button>
                                </div>
                                {addrOverridden && (
                                  <p className="text-[10px]" style={{ color: "#6366F1" }}>
                                    Endereço original: {originalAddr}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p style={{ color: "var(--color-body-text)" }}>
                                {watch("deliveryAddress") || formatEndereco(deliveryAddrObj!)}
                              </p>
                            )}

                            {addrSource === "CUSTOMER_MAIN_ADDRESS" && !isAlternate && (
                              <p className="mt-1" style={{ color: "#9CA3AF" }}>
                                Usando endereço do cliente — verifique se é o local correto da obra.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* itens */}
                      {erpItems.length > 0 && (
                        <div className="rounded-lg border divide-y text-[11px]"
                             style={{ borderColor: "rgba(22,163,74,0.2)", backgroundColor: "rgba(22,163,74,0.03)" }}>
                          {erpItems.map(item => {
                            const st = STOCK_STATUS_CONFIG[item.stockStatus] ?? STOCK_STATUS_CONFIG.CITEL_DOWN;
                            return (
                              <div key={item.productCode} className="flex items-center justify-between gap-2 px-3 py-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Package className="w-3 h-3 flex-shrink-0" style={{ color: "#A3A3A3" }} />
                                  <span className="truncate text-gray-700">{item.description}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className="text-gray-400">{item.quantity}{item.unit}</span>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                        style={{ color: st.color, backgroundColor: st.bg }}>
                                    {st.label}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Bloqueado ── */}
                  {erpLookupState === "blocked" && (
                    <div className="mt-3 rounded-lg p-3"
                         style={{ backgroundColor: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)" }}>
                      <div className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#DC2626" }} />
                        <div>
                          <p className="text-[12px] font-semibold" style={{ color: "#7F1D1D" }}>
                            {BLOCKED_MESSAGES[validationStatus ?? ""] ?? "Pedido em status inválido para entrega."}
                          </p>
                          {erpStatus && (
                            <p className="text-[10px] mt-0.5" style={{ color: "#DC2626" }}>
                              Status Citel: {erpStatus}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Não encontrado ── */}
                  {erpLookupState === "not_found" && (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px]" style={{ color: "#DC2626" }}>
                      <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>Pedido não encontrado na Citel para esta loja. Verifique o número e a loja selecionada.</span>
                    </div>
                  )}

                  {/* ── Citel fora ── */}
                  {erpLookupState === "citel_down" && (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px]" style={{ color: "#D97706" }}>
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>Não foi possível consultar a Citel. Tente novamente ou solicite validação manual ao supervisor.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Seção: Destinatário ── */}
              <div>
                <p className="text-[11px] font-semibold uppercase mb-3"
                   style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}>
                  Destinatário
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>Nome do cliente</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#A3A3A3" }} />
                      <input {...register("customerName")} type="text" placeholder="Nome completo"
                             className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                             style={{ borderColor: errors.customerName ? "#DC2626" : "var(--color-border)", backgroundColor: "white" }} />
                    </div>
                    {errors.customerName && <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.customerName.message}</p>}
                  </div>

                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>Telefone para contato</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#A3A3A3" }} />
                      <input {...register("customerPhone")} type="tel" placeholder="(11) 99999-9999"
                             className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                             style={{ borderColor: errors.customerPhone ? "#DC2626" : "var(--color-border)", backgroundColor: "white" }} />
                    </div>
                    {errors.customerPhone && <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.customerPhone.message}</p>}
                  </div>

                  {/* endereço: oculto quando painel de endereços está visível */}
                  {!customerAddrObj && (
                    <div>
                      <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>Endereço de entrega</label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-3 w-4 h-4" style={{ color: "#A3A3A3" }} />
                        <textarea {...register("deliveryAddress")} rows={2} placeholder="Rua, número, bairro, cidade"
                                  className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border resize-none focus:outline-none"
                                  style={{ borderColor: errors.deliveryAddress ? "#DC2626" : "var(--color-border)", backgroundColor: "white" }} />
                      </div>
                      {errors.deliveryAddress && <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.deliveryAddress.message}</p>}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Janela de entrega ── */}
              <div>
                <p className="text-[11px] font-semibold uppercase mb-3"
                   style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}>
                  Janela de entrega{" "}
                  <span className="font-normal normal-case" style={{ color: "#A3A3A3" }}>(opcional)</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>Das</label>
                    <input {...register("deliveryWindowStart")} type="time"
                           className="w-full px-3 py-2.5 rounded-lg text-[13px] border focus:outline-none bg-white"
                           style={{ borderColor: "var(--color-border)", colorScheme: "light" }} />
                  </div>
                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>Até</label>
                    <input {...register("deliveryWindowEnd")} type="time"
                           className="w-full px-3 py-2.5 rounded-lg text-[13px] border focus:outline-none bg-white"
                           style={{ borderColor: errors.deliveryWindowEnd ? "#DC2626" : "var(--color-border)", colorScheme: "light" }} />
                    {errors.deliveryWindowEnd && (
                      <p className="text-[11px] mt-1 col-span-2" style={{ color: "#DC2626" }}>{errors.deliveryWindowEnd.message}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Prioridade ── */}
              <div>
                <p className="text-[11px] font-semibold uppercase mb-3"
                   style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}>
                  Prioridade
                </p>
                <div className="space-y-2">
                  {PRIORITY_OPTIONS.map(opt => {
                    const isSelected = priority === opt.value;
                    return (
                      <button key={opt.value} type="button" onClick={() => setValue("priority", opt.value)}
                              className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all",
                                           isSelected ? `${opt.activeBg} ${opt.activeBorder}` : "bg-white border-gray-200 hover:border-gray-300")}>
                        <opt.icon className={cn("w-4 h-4 flex-shrink-0", isSelected ? opt.activeText : "text-gray-400")} />
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-[13px] font-semibold", isSelected ? opt.activeText : "text-gray-700")}>{opt.label}</p>
                          <p className="text-[11px] text-gray-400">{opt.description}</p>
                        </div>
                        {isSelected && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: opt.dotColor }} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Data/hora prevista ── */}
              <div>
                <label className="block text-[11px] font-semibold mb-1.5 uppercase"
                       style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}>
                  Data e hora prevista da entrega
                </label>
                <input {...register("scheduledFor")} type="datetime-local"
                       className="w-full px-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                       style={{ borderColor: errors.scheduledFor ? "#DC2626" : "var(--color-border)", backgroundColor: "white", colorScheme: "light" }} />
                {errors.scheduledFor && <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.scheduledFor.message}</p>}
                <p className="text-[11px] mt-1" style={{ color: "#A3A3A3" }}>Pré-preenchido conforme prioridade — edite se necessário</p>
              </div>

              {/* ── Frete cobrado ── */}
              <div>
                <label className="block text-[11px] font-semibold mb-1.5 uppercase"
                       style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}>
                  Frete cobrado do cliente
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: "#A3A3A3" }}>R$</span>
                  <input type="number" step="0.01" min="0" defaultValue={suggestedPrice.toFixed(2)}
                         onChange={e => setValue("chargedFreight", parseFloat(e.target.value) || 0)}
                         className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                         style={{ borderColor: "var(--color-border)", backgroundColor: "white" }} />
                </div>
              </div>

              {/* ── Observações ── */}
              <div>
                <label className="block text-[11px] font-semibold mb-1.5 uppercase"
                       style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}>
                  Observações{" "}
                  <span className="font-normal normal-case" style={{ color: "#A3A3A3" }}>(opcional)</span>
                </label>
                <textarea {...register("notes")} rows={2} placeholder="Ex: Ligar antes, portão azul..."
                          className="w-full px-3 py-2.5 rounded-lg text-[13px] border resize-none focus:outline-none"
                          style={{ borderColor: "var(--color-border)", backgroundColor: "white" }} />
              </div>

              {submitError && (
                <div className="rounded-lg px-4 py-3"
                     style={{ backgroundColor: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)" }}>
                  <p className="text-[13px]" style={{ color: "#7F1D1D" }}>{submitError}</p>
                </div>
              )}
            </form>

            {/* Footer */}
            <div className="px-6 py-4 border-t flex-shrink-0"
                 style={{ borderColor: "var(--color-border)" }}>
              <button onClick={handleSubmit(onSubmit)}
                      disabled={isSubmitting || erpLookupState !== "found"}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: erpLookupState === "found" ? "var(--color-primary)" : "#9CA3AF",
                        boxShadow:       erpLookupState === "found" ? "0 2px 8px rgba(249,115,22,0.25)" : "none",
                      }}>
                {isSubmitting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><span>Criar Solicitação</span><ChevronRight className="w-4 h-4" /></>}
              </button>
              {erpLookupState !== "found" && erpLookupState !== "idle" && (
                <p className="text-center text-[11px] mt-1" style={{ color: "#DC2626" }}>
                  {erpLookupState === "blocked"
                    ? "Pedido bloqueado — não é possível criar a solicitação"
                    : "Valide o pedido na Citel para continuar"}
                </p>
              )}
              {erpLookupState === "found" && (
                <p className="text-center text-[11px] mt-2" style={{ color: "#A3A3A3" }}>
                  NF será vinculada após emissão pelo CD
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
