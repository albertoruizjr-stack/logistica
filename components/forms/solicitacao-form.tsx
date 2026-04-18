"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2, Search, Package, User, MapPin, CheckCircle2,
  AlertTriangle, ArrowLeftRight, FileText, Zap
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { ERPInvoice } from "@/types";

// Step 1: buscar NF
const step1Schema = z.object({
  invoiceNumber: z.string().min(1, "Informe o número da NF"),
  storeId: z.string().min(1, "Selecione a loja"),
});

// Step 2: confirmar pedido
const step2Schema = z.object({
  isComplete: z.boolean(),
  chargedFreight: z.number({ invalid_type_error: "Informe o valor do frete" }).min(0),
  deliveryType: z.enum(["STANDARD", "URGENT"]),
  notes: z.string().optional(),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;

interface Store {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  stores: Store[];
  sessionStoreId: string;
  sessionUserId: string;
}

type Step = "SEARCH" | "CONFIRM" | "AVAILABILITY" | "SUBMITTING" | "DONE";

export function NovaSolicitacaoForm({ stores, sessionStoreId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("SEARCH");
  const [invoice, setInvoice] = useState<ERPInvoice | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // disponibilidade de cada item
  const [itemAvailability, setItemAvailability] = useState<Record<string, boolean>>({});
  // cotação de frete calculada
  const [suggestedFreight, setSuggestedFreight] = useState<number | null>(null);

  const step1 = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: { storeId: sessionStoreId },
  });

  const step2 = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
    defaultValues: { isComplete: true, deliveryType: "STANDARD", chargedFreight: 0 },
  });

  // Step 1: busca NF no ERP
  async function handleSearch(data: Step1Data) {
    setFetchError(null);
    try {
      const res = await fetch(`/api/erp/nota-fiscal/${data.invoiceNumber}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        setFetchError(json.error ?? "NF não encontrada no ERP");
        return;
      }

      setInvoice(json.data);

      // inicializa disponibilidade como true para todos os itens
      const avail: Record<string, boolean> = {};
      json.data.items.forEach((item: { productCode: string }) => {
        avail[item.productCode] = true;
      });
      setItemAvailability(avail);

      setStep("CONFIRM");
    } catch {
      setFetchError("Erro de conexão ao consultar o ERP");
    }
  }

  // toggle de disponibilidade de item
  function toggleItemAvailability(productCode: string) {
    setItemAvailability((prev) => ({
      ...prev,
      [productCode]: !prev[productCode],
    }));
  }

  const allAvailable = Object.values(itemAvailability).every(Boolean);
  const missingCount = Object.values(itemAvailability).filter(Boolean === false).length;

  // Step 2: submete a solicitação
  async function handleSubmit(data: Step2Data) {
    if (!invoice) return;
    setStep("SUBMITTING");
    setSubmitError(null);

    const payload = {
      invoiceNumber: invoice.invoiceNumber,
      storeId: step1.getValues("storeId"),
      deliveryType: data.deliveryType,
      chargedFreight: data.chargedFreight,
      isComplete: allAvailable,
      notes: data.notes,
      itemsAvailability: invoice.items.map((item) => ({
        productCode: item.productCode,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        availableAtStore: itemAvailability[item.productCode] ?? true,
      })),
    };

    try {
      const res = await fetch("/api/solicitacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setSubmitError(json.error ?? "Erro ao criar solicitação");
        setStep("CONFIRM");
        return;
      }

      setCreatedId(json.data.id);
      setStep("DONE");
    } catch {
      setSubmitError("Erro de conexão. Tente novamente.");
      setStep("CONFIRM");
    }
  }

  // ── TELA: DONE ──
  if (step === "DONE") {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Solicitação criada!</h2>
        <p className="text-gray-500 text-sm mb-1">
          NF <strong>{invoice?.invoiceNumber}</strong> registrada com sucesso.
        </p>
        {!allAvailable && (
          <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-700 flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 flex-shrink-0" />
            Transferência criada automaticamente para os itens em falta.
          </div>
        )}
        <div className="mt-6 flex gap-3 justify-center">
          <button
            onClick={() => router.push("/solicitacoes")}
            className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
          >
            Ver solicitações
          </button>
          <button
            onClick={() => {
              setStep("SEARCH");
              setInvoice(null);
              step1.reset({ storeId: sessionStoreId });
              step2.reset();
            }}
            className="px-5 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition"
          >
            Nova solicitação
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── STEP 1: Busca NF ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-5">
          <div className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
            step !== "SEARCH" ? "bg-green-500 text-white" : "bg-orange-500 text-white"
          )}>
            {step !== "SEARCH" ? "✓" : "1"}
          </div>
          <h2 className="font-semibold text-gray-900">Buscar nota fiscal</h2>
        </div>

        <form onSubmit={step1.handleSubmit(handleSearch)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Loja de origem
              </label>
              <select
                {...step1.register("storeId")}
                disabled={step !== "SEARCH"}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white disabled:bg-gray-50"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    Loja {s.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Número da NF
              </label>
              <div className="flex gap-2">
                <input
                  {...step1.register("invoiceNumber")}
                  disabled={step !== "SEARCH"}
                  placeholder="Ex: 123456"
                  className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-50"
                />
                {step === "SEARCH" && (
                  <button
                    type="submit"
                    disabled={step1.formState.isSubmitting}
                    className="px-4 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-60 transition flex items-center gap-1.5"
                  >
                    {step1.formState.isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                    Buscar
                  </button>
                )}
              </div>
              {step1.formState.errors.invoiceNumber && (
                <p className="text-xs text-red-600 mt-1">
                  {step1.formState.errors.invoiceNumber.message}
                </p>
              )}
            </div>
          </div>

          {fetchError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700">{fetchError}</p>
            </div>
          )}
        </form>
      </div>

      {/* ── STEP 2: Confirmar dados do ERP ── */}
      {invoice && step !== "SEARCH" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold">
              2
            </div>
            <h2 className="font-semibold text-gray-900">Confirmar pedido</h2>
          </div>

          {/* Dados do cliente */}
          <div className="grid grid-cols-2 gap-4 mb-5 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-start gap-2">
              <User className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Cliente</p>
                <p className="text-sm font-medium text-gray-900">{invoice.customer.name}</p>
                {invoice.customer.phone && (
                  <p className="text-xs text-gray-500">{invoice.customer.phone}</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Endereço de entrega</p>
                <p className="text-sm font-medium text-gray-900">
                  {invoice.deliveryAddress.street}
                </p>
                <p className="text-xs text-gray-500">{invoice.deliveryAddress.city}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <FileText className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Total da NF</p>
                <p className="text-sm font-semibold text-gray-900">
                  {formatCurrency(invoice.totalValue)}
                </p>
              </div>
            </div>
          </div>

          {/* Itens com toggle de disponibilidade */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700">
                Itens do pedido
              </h3>
              {!allAvailable && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <ArrowLeftRight className="w-3 h-3" />
                  Transferência necessária
                </span>
              )}
            </div>
            <div className="space-y-2">
              {invoice.items.map((item) => (
                <div
                  key={item.productCode}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                    itemAvailability[item.productCode]
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  )}
                >
                  <Package className={cn(
                    "w-4 h-4 flex-shrink-0",
                    itemAvailability[item.productCode] ? "text-green-500" : "text-red-400"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {item.productName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {item.quantity} {item.unit} • Cód: {item.productCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleItemAvailability(item.productCode)}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-full font-medium border transition-colors",
                      itemAvailability[item.productCode]
                        ? "bg-green-100 text-green-700 border-green-200 hover:bg-red-100 hover:text-red-700 hover:border-red-200"
                        : "bg-red-100 text-red-700 border-red-200 hover:bg-green-100 hover:text-green-700 hover:border-green-200"
                    )}
                  >
                    {itemAvailability[item.productCode] ? "✓ Na loja" : "✗ Em falta"}
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Clique em cada item para marcar como disponível ou em falta na loja.
            </p>
          </div>

          {/* Formulário step 2 */}
          <form onSubmit={step2.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Tipo de entrega */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Tipo de entrega
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["STANDARD", "URGENT"] as const).map((type) => (
                    <label
                      key={type}
                      className={cn(
                        "flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm",
                        step2.watch("deliveryType") === type
                          ? type === "URGENT"
                            ? "bg-red-50 border-red-300 text-red-700"
                            : "bg-blue-50 border-blue-300 text-blue-700"
                          : "border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      <input
                        type="radio"
                        {...step2.register("deliveryType")}
                        value={type}
                        className="sr-only"
                      />
                      {type === "URGENT" ? (
                        <Zap className="w-3.5 h-3.5" />
                      ) : (
                        <Package className="w-3.5 h-3.5" />
                      )}
                      {type === "STANDARD" ? "Padrão" : "Urgente"}
                    </label>
                  ))}
                </div>
              </div>

              {/* Frete cobrado */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Frete cobrado do cliente (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  {...step2.register("chargedFreight", { valueAsNumber: true })}
                  placeholder="0,00"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                {suggestedFreight !== null && (
                  <p className="text-xs text-gray-400 mt-1">
                    Sugerido: {formatCurrency(suggestedFreight)}
                  </p>
                )}
                {step2.formState.errors.chargedFreight && (
                  <p className="text-xs text-red-600 mt-1">
                    {step2.formState.errors.chargedFreight.message}
                  </p>
                )}
              </div>
            </div>

            {/* Observações */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Observações (opcional)
              </label>
              <textarea
                {...step2.register("notes")}
                rows={2}
                placeholder="Instruções especiais para a entrega..."
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
              />
            </div>

            {/* Aviso de transferência */}
            {!allAvailable && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start gap-2">
                <ArrowLeftRight className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-orange-900">Transferência necessária</p>
                  <p className="text-xs text-orange-700 mt-0.5">
                    Itens em falta gerarão uma solicitação de transferência automática que o
                    operador logístico irá gerenciar.
                  </p>
                </div>
              </div>
            )}

            {submitError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm text-red-700">{submitError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setStep("SEARCH"); setInvoice(null); }}
                className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={step === "SUBMITTING"}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
              >
                {step === "SUBMITTING" && <Loader2 className="w-4 h-4 animate-spin" />}
                {step === "SUBMITTING" ? "Criando..." : "Criar solicitação de entrega"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
