"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapViewData, MapFilters, MapStore, MapDriver, MapDelivery, MarkerColor } from "@/types";

// CartoDB dark tiles — sem API key
const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

const COLOR_MAP: Record<MarkerColor, string> = {
  red:    "#ef4444",
  orange: "#f97316",
  blue:   "#3b82f6",
  green:  "#22c55e",
  purple: "#a855f7",
  gray:   "#6b7280",
};

const SP_CENTER: [number, number] = [-23.55, -46.63];

// ─── ícone SVG para lojas (estrela/pin) ──────────────────────────────────────

function storeIcon(name: string) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        background:#f59e0b;color:#000;border-radius:4px;
        padding:2px 6px;font-size:11px;font-weight:700;
        border:2px solid #d97706;white-space:nowrap;
        box-shadow:0 2px 6px rgba(0,0,0,0.5);
      ">${name}</div>`,
    iconAnchor: [0, 0],
  });
}

// ─── ajusta bounds quando dados mudam ────────────────────────────────────────

function BoundsUpdater({ data }: { data: MapViewData }) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [];
    data.stores.forEach((s)    => points.push([s.lat, s.lng]));
    data.drivers.forEach((d)   => { if (d.lat && d.lng) points.push([d.lat, d.lng]); });
    data.deliveries.forEach((d) => { if (d.lat && d.lng) points.push([d.lat, d.lng]); });
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ─── filtros aplicados no cliente ────────────────────────────────────────────

function applyFilters(data: MapViewData, filters: MapFilters): MapViewData {
  const deliveries = data.deliveries.filter((d) => {
    if (filters.storeId && d.storeId !== filters.storeId) return false;
    if (filters.modal && d.modalRecommendation !== filters.modal) return false;
    if (filters.risk && d.delayRisk !== filters.risk) return false;
    if (filters.driverId && d.suggestedDriverId !== filters.driverId) return false;
    if (filters.showUrgentOnly && !d.isUrgent) return false;
    return true;
  });
  const drivers = data.drivers.filter((d) => {
    if (filters.storeId && d.storeId !== filters.storeId) return false;
    if (filters.driverId && d.id !== filters.driverId) return false;
    return true;
  });
  return { ...data, deliveries, drivers };
}

// ─── Store markers ────────────────────────────────────────────────────────────

function StoreMarkers({ stores }: { stores: MapStore[] }) {
  return (
    <>
      {stores.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.lat, s.lng]}
          radius={10}
          pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.9, weight: 2 }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]}>
            <span style={{ fontWeight: 700, fontSize: 11 }}>
              Loja {s.code} — {s.name}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

// ─── Driver markers ───────────────────────────────────────────────────────────

function DriverMarkers({ drivers }: { drivers: MapDriver[] }) {
  return (
    <>
      {drivers
        .filter((d) => d.lat !== null && d.lng !== null)
        .map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat!, d.lng!]}
            radius={8}
            pathOptions={{
              color: COLOR_MAP[d.color],
              fillColor: COLOR_MAP[d.color],
              fillOpacity: 0.85,
              weight: 2,
            }}
          >
            <Tooltip>
              <div style={{ fontSize: 12 }}>
                <strong>{d.name}</strong>
                <br />{d.vehicleType ?? "—"} · {d.storeName}
                <br />
                {d.minutesUntilFree === 0
                  ? "✓ Disponível agora"
                  : `Livre em ~${d.minutesUntilFree} min`}
                <br />Score: {d.score}
                {!d.isLocationFresh && <><br /><em style={{ color: "#f97316" }}>Localização desatualizada</em></>}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
    </>
  );
}

// ─── Delivery markers ─────────────────────────────────────────────────────────

function DeliveryMarkers({ deliveries }: { deliveries: MapDelivery[] }) {
  return (
    <>
      {deliveries
        .filter((d) => d.lat !== null && d.lng !== null)
        .map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat!, d.lng!]}
            radius={6}
            pathOptions={{
              color: COLOR_MAP[d.color],
              fillColor: COLOR_MAP[d.color],
              fillOpacity: 0.8,
              weight: 1.5,
            }}
          >
            <Tooltip>
              <div style={{ fontSize: 12 }}>
                {d.isUrgent && <span style={{ color: "#ef4444", fontWeight: 700 }}>⚡ URGENTE · </span>}
                <strong>{d.customerName}</strong>
                <br />{d.deliveryAddress}
                <br />
                <span style={{ textTransform: "capitalize" }}>{d.status.replace(/_/g, " ")}</span>
                {d.distanceKm && <> · {d.distanceKm.toFixed(1)} km</>}
                <br />{d.storeName}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
    </>
  );
}

// ─── Heatmap overlay usando CircleMarkers com opacidade ──────────────────────

function HeatmapLayer({ data }: { data: MapViewData }) {
  if (data.heatmap.length === 0) return null;
  const maxCount = Math.max(...data.heatmap.map((p) => p.count), 1);
  return (
    <>
      {data.heatmap.map((p, i) => {
        const intensity = p.count / maxCount;
        const radius    = 20 + intensity * 40;
        const opacity   = 0.08 + intensity * 0.22;
        return (
          <CircleMarker
            key={i}
            center={[p.lat, p.lng]}
            radius={radius}
            pathOptions={{
              color: "#ef4444",
              fillColor: "#ef4444",
              fillOpacity: opacity,
              weight: 0,
              stroke: false,
            }}
            interactive={false}
          />
        );
      })}
    </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  data:    MapViewData;
  filters: MapFilters;
  showHeatmap: boolean;
}

export default function MapCanvas({ data, filters, showHeatmap }: Props) {
  const filtered = applyFilters(data, filters);

  return (
    <MapContainer
      center={SP_CENTER}
      zoom={11}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
      <BoundsUpdater data={data} />

      {showHeatmap && <HeatmapLayer data={filtered} />}
      <StoreMarkers   stores={filtered.stores} />
      <DriverMarkers  drivers={filtered.drivers} />
      <DeliveryMarkers deliveries={filtered.deliveries} />
    </MapContainer>
  );
}
