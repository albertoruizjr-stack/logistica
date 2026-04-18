"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Calculator, AlertCircle, CheckCircle2, Clock, Zap, Truck, MapPin, Search } from "lucide-react";
import { cn, formatCurrency, formatDistance } from "@/lib/utils";

const schema = z.object({
  storeId: z.string().min(1, "Selecione a loja de origem"),
  destAddress: z.string().min(5, "Informe o endereço de entrega"),
  destLat: z.number({ invalid_type_error: "Latitude inválida" }),
  destLng: z.number({ invalid_type_error: "Longitude inválida" }),
  isUrgent: z.boolean().default(false),
});

type FormData = z.infer<typeof schema>;

interface Store {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
}

interface QuoteResult {
  distanceKm: number;
  durationMinutes?: number;   // duração real de rota (Google Maps) ou estimada (Haversine)
  isApproximate?: boolean;    // true = fallback Haversine — dado não é rota real
  warning?: string;           // mensagem de alerta quando isApproximate = true
  zone: { name: string } | null;
  suggestedPrice: number;
  isUrgent: boolean;
  urgentFactor: number | null;
  estimatedDays: number;
  deliveryType: string;
  underConsultation: boolean;
  quoteId?: string;
}

interface Props {
  stores: Store[];
  sessionStoreId: string;
}

export function FreightQuoteForm({ stores, sessionStoreId }: Props) {
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coordsMode, setCoordsMode] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodedAddress, setGeocodedAddress] = useState<string | null>(null);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      storeId: sessionStoreId,
      isUrgent: false,
      destLat: 0,
      destLng: 0,
    },
  });

  const selectedStoreId = watch("storeId");
  const selectedStore = stores.find((s) => s.id === selectedStoreId);
  const isUrgent = watch("isUrgent");
  const destAddress = watch("destAddress");

  async function handleGeocode() {
    if (!destAddress || destAddress.length < 5) return;
    setGeocoding(true);
    setGeocodeError(null);
    setGeocodedAddress(null);

    try {
      const res = await fetch("/api/geocode", {
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
    } catch {
      setGeocodeError("Erro de conexão ao buscar localização");
    } finally {
      setGeocoding(false);
    }
  }

  async function onSubmit(data: FormData) {
    setLoading(true);
    setError(null);
    setResult(null);

    if (!data.destLat || !data.destLng) {
      setError("Clique em 'Localizar' para buscar as coordenadas do endereço antes de calcular.");
      setLoading(false);
      return;
    }

    const payload = {
      ...data,
      originAddress: selectedStore?.address ?? "",
      originLat: selectedStore?.lat ?? -23.55,
      originLng: selectedStore?.lng ?? -46.63,
      save: false,
    };

    try {
      const res = await fetch("/api/frete/cotacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao calcular frete");
        return;
      }

      setResult(json.data);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Loja de origem */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Loja de origem
          </label>
          <select
            {...register("storeId")}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
          >
            <option value="">Selecione a loja...</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                Loja {store.code} — {store.name}
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

        {/* Endereço de entrega + Geocoding */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Endereço de entrega
          </label>
          <div className="flex gap-2">
            <input
              {...register("destAddress")}
              type="text"
              placeholder="Ex: Rua das Flores, 123 — Vila Mariana, SP"
              className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              onChange={() => {
                setGeocodedAddress(null);
                setGeocodeError(null);
              }}
            />
            <button
              type="button"
              onClick={handleGeocode}
              disabled={geocoding || !destAddress || destAddress.length < 5}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 rounded-lg text-sm font-medium transition whitespace-nowrap"
              title="Buscar localização pelo endereço"
            >
              {geocoding
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Search className="w-4 h-4" />}
              Localizar
            </button>
          </div>

          {/* Feedback do geocoding */}
          {geocodedAddress && (
            <p className="text-xs text-green-700 mt-1.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {geocodedAddress}
            </p>
          )}
          {geocodeError && (
            <p className="text-xs text-amber-600 mt-1.5">{geocodeError} — use coordenadas manuais abaixo.</p>
          )}
          {errors.destAddress && (
            <p className="text-xs text-red-600 mt-1">{errors.destAddress.message}</p>
          )}
        </div>

        {/* Coordenadas manuais (fallback quando geocoding não disponível) */}
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
                  type="number"
                  step="any"
                  placeholder="-23.5643"
                  onChange={(e) => setValue("destLat", parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Longitude</label>
                <input
                  type="number"
                  step="any"
                  placeholder="-46.6527"
                  onChange={(e) => setValue("destLng", parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Urgente */}
        <div className={cn(
          "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
          isUrgent
            ? "bg-red-50 border-red-200"
            : "bg-gray-50 border-gray-200 hover:bg-gray-100"
        )}>
          <input
            {...register("isUrgent")}
            type="checkbox"
            id="isUrgent"
            className="w-4 h-4 accent-red-500"
          />
          <label htmlFor="isUrgent" className="cursor-pointer flex-1">
            <span className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
              <Zap className={cn("w-3.5 h-3.5", isUrgent ? "text-red-500" : "text-gray-400")} />
              Entrega urgente (hoje)
            </span>
            <span className="text-xs text-gray-400">Aplica multiplicador sobre o valor padrão</span>
          </label>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Calculator className="w-4 h-4" />
          )}
          {loading ? "Calculando..." : "Calcular Frete"}
        </button>
      </form>

      {/* Resultado */}
      {error && (
        <div className="mt-5 bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-5">
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
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <h3 className="font-semibold text-green-900">
                  Cotação {result.isApproximate ? "estimada" : "calculada"}
                </h3>
              </div>

              {/* Alerta de fallback Haversine */}
              {result.isApproximate && result.warning && (
                <div className="mb-4 flex gap-2.5 bg-yellow-50 border border-yellow-300 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-800">{result.warning}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">
                    {result.isApproximate ? "Distância (linha reta)" : "Distância por rota"}
                  </p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatDistance(result.distanceKm)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">
                    {result.isApproximate ? "Tempo estimado" : "Tempo de rota"}
                  </p>
                  <p className="text-sm font-medium text-gray-900">
                    {result.durationMinutes != null
                      ? `~${Math.round(result.durationMinutes)} min`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Zona</p>
                  <p className="text-sm font-medium text-gray-900">
                    {result.zone?.name ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Frete sugerido</p>
                  <p className={cn(
                    "text-2xl font-bold",
                    result.isUrgent ? "text-red-600" : "text-orange-600"
                  )}>
                    {formatCurrency(result.suggestedPrice)}
                  </p>
                  {result.isUrgent && result.urgentFactor && (
                    <p className="text-xs text-red-500">
                      (multiplicador {result.urgentFactor}× aplicado)
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Prazo</p>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <p className="text-sm font-medium text-gray-900">
                      {result.estimatedDays === 0 ? "Entrega hoje" : "Entrega amanhã"}
                    </p>
                  </div>
                </div>
              </div>

              <div className={cn(
                "mt-4 text-xs px-3 py-2 rounded-lg font-medium inline-flex items-center gap-1.5",
                result.isUrgent
                  ? "bg-red-100 text-red-700"
                  : "bg-blue-100 text-blue-700"
              )}>
                {result.isUrgent ? <Zap className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
                {result.isUrgent ? "Urgente — via Lalamove" : "Padrão — rota interna"}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

