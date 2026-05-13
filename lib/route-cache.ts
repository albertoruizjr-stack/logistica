// lib/route-cache.ts
// Cache de rotas e geocodificação no PostgreSQL.
// TTL: rota base 24h | trânsito 10min | geocoding permanente.

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { ComputeRoutesResult, StructuredAddress } from "@/services/maps/google-routes.provider";

const ROUTE_TTL_MS   = 24 * 60 * 60 * 1000; // 24h
const TRAFFIC_TTL_MS = 10 * 60 * 1000;       // 10min

// ──────────────────────────────────────────────
// CACHE KEY DE ROTA
// Coordenadas arredondadas a 4 casas decimais (~11m de precisão em SP).
// Sem time-bucket — variação de tráfego é capturada por durationInTrafficMin.
// ──────────────────────────────────────────────

export function buildRouteCacheKey(
  originLat: number,
  originLng: number,
  destLat:   number,
  destLng:   number
): string {
  return [
    originLat.toFixed(4),
    originLng.toFixed(4),
    destLat.toFixed(4),
    destLng.toFixed(4),
  ].join("_");
}

// ──────────────────────────────────────────────
// RESULTADO DO CACHE DE ROTA
// ──────────────────────────────────────────────

export interface CachedRouteResult {
  distanceKm:           number;
  durationMin:          number;
  durationInTrafficMin: number | null; // null = tráfego expirado ou não disponível
  isTrafficFresh:       boolean;
}

export async function getCachedRoute(
  cacheKey: string
): Promise<CachedRouteResult | null> {
  const cached = await prisma.routeCache.findUnique({ where: { cacheKey } });
  if (!cached) return null;

  const now = new Date();
  if (cached.expiresAt < now) {
    prisma.routeCache.delete({ where: { cacheKey } }).catch(() => {});
    return null;
  }

  const isTrafficFresh =
    cached.durationInTrafficMin != null &&
    cached.trafficExpiresAt != null &&
    cached.trafficExpiresAt > now;

  return {
    distanceKm:           cached.distanceKm,
    durationMin:          cached.durationMin,
    durationInTrafficMin: isTrafficFresh ? cached.durationInTrafficMin : null,
    isTrafficFresh,
  };
}

export async function saveCachedRoute(
  originLat: number,
  originLng: number,
  destLat:   number,
  destLng:   number,
  result:    ComputeRoutesResult
): Promise<void> {
  const cacheKey       = buildRouteCacheKey(originLat, originLng, destLat, destLng);
  const now            = new Date();
  const expiresAt      = new Date(now.getTime() + ROUTE_TTL_MS);
  const trafficExpiresAt = new Date(now.getTime() + TRAFFIC_TTL_MS);

  await prisma.routeCache.upsert({
    where:  { cacheKey },
    create: {
      cacheKey,
      originLat,
      originLng,
      destLat,
      destLng,
      distanceKm:           result.distanceKm,
      durationMin:          result.durationMin,
      durationInTrafficMin: result.durationInTrafficMin,
      trafficExpiresAt,
      provider:  "GOOGLE_ROUTES",
      expiresAt,
    },
    update: {
      distanceKm:           result.distanceKm,
      durationMin:          result.durationMin,
      durationInTrafficMin: result.durationInTrafficMin,
      trafficExpiresAt,
      provider:  "GOOGLE_ROUTES",
      fetchedAt: now,
      expiresAt,
    },
  });
}

// ──────────────────────────────────────────────
// CACHE DE GEOCODIFICAÇÃO — permanente
// ──────────────────────────────────────────────

export function buildGeocodingCacheKey(query: string): string {
  return createHash("sha256")
    .update(query.toLowerCase().trim())
    .digest("hex")
    .slice(0, 32);
}

export async function getCachedGeocoding(
  query: string
): Promise<StructuredAddress | null> {
  const queryHash = buildGeocodingCacheKey(query);
  const cached = await prisma.geocodingCache.findUnique({ where: { queryHash } });
  if (!cached) return null;

  return {
    formattedAddress: cached.formattedAddress,
    street:           cached.street,
    streetNumber:     cached.streetNumber,
    neighborhood:     cached.neighborhood,
    city:             cached.city,
    state:            cached.state,
    postalCode:       cached.postalCode,
    lat:              cached.lat,
    lng:              cached.lng,
    placeId:          cached.placeId,
    withinSP:         cached.withinSP,
  };
}

export async function saveCachedGeocoding(
  query:    string,
  result:   StructuredAddress,
  provider: string = "GOOGLE_GEOCODING"
): Promise<void> {
  const queryHash = buildGeocodingCacheKey(query);

  await prisma.geocodingCache.upsert({
    where:  { queryHash },
    create: {
      queryHash,
      placeId:          result.placeId,
      formattedAddress: result.formattedAddress,
      street:           result.street,
      streetNumber:     result.streetNumber,
      neighborhood:     result.neighborhood,
      city:             result.city,
      state:            result.state,
      postalCode:       result.postalCode,
      lat:              result.lat,
      lng:              result.lng,
      withinSP:         result.withinSP,
      provider,
    },
    update: {
      formattedAddress: result.formattedAddress,
      lat:              result.lat,
      lng:              result.lng,
      withinSP:         result.withinSP,
      cachedAt:         new Date(),
    },
  });
}
