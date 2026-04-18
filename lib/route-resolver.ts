// lib/route-resolver.ts
// Orquestrador da resolução de rota.
// Fluxo: cache PostgreSQL → Google Maps API → Haversine fallback.
// Garante que frete.service.ts nunca fique sem uma distância,
// mesmo que a API esteja indisponível.

import { calculateHaversineDistance } from "@/lib/utils";
import { getRouteDistance } from "./google-maps";
import {
  getTimeBucket,
  buildCacheKey,
  getCachedRoute,
  saveCachedRoute,
} from "./route-cache";

export interface RouteResolution {
  distanceKm: number;
  durationMin: number;
  isApproximate: boolean; // true = Haversine ativo, dado não é rota real
}

export async function resolveRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<RouteResolution> {
  const timeBucket = getTimeBucket();
  const cacheKey = buildCacheKey(originLat, originLng, destLat, destLng, timeBucket);

  // 1. cache hit?
  const cached = await getCachedRoute(cacheKey);
  if (cached) {
    return { ...cached, isApproximate: false };
  }

  // 2. Google Maps Distance Matrix
  const fromApi = await getRouteDistance(originLat, originLng, destLat, destLng);
  if (fromApi) {
    // salva no cache em background — não bloqueia a resposta
    saveCachedRoute(originLat, originLng, destLat, destLng, fromApi, timeBucket).catch(
      () => {}
    );
    return { ...fromApi, isApproximate: false };
  }

  // 3. fallback Haversine — estimativa de linha reta
  const distanceKm = calculateHaversineDistance(
    originLat,
    originLng,
    destLat,
    destLng
  );
  return {
    distanceKm,
    durationMin: (distanceKm / 30) * 60, // estimativa: 30 km/h médio em SP
    isApproximate: true,
  };
}
