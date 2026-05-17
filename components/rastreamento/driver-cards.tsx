"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  Bike, Car, Truck, MapPin, Clock, Package,
  ArrowLeftRight, ExternalLink, RefreshCw, Wifi, WifiOff,
} from "lucide-react";
import RouteProgressCard from "./route-progress-card";

// ──────────────────────────────────────────────
// TIPOS (refletem os dados serializados do Server Component)
// ──────────────────────────────────────────────

export interface RouteStop {
  deliveryRequestId: string;
  stopPosition:      number | null;
  eta:               string | null;
  status:            string;
  docLabel:          string;
  customerName:      string | null;
  address:           string | null;
  lat:               number | null;
  lng:               number | null;
}

export interface ActiveRoute {
  id:                string;
  name:              string | null;
  stopCount:         number;
  estimatedReturnAt: string | null;
  stops:             RouteStop[];
}

export interface DriverCardData {
  id: string;
  name: string;
  phone: string;
  vehicleType: string | null;
  licensePlate: string | null;
  available: boolean;
  store: { code: string; name: string; lat: number; lng: number };
  lastLocation: {
    lat: number;
    lng: number;
    speed: number | null;
    timestamp: string;
    source: string;
  } | null;
  activeRoute: ActiveRoute | null;
  activeDispatches: {
    id: string;
    modal: string;
    status: string;
    transfer: { fromStore: { code: string }; toStore: { code: string } } | null;
    deliveryRequest: { invoiceNumber: string; customerName: string } | null;
  }[];
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

function VehicleIcon({ type }: { type: string | null }) {
  if (type === "moto") return <Bike className="w-4 h-4" />;
  if (type === "van" || type === "caminhão") return <Truck className="w-4 h-4" />;
  return <Car className="w-4 h-4" />;
}

function locationAge(timestamp: string): "fresh" | "stale" | "old" {
  const ageMin = (Date.now() - new Date(timestamp).getTime()) / 60_000;
  if (ageMin < 5)  return "fresh";
  if (ageMin < 30) return "stale";
  return "old";
}

const AGE_COLORS = {
  fresh: "text-green-600",
  stale: "text-amber-500",
  old:   "text-gray-400",
};

const STATUS_DOT: Record<string, string> = {
  PENDING:    "bg-yellow-400",
  ASSIGNED:   "bg-blue-400",
  IN_TRANSIT: "bg-orange-400",
  COMPLETED:  "bg-green-400",
  FAILED:     "bg-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:    "Aguardando",
  ASSIGNED:   "Atribuído",
  IN_TRANSIT: "Em trânsito",
  COMPLETED:  "Concluído",
  FAILED:     "Falhou",
};

// ──────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ──────────────────────────────────────────────

export function DriverCards({ initialDrivers }: { initialDrivers: DriverCardData[] }) {
  const router = useRouter();
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  // auto-refresh a cada 30 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
      setLastRefresh(new Date());
    }, 30_000);
    return () => clearInterval(interval);
  }, [router]);

  async function handleManualRefresh() {
    setRefreshing(true);
    router.refresh();
    setLastRefresh(new Date());
    setTimeout(() => setRefreshing(false), 800);
  }

  const active = initialDrivers.filter((d) => !d.available || d.activeDispatches.length > 0 || d.activeRoute);
  const available = initialDrivers.filter((d) => d.available && d.activeDispatches.length === 0 && !d.activeRoute);

  return (
    <div>
      {/* Barra de status do refresh */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {active.length} em rota
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-300" />
            {available.length} disponível{available.length !== 1 ? "is" : ""}
          </span>
        </div>
        <button
          onClick={handleManualRefresh}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          Atualizado {formatRelativeTime(lastRefresh)}
        </button>
      </div>

      {/* Em rota */}
      {active.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">Em rota agora</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {active.map((driver) => (
              <DriverCard key={driver.id} driver={driver} highlight />
            ))}
          </div>
        </div>
      )}

      {/* Disponíveis */}
      {available.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">Disponíveis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {available.map((driver) => (
              <DriverCard key={driver.id} driver={driver} highlight={false} />
            ))}
          </div>
        </div>
      )}

      {initialDrivers.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <Truck className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Nenhum motorista cadastrado</p>
          <p className="text-sm text-gray-400 mt-1">Cadastre motoristas no painel de administração</p>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// CARD INDIVIDUAL DO MOTORISTA
// ──────────────────────────────────────────────

function DriverCard({ driver, highlight }: { driver: DriverCardData; highlight: boolean }) {
  const age = driver.lastLocation ? locationAge(driver.lastLocation.timestamp) : "old";
  const hasLocation = driver.lastLocation !== null;
  const mapsUrl = hasLocation
    ? `https://maps.google.com/?q=${driver.lastLocation!.lat},${driver.lastLocation!.lng}`
    : null;

  return (
    <div className={cn(
      "bg-white rounded-xl border transition-shadow hover:shadow-md overflow-hidden",
      highlight ? "border-orange-200" : "border-gray-200"
    )}>
      {/* Header do card */}
      <div className={cn(
        "px-4 py-3 flex items-center gap-3 border-b",
        highlight ? "bg-orange-50 border-orange-100" : "bg-gray-50 border-gray-100"
      )}>
        <div className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0",
          highlight ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-500"
        )}>
          <VehicleIcon type={driver.vehicleType} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{driver.name}</p>
          <p className="text-xs text-gray-400">
            {driver.store.code} · {driver.phone}
          </p>
        </div>
        {/* indicador de sinal GPS */}
        <div title={hasLocation ? "Localização disponível" : "Sem localização"}>
          {hasLocation && age !== "old"
            ? <Wifi className={cn("w-4 h-4", AGE_COLORS[age])} />
            : <WifiOff className="w-4 h-4 text-gray-300" />
          }
        </div>
      </div>

      {/* Localização */}
      <div className="px-4 py-3 border-b border-gray-100">
        {hasLocation ? (
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
                <MapPin className="w-3.5 h-3.5" />
                <span className={cn("font-medium", AGE_COLORS[age])}>
                  {age === "fresh" ? "Localização recente" : age === "stale" ? "Localização desatualizada" : "Localização antiga"}
                </span>
              </div>
              <p className="text-xs text-gray-400 font-mono">
                {driver.lastLocation!.lat.toFixed(5)}, {driver.lastLocation!.lng.toFixed(5)}
              </p>
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                <Clock className="w-3 h-3" />
                {formatRelativeTime(driver.lastLocation!.timestamp)}
                {driver.lastLocation!.speed != null && (
                  <span>· {Math.round(driver.lastLocation!.speed)} km/h</span>
                )}
              </div>
            </div>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap flex-shrink-0"
              >
                <ExternalLink className="w-3 h-3" />
                Ver no Maps
              </a>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <WifiOff className="w-3.5 h-3.5" />
            Sem localização registrada
          </p>
        )}
      </div>

      {/* Card de rota em andamento (substitui despachos quando há rota) */}
      {driver.activeRoute && (
        <RouteProgressCard driver={driver} route={driver.activeRoute} />
      )}

      {/* Despachos ativos (mostra quando NÃO é rota interna ou rota sem detalhes) */}
      {!driver.activeRoute && driver.activeDispatches.length > 0 ? (
        <div className="px-4 py-3 space-y-2">
          {driver.activeDispatches.map((dispatch) => (
            <div key={dispatch.id} className="flex items-center gap-2">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                STATUS_DOT[dispatch.status] ?? "bg-gray-300"
              )} />
              <div className="flex-1 min-w-0 text-xs">
                {dispatch.transfer ? (
                  <span className="flex items-center gap-1 text-gray-700 font-medium">
                    <ArrowLeftRight className="w-3 h-3 text-gray-400" />
                    {dispatch.transfer.fromStore.code} → {dispatch.transfer.toStore.code}
                    <span className="text-gray-400 font-normal ml-1">
                      {STATUS_LABEL[dispatch.status]}
                    </span>
                  </span>
                ) : dispatch.deliveryRequest ? (
                  <span className="flex items-center gap-1 text-gray-700 font-medium">
                    <Package className="w-3 h-3 text-gray-400" />
                    NF {dispatch.deliveryRequest.invoiceNumber}
                    <span className="text-gray-400 font-normal ml-1 truncate">
                      · {dispatch.deliveryRequest.customerName}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : !driver.activeRoute && driver.activeDispatches.length === 0 ? (
        <div className="px-4 py-3">
          <p className="text-xs text-green-600 font-medium">Disponível para nova rota</p>
        </div>
      ) : null}

      {/* Veículo */}
      {driver.licensePlate && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            {driver.vehicleType ?? "Veículo"} · <span className="font-mono font-medium text-gray-600">{driver.licensePlate}</span>
          </p>
        </div>
      )}
    </div>
  );
}
