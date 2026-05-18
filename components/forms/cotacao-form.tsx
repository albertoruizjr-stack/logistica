"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2, Calculator, AlertCircle, CheckCircle2, Clock, Zap,
  Truck, MapPin, Search, Package, AlertTriangle, Calendar,
  ArrowRight, X, ChevronRight, RotateCcw,
} from "lucide-react";
import { cn, formatCurrency, formatDistance } from "@/lib/utils";
import { SolicitarEntregaDrawer } from "@/components/cotacao/solicitar-entrega-drawer";
import { getCutoffStatus, BRASILIA_TZ, type CutoffStatus } from "@/lib/cutoff";
import type { DeliveryOption } from "@/types";

// ─── Google Maps Autocomplete types ──────────────────────────────────────────
declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts: Record<string, unknown>
          ) => {
            addListener: (event: string, cb: () => void) => void;
            getPlace: () => {
              geometry?: { location?: { lat: () => number; lng: () => number } };
              formatted_address?: string;
              address_components?: Array<{ types: string[]; short_name: string; long_name: string }>;
            };
          };
        };
        LatLngBounds: new (sw: { lat: number; lng: number }, ne: { lat: number; lng: number }) => unknown;
      };
    };
    initGoogleMapsCallback?: () => void;
  }
}

// ─── Delivery option definitions ─────────────────────────────────────────────
interface OptionDef {
  id:        DeliveryOption;
  label:     string;
  sub:       string;
  icon:      React.ReactNode;
  urgent:    boolean;
  scheduled: boolean;
}

