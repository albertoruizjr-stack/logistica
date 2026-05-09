"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2, Search, Package, User, MapPin, CheckCircle2,
  AlertTriangle, ArrowLeftRight, FileText, Zap, TrendingUp, Clock, X, Calendar
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  getCutoffStatus,
  FIRST_CUTOFF,
  DISPATCH_WINDOW_LABELS,
  type CutoffStatus,
  type DispatchWindowValue,
  type SameDayCutoffChoice,
} from "@/lib/cutoff";
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

type Step = "SEARCH" | "CONFIRM" | "AVAILABILITY" | "SUBMITTING" | "DONE" | "DUPLICATE";
type CutoffChoice = "SECOND_DISPATCH" | "EXPRESS" | "EXCEPTION";

export function NovaSolicitacaoForm({ stores, sessionStoreId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("SEARCH");
  const [invoice, setInvoice] = useState<ERPInvoice | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  // disponibilidade de cada item
  const [itemAvailability, setItemAvailability] = useState<Record<string, boolean>>({});
  // cotação de frete
  const [suggestedFreight, setSuggestedFreight] = useState<number | null>(null);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [freightLoading, setFreightLoading] = useState(false);
  // corte horário 17h30
  const [cutoffStatus, setCutoffStatus] = useState<CutoffStatus | null>(null);
  const [showCutoffModal, setShowCutoffModal] = useState(false);
  const [cutoffChoice, setCutoffChoice] = useState<CutoffChoice | null>(null);
  const [exceptionReason, setExceptionReason] = useState("");
  const [cutoffWarningShownAt, setCutoffWarningShownAt] = useState<Date | null>(null);
  // corte same-day 12h00
  const [showSameDayModal, setShowSameDayModal] = useState(false);
  const [sameDayCutoffChoice, setSameDayCutoffChoice] = useState<SameDayCutoffChoice | null>(null);
  const [sameDayApprovalReason, setSameDayApprovalReason] = useState("");

  // Verifica corte horário na montagem e a cada minuto
  useEffect(() => {
    const check = () => {
      const status = getCutoffStatus();
      setCutoffStatus(status);
      if (status.isAfterFirst && !cutoffWarningShownAt) {
        setCutoffWarningShownAt(new Date());
      }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step1 = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: { storeId: sessionStoreId },
  });

  const step2 = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
    defaultValues: { isComplete: true, deliveryType: "STANDARD", chargedFreight: 0 },
  });

  // Recalcula cotação com coords já conhecidas (muda só isUrgent)
  const refreshQuote = useCallback(async (coords: { lat: number; lng: number }, storeId: string, isUrgent: boolean) => {
    const store = stores.find((s) => s.id === storeId);
    if (!store || !invoice) return;
    setFreightLoading(true);
    try {
      const address = `${invoice.deliveryAddress.street}, ${invoice.deliveryAddress.city}, ${invoice.deliveryAddress.state}`;
      const res = await fetch("/api/frete/cotacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: store.id,
          originAddress: store.name,
          originLat: store.lat,
          originLng: store.lng,
          destAddress: address,
          destLat: coords.lat,
          destLng: coords.lng,
          isUrgent,
          save: false,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSuggestedFreight(json.data.suggestedPrice);
        step2.setValue("chargedFreight", json.data.suggestedPrice);
      }
    } catch {
      // falha silenciosa — usuário digita manualmente
    } finally {
      setFreightLoading(false);
    }
  }, [invoice, stores, step2]);

  // Geocodifica endereço + calcula cotação inicial
  async function geocodeAndQuote(inv: ERPInvoice, storeId: string) {
    const store = stores.find((s) => s.id === storeId);
    if (!store) return;
    setFreightLoading(true);
    try {
      const address = `${inv.deliveryAddress.street}, ${inv.deliveryAddress.city}, ${inv.deliveryAddress.state}`;
      const geoRes = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const geoJson = await geoRes.json();
      if (!geoRes.ok || !geoJson.success) return;

      const coords = { lat: geoJson.data.lat, lng: geoJson.data.lng };
      setDestCoords(coords);
      await refreshQuote(coords, storeId, step2.getValues("deliveryType") === "URGENT");
    } catch {
      // endereço não encontrado — usuário digita manualmente
    } finally {
      setFreightLoading(false);
    }
  }

  // Recotiza quando tipo de entrega muda (só se coordenadas já conhecidas)
  const watchedDeliveryType = step2.watch("deliveryType");
  useEffect(() => {
    if (!destCoords || step === "SEARCH") return;
    void refreshQuote(destCoords, step1.getValues("storeId"), watchedDeliveryType === "URGENT");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedDeliveryType]);

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

      // geocodifica + cotiza frete em background (não bloqueia o avanço de tela)
      void geocodeAndQuote(json.data, data.storeId);
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
  const missingCount = Object.values(itemAvailability).filter((v) => !v).length;

  // Step 2: verifica corte → abre modal se necessário → submete
  async function handleSubmit(data: Step2Data) {
    if (!invoice) return;

    // Gate 1 — same-day: URGENT após 12h e ainda não escolheu o que fazer
    if (cutoffStatus?.isAfterSecond && data.deliveryType === "URGENT" && !sameDayCutoffChoice) {
      setShowSameDayModal(true);
      return;
    }

    // Gate 2 — 17h30: padrão após corte e ainda não escolheu
    if (cutoffStatus?.isAfterFirst && data.deliveryType !== "URGENT" && !cutoffChoice) {
      setShowCutoffModal(true);
      return;
    }

    await submitSolicitacao(data);
  }

  async function submitSolicitacao(
    data: Step2Data,
    choiceOverride?: CutoffChoice,
    sameDayChoiceOverride?: SameDayCutoffChoice
  ) {
    const choice = choiceOverride ?? cutoffChoice;
    const sdChoice = sameDayChoiceOverride ?? sameDayCutoffChoice;
    setStep("SUBMITTING");
    setSubmitError(null);

    // Same-day: se escolheu NEXT_DAY, muda para STANDARD; se EXPRESS, força URGENT
    // Corte 17h30: se escolheu EXPRESS, força URGENT
    let effectiveDeliveryType = data.deliveryType;
    if (sdChoice === "NEXT_DAY") {
      effectiveDeliveryType = "STANDARD";
    } else if (sdChoice === "EXPRESS" || choice === "EXPRESS") {
      effectiveDeliveryType = "URGENT";
    }

    // Salva cotação definitiva antes de criar a solicitação
    let freightQuoteId: string | undefined;
    if (destCoords) {
      const store = stores.find((s) => s.id === step1.getValues("storeId"));
      if (store) {
        try {
          const address = `${invoice!.deliveryAddress.street}, ${invoice!.deliveryAddress.city}, ${invoice!.deliveryAddress.state}`;
          const quoteRes = await fetch("/api/frete/cotacao", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storeId: store.id,
              originAddress: store.name,
              originLat: store.lat,
              originLng: store.lng,
              destAddress: address,
              destLat: destCoords.lat,
              destLng: destCoords.lng,
              isUrgent: effectiveDeliveryType === "URGENT",
              save: true,
            }),
          });
          const quoteJson = await quoteRes.json();
          if (quoteRes.ok && quoteJson.success) {
            freightQuoteId = quoteJson.data.quoteId;
          }
        } catch {
          // continua sem quoteId
        }
      }
    }

    // Mapeia escolhas para overrides de API
    // Same-day EXPRESS ou 17h30 EXPRESS → ambos viram "EXPRESS" no dispatchWindowOverride
    const dispatchWindowOverride: "EXPRESS" | "EXCEPTION" | undefined =
      sdChoice === "EXPRESS" ? "EXPRESS" :
      choice === "EXPRESS" ? "EXPRESS" :
      choice === "EXCEPTION" ? "EXCEPTION" :
      undefined;

    const payload = {
      invoiceNumber: invoice!.invoiceNumber,
      storeId: step1.getValues("storeId"),
      deliveryType: effectiveDeliveryType,
      chargedFreight: data.chargedFreight,
      isComplete: allAvailable,
      notes: data.notes,
      freightQuoteId,
      itemsAvailability: invoice!.items.map((item) => ({
        productCode: item.productCode,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        availableAtStore: itemAvailability[item.productCode] ?? true,
      })),
      // campos de corte 17h30
      ...(dispatchWindowOverride ? { dispatchWindowOverride } : {}),
      ...(choice === "EXCEPTION" && exceptionReason ? { cutoffApprovalReason: exceptionReason } : {}),
      ...(cutoffWarningShownAt ? { cutoffWarningShownAt: cutoffWarningShownAt.toISOString() } : {}),
      // campos de corte same-day 12h00
      ...(sdChoice === "EXCEPTION" && sameDayApprovalReason
        ? { sameDayRequested: true, sameDayApprovalReason }
        : {}),
    };

    try {
      const res = await fetch("/api/solicitacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (res.status === 409 && json.code === "DUPLICATE") {
        setDuplicateId(json.details?.existingId ?? null);
        setStep("DUPLICATE");
        return;
      }

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

  // ── TELA: DUPLICATE ──
  if (step === "DUPLICATE") {
    return (
      <div className="bg-white rounded-xl border border-amber-200 p-8 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Solicitação já existe</h2>
        <p className="text-gray-500 text-sm mb-1">
          Já existe uma solicitação de entrega para este pedido.
        </p>
        <p className="text-gray-400 text-xs mt-1">
          Não é possível criar uma segunda solicitação para o mesmo número de pedido e loja.
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <button
            onClick={() => {
              setStep("SEARCH");
              setInvoice(null);
              setDuplicateId(null);
              step1.reset({ storeId: sessionStoreId });
              step2.reset();
            }}
            className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
          >
            Voltar
          </button>
          {duplicateId ? (
            <button
              onClick={() => router.push(`/solicitacoes/${duplicateId}`)}
              className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition"
            >
              Ver solicitação existente
            </button>
          ) : (
            <button
              onClick={() => router.push("/solicitacoes")}
              className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition"
            >
              Ver solicitações
            </button>
          )}
        </div>
      </div>
    );
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

  // ── MODAL DE CORTE SAME-DAY (12h00) ──
  const SameDayModal = () => {
    const [localReason, setLocalReason] = useState(sameDayApprovalReason);

    function choose(sdChoice: SameDayCutoffChoice) {
      setSameDayCutoffChoice(sdChoice);
      setShowSameDayModal(false);
      if (sdChoice === "EXCEPTION") {
        setSameDayApprovalReason(localReason);
      }
      void submitSolicitacao(step2.getValues(), undefined, sdChoice);
    }

    if (!showSameDayModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
          <button
            onClick={() => setShowSameDayModal(false)}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base leading-tight">
                Corte de 12h00 — entrega no mesmo dia
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                São {cutoffStatus?.brasiliaTime.hour}h{String(cutoffStatus?.brasiliaTime.minute ?? 0).padStart(2, "0")} (horário de Brasília)
              </p>
            </div>
          </div>

          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-5 text-sm text-orange-800">
            Após as 12h00, a frota interna <strong>não garante entrega hoje</strong>.
            <br /><br />
            Escolha como prosseguir com esta solicitação urgente.
          </div>

          <div className="space-y-3">
            {/* Opção 1: Expressa via Lalamove */}
            <button
              onClick={() => choose("EXPRESS")}
              className="w-full text-left px-4 py-3 border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition group"
            >
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-gray-900 text-sm group-hover:text-blue-900">
                    Entrega expressa via Lalamove
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Garante entrega hoje · Novo custo de frete aplicado
                  </p>
                </div>
              </div>
            </button>

            {/* Opção 2: Reagendar para amanhã */}
            <button
              onClick={() => choose("NEXT_DAY")}
              className="w-full text-left px-4 py-3 border-2 border-gray-200 rounded-xl hover:border-orange-300 hover:bg-orange-50 transition group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900 text-sm group-hover:text-orange-900">
                    Reagendar para amanhã
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Entra no 1º Despacho do dia seguinte · Frete padrão
                  </p>
                </div>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                  Recomendado
                </span>
              </div>
            </button>

            {/* Opção 3: Exceção operacional */}
            <div className="border-2 border-gray-200 rounded-xl overflow-hidden hover:border-red-200 transition">
              <div className="px-4 py-3">
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">
                      Solicitar exceção operacional
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      A logística precisará aprovar a entrega hoje pela frota interna
                    </p>
                  </div>
                </div>
                <textarea
                  value={localReason}
                  onChange={(e) => setLocalReason(e.target.value)}
                  placeholder="Descreva o motivo — ex: cliente não pode receber amanhã..."
                  rows={2}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-red-300 mt-1"
                />
                <button
                  onClick={() => { setSameDayApprovalReason(localReason); choose("EXCEPTION"); }}
                  disabled={!localReason.trim()}
                  className="mt-2 w-full py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
                >
                  Solicitar exceção
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowSameDayModal(false)}
            className="mt-4 w-full text-center text-sm text-gray-400 hover:text-gray-600 transition"
          >
            Cancelar — voltar ao formulário
          </button>
        </div>
      </div>
    );
  };

  // ── MODAL DE CORTE HORÁRIO (17h30) ──
  const CutoffModal = () => {
    const [localReason, setLocalReason] = useState(exceptionReason);

    function choose(choice: CutoffChoice) {
      setCutoffChoice(choice);
      setShowCutoffModal(false);
      if (choice === "EXCEPTION") {
        setExceptionReason(localReason);
      }
      void submitSolicitacao(step2.getValues(), choice);
    }

    if (!showCutoffModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
          <button
            onClick={() => setShowCutoffModal(false)}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Ícone + título */}
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base leading-tight">
                Horário de corte das {FIRST_CUTOFF.hour}h{String(FIRST_CUTOFF.minute).padStart(2, "0")} atingido
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                São {cutoffStatus?.brasiliaTime.hour}h{String(cutoffStatus?.brasiliaTime.minute ?? 0).padStart(2, "0")} (horário de Brasília)
              </p>
            </div>
          </div>

          {/* Mensagem */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5 text-sm text-amber-800">
            Esta solicitação entrou após o horário de corte das 17h30. Ela será programada para o{" "}
            <strong>segundo despacho do dia seguinte</strong>.
            <br /><br />
            Caso o cliente precise receber no período da manhã, altere para entrega expressa via Lalamove,
            sujeito a novo custo de frete.
          </div>

          {/* Opções */}
          <div className="space-y-3">
            {/* Opção 1: Manter no 2º despacho */}
            <button
              onClick={() => choose("SECOND_DISPATCH")}
              className="w-full text-left px-4 py-3 border-2 border-gray-200 rounded-xl hover:border-orange-300 hover:bg-orange-50 transition group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900 text-sm group-hover:text-orange-900">
                    Manter no 2º despacho
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Entrega no período da tarde do dia seguinte
                  </p>
                </div>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                  Recomendado
                </span>
              </div>
            </button>

            {/* Opção 2: Entrega expressa */}
            <button
              onClick={() => choose("EXPRESS")}
              className="w-full text-left px-4 py-3 border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900 text-sm group-hover:text-blue-900">
                      Alterar para entrega expressa
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Via Lalamove · Novo custo de frete aplicado
                    </p>
                  </div>
                </div>
              </div>
            </button>

            {/* Opção 3: Solicitar aprovação */}
            <div className="border-2 border-gray-200 rounded-xl overflow-hidden hover:border-red-200 transition">
              <div className="px-4 py-3">
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">
                      Solicitar aprovação excepcional
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      A equipe logística precisará aprovar a entrada no 1º despacho
                    </p>
                  </div>
                </div>
                <textarea
                  value={localReason}
                  onChange={(e) => setLocalReason(e.target.value)}
                  placeholder="Descreva o motivo da urgência para aprovação..."
                  rows={2}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-red-300 mt-1"
                />
                <button
                  onClick={() => { setExceptionReason(localReason); choose("EXCEPTION"); }}
                  disabled={!localReason.trim()}
                  className="mt-2 w-full py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
                >
                  Solicitar aprovação
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowCutoffModal(false)}
            className="mt-4 w-full text-center text-sm text-gray-400 hover:text-gray-600 transition"
          >
            Cancelar — voltar ao formulário
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <SameDayModal />
      <CutoffModal />

      {/* ── BANNER: corte same-day 12h00 (URGENT após meio-dia) ── */}
      {cutoffStatus?.isAfterSecond &&
        step2.watch("deliveryType") === "URGENT" &&
        !sameDayCutoffChoice &&
        (step as Step) !== "DONE" &&
        (step as Step) !== "DUPLICATE" && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-900">
              São {cutoffStatus.brasiliaTime.hour}h{String(cutoffStatus.brasiliaTime.minute).padStart(2, "0")} — corte de 12h00 para entrega no mesmo dia
            </p>
            <p className="text-xs text-orange-700 mt-0.5">
              A frota interna não garante entrega hoje. Ao criar a solicitação urgente,
              você será solicitado a escolher entre <strong>Lalamove</strong>,
              reagendar para amanhã ou solicitar exceção.
            </p>
          </div>
        </div>
      )}

      {/* ── BANNER: corte 17h30 ── */}
      {cutoffStatus?.isAfterFirst && (step as Step) !== "DONE" && (step as Step) !== "DUPLICATE" && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              São {cutoffStatus.brasiliaTime.hour}h{String(cutoffStatus.brasiliaTime.minute).padStart(2, "0")} — horário de corte das 17h30 atingido
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Novas solicitações entram no <strong>2º despacho do dia seguinte</strong>.
              Para entrega pela manhã, use entrega expressa via Lalamove.
            </p>
          </div>
        </div>
      )}

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
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    {...step2.register("chargedFreight", { valueAsNumber: true })}
                    placeholder="0,00"
                    disabled={freightLoading}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-50"
                  />
                  {freightLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                    </div>
                  )}
                </div>
                {freightLoading && (
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Calculando frete sugerido...
                  </p>
                )}
                {!freightLoading && suggestedFreight !== null && (
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-orange-400" />
                    Sugerido pelo motor: <strong className="text-gray-800">{formatCurrency(suggestedFreight)}</strong>
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
