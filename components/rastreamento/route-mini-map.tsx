"use client";

import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const TILE_URL  = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

interface Point {
  lat:   number;
  lng:   number;
  label: string;
  color: string;
  size:  number;
}

interface Props {
  store:    { lat: number; lng: number; code: string };
  driver:   { lat: number; lng: number } | null;
  stops:    Array<{ lat: number; lng: number; label: string; delivered: boolean }>;
  height?:  number;
}

export default function RouteMiniMap({ store, driver, stops, height = 200 }: Props) {
  const points: Point[] = [
    { lat: store.lat, lng: store.lng, label: `Loja ${store.code}`, color: "#0f172a", size: 8 },
    ...stops.map((s) => ({
      lat:   s.lat,
      lng:   s.lng,
      label: s.label,
      color: s.delivered ? "#22c55e" : "#f97316",
      size:  6,
    })),
  ];

  if (driver) {
    points.push({ lat: driver.lat, lng: driver.lng, label: "Motorista", color: "#2563eb", size: 9 });
  }

  // Centro inicial: motorista > primeira parada não-entregue > loja
  const firstPending = stops.find((s) => !s.delivered);
  const center: [number, number] = driver
    ? [driver.lat, driver.lng]
    : firstPending
      ? [firstPending.lat, firstPending.lng]
      : [store.lat, store.lng];

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height }}>
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
        attributionControl={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <FitBounds points={points} />
        {points.map((p, idx) => (
          <CircleMarker
            key={idx}
            center={[p.lat, p.lng]}
            radius={p.size}
            pathOptions={{ color: p.color, fillColor: p.color, fillOpacity: 0.9, weight: 2 }}
          >
            <Tooltip direction="top" offset={[0, -4]} opacity={0.95}>
              <span className="text-xs font-semibold">{p.label}</span>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

function FitBounds({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);
  return null;
}
