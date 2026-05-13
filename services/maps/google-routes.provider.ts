// services/maps/google-routes.provider.ts
// Provider para a Google Routes API v2 (Compute Routes) e Geocoding API com viés SP.
// Nunca expõe a API key — chamada exclusivamente no backend (server-side).

const ROUTES_URL   = "https://routes.googleapis.com/directions/v2:computeRoutes";
const GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// Status da API que indicam erro de configuração/cota — logar com mais destaque
const QUOTA_STATUSES = new Set(["OVER_DAILY_LIMIT", "OVER_QUERY_LIMIT", "REQUEST_DENIED"]);
const EMPTY_STATUSES = new Set(["ZERO_RESULTS", "NOT_FOUND"]);

// ──────────────────────────────────────────────
// COMPUTE ROUTES
// ──────────────────────────────────────────────

export interface ComputeRoutesResult {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;          // sem trânsito (staticDuration)
  durationMin: number;
  durationInTrafficSeconds: number; // com trânsito real (duration, TRAFFIC_AWARE)
  durationInTrafficMin: number;
  polyline?: string;
}

export async function computeRoutes(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<ComputeRoutesResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // Solicita distância, duração sem/com trânsito e polyline opcional
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin:      { location: { latLng: { latitude: originLat,  longitude: originLng } } },
        destination: { location: { latLng: { latitude: destLat,    longitude: destLng   } } },
        travelMode:            "DRIVE",
        routingPreference:     "TRAFFIC_AWARE",
        computeAlternativeRoutes: false,
        languageCode: "pt-BR",
        units:        "METRIC",
      }),
      // Timeout de 8s para não travar o fluxo operacional
      signal: AbortSignal.timeout(8_000),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const status = data?.error?.status ?? "HTTP_ERROR";
      if (QUOTA_STATUSES.has(status)) {
        console.error(`[google-routes] quota/permissão negada: ${status}`);
      } else {
        console.error(`[google-routes] HTTP ${res.status} (${status})`);
      }
      return null;
    }

    const route = data?.routes?.[0];
    if (!route) {
      console.error("[google-routes] nenhuma rota retornada");
      return null;
    }

    const distanceMeters         = route.distanceMeters ?? 0;
    // duration = com tráfego (TRAFFIC_AWARE), staticDuration = sem tráfego
    const durationInTrafficSeconds = parseDuration(route.duration);
    const durationSeconds          = parseDuration(route.staticDuration);

    return {
      distanceMeters,
      distanceKm:              distanceMeters / 1000,
      durationSeconds,
      durationMin:             durationSeconds / 60,
      durationInTrafficSeconds,
      durationInTrafficMin:    durationInTrafficSeconds / 60,
      polyline:                route.polyline?.encodedPolyline,
    };
  } catch (err: any) {
    if (err?.name === "TimeoutError") {
      console.error("[google-routes] timeout na chamada à API");
    } else {
      console.error("[google-routes] erro:", err);
    }
    return null;
  }
}

// ──────────────────────────────────────────────
// GEOCODING API — endereço → coordenadas + estrutura
// ──────────────────────────────────────────────

export interface StructuredAddress {
  formattedAddress: string;
  street:       string | null;
  streetNumber: string | null;
  neighborhood: string | null; // bairro
  city:         string;
  state:        string;        // sigla, ex: "SP"
  postalCode:   string | null;
  lat:          number;
  lng:          number;
  placeId:      string | null;
  withinSP:     boolean;
}

export async function geocodeAddressSP(
  address: string
): Promise<StructuredAddress | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const url = new URL(GEOCODING_URL);
  url.searchParams.set("address",  address);
  url.searchParams.set("region",   "BR");
  // Restringe componentes ao Brasil — prioriza SP internamente
  url.searchParams.set("components", "country:BR");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("key",      apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const data = await res.json();

    if (QUOTA_STATUSES.has(data?.status)) {
      console.error(`[google-geocoding] quota/permissão negada: ${data.status}`);
      return null;
    }
    if (EMPTY_STATUSES.has(data?.status)) {
      return null; // endereço não encontrado — não é erro de configuração
    }
    if (data?.status !== "OK") {
      console.error(`[google-geocoding] status inesperado: ${data?.status}`);
      return null;
    }

    const result = data?.results?.[0];
    if (!result) return null;

    return parseAddressComponents(result);
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// HELPERS INTERNOS
// ──────────────────────────────────────────────

function parseDuration(value: string | undefined): number {
  if (!value) return 0;
  // formato da Routes API: "1234s"
  return parseInt(value.replace("s", ""), 10) || 0;
}

function parseAddressComponents(result: any): StructuredAddress {
  const components: any[] = result.address_components ?? [];

  const get      = (type: string) => components.find((c) => c.types.includes(type))?.long_name  ?? null;
  const getShort = (type: string) => components.find((c) => c.types.includes(type))?.short_name ?? null;

  const state = getShort("administrative_area_level_1") ?? "";
  const city  = get("locality") ?? get("administrative_area_level_2") ?? "";

  return {
    formattedAddress: result.formatted_address ?? "",
    street:           get("route"),
    streetNumber:     get("street_number"),
    neighborhood:     get("sublocality_level_1") ?? get("sublocality"),
    city,
    state,
    postalCode:       get("postal_code"),
    lat:              result.geometry.location.lat,
    lng:              result.geometry.location.lng,
    placeId:          result.place_id ?? null,
    withinSP:         state === "SP",
  };
}
