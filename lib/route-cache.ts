// lib/route-cache.ts
// Cache de rotas no PostgreSQL.
// Responsabilidade: construir chave de lookup contextualizada por período do dia
// e executar operações de leitura/escrita no modelo RouteCache.

import { prisma } from "@/lib/prisma";
import type { RouteResult } from "./google-maps";

// ──────────────────────────────────────────────
// TIME BUCKET
// Captura variação de tráfego por período do dia em SP.
// Mesmo par origem→destino tem duração diferente de manhã e à tarde.
// ──────────────────────────────────────────────

export type TimeBucket = "MORNING" | "AFTERNOON" | "EVENING";

export function getTimeBucket(): TimeBucket {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return "MORNING";
  if (hour >= 12 && hour < 18) return "AFTERNOON";
  return "EVENING"; // 18h-6h (inclui madrugada)
}

// ──────────────────────────────────────────────
// CACHE KEY
// Arredonda para 4 casas decimais (~11m de precisão em SP)
// e inclui o período do dia para capturar variação de tráfego.
// Formato: "{oLat4dp}_{oLng4dp}_{dLat4dp}_{dLng4dp}_{BUCKET}"
// ──────────────────────────────────────────────

export function buildCacheKey(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  timeBucket: TimeBucket
): string {
  return [
    originLat.toFixed(4),
    originLng.toFixed(4),
    destLat.toFixed(4),
    destLng.toFixed(4),
    timeBucket,
  ].join("_");
}

// ──────────────────────────────────────────────
// TTL DINÂMICO
// Rotas curtas são mais afetadas por obras locais → TTL menor.
// Rotas longas passam por múltiplos caminhos → menos sensíveis.
// ──────────────────────────────────────────────

export function computeTTLDays(distanceKm: number): number {
  if (distanceKm <= 5) return 7;
  if (distanceKm <= 15) return 15;
  return 30;
}

// ──────────────────────────────────────────────
// OPERAÇÕES DE BANCO
// ──────────────────────────────────────────────

export async function getCachedRoute(
  cacheKey: string
): Promise<RouteResult | null> {
  const cached = await prisma.routeCache.findUnique({ where: { cacheKey } });

  if (!cached) return null;

  if (cached.expiresAt < new Date()) {
    // expirado: remove de forma assíncrona e retorna null para nova consulta
    prisma.routeCache.delete({ where: { cacheKey } }).catch(() => {});
    return null;
  }

  return { distanceKm: cached.distanceKm, durationMin: cached.durationMin };
}

export async function saveCachedRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  result: RouteResult,
  timeBucket: TimeBucket
): Promise<void> {
  const cacheKey = buildCacheKey(originLat, originLng, destLat, destLng, timeBucket);
  const ttlDays = computeTTLDays(result.distanceKm);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  await prisma.routeCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      originLat,
      originLng,
      destLat,
      destLng,
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      expiresAt,
    },
    update: {
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      fetchedAt: new Date(),
      expiresAt,
    },
  });
}
