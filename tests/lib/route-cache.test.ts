import { describe, it, expect, vi, afterEach } from "vitest";
import { buildCacheKey, getTimeBucket, computeTTLDays } from "@/lib/route-cache";

afterEach(() => {
  vi.useRealTimers();
});

// ──────────────────────────────────────────────
// buildCacheKey
// ──────────────────────────────────────────────

describe("buildCacheKey", () => {
  it("arredonda coordenadas para 4 casas decimais", () => {
    const key = buildCacheKey(
      -23.55012345,
      -46.63334567,
      -23.54350001,
      -46.62900099,
      "MORNING"
    );
    expect(key).toBe("-23.5501_-46.6333_-23.5435_-46.6290_MORNING");
  });

  it("origem e destino são posicionalmente distintos", () => {
    const keyAB = buildCacheKey(-23.5501, -46.6333, -23.5435, -46.629, "AFTERNOON");
    const keyBA = buildCacheKey(-23.5435, -46.629, -23.5501, -46.6333, "AFTERNOON");
    expect(keyAB).not.toBe(keyBA);
  });

  it("mesmo par de coordenadas com timeBuckets diferentes gera chaves distintas", () => {
    const morning = buildCacheKey(-23.5501, -46.6333, -23.5435, -46.629, "MORNING");
    const evening = buildCacheKey(-23.5501, -46.6333, -23.5435, -46.629, "EVENING");
    expect(morning).not.toBe(evening);
  });

  it("diferenças na 5ª casa decimal (≤4) resultam na mesma chave de 4dp", () => {
    // -23.55011 e -23.55014 ambos arredondam para -23.5501 (5ª casa ≤ 4 → sem carry)
    const key1 = buildCacheKey(-23.55011, -46.6333, -23.5435, -46.629, "AFTERNOON");
    const key2 = buildCacheKey(-23.55014, -46.6333, -23.5435, -46.629, "AFTERNOON");
    expect(key1).toBe(key2);
  });
});

// ──────────────────────────────────────────────
// getTimeBucket
// ──────────────────────────────────────────────

describe("getTimeBucket", () => {
  it("retorna MORNING entre 6h e 11h59", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T09:30:00"));
    expect(getTimeBucket()).toBe("MORNING");
  });

  it("retorna AFTERNOON entre 12h e 17h59", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T15:00:00"));
    expect(getTimeBucket()).toBe("AFTERNOON");
  });

  it("retorna EVENING às 18h em diante", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T20:00:00"));
    expect(getTimeBucket()).toBe("EVENING");
  });

  it("retorna EVENING antes das 6h (madrugada)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T03:00:00"));
    expect(getTimeBucket()).toBe("EVENING");
  });
});

// ──────────────────────────────────────────────
// computeTTLDays
// ──────────────────────────────────────────────

describe("computeTTLDays", () => {
  it("retorna 7 dias para distâncias até 5 km", () => {
    expect(computeTTLDays(0.5)).toBe(7);
    expect(computeTTLDays(5)).toBe(7);
  });

  it("retorna 15 dias para distâncias entre 5 e 15 km", () => {
    expect(computeTTLDays(5.1)).toBe(15);
    expect(computeTTLDays(15)).toBe(15);
  });

  it("retorna 30 dias para distâncias acima de 15 km", () => {
    expect(computeTTLDays(15.1)).toBe(30);
    expect(computeTTLDays(25)).toBe(30);
  });
});