const DELIVERY_OPTIONS: OptionDef[] = [
  {
    id: "SAME_DAY",
    label: "Entrega hoje — Same Day",
    sub: "Frota interna · sujeito ao corte das 12h00",
    icon: <Zap className="w-4 h-4" />,
    urgent: true,
    scheduled: false,
  },
  {
    id: "TOMORROW_FIRST",
    label: "Amanhã — 1º Despacho",
    sub: "Manhã D+1 · criado até 17h30",
    icon: <Truck className="w-4 h-4" />,
    urgent: false,
    scheduled: false,
  },
  {
    id: "TOMORROW_SECOND",
    label: "Amanhã — 2º Despacho",
    sub: "Tarde D+1 · criado após 17h30",
    icon: <Truck className="w-4 h-4" />,
    urgent: false,
    scheduled: false,
  },
  {
    id: "EXPRESS",
    label: "Entrega expressa — Lalamove/99",
    sub: "Entrega hoje · ignora horários de corte",
    icon: <Zap className="w-4 h-4 text-orange-500" />,
    urgent: true,
    scheduled: false,
  },
  {
    id: "SCHEDULED",
    label: "Entrega agendada",
    sub: "Escolha a data",
    icon: <Calendar className="w-4 h-4" />,
    urgent: false,
    scheduled: true,
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type CutoffModalType = "SAME_DAY_CUTOFF" | "FIRST_DISPATCH_CUTOFF" | null;

interface QuoteResult {
  distanceKm:          number;
  durationMinutes?:    number;
  isApproximate?:      boolean;
  warning?:            string;
  zone:                { name: string } | null;
  suggestedPrice:      number;
  isUrgent:            boolean;
  urgentFactor:        number | null;
  estimatedDays:       number;
  deliveryType:        string;
  deliveryOption:      DeliveryOption;
  dispatchWindowLabel: string;
  underConsultation:   boolean;
  quoteId?:            string;
  expiresAt?:          string;
}

interface Store {
  id:      string;
  code:    string;
  name:    string;
  lat:     number;
  lng:     number;
  address: string;
}

interface Props {
  stores:         Store[];
  sessionStoreId: string;
}

// ─── Zod schema ───────────────────────────────────────────────────────────────
const schema = z.object({
  storeId:       z.string().min(1, "Selecione a loja de origem"),
  destAddress:   z.string().min(5, "Informe o endereço de entrega"),
  destLat:       z.number(),
  destLng:       z.number(),
  scheduledDate: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

// ─── CutoffModal ──────────────────────────────────────────────────────────────
function CutoffModal({
  type,
  cutoffTime,
  onAlterar,
  onAmanha,
  onExcecao,
  onFechar,
  brtTime,
}: {
  type:      CutoffModalType;
  cutoffTime: string;
  onAlterar: () => void;
  onAmanha:  () => void;
  onExcecao: () => void;
  onFechar:  () => void;
  brtTime:   { hour: number; minute: number };
}) {
  if (!type) return null;
  const isSameDay = type === "SAME_DAY_CUTOFF";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base">
                {isSameDay
                  ? `Corte das ${cutoffTime} encerrado`
                  : `Corte das ${cutoffTime} encerrado`}
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Agora são {brtTime.hour}h{String(brtTime.minute).padStart(2, "0")} (Brasília)
              </p>
            </div>
            <button onClick={onFechar} className="ml-auto text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-sm text-gray-700 mb-5">
            {isSameDay
              ? "O horário de corte para entrega no mesmo dia encerrou às 12h00. Para entregar hoje, use entrega expressa via Lalamove/99 ou solicite exceção operacional."
              : "O horário de corte para o 1º despacho do dia seguinte encerrou às 17h30. Esta entrega será programada para o 2º despacho, salvo exceção aprovada."}
          </p>

          <div className="space-y-2">
            <button
              onClick={onAlterar}
              className="w-full flex items-center justify-between px-4 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition"
            >
              <span className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                {isSameDay ? "Alterar para expressa (Lalamove/99)" : "Alterar para expressa"}
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={onAmanha}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-sm font-semibold transition"
            >
              <span className="flex items-center gap-2">
                <Truck className="w-4 h-4" />
                {isSameDay ? "Programar para amanhã — 1º Despacho" : "Manter no 2º Despacho"}
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={onExcecao}
              className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-sm font-medium transition"
            >
              <span className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Solicitar exceção operacional
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function FreightQuoteForm({ stores, sessionStoreId }: Props) {
  const [result, setResult]                       = useState<QuoteResult | null>(null);
  const [loading, setLoading]                     = useState(false);
  const [error, setError]                         = useState<string | null>(null);
  const [coordsMode, setCoordsMode]               = useState(false);
  const [geocoding, setGeocoding]                 = useState(false);
  const [geocodedAddress, setGeocodedAddress]     = useState<string | null>(null);
  const [autocompletedAddress, setAutocompletedAddress] = useState<string | null>(null);
  const [geocodeError, setGeocodeError]           = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen]               = useState(false);
  const [cutoffStatus, setCutoffStatus]           = useState<CutoffStatus | null>(null);
  const [cutoffModal, setCutoffModal]             = useState<CutoffModalType>(null);
  const [cutoffException, setCutoffException]     = useState(false);
  const [excecaoReason, setExcecaoReason]         = useState("");
  const [showExcecaoInput, setShowExcecaoInput]   = useState(false);
  const [deliveryOption, setDeliveryOption]       = useState<DeliveryOption>("TOMORROW_FIRST");
  // Veículo para EXPRESS: moto cota direto Lalamove (mais barato);
  // carro/van cai na tabela express por zona.
  const [expressVehicle, setExpressVehicle]       = useState<"MOTORCYCLE" | "CAR">("CAR");
  const [pendingCalculate, setPendingCalculate]   = useState(false);

  const addressInputRef  = useRef<HTMLInputElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const autocompleteRef  = useRef<any>(null);

  // ── cutoff status ────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setCutoffStatus(getCutoffStatus());
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── react-hook-form ──────────────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      storeId:  sessionStoreId,
      destLat:  0,
      destLng:  0,
    },
  });

  const selectedStoreId = watch("storeId");
  const selectedStore   = stores.find((s) => s.id === selectedStoreId);
  const destAddress     = watch("destAddress");
  const scheduledDate   = watch("scheduledDate");

  // ── Google Places Autocomplete ───────────────────────────────────────────
  const initAutocomplete = useCallback(() => {
    if (!window.google?.maps?.places || !addressInputRef.current || autocompleteRef.current) return;
    const bounds = new window.google.maps.LatLngBounds(
      { lat: -25.5, lng: -51.0 },
      { lat: -19.8, lng: -44.0 }
    );
    const ac = new window.google.maps.places.Autocomplete(addressInputRef.current, {
      componentRestrictions: { country: "br" },
      bounds,
      strictBounds: false,
      types: ["address"],
      fields: ["geometry", "formatted_address", "address_components"],
    });
    autocompleteRef.current = ac;
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const loc   = place?.geometry?.location;
      if (!loc) return;
      setValue("destLat", loc.lat());
      setValue("destLng", loc.lng());
      const formatted = place.formatted_address ?? "";
      setValue("destAddress", formatted);
      setAutocompletedAddress(formatted);
      setGeocodedAddress(null);
      setGeocodeError(null);
      setResult(null);

      // extrair cidade/UF dos address_components
      const comps = place.address_components ?? [];
      // stored in refs to use on submit
      const city  = comps.find((c) => c.types.includes("locality"))?.long_name;
      const state = comps.find((c) => c.types.includes("administrative_area_level_1"))?.short_name;
      // guardar em data attributes no input para usar no submit
      if (addressInputRef.current) {
        addressInputRef.current.dataset.city  = city  ?? "";
        addressInputRef.current.dataset.state = state ?? "";
        addressInputRef.current.dataset.quotedAddress = formatted;
      }
    });
  }, [setValue]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;
    if (window.google?.maps?.places) { initAutocomplete(); return; }
    if (document.getElementById("gmaps-script")) {
      window.initGoogleMapsCallback = initAutocomplete;
      return;
    }
    window.initGoogleMapsCallback = initAutocomplete;
    const script = document.createElement("script");
    script.id  = "gmaps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initGoogleMapsCallback`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, [initAutocomplete]);

  // ── geocode manual ───────────────────────────────────────────────────────
  async function handleGeocode() {
    if (!destAddress || destAddress.length < 5) return;
    setGeocoding(true);
    setGeocodeError(null);
    setGeocodedAddress(null);
    try {
      const res  = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: destAddress }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setGeocodeError(json.error ?? "Endereço não encontrado");
        return;
      }
      setValue("destLat", json.data.lat);
      setValue("destLng", json.data.lng);
      setGeocodedAddress(json.data.formattedAddress);
      setAutocompletedAddress(null);
      setResult(null);
      if (addressInputRef.current) {
        addressInputRef.current.dataset.city  = json.data.city  ?? "";
        addressInputRef.current.dataset.state = json.data.state ?? "";
        addressInputRef.current.dataset.quotedAddress = json.data.formattedAddress;
      }
    } catch {
      setGeocodeError("Erro de conexão ao buscar localização");
    } finally {
      setGeocoding(false);
    }
  }

  // ── cutoff check + calculate ─────────────────────────────────────────────
  function checkCutoffAndCalculate() {
    const cs = getCutoffStatus();
    if (deliveryOption === "SAME_DAY" && cs.isAfterSecond && !cutoffException) {
      setCutoffModal("SAME_DAY_CUTOFF");
      return;
    }
    if (deliveryOption === "TOMORROW_FIRST" && cs.isAfterFirst && !cutoffException) {
      setCutoffModal("FIRST_DISPATCH_CUTOFF");
      return;
    }
    setPendingCalculate(true);
  }

  useEffect(() => {
    if (pendingCalculate) {
      setPendingCalculate(false);
      handleSubmit(doCalculate)();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCalculate]);

  async function doCalculate(data: FormData) {
    if (!data.destLat || !data.destLng) {
      setError("Clique em 'Localizar' para buscar as coordenadas do endereço antes de calcular.");
      return;
    }
    if (deliveryOption === "SCHEDULED" && !data.scheduledDate) {
      setError("Informe a data de entrega para cotação agendada.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const city          = addressInputRef.current?.dataset.city;
    const state         = addressInputRef.current?.dataset.state;
    const quotedAddress = addressInputRef.current?.dataset.quotedAddress;

    try {
      const res  = await fetch("/api/frete/cotacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId:        data.storeId,
          originAddress:  selectedStore?.address ?? "",
          originLat:      selectedStore?.lat ?? -23.55,
          originLng:      selectedStore?.lng ?? -46.63,
          destAddress:    data.destAddress,
          destLat:        data.destLat,
          destLng:        data.destLng,
          deliveryOption,
          // Só envia quando o usuário escolheu EXPRESS — outros modais ignoram.
          expressVehicle: deliveryOption === "EXPRESS" ? expressVehicle : undefined,
          scheduledFor:   data.scheduledDate,
          cutoffException,
          cutoffExceptionReason: cutoffException ? excecaoReason : undefined,
          city,
          state,
          quotedAddress,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao calcular frete");
        return;
      }
      setResult(json.data);
      setCutoffException(false);
      setExcecaoReason("");
      setShowExcecaoInput(false);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  // ── cutoff modal actions ─────────────────────────────────────────────────
  function handleModalAlterar() {
    setCutoffModal(null);
    setDeliveryOption("EXPRESS");
    setTimeout(() => setPendingCalculate(true), 0);
  }

  function handleModalAmanha() {
    setCutoffModal(null);
    if (cutoffModal === "SAME_DAY_CUTOFF") {
      setDeliveryOption("TOMORROW_FIRST");
    } else {
      setDeliveryOption("TOMORROW_SECOND");
    }
    setTimeout(() => setPendingCalculate(true), 0);
  }

  function handleModalExcecao() {
    setCutoffModal(null);
    setCutoffException(true);
    setShowExcecaoInput(true);
  }

  // ── option change ────────────────────────────────────────────────────────
  function handleOptionChange(opt: DeliveryOption) {
    setDeliveryOption(opt);
    setResult(null);
    setError(null);
    setCutoffException(false);
    setShowExcecaoInput(false);
  }

  // ── nova cotação ─────────────────────────────────────────────────────────
  function handleNovaCotacao() {
    setResult(null);
    setError(null);
    setCutoffException(false);
  }

  const brt = cutoffStatus?.brasiliaTime ?? { hour: 0, minute: 0 };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Cutoff modal */}
      {cutoffModal && (
        <CutoffModal
          type={cutoffModal}
          cutoffTime={cutoffModal === "SAME_DAY_CUTOFF" ? "12h00" : "17h30"}
          brtTime={brt}
          onAlterar={handleModalAlterar}
          onAmanha={handleModalAmanha}
          onExcecao={handleModalExcecao}
          onFechar={() => setCutoffModal(null)}
        />
      )}

      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              checkCutoffAndCalculate();
            }}
            className="space-y-5"
          >
            {/* ── Loja origem ── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Loja de origem
              </label>
              <select
                {...register("storeId")}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              >
                <option value="">Selecione a loja...</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    Loja {s.code} — {s.name}
                  </option>
                ))}
              </select>
              {selectedStore && (
                <p className="text-xs text-gray-400 mt-1">{selectedStore.address}</p>
              )}
              {errors.storeId && (
                <p className="text-xs text-red-600 mt-1">{errors.storeId.message}</p>
              )}
            </div>

            {/* ── Endereço destino ── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Endereço de entrega
              </label>
              <div className="flex gap-2">
                <input
                  {...(() => {
                    const { onChange: rhfOnChange, ref: rhfRef, ...rest } = register("destAddress");
                    return {
                      ...rest,
                      ref: (el: HTMLInputElement | null) => {
                        rhfRef(el);
                        addressInputRef.current = el;
                      },
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                        rhfOnChange(e);
                        setGeocodedAddress(null);
                        setGeocodeError(null);
                        setAutocompletedAddress(null);
                        setResult(null);
                      },
                    };
                  })()}
                  type="text"
                  placeholder="Ex: Rua das Flores, 123 — Vila Mariana, SP"
                  className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={handleGeocode}
                  disabled={geocoding || !destAddress || destAddress.length < 5}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 rounded-lg text-sm font-medium transition whitespace-nowrap"
                  title="Buscar localização pelo endereço"
                >
                  {geocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Localizar
                </button>
              </div>
              {autocompletedAddress && (
                <p className="text-xs text-green-700 mt-1.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {autocompletedAddress}
                </p>
              )}
              {!autocompletedAddress && geocodedAddress && (
                <p className="text-xs text-green-700 mt-1.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {geocodedAddress}
                </p>
              )}
              {geocodeError && (
                <p className="text-xs text-amber-600 mt-1.5">{geocodeError} — use coordenadas manuais abaixo.</p>
              )}
              {errors.destAddress && (
                <p className="text-xs text-red-600 mt-1">{errors.destAddress.message}</p>
              )}
            </div>

            {/* ── Coordenadas manuais ── */}
            <div>
              <button
                type="button"
                onClick={() => setCoordsMode(!coordsMode)}
                className="text-xs text-orange-600 hover:underline"
              >
                {coordsMode ? "Ocultar" : "Informar"} coordenadas manualmente (avançado)
              </button>
              {coordsMode && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Latitude</label>
                    <input
                      type="number" step="any" placeholder="-23.5643"
                      onChange={(e) => setValue("destLat", parseFloat(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Longitude</label>
                    <input
                      type="number" step="any" placeholder="-46.6527"
                      onChange={(e) => setValue("destLng", parseFloat(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Opção de entrega ── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Modalidade de entrega
              </label>
              <div className="space-y-2">
                {DELIVERY_OPTIONS.map((opt) => {
                  const selected  = deliveryOption === opt.id;
                  const isAfter12 = cutoffStatus?.isAfterSecond;
                  const isAfter17 = cutoffStatus?.isAfterFirst;

                  let cutoffHint: string | null = null;
                  if (opt.id === "SAME_DAY" && isAfter12) {
                    cutoffHint = "⚠ Corte das 12h00 encerrado — aviso obrigatório";
                  }
                  if (opt.id === "TOMORROW_FIRST" && isAfter17) {
                    cutoffHint = "⚠ Corte das 17h30 encerrado";
                  }

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleOptionChange(opt.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                        selected
                          ? opt.urgent
                            ? "border-orange-400 bg-orange-50 ring-2 ring-orange-300"
                            : "border-blue-400 bg-blue-50 ring-2 ring-blue-300"
                          : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                      )}
                    >
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                        selected
                          ? opt.urgent ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600"
                          : "bg-white text-gray-400 border border-gray-200"
                      )}>
                        {opt.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm font-semibold",
                          selected ? opt.urgent ? "text-orange-900" : "text-blue-900" : "text-gray-800"
                        )}>
                          {opt.label}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{opt.sub}</p>
                        {cutoffHint && (
                          <p className="text-xs text-amber-600 font-medium mt-0.5">{cutoffHint}</p>
                        )}
                      </div>
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 flex-shrink-0",
                        selected
                          ? opt.urgent ? "border-orange-500 bg-orange-500" : "border-blue-500 bg-blue-500"
                          : "border-gray-300"
                      )} />
                    </button>
                  );
                })}
              </div>

              {/* Data p/ entrega agendada */}
              {deliveryOption === "SCHEDULED" && (
                <div className="mt-3">
                  <label className="text-xs text-gray-600 mb-1 block font-medium">
                    Data de entrega
                  </label>
                  <input
                    type="date"
                    {...register("scheduledDate")}
                    min={new Date(Date.now() + 86_400_000).toISOString().split("T")[0]}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              )}

              {/* Veículo p/ entrega expressa: moto cota direto Lalamove (mais barato) */}
              {deliveryOption === "EXPRESS" && (
                <div className="mt-3">
                  <label className="text-xs text-gray-600 mb-2 block font-medium">
                    Tipo de veículo
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setExpressVehicle("MOTORCYCLE")}
                      className={cn(
                        "px-3 py-2.5 rounded-lg border text-sm font-medium transition flex items-center justify-center gap-2",
                        expressVehicle === "MOTORCYCLE"
                          ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      )}
                    >
                      🏍️ Moto
                      <span className="text-[10px] text-gray-500 font-normal">cotação Lalamove</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpressVehicle("CAR")}
                      className={cn(
                        "px-3 py-2.5 rounded-lg border text-sm font-medium transition flex items-center justify-center gap-2",
                        expressVehicle === "CAR"
                          ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      )}
                    >
                      🚐 Carro/Van
                      <span className="text-[10px] text-gray-500 font-normal">tabela express</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    Moto vale pra pacotes leves (até 20 kg) sem lata grande ou papelão.
                  </p>
                </div>
              )}
            </div>

            {/* ── Exceção operacional ── */}
            {showExcecaoInput && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> Exceção operacional
                </p>
                <p className="text-xs text-amber-700">
                  Informe o motivo da exceção. Será registrado para auditoria.
                </p>
                <textarea
                  value={excecaoReason}
                  onChange={(e) => setExcecaoReason(e.target.value)}
                  placeholder="Ex: Cliente de alta prioridade, aprovado pelo gerente João"
                  rows={2}
                  className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>
            )}

            {/* ── Submit ── */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Calculando...</>
                : <><Calculator className="w-4 h-4" /> Calcular e Salvar Cotação</>}
            </button>
          </form>

          {/* ── Erro ── */}
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* ── Resultado ── */}
          {result && (
            <div className="mt-5 space-y-4">
              {result.underConsultation ? (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 text-orange-500" />
                    <h3 className="font-semibold text-orange-900">Frete sob consulta</h3>
                  </div>
                  <p className="text-sm text-orange-700">
                    A distância de <strong>{formatDistance(result.distanceKm)}</strong> excede o
                    limite da tabela de zonas. Entre em contato com a operação para cotar.
                  </p>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                      <h3 className="font-semibold text-green-900">
                        Cotação {result.isApproximate ? "estimada" : "calculada"}
                      </h3>
                    </div>
                    {result.quoteId && (
                      <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">
                        Salva ✓
                      </span>
                    )}
                  </div>

                  {result.warning && (
                    <div className="flex gap-2.5 bg-yellow-50 border border-yellow-300 rounded-lg p-3">
                      <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-800">{result.warning}</p>
                    </div>
                  )}

                  {/* Detalhes da rota */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">
                        {result.isApproximate ? "Distância (linha reta)" : "Distância por rota"}
                      </p>
                      <p className="text-lg font-bold text-gray-900">
                        {formatDistance(result.distanceKm)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Tempo estimado</p>
                      <p className="text-sm font-medium text-gray-900">
                        {result.durationMinutes != null
                          ? `~${Math.round(result.durationMinutes)} min`
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Zona</p>
                      <p className="text-sm font-medium text-gray-900">
                        {result.zone?.name ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Janela de despacho</p>
                      <p className="text-sm font-medium text-gray-900">
                        {result.dispatchWindowLabel}
                      </p>
                    </div>
                  </div>

                  {/* Preço */}
                  <div className="flex items-end justify-between border-t border-green-200 pt-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Frete sugerido</p>
                      <p className={cn(
                        "text-3xl font-bold",
                        result.isUrgent ? "text-red-600" : "text-orange-600"
                      )}>
                        {formatCurrency(result.suggestedPrice)}
                      </p>
                      {result.isUrgent && result.urgentFactor && (
                        <p className="text-xs text-red-500 mt-0.5">
                          multiplicador {result.urgentFactor}× aplicado
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500 mb-0.5">Prazo</p>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <p className="text-sm font-semibold text-gray-900">
                          {result.estimatedDays === 0 ? "Hoje" : "Amanhã D+1"}
                        </p>
                      </div>
                      {result.expiresAt && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Válida até {new Date(result.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Modalidade badge */}
                  <div className={cn(
                    "text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5",
                    result.isUrgent ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
                  )}>
                    {result.isUrgent ? <Zap className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
                    {result.dispatchWindowLabel}
                  </div>

                  {/* CTAs */}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setDrawerOpen(true)}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition"
                      style={{ backgroundColor: "var(--color-primary)", boxShadow: "0 2px 8px rgba(249,115,22,0.3)" }}
                    >
                      <Package className="w-4 h-4" />
                      Converter em Solicitação
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleNovaCotacao}
                      title="Nova cotação"
                      className="px-3 py-3 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600 transition"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Drawer de solicitação */}
      {result?.quoteId && (
        <SolicitarEntregaDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          freightQuoteId={result.quoteId}
          storeId={watch("storeId")}
          stores={stores}
          suggestedPrice={result.suggestedPrice}
          isUrgent={result.isUrgent}
          destAddress={watch("destAddress")}
        />
      )}
    </>
  );
}
