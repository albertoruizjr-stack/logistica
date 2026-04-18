// lib/google-maps.ts
// Cliente do Google Maps Platform (Distance Matrix + Geocoding).
// Geocoding: Google Maps quando disponível → Nominatim (OpenStreetMap) como fallback gratuito.
// Retorna null em qualquer falha — o orquestrador decide o fallback.

const DISTANCE_MATRIX_URL =
  "https://maps.googleapis.com/maps/api/distancematrix/json";

const GEOCODING_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
}

export async function getRouteDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<RouteResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn(
      "[google-maps] GOOGLE_MAPS_API_KEY não configurada — fallback Haversine ativo"
    );
    return null;
  }

  const url = new URL(DISTANCE_MATRIX_URL);
  url.searchParams.set("origins", `${originLat},${originLng}`);
  url.searchParams.set("destinations", `${destLat},${destLng}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("units", "metric");
  url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error(`[google-maps] HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const element = data?.rows?.[0]?.elements?.[0];

    if (!element || element.status !== "OK") {
      console.error(`[google-maps] status inesperado: ${element?.status}`);
      return null;
    }

    return {
      distanceKm: element.distance.value / 1000, // metros → km
      durationMin: element.duration.value / 60,  // segundos → minutos
    };
  } catch (err) {
    console.error("[google-maps] erro na chamada:", err);
    return null;
  }
}

// ──────────────────────────────────────────────
// GEOCODING API — endereço → lat/lng
// ──────────────────────────────────────────────

export interface GeocodingResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export async function geocodeAddress(
  address: string
): Promise<GeocodingResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (apiKey) {
    const result = await geocodeViaGoogleMaps(address, apiKey);
    if (result) return result;
  }

  // fallback gratuito via Nominatim (OpenStreetMap) — sem chave necessária
  return geocodeViaNominatim(address);
}

async function geocodeViaGoogleMaps(
  address: string,
  apiKey: string
): Promise<GeocodingResult | null> {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("region", "BR");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.results?.[0];
    if (!result || data.status !== "OK") return null;

    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
    };
  } catch {
    return null;
  }
}

// Nominatim tem limite de 1 req/seg por política de uso — aceitável para uso interno
async function geocodeViaNominatim(
  address: string
): Promise<GeocodingResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${address}, Brasil`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        // Nominatim exige User-Agent identificável por política de uso
        "User-Agent": "SistemaLogisticaMestreDaPintura/1.0 (interno)",
        "Accept-Language": "pt-BR,pt",
      },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.[0];
    if (!result) return null;

    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      formattedAddress: result.display_name,
    };
  } catch {
    return null;
  }
}
