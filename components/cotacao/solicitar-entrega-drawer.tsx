"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X, Loader2, Zap, Calendar, Clock,
  ChevronRight, CheckCircle2, Phone, AlertCircle,
  Search, User, MapPin, ShoppingCart,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

// ─── helpers ───────────────────────────────────────────────
function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultScheduledFor(priority: "URGENTE" | "HOJE" | "NORMAL"): string {
  const now = new Date();
  if (priority === "URGENTE") {
    now.setHours(now.getHours() + 1);
    return toDatetimeLocal(now);
  }
  if (priority === "HOJE") {
    now.setHours(18, 0, 0, 0);
    return toDatetimeLocal(now);
  }
  now.setDate(now.getDate() + 1);
  now.setHours(12, 0, 0, 0);
  return toDatetimeLocal(now);
}

// ─── schema ────────────────────────────────────────────────
const schema = z
  .object({
    orderNumber:   z.string().min(1, "Informe o número do pedido"),
    orderStoreId:  z.string().min(1, "Selecione a loja do pedido"),
    customerName:  z.string().min(2, "Informe o nome do destinatário"),
    customerPhone: z.string().min(8, "Informe o telefone (mín. 8 dígitos)"),
    deliveryAddress: z.string().min(5, "Informe o endereço de entrega"),
    deliveryWindowStart: z.string().optional(),
    deliveryWindowEnd:   z.string().optional(),
    priority:      z.enum(["URGENTE", "HOJE", "NORMAL"]),
    chargedFreight: z.number({ invalid_type_error: "Informe o valor do frete" }).min(0),
    scheduledFor:  z.string().min(1, "Informe a data/hora prevista"),
    notes:         z.string().optional(),
  })
  .refine(
    (d) => {
      if (!d.deliveryWindowStart || !d.deliveryWindowEnd) return true;
      return d.deliveryWindowStart < d.deliveryWindowEnd;
    },
    { message: "Início da janela deve ser anterior ao fim", path: ["deliveryWindowEnd"] }
  );

type FormData = z.infer<typeof schema>;

// ─── tipos ─────────────────────────────────────────────────
interface StoreOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  freightQuoteId: string;
  storeId: string;
  stores: StoreOption[];
  suggestedPrice: number;
  isUrgent: boolean;
  destAddress: string;
}

const PRIORITY_OPTIONS: {
  value: FormData["priority"];
  label: string;
  description: string;
  icon: typeof Zap;
  dotColor: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
}[] = [
  {
    value: "URGENTE",
    label: "Urgente",
    description: "Entrega imediata — cliente aguardando",
    icon: Zap,
    dotColor: "#DC2626",
    activeBg: "bg-red-50",
    activeBorder: "border-red-300",
    activeText: "text-red-700",
  },
  {
    value: "HOJE",
    label: "Hoje",
    description: "Entrega no mesmo dia (D0)",
    icon: Clock,
    dotColor: "#F97316",
    activeBg: "bg-orange-50",
    activeBorder: "border-orange-300",
    activeText: "text-orange-700",
  },
  {
    value: "NORMAL",
    label: "Normal",
    description: "Entrega no próximo ciclo de rota (D+1)",
    icon: Calendar,
    dotColor: "#737373",
    activeBg: "bg-gray-50",
    activeBorder: "border-gray-300",
    activeText: "text-gray-700",
  },
];

