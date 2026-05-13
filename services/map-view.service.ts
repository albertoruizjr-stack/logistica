// services/map-view.service.ts
// Agrega dados operacionais para a visão espacial do mapa.
// Não toma decisões — apenas consolida o que os outros services já calcularam.

import { prisma }            from "@/lib/prisma";
import { getDriversWithETA } from "@/services/driver-eta.service";
import type {
  MapStore, MapDriver, MapDelivery, HeatmapPoint, MapSummary, MapViewData,
  MarkerColor, DeliveryRisk, ModalRecommendation,
} from "@/types";

const ACTIVE_STATUSES = [
  "PRONTO_ROTEIRIZACAO",
  "ROTEIRIZADO",
  "DISPATCHED",
  "IN_TRANSIT",
] as const;

// ─── helpers ──────────────────────────────────

function driverColor(minutesUntilFree: number, hasLocation: boolean): MarkerColor {
  if (!hasLocation) return "gray";
  if (minutesUntilFree === 0) return "green";
  if (minutesUntilFree <= 30) return "orange";
  return "red";
}

function deliveryColor(isUrgent: boolean, risk: DeliveryRisk): MarkerColor {
  if (isUrgent) return "red";
  if (risk === "HIGH") return "orange";
  if (risk === "MEDIUM") return "blue";
  return "green";
}

function toRisk(r: string | null | undefined): DeliveryRisk {
  if (r === "HIGH" || r === "MEDIUM" || r === "LOW") return r;
  return "LOW";
}

function toModal(m: string | null | undefined): ModalRecommendation | null {
  if (m === "INTERNAL" || m === "LALAMOVE" || m === "EXPRESS" || m === "CONSOLIDATE") return m;
  return null;
}

// Arredonda lat/lng para 2 casas (~1.1km) para gerar células do heatmap
function heatmapKey(lat: number, lng: number) {
  return `${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100}`;
}

// ─── lojas ────────────────────────────────────

async function getMapStores(storeId: string | null): Promise<MapStore[]> {
  const stores = await prisma.store.findMany({
    where: { active: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true, code: true, name: true, lat: true, lng: true, address: true },
    orderBy: { code: "asc" },
  });
  return stores;
}

// ─── motoristas ───────────────────────────────

async function getMapDrivers(storeId: string | null): Promise<MapDriver[]> {
  // Busca lojas para iterar (getDriversWithETA requer storeId individual)
  const storeIds = storeId
    ? [storeId]
    : await prisma.store.findMany({ where: { active: true }, select: { id: true } }).then((s) => s.map((x) => x.id));

  const storeNameMap = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, name: true },
  }).then((rows) => new Map(rows.map((r) => [r.id, r.name])));

  const results = await Promise.all(storeIds.map((sid) => getDriversWithETA(sid)));
  const allDrivers = results.flat();

  // getDriversWithETA não retorna storeId; buscamos via driver.storeId separado
  const driverStoreMap = await prisma.driver.findMany({
    where: { storeId: { in: storeIds }, active: true },
    select: { id: true, storeId: true },
  }).then((rows) => new Map(rows.map((r) => [r.id, r.storeId])));

  return allDrivers.map((d) => {
    const sid = driverStoreMap.get(d.driverId) ?? "";
    return {
      id:               d.driverId,
      name:             d.driverName,
      vehicleType:      d.vehicleType,
      lat:              d.currentLat,
      lng:              d.currentLng,
      isLocationFresh:  d.isLocationFresh,
      minutesUntilFree: d.minutesUntilFree,
      activeDeliveries: d.activeDeliveries,
      score:            d.score,
      storeId:          sid,
      storeName:        storeNameMap.get(sid) ?? "",
      color:            driverColor(d.minutesUntilFree, d.currentLat !== null),
    };
  });
}

// ─── entregas ─────────────────────────────────

async function getMapDeliveries(storeId: string | null): Promise<MapDelivery[]> {
  const requests = await prisma.deliveryRequest.findMany({
    where: {
      status: { in: ACTIVE_STATUSES as unknown as any[] },
      ...(storeId ? { storeId } : {}),
    },
    select: {
      id:             true,
      customerName:   true,
      deliveryAddress: true,
      deliveryLat:    true,
      deliveryLng:    true,
      status:         true,
      deliveryType:   true,
      storeId:        true,
      createdAt:      true,
      store: { select: { name: true } },
      freightQuote: { select: { distanceKm: true, isUrgent: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return requests.map((r) => {
    const isUrgent = r.freightQuote?.isUrgent ?? false;
    const ageHours = (Date.now() - r.createdAt.getTime()) / 3_600_000;
    let risk: DeliveryRisk = "LOW";
    if (isUrgent || ageHours > 4) risk = "HIGH";
    else if (ageHours > 2) risk = "MEDIUM";

    return {
      id:                  r.id,
      customerName:        r.customerName,
      deliveryAddress:     r.deliveryAddress,
      lat:                 r.deliveryLat ?? null,
      lng:                 r.deliveryLng ?? null,
      status:              r.status,
      isUrgent,
      delayRisk:           risk,
      modalRecommendation: null,
      suggestedDriverId:   null,
      distanceKm:          r.freightQuote?.distanceKm ?? null,
      storeId:             r.storeId,
      storeName:           r.store.name,
      color:               deliveryColor(isUrgent, risk),
      createdAt:           r.createdAt,
    };
  });
}

// ─── heatmap ──────────────────────────────────

function buildHeatmap(deliveries: MapDelivery[]): HeatmapPoint[] {
  const cells = new Map<string, { lat: number; lng: number; count: number }>();

  for (const d of deliveries) {
    if (d.lat === null || d.lng === null) continue;
    const key = heatmapKey(d.lat, d.lng);
    const cell = cells.get(key);
    if (cell) {
      cell.count++;
    } else {
      cells.set(key, {
        lat:   Math.round(d.lat * 100) / 100,
        lng:   Math.round(d.lng * 100) / 100,
        count: 1,
      });
    }
  }

  return Array.from(cells.values()).sort((a, b) => b.count - a.count);
}

// ─── resumo ───────────────────────────────────

function buildSummary(drivers: MapDriver[], deliveries: MapDelivery[]): MapSummary {
  return {
    totalDeliveries:  deliveries.length,
    urgentCount:      deliveries.filter((d) => d.isUrgent).length,
    highRiskCount:    deliveries.filter((d) => d.delayRisk === "HIGH").length,
    activeDrivers:    drivers.length,
    availableDrivers: drivers.filter((d) => d.minutesUntilFree === 0).length,
    inTransitCount:   deliveries.filter((d) => d.status === "IN_TRANSIT").length,
    pendingCount:     deliveries.filter((d) =>
      ["PRONTO_ROTEIRIZACAO", "ROTEIRIZADO"].includes(d.status)
    ).length,
  };
}

// ─── entrada principal ────────────────────────

export async function getMapViewData(storeId: string | null): Promise<MapViewData> {
  const [stores, drivers, deliveries] = await Promise.all([
    getMapStores(storeId),
    getMapDrivers(storeId),
    getMapDeliveries(storeId),
  ]);

  return {
    stores,
    drivers,
    deliveries,
    heatmap:   buildHeatmap(deliveries),
    summary:   buildSummary(drivers, deliveries),
    updatedAt: new Date(),
  };
}
