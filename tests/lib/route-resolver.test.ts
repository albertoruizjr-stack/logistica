import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/google-maps", () => ({
  getRouteDistance: vi.fn(),
}));
vi.mock("@/lib/route-cache", () => ({
  getTimeBucket: vi.fn(() => "MORNING"),
  buildCacheKey: vi.fn(() => "mock-cache-key"),
  getCachedRoute: vi.fn(),
  saveCachedRoute: vi.fn().mockResolvedValue(undefined),
}));

import { getRouteDistance } from "@/lib/google-maps";
import { getCachedRoute, saveCachedRoute } from "@/lib/route-cache";
import { resolveRoute } from "@/lib/route-resolver";

describe("resolveRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna cache sem chamar Google Maps quando há hit", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue({
      distanceKm: 3.5,
      durationMin: 8,
    });

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBe(3.5);
    expect(result.durationMin).toBe(8);
    expect(result.isApproximate).toBe(false);
    expect(getRouteDistance).not.toHaveBeenCalled();
    expect(saveCachedRoute).not.toHaveBeenCalled();
  });

  it("chama Google Maps no cache miss e salva resultado com timeBucket", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(getRouteDistance).mockResolvedValue({
      distanceKm: 4.2,
      durationMin: 11,
    });

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBe(4.2);
    expect(result.durationMin).toBe(11);
    expect(result.isApproximate).toBe(false);
    expect(saveCachedRoute).toHaveBeenCalledOnce();
    // verifica que o timeBucket foi passado
    expect(saveCachedRoute).toHaveBeenCalledWith(
      -23.5501, -46.6333, -23.5435, -46.629,
      { distanceKm: 4.2, durationMin: 11 },
      "MORNING"
    );
  });

  it("usa Haversine quando cache miss E Google Maps retorna null", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(getRouteDistance).mockResolvedValue(null);

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.distanceKm).toBeLessThan(20);
    expect(result.isApproximate).toBe(true);
    expect(saveCachedRoute).not.toHaveBeenCalled();
  });

  it("durationMin no fallback Haversine usa estimativa de 30km/h", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(getRouteDistance).mockResolvedValue(null);

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    const expectedDuration = (result.distanceKm / 30) * 60;
    expect(result.durationMin).toBeCloseTo(expectedDuration, 1);
  });
});
