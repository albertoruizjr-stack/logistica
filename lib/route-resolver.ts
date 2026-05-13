// lib/route-resolver.ts
// Orquestrador da resolução de rota.
// Fluxo: cache → Routes API (com trânsito) → Haversine fallback.

import { calculateHaversineDistance } from "@/lib/utils";
import { computeRoutes }              from "@/services/maps/google-routes.provider";
import { logMapsUsage }               from "@/services/maps/usage-logger";
import {
  buildRouteCacheKey,
  getCachedRoute,
  saveCachedRoute,
} from "./route-cache";

export interface RouteResolution {
  distanceKm:           number;
  durationMin:          number;          // sem trânsito
  durationInTrafficMin: number | null;   // com trânsito (null = não disponível)
  isApproximate:        boolean;         // true = Haversine ativo
  isTrafficFresh:       boolean;         // false = trânsito expirado/indisponível
}

export async function resolveRoute(
  originLat: number,
  originLng: number,
  destLat:   number,
  destLng:   number,
  storeId?:  string
): Promise<RouteResolution> {
  const cacheKey = buildRouteCacheKey(originLat, originLng, destLat, destLng);

  // 1. cache hit
  const cached = await getCachedRoute(cacheKey);
  if (cached) {
    logMapsUsage({ endpoint: "ROUTE_CACHE_HIT", cacheHit: true, storeId });
    return {
      distanceKm:           cached.distanceKm,
      durationMin:          cached.durationMin,
      durationInTrafficMin: cached.durationInTrafficMin,
      isApproximate:        false,
      isTrafficFresh:       cached.isTrafficFresh,
    };
  }

  // 2. Google Routes API (Compute Routes com TRAFFIC_AWARE)
  const fromApi = await computeRoutes(originLat, originLng, destLat, destLng);
  if (fromApi) {
    logMapsUsage({ endpoint: "COMPUTE_ROUTES", cacheHit: false, success: true, storeId });
    saveCachedRoute(originLat, originLng, destLat, destLng, fromApi).catch(() => {});
    return {
      distanceKm:           fromApi.distanceKm,
      durationMin:          fromApi.durationMin,
      durationInTrafficMin: fromApi.durationInTrafficMin,
      isApproximate:        false,
      isTrafficFresh:       true,
    };
  }

  // 3. Haversine fallback
  logMapsUsage({ endpoint: "HAVERSINE_FALLBACK", cacheHit: false, success: true, storeId });
  const distanceKm = calculateHaversineDistance(originLat, originLng, destLat, destLng);
  return {
    distanceKm,
    durationMin:          (distanceKm / 30) * 60, // estimativa: 30 km/h médio em SP
    durationInTrafficMin: null,
    isApproximate:        true,
    isTrafficFresh:       false,
  };
}
