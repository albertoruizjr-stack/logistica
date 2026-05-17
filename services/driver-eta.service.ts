// services/driver-eta.service.ts
// Calcula ETA de cada motorista com base nas entregas ativas e localização atual.
// Usado pelo motor de decisão para escolher o melhor candidato de frota própria.

import { prisma }                    from "@/lib/prisma";
import { DispatchStatus }            from "@prisma/client";
import { calculateHaversineDistance } from "@/lib/utils";
import type { DriverETAResult }      from "@/types";
import { computeRoutes }             from "@/services/maps/google-routes.provider";

const UNLOAD_BUFFER_MIN  = 10;  // tempo de descarga por parada
const LOCATION_FRESH_MIN = 30;  // localização considerada recente
const FALLBACK_DURATION_MIN = 45; // quando não há durationMinutes na cotação
const ROUTES_CACHE_TTL_MS = 3 * 60_000; // ETA driver→ponto vale 3 min

// Cache em memória do server pra ETA com trânsito.
// Chave: "lat,lng>destLat,destLng" arredondado a 4 casas (~10m).
const etaCache = new Map<string, { value: number; expiresAt: number }>();

function etaCacheKey(oLat: number, oLng: number, dLat: number, dLng: number): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(oLat)},${r(oLng)}>${r(dLat)},${r(dLng)}`;
}

// Tenta Routes API com cache. Se falhar (rede/quota), cai pro Haversine × 1.4 (fator
// urbano conservador) e converte pra minutos a 25 km/h.
async function getDriveTimeMin(
  oLat: number, oLng: number, dLat: number, dLng: number,
): Promise<{ min: number; source: "ROUTES" | "FALLBACK" }> {
  const key = etaCacheKey(oLat, oLng, dLat, dLng);
  const hit = etaCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { min: hit.value, source: "ROUTES" };
  }

  try {
    const route = await computeRoutes(oLat, oLng, dLat, dLng);
    if (route && (route.durationInTrafficMin ?? route.durationMin) > 0) {
      const min = route.durationInTrafficMin ?? route.durationMin;
      etaCache.set(key, { value: min, expiresAt: Date.now() + ROUTES_CACHE_TTL_MS });
      return { min, source: "ROUTES" };
    }
  } catch (err) {
    console.warn("[driver-eta] Routes API falhou, usando fallback Haversine", err);
  }

  // Fallback: Haversine + fator de detour urbano. Conservador pra não sub-estimar.
  const km  = calculateHaversineDistance(oLat, oLng, dLat, dLng) * 1.4;
  const min = (km / 25) * 60;
  return { min, source: "FALLBACK" };
}

// ──────────────────────────────────────────────
// SCORE COMPOSTO (lógica definida pelo operador)
// Recebe: minutos até ficar livre, distância até a origem, entregas ativas.
// Retorna: 0-100 (mais alto = melhor candidato).
// ──────────────────────────────────────────────

export function scoreDriverWithETA(
  minutesUntilFree: number,
  dOriginKm: number | null,
  activeDeliveries: number
): number {
  if (minutesUntilFree > 45) return 0;
  if (dOriginKm != null && dOriginKm > 18) return 0;

  const availabilityScore = Math.max(0, 45 - minutesUntilFree);              // até 45 pts
  // Sem localização recente → recebe nota neutra (não premia nem zera).
  // Premia drivers com GPS ativo: distância conhecida vira pontos reais.
  const proximityScore = dOriginKm == null
    ? 10
    : Math.max(0, 35 * (1 - dOriginKm / 18));                                 // até 35 pts
  const loadScore =
    activeDeliveries === 0 ? 20 :
    activeDeliveries === 1 ? 10 :
    activeDeliveries === 2 ? 4  : 0;                                          // até 20 pts

  return Math.max(0, Math.min(100, Math.round(availabilityScore + proximityScore + loadScore)));
}

// ──────────────────────────────────────────────
// CÁLCULO DE MINUTOS ATÉ FICAR LIVRE
// Encadeia as entregas ativas em ordem de despacho.
// ──────────────────────────────────────────────

interface ActiveDispatch {
  status:       string;
  dispatchedAt: Date | null;
  durationMin:  number | null;  // da freight quote associada
}

export function computeMinutesUntilFree(
  dispatches: ActiveDispatch[],
  now: Date
): number {
  if (dispatches.length === 0) return 0;

  // Ordena: IN_TRANSIT primeiro (já saiu), ASSIGNED depois (na fila)
  const sorted = [...dispatches].sort((a, b) => {
    if (a.status === "IN_TRANSIT" && b.status !== "IN_TRANSIT") return -1;
    if (b.status === "IN_TRANSIT" && a.status !== "IN_TRANSIT") return  1;
    const ta = a.dispatchedAt?.getTime() ?? 0;
    const tb = b.dispatchedAt?.getTime() ?? 0;
    return ta - tb;
  });

  let etaMs = now.getTime();

  for (const [i, dispatch] of sorted.entries()) {
    const durationMs = (dispatch.durationMin ?? FALLBACK_DURATION_MIN) * 60_000;
    const bufferMs   = UNLOAD_BUFFER_MIN * 60_000;

    if (i === 0 && dispatch.status === "IN_TRANSIT" && dispatch.dispatchedAt) {
      const elapsed  = now.getTime() - dispatch.dispatchedAt.getTime();
      const total    = durationMs + bufferMs;
      const remaining = Math.max(0, total - elapsed);
      etaMs = now.getTime() + remaining;
    } else {
      // Entrega na fila: começa após a anterior terminar
      etaMs += durationMs + bufferMs;
    }
  }

  return Math.max(0, (etaMs - now.getTime()) / 60_000);
}

// ──────────────────────────────────────────────
// CONSULTA PRINCIPAL — ETA de todos os motoristas da loja
// ──────────────────────────────────────────────

export async function getDriversWithETA(
  storeId:        string,
  originLat?:     number,
  originLng?:     number
): Promise<DriverETAResult[]> {
  const now    = new Date();
  const cutoff = new Date(now.getTime() - LOCATION_FRESH_MIN * 60_000);

  const drivers = await prisma.driver.findMany({
    where: { storeId, active: true },
    include: {
      locations: {
        where:   { timestamp: { gte: cutoff } },
        orderBy: { timestamp: "desc" },
        take: 1,
      },
      dispatches: {
        where: {
          status: { in: [DispatchStatus.ASSIGNED, DispatchStatus.IN_TRANSIT] },
        },
        include: {
          deliveryRequest: {
            select: {
              freightQuote: { select: { durationMinutes: true } },
            },
          },
        },
        orderBy: { dispatchedAt: "asc" },
      },
    },
  });

  return Promise.all(drivers.map(async (driver) => {
    const loc     = driver.locations[0] ?? null;
    const dispatches: ActiveDispatch[] = driver.dispatches.map((d) => ({
      status:       d.status,
      dispatchedAt: d.dispatchedAt,
      durationMin:  d.deliveryRequest?.freightQuote?.durationMinutes ?? null,
    }));

    const minutesUntilFree = computeMinutesUntilFree(dispatches, now);
    const estimatedFreeAt  = new Date(now.getTime() + minutesUntilFree * 60_000);

    const currentLat = loc?.lat ?? null;
    const currentLng = loc?.lng ?? null;

    // Distância driver → origem do pedido (loja despachante).
    // ANTES: quando driver não tinha GPS, dOriginKm caía pra 0 e ele
    // ganhava 35pts de proximidade grátis. Agora distância vira null e
    // o score considera isso (sem localização ≠ "está aqui do lado").
    let dOriginKm: number | null = null;
    let dOriginMin: number | null = null;

    if (originLat != null && originLng != null && currentLat != null && currentLng != null) {
      dOriginKm = calculateHaversineDistance(currentLat, currentLng, originLat, originLng);
      const eta = await getDriveTimeMin(currentLat, currentLng, originLat, originLng);
      dOriginMin = eta.min;
    }

    const score = driver.available
      ? scoreDriverWithETA(minutesUntilFree, dOriginKm, dispatches.length)
      : 0;

    return {
      driverId:         driver.id,
      driverName:       driver.name,
      vehicleType:      driver.vehicleType,
      currentLat,
      currentLng,
      isLocationFresh:  loc !== null,
      activeDeliveries: dispatches.length,
      minutesUntilFree,
      estimatedFreeAt,
      score,
      etaToOriginMin:   dOriginMin,
    };
  }));
}
