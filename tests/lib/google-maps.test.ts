import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocodeAddress } from "@/lib/google-maps";

vi.mock("@/services/maps/google-routes.provider", () => ({
  geocodeAddressSP: vi.fn(),
}));
vi.mock("@/lib/route-cache", () => ({
  getCachedGeocoding:  vi.fn().mockResolvedValue(null),
  saveCachedGeocoding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/maps/usage-logger", () => ({
  logMapsUsage: vi.fn(),
}));
vi.mock("@/services/maps/quota-guard", () => ({
  checkMapsQuota: vi.fn().mockResolvedValue({ allowed: true, count: 0, limit: 500, nearLimit: false }),
}));

// Importações dos módulos mockados — acessadas via vi.mocked()
import { geocodeAddressSP }  from "@/services/maps/google-routes.provider";
import { getCachedGeocoding } from "@/lib/route-cache";

global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

describe("geocodeAddress", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
    vi.clearAllMocks();
    vi.mocked(getCachedGeocoding).mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it("retorna resultado estruturado do Google quando disponível", async () => {
    const mockResult = {
      formattedAddress: "Rua X, 123, São Paulo - SP, 01310-100",
      street: "Rua X", streetNumber: "123", neighborhood: "Centro",
      city: "São Paulo", state: "SP", postalCode: "01310-100",
      lat: -23.55, lng: -46.63, placeId: "abc123", withinSP: true,
    };
    vi.mocked(geocodeAddressSP).mockResolvedValue(mockResult);

    const result = await geocodeAddress("Rua X, 123, São Paulo - SP");
    expect(result).not.toBeNull();
    expect(result!.city).toBe("São Paulo");
    expect(result!.withinSP).toBe(true);
    expect(result!.state).toBe("SP");
  });

  it("retorna null quando Google e Nominatim falham", async () => {
    vi.mocked(geocodeAddressSP).mockResolvedValue(null);
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await geocodeAddress("endereço inválido, RJ");
    expect(result).toBeNull();
  });
});
