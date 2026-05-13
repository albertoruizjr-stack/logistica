// lib/google-maps.ts
// Geocodificação com viés para São Paulo + fallback Nominatim.
// Usado internamente pelo endpoint /api/geocode.
// A chave de API nunca é exposta ao frontend.

import { geocodeAddressSP, type StructuredAddress } from "@/services/maps/google-routes.provider";
import { getCachedGeocoding, saveCachedGeocoding }  from "@/lib/route-cache";
import { logMapsUsage }                             from "@/services/maps/usage-logger";
import { checkMapsQuota }                           from "@/services/maps/quota-guard";

// re-exporta o tipo canônico de endereço
export type { StructuredAddress };

// ──────────────────────────────────────────────
// VALIDAÇÃO DE QUALIDADE DE ENDEREÇO
// Rejeita consultas genéricas demais antes de chamar a API.
// Reduz chamadas improdutivas e protege a quota.
// ──────────────────────────────────────────────

export interface AddressQualityResult {
  valid:   boolean;
  reason?: string;
}

// Padrões que indicam endereço completo o suficiente:
// CEP (8 dígitos), sigla de estado "- SP", "SP -", ou nome de cidade conhecida
const CEP_RE       = /\b\d{5}-?\d{3}\b/;
const STATE_CODE_RE = /\b[A-Z]{2}\b/;  // ex: SP, RJ, MG

export function validateAddressQuality(address: string): AddressQualityResult {
  const trimmed = address.trim();

  if (trimmed.length < 8) {
    return { valid: false, reason: "Endereço muito curto. Informe rua, número e cidade ou CEP." };
  }

  // Aceita endereços com CEP — qualidade garantida
  if (CEP_RE.test(trimmed)) return { valid: true };

  // Precisa ter ao menos uma vírgula separando partes (rua, cidade ou rua, número)
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return {
      valid: false,
      reason: "Informe o endereço completo: Rua, Número, Cidade — SP (ou use o CEP).",
    };
  }

  // Deve conter sigla de estado para evitar geocoding ambíguo (ex: "Rua das Flores" existe em 200 cidades)
  if (!STATE_CODE_RE.test(trimmed)) {
    return {
      valid: false,
      reason: "Inclua a cidade e estado (ex: São Paulo — SP) ou o CEP para garantir precisão.",
    };
  }

  return { valid: true };
}

// ──────────────────────────────────────────────
// GEOCODING PRINCIPAL — cache → Google → Nominatim
// ──────────────────────────────────────────────

export async function geocodeAddress(
  address: string
): Promise<StructuredAddress | null> {
  // 1. cache permanente — não consome quota
  const cached = await getCachedGeocoding(address);
  if (cached) {
    logMapsUsage({ endpoint: "GEOCODE_CACHE_HIT", cacheHit: true });
    return cached;
  }

  // 2. quota guard — pula Google se limite diário atingido
  const quota = await checkMapsQuota().catch(
    (): { allowed: boolean; count: number; limit: number; nearLimit: boolean } =>
      ({ allowed: true, count: 0, limit: 0, nearLimit: false })
  );
  if (!quota.allowed) {
    logMapsUsage({ endpoint: "MAPS_QUOTA_EXCEEDED", cacheHit: false, success: false });
    // Tenta Nominatim como fallback quando a quota estourou
    return geocodeViaNominatim(address);
  }

  if (quota.nearLimit) {
    console.warn(`[google-maps] quota em ${quota.count}/${quota.limit} — próximo do limite`);
  }

  // 3. Google Geocoding API (SP biased)
  const fromGoogle = await geocodeAddressSP(address);
  if (fromGoogle) {
    logMapsUsage({ endpoint: "GEOCODE", cacheHit: false, success: true });
    saveCachedGeocoding(address, fromGoogle, "GOOGLE_GEOCODING").catch(() => {});
    return fromGoogle;
  }

  // 4. Nominatim (OpenStreetMap) — fallback gratuito, rate-limited 1 req/s
  const fromNominatim = await geocodeViaNominatim(address);
  if (fromNominatim) {
    logMapsUsage({ endpoint: "GEOCODE", cacheHit: false, success: true });
    saveCachedGeocoding(address, fromNominatim, "NOMINATIM").catch(() => {});
    return fromNominatim;
  }

  logMapsUsage({ endpoint: "GEOCODE", cacheHit: false, success: false, error: "NOT_FOUND" });
  return null;
}

// ──────────────────────────────────────────────
// FALLBACK — Nominatim (OpenStreetMap)
// ──────────────────────────────────────────────

async function geocodeViaNominatim(
  address: string
): Promise<StructuredAddress | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q",              `${address}, São Paulo, Brasil`);
  url.searchParams.set("format",         "json");
  url.searchParams.set("limit",          "1");
  url.searchParams.set("countrycodes",   "br");
  url.searchParams.set("addressdetails", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent":      "SistemaLogisticaMestreDaPintura/1.0 (interno)",
        "Accept-Language": "pt-BR,pt",
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;

    const data   = await res.json();
    const result = data?.[0];
    if (!result) return null;

    const addr = result.address ?? {};
    const state =
      addr.state_code?.replace("BR-", "") ??
      (addr.state === "São Paulo" ? "SP" : "");

    return {
      formattedAddress: result.display_name,
      street:           addr.road ?? null,
      streetNumber:     addr.house_number ?? null,
      neighborhood:     addr.suburb ?? addr.neighbourhood ?? null,
      city:             addr.city ?? addr.town ?? addr.municipality ?? "",
      state,
      postalCode:       addr.postcode ?? null,
      lat:              parseFloat(result.lat),
      lng:              parseFloat(result.lon),
      placeId:          null,
      withinSP:         state === "SP",
    };
  } catch {
    return null;
  }
}