// ─── componente ────────────────────────────────────────────
export function SolicitarEntregaDrawer({
  open,
  onClose,
  freightQuoteId,
  storeId,
  stores,
  suggestedPrice,
  isUrgent,
  destAddress,
}: Props) {
  const router = useRouter();
  const [erpLookupState, setErpLookupState] = useState<"idle" | "loading" | "found" | "not_found">("idle");
  const [erpItemCount, setErpItemCount] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{ id: string; orderNumber: string } | null>(null);

  const defaultPriority: FormData["priority"] = isUrgent ? "URGENTE" : "NORMAL";

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: {
        orderNumber: "",
        orderStoreId: storeId, // mesma loja da cotação por padrão
        customerName: "",
        customerPhone: "",
        deliveryAddress: destAddress,
        deliveryWindowStart: "",
        deliveryWindowEnd: "",
        priority: defaultPriority,
        chargedFreight: suggestedPrice,
        scheduledFor: defaultScheduledFor(defaultPriority),
        notes: "",
      },
    });

  const priority = watch("priority");
  const orderNumber = watch("orderNumber");
  const orderStoreId = watch("orderStoreId");

  useEffect(() => {
    setValue("scheduledFor", defaultScheduledFor(priority));
  }, [priority, setValue]);

  useEffect(() => {
    if (!successData) return;
    const timer = setTimeout(() => {
      router.push(`/solicitacoes/${successData.id}`);
      onClose();
    }, 2000);
    return () => clearTimeout(timer);
  }, [successData, router, onClose]);

  async function handleErpLookup() {
    if (!orderNumber.trim() || !orderStoreId) return;
    const store = stores.find((s) => s.id === orderStoreId);
    if (!store) return;

    setErpLookupState("loading");
    try {
      const res = await fetch(
        `/api/erp/pedido?number=${encodeURIComponent(orderNumber.trim())}&storeCode=${encodeURIComponent(store.code)}`
      );
      const json = await res.json();

      if (!res.ok || !json.success) {
        setErpLookupState("not_found");
        return;
      }

      const d = json.data;
      if (d.customerName) setValue("customerName", d.customerName);
      if (d.customerPhone) setValue("customerPhone", d.customerPhone);
      if (d.deliveryAddress) setValue("deliveryAddress", d.deliveryAddress);
      setErpItemCount(d.itemCount ?? null);
      setErpLookupState("found");
    } catch {
      setErpLookupState("not_found");
    }
  }

  async function onSubmit(data: FormData) {
    setSubmitError(null);
    const deliveryType = data.priority === "URGENTE" ? "URGENT" : "STANDARD";

    try {
      const res = await fetch("/api/solicitacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber:    data.orderNumber.trim(),
          orderStoreId:   data.orderStoreId,
          storeId,
          freightQuoteId,
          chargedFreight: data.chargedFreight,
          deliveryType,
          customerName:   data.customerName.trim(),
          customerPhone:  data.customerPhone.trim(),
          deliveryAddress: data.deliveryAddress.trim(),
          deliveryWindowStart: data.deliveryWindowStart || undefined,
          deliveryWindowEnd:   data.deliveryWindowEnd || undefined,
          scheduledFor:   new Date(data.scheduledFor).toISOString(),
          notes:          data.notes || undefined,
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
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        onClick={!successData ? onClose : undefined}
      />

      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col shadow-2xl"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              className="text-[15px] font-bold"
              style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}
            >
              Solicitar Entrega
            </h2>
            <p className="text-[12px] mt-0.5 truncate max-w-[280px]" style={{ color: "var(--color-muted-text)" }}>
              {destAddress}
            </p>
          </div>
          {!successData && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
            >
              <X className="w-4 h-4" style={{ color: "var(--color-muted-text)" }} />
            </button>
          )}
        </div>

        {/* Estado de sucesso */}
        {successData ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "rgba(22,163,74,0.1)" }}
            >
              <CheckCircle2 className="w-8 h-8" style={{ color: "#16A34A" }} />
            </div>
            <div>
              <p
                className="text-[17px] font-bold mb-1"
                style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}
              >
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
            <div
              className="mx-6 mt-4 px-4 py-3 rounded-lg flex items-center justify-between"
              style={{ backgroundColor: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.15)" }}
            >
              <p className="text-[12px]" style={{ color: "var(--color-muted-text)" }}>
                Frete sugerido pela cotação
              </p>
              <p className="text-[14px] font-bold" style={{ color: "var(--color-primary)" }}>
                {formatCurrency(suggestedPrice)}
              </p>
            </div>

            <form
              onSubmit={handleSubmit(onSubmit)}
              className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
            >
              {/* ── Seção: Pedido ── */}
              <div>
                <p
                  className="text-[11px] font-semibold uppercase mb-3"
                  style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}
                >
                  Pedido (PD)
                </p>

                {/* Loja do pedido */}
                <div className="mb-3">
                  <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                    Loja que gerou o pedido
                  </label>
                  <select
                    {...register("orderStoreId")}
                    className="w-full px-3 py-2.5 rounded-lg text-[13px] border focus:outline-none bg-white"
                    style={{ borderColor: errors.orderStoreId ? "#DC2626" : "var(--color-border)" }}
                    onChange={() => setErpLookupState("idle")}
                  >
                    <option value="">Selecione a loja...</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        Loja {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                  {errors.orderStoreId && (
                    <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.orderStoreId.message}</p>
                  )}
                </div>

                {/* Número do PD + botão buscar */}
                <div>
                  <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                    Número do pedido
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <ShoppingCart
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                        style={{ color: "#A3A3A3" }}
                      />
                      <input
                        {...register("orderNumber")}
                        type="text"
                        placeholder="Ex: 45231"
                        autoFocus
                        onChange={() => setErpLookupState("idle")}
                        className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                        style={{
                          borderColor: errors.orderNumber ? "#DC2626" : "var(--color-border)",
                          backgroundColor: "white",
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleErpLookup}
                      disabled={erpLookupState === "loading" || !orderNumber.trim() || !orderStoreId}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-semibold border transition-colors disabled:opacity-40"
                      style={{
                        backgroundColor: erpLookupState === "found" ? "rgba(22,163,74,0.08)" : "rgba(249,115,22,0.06)",
                        borderColor: erpLookupState === "found" ? "rgba(22,163,74,0.3)" : "rgba(249,115,22,0.2)",
                        color: erpLookupState === "found" ? "#16A34A" : "var(--color-primary)",
                      }}
                    >
                      {erpLookupState === "loading" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : erpLookupState === "found" ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      {erpLookupState === "found" ? "Encontrado" : "Buscar"}
                    </button>
                  </div>
                  {errors.orderNumber && (
                    <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.orderNumber.message}</p>
                  )}

                  {/* ERP: encontrado */}
                  {erpLookupState === "found" && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: "#16A34A" }}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Dados preenchidos automaticamente
                      {erpItemCount != null && ` · ${erpItemCount} item${erpItemCount !== 1 ? "s" : ""}`}
                    </div>
                  )}

                  {/* ERP: não encontrado */}
                  {erpLookupState === "not_found" && (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px]" style={{ color: "#D97706" }}>
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>Pedido não encontrado no ERP — preencha os dados abaixo manualmente. Você ainda pode criar a solicitação.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Seção: Destinatário ── */}
              <div>
                <p
                  className="text-[11px] font-semibold uppercase mb-3"
                  style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}
                >
                  Destinatário
                </p>

                <div className="space-y-3">
                  {/* Nome */}
                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                      Nome do cliente
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#A3A3A3" }} />
                      <input
                        {...register("customerName")}
                        type="text"
                        placeholder="Nome completo"
                        className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                        style={{
                          borderColor: errors.customerName ? "#DC2626" : "var(--color-border)",
                          backgroundColor: "white",
                        }}
                      />
                    </div>
                    {errors.customerName && (
                      <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.customerName.message}</p>
                    )}
                  </div>

                  {/* Telefone */}
                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                      Telefone para contato
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#A3A3A3" }} />
                      <input
                        {...register("customerPhone")}
                        type="tel"
                        placeholder="(11) 99999-9999"
                        className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                        style={{
                          borderColor: errors.customerPhone ? "#DC2626" : "var(--color-border)",
                          backgroundColor: "white",
                        }}
                      />
                    </div>
                    {errors.customerPhone && (
                      <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.customerPhone.message}</p>
                    )}
                  </div>

                  {/* Endereço */}
                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                      Endereço de entrega
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 w-4 h-4" style={{ color: "#A3A3A3" }} />
                      <textarea
                        {...register("deliveryAddress")}
                        rows={2}
                        placeholder="Rua, número, bairro, cidade"
                        className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border resize-none focus:outline-none"
                        style={{
                          borderColor: errors.deliveryAddress ? "#DC2626" : "var(--color-border)",
                          backgroundColor: "white",
                        }}
                      />
                    </div>
                    {errors.deliveryAddress && (
                      <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.deliveryAddress.message}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Seção: Janela de entrega ── */}
              <div>
                <p
                  className="text-[11px] font-semibold uppercase mb-3"
                  style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}
                >
                  Janela de entrega{" "}
                  <span className="font-normal normal-case" style={{ color: "#A3A3A3" }}>(opcional)</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                      Das
                    </label>
                    <input
                      {...register("deliveryWindowStart")}
                      type="time"
                      className="w-full px-3 py-2.5 rounded-lg text-[13px] border focus:outline-none bg-white"
                      style={{ borderColor: "var(--color-border)", colorScheme: "light" }}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] mb-1" style={{ color: "var(--color-muted-text)" }}>
                      Até
                    </label>
                    <input
                      {...register("deliveryWindowEnd")}
                      type="time"
                      className="w-full px-3 py-2.5 rounded-lg text-[13px] border focus:outline-none bg-white"
                      style={{
                        borderColor: errors.deliveryWindowEnd ? "#DC2626" : "var(--color-border)",
                        colorScheme: "light",
                      }}
                    />
                    {errors.deliveryWindowEnd && (
                      <p className="text-[11px] mt-1 col-span-2" style={{ color: "#DC2626" }}>
                        {errors.deliveryWindowEnd.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Seção: Prioridade ── */}
              <div>
                <p
                  className="text-[11px] font-semibold uppercase mb-3"
                  style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}
                >
                  Prioridade
                </p>
                <div className="space-y-2">
                  {PRIORITY_OPTIONS.map((opt) => {
                    const isSelected = priority === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setValue("priority", opt.value)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all",
                          isSelected
                            ? `${opt.activeBg} ${opt.activeBorder}`
                            : "bg-white border-gray-200 hover:border-gray-300"
                        )}
                      >
                        <opt.icon
                          className={cn("w-4 h-4 flex-shrink-0", isSelected ? opt.activeText : "text-gray-400")}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-[13px] font-semibold", isSelected ? opt.activeText : "text-gray-700")}>
                            {opt.label}
                          </p>
                          <p className="text-[11px] text-gray-400">{opt.description}</p>
                        </div>
                        {isSelected && (
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: opt.dotColor }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Data/hora prevista ── */}
              <div>
                <label
                  className="block text-[11px] font-semibold mb-1.5 uppercase"
                  style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}
                >
                  Data e hora prevista da entrega
                </label>
                <input
                  {...register("scheduledFor")}
                  type="datetime-local"
                  className="w-full px-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                  style={{
                    borderColor: errors.scheduledFor ? "#DC2626" : "var(--color-border)",
                    backgroundColor: "white",
                    colorScheme: "light",
                  }}
                />
                {errors.scheduledFor && (
                  <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>{errors.scheduledFor.message}</p>
                )}
                <p className="text-[11px] mt-1" style={{ color: "#A3A3A3" }}>
                  Pré-preenchido conforme prioridade — edite se necessário
                </p>
              </div>

              {/* ── Frete cobrado ── */}
              <div>
                <label
                  className="block text-[11px] font-semibold mb-1.5 uppercase"
                  style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}
                >
                  Frete cobrado do cliente
                </label>
                <div className="relative">
                  <span
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px]"
                    style={{ color: "#A3A3A3" }}
                  >
                    R$
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={suggestedPrice.toFixed(2)}
                    onChange={(e) => setValue("chargedFreight", parseFloat(e.target.value) || 0)}
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg text-[13px] border focus:outline-none"
                    style={{ borderColor: "var(--color-border)", backgroundColor: "white" }}
                  />
                </div>
              </div>

              {/* ── Observações ── */}
              <div>
                <label
                  className="block text-[11px] font-semibold mb-1.5 uppercase"
                  style={{ letterSpacing: "0.1em", color: "var(--color-muted-text)" }}
                >
                  Observações{" "}
                  <span className="font-normal normal-case" style={{ color: "#A3A3A3" }}>(opcional)</span>
                </label>
                <textarea
                  {...register("notes")}
                  rows={2}
                  placeholder="Ex: Ligar antes, portão azul..."
                  className="w-full px-3 py-2.5 rounded-lg text-[13px] border resize-none focus:outline-none"
                  style={{ borderColor: "var(--color-border)", backgroundColor: "white" }}
                />
              </div>

              {submitError && (
                <div
                  className="rounded-lg px-4 py-3"
                  style={{ backgroundColor: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)" }}
                >
                  <p className="text-[13px]" style={{ color: "#7F1D1D" }}>{submitError}</p>
                </div>
              )}
            </form>

            {/* Footer */}
            <div
              className="px-6 py-4 border-t flex-shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <button
                onClick={handleSubmit(onSubmit)}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-bold text-white transition-opacity disabled:opacity-60"
                style={{
                  backgroundColor: "var(--color-primary)",
                  boxShadow: "0 2px 8px rgba(249,115,22,0.25)",
                }}
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Criar Solicitação
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
              <p className="text-center text-[11px] mt-2" style={{ color: "#A3A3A3" }}>
                NF será vinculada após emissão pelo CD
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
