import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/maps/google-routes.provider", () => ({
  computeRoutes: vi.fn(),
}));
vi.mock("@/lib/route-cache", () => ({
  buildRouteCacheKey: vi.fn(() => "mock-cache-key"),
  getCachedRoute:     vi.fn(),
  saveCachedRoute:    vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/maps/usage-logger", () => ({
  logMapsUsage: vi.fn(),
}));

import { computeRoutes }                    from "@/services/maps/google-routes.provider";
import { getCachedRoute, saveCachedRoute }  from "@/lib/route-cache";
import { resolveRoute }                     from "@/lib/route-resolver";

const MOCK_CACHE_HIT = {
  distanceKm: 3.5,
  durationMin: 8,
  durationInTrafficMin: 10,
  isTrafficFresh: true,
};

const MOCK_API_RESULT = {
  distanceMeters: 4200,
  distanceKm: 4.2,
  durationSeconds: 660,
  durationMin: 11,
  durationInTrafficSeconds: 780,
  durationInTrafficMin: 13,
};

describe("resolveRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna cache sem chamar API quando há hit", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(MOCK_CACHE_HIT);

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBe(3.5);
    expect(result.durationMin).toBe(8);
    expect(result.durationInTrafficMin).toBe(10);
    expect(result.isApproximate).toBe(false);
    expect(result.isTrafficFresh).toBe(true);
    expect(computeRoutes).not.toHaveBeenCalled();
    expect(saveCachedRoute).not.toHaveBeenCalled();
  });

  it("chama Routes API no cache miss e salva resultado", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(computeRoutes).mockResolvedValue(MOCK_API_RESULT);

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBe(4.2);
    expect(result.durationMin).toBe(11);
    expect(result.durationInTrafficMin).toBe(13);
    expect(result.isApproximate).toBe(false);
    expect(result.isTrafficFresh).toBe(true);
    expect(saveCachedRoute).toHaveBeenCalledOnce();
  });

  it("usa Haversine quando cache miss e API retorna null", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(computeRoutes).mockResolvedValue(null);

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.isApproximate).toBe(true);
    expect(result.durationInTrafficMin).toBeNull();
    expect(result.isTrafficFresh).toBe(false);
    expect(saveCachedRoute).not.toHaveBeenCalled();
  });

  it("durationMin no fallback Haversine usa estimativa de 30km/h", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(computeRoutes).mockResolvedValue(null);

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result.durationMin).toBeCloseTo((result.distanceKm / 30) * 60, 1);
  });
});
