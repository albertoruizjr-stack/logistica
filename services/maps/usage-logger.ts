// services/maps/usage-logger.ts
// Registra chamadas à API do Google Maps para controle de custos e quota.
// Sempre fire-and-forget — nunca bloqueia o fluxo operacional.

import { prisma } from "@/lib/prisma";

export type MapsEndpoint =
  | "COMPUTE_ROUTES"
  | "GEOCODE"
  | "ROUTE_CACHE_HIT"
  | "GEOCODE_CACHE_HIT"
  | "HAVERSINE_FALLBACK"
  | "MAPS_QUOTA_EXCEEDED";  // quota diária atingida — API bloqueada preventivamente

export function logMapsUsage(params: {
  endpoint:  MapsEndpoint;
  cacheHit?: boolean;
  success?:  boolean;
  storeId?:  string;
  error?:    string;
}): void {
  prisma.mapsUsageLog
    .create({
      data: {
        endpoint:  params.endpoint,
        cacheHit:  params.cacheHit ?? false,
        success:   params.success  ?? true,
        storeId:   params.storeId  ?? null,
        error:     params.error    ?? null,
      },
    })
    .catch(() => {});
}
