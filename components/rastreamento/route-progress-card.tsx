"use client";

import dynamic from "next/dynamic";
import { Clock, CheckCircle2, Truck, MapPin, Home } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { ActiveRoute, DriverCardData } from "./driver-cards";

// Carrega o mapa só no client (Leaflet usa window)
const RouteMiniMap = dynamic(() => import("./route-mini-map"), { ssr: false });

// Velocidade média urbana SP (km/h) usada quando não temos chamada Routes em tempo real.
// É deliberadamente conservadora pra não sub-estimar o tempo de chegada.
const AVG_SPEED_KMH = 25;

interface Props {
  driver: DriverCardData;
  route:  ActiveRoute;
}

export default function RouteProgressCard({ driver, route }: Props) {
  const delivered = route.stops.filter(isFinalDelivered).length;
  const pending   = route.stops.filter((s) => !isFinal(s.status));
  const next      = pending[0] ?? null;
  const finished  = delivered === route.stopCount;

  const stopsForMap = route.stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({
      lat:       s.lat as number,
      lng:       s.lng as number,
      label:     s.docLabel,
      delivered: isFinalDelivered(s),
    }));

  const driverPoint = driver.lastLocation
    ? { lat: driver.lastLocation.lat, lng: driver.lastLocation.lng }
    : null;

  // ETA de retorno à loja (só relevante quando rota finalizou as entregas)
  const homeEtaText =
    finished && driverPoint
      ? formatHomeEta(haversineKm(driverPoint, driver.store) / AVG_SPEED_KMH * 60)
      : null;

  return (
    <div className="border-t border-orange-100 bg-white">
      {/* Barra de progresso */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-gray-700">
            {finished ? "Rota concluída" : `${delivered} de ${route.stopCount} entregues`}
          </p>
          {route.estimatedReturnAt && !finished && (
            <p className="text-[10px] text-gray-400">
              previsão retorno {new Date(route.estimatedReturnAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={cn("h-full transition-all", finished ? "bg-green-500" : "bg-orange-500")}
            style={{ width: `${Math.min(100, (delivered / Math.max(1, route.stopCount)) * 100)}%` }}
          />
        </div>
      </div>

      {/* Próxima parada ou retorno */}
      <div className="px-4 py-3 border-b border-gray-100">
        {finished ? (
          <div className="flex items-start gap-2.5">
            <span className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0">
              <Home className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-900">Voltando à loja {driver.store.code}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {homeEtaText ?? "Sem localização — ETA indisponível"}
              </p>
            </div>
          </div>
        ) : next ? (
          <div className="flex items-start gap-2.5">
            <span className="w-7 h-7 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center flex-shrink-0">
              <Truck className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gray-900 truncate">
                Próxima: {next.docLabel}
                {next.customerName && <span className="text-gray-500 font-normal"> · {next.customerName}</span>}
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{next.address ?? "—"}</span>
              </p>
              {next.eta && (
                <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> ETA {new Date(next.eta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Mapa */}
      {stopsForMap.length > 0 && (
        <RouteMiniMap
          store={{ lat: driver.store.lat, lng: driver.store.lng, code: driver.store.code }}
          driver={driverPoint}
          stops={stopsForMap}
          height={180}
        />
      )}

      {/* Última ping do motorista */}
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
        <p className="text-[10px] text-gray-500 flex items-center gap-1">
          {driver.lastLocation ? (
            <>
              <span className={cn("w-1.5 h-1.5 rounded-full", freshnessDot(driver.lastLocation.timestamp))} />
              Última localização {formatRelativeTime(driver.lastLocation.timestamp)}
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
              Sem ping recente
            </>
          )}
        </p>
        {driver.lastLocation && (
          <p className="text-[10px] text-gray-400">via {driver.lastLocation.source}</p>
        )}
      </div>

      {/* Lista compacta das próximas paradas (até 3) */}
      {!finished && pending.length > 1 && (
        <details className="border-t border-gray-100">
          <summary className="px-4 py-2 text-[11px] text-gray-500 cursor-pointer hover:bg-gray-50">
            Ver outras {pending.length - 1} paradas
          </summary>
          <ol className="px-4 py-2 space-y-1.5">
            {pending.slice(1).map((s) => (
              <li key={s.deliveryRequestId} className="text-[11px] text-gray-700 flex items-start gap-1.5">
                <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-700 text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {s.stopPosition ?? "?"}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{s.docLabel}</span>
                  {s.customerName && <span className="text-gray-500"> · {s.customerName}</span>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function isFinal(status: string): boolean {
  return status === "DELIVERED" || status === "OCORRENCIA" || status === "CANCELLED";
}

function isFinalDelivered(s: { status: string }): boolean {
  return s.status === "DELIVERED";
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatHomeEta(minutes: number): string {
  if (minutes < 1) return "Quase chegando";
  if (minutes < 60) return `Chega em ~${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `Chega em ~${h}h${m.toString().padStart(2, "0")}`;
}

function freshnessDot(timestamp: string): string {
  const ageMin = (Date.now() - new Date(timestamp).getTime()) / 60_000;
  if (ageMin < 2)  return "bg-green-500 animate-pulse";
  if (ageMin < 5)  return "bg-green-400";
  if (ageMin < 15) return "bg-amber-400";
  return "bg-red-400";
}
