import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRouteDistance } from "@/lib/google-maps";

global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

describe("getRouteDistance", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.clearAllMocks();
  });

  it("retorna null sem chamar fetch quando API_KEY está ausente", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retorna distância e duração quando API responde OK", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [
          {
            elements: [
              {
                status: "OK",
                distance: { value: 3540 }, // 3.54 km
                duration: { value: 840 },  // 14 min
              },
            ],
          },
        ],
      }),
    } as Response);

    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBeCloseTo(3.54, 2);
    expect(result!.durationMin).toBeCloseTo(14, 0);
  });

  it("retorna null quando elemento tem status diferente de OK", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [{ elements: [{ status: "ZERO_RESULTS" }] }],
      }),
    } as Response);

    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result).toBeNull();
  });

  it("retorna null quando HTTP status não é 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as Response);

    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result).toBeNull();
  });

  it("retorna null quando fetch lança exceção de rede", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result).toBeNull();
  });

  it("constrói URL com os parâmetros corretos", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [
          {
            elements: [
              { status: "OK", distance: { value: 1000 }, duration: { value: 120 } },
            ],
          },
        ],
      }),
    } as Response);

    await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("origins=-23.5501%2C-46.6333");
    expect(calledUrl).toContain("mode=driving");
    expect(calledUrl).toContain("key=test-key-123");
  });
});
