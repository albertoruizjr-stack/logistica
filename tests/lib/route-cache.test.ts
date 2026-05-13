import { describe, it, expect } from "vitest";
import { buildRouteCacheKey, buildGeocodingCacheKey } from "@/lib/route-cache";

describe("buildRouteCacheKey", () => {
  it("arredonda coordenadas para 4 casas decimais", () => {
    const key = buildRouteCacheKey(-23.55012345, -46.63334567, -23.54350001, -46.62900099);
    expect(key).toBe("-23.5501_-46.6333_-23.5435_-46.6290");
  });

  it("origem e destino são posicionalmente distintos", () => {
    const keyAB = buildRouteCacheKey(-23.5501, -46.6333, -23.5435, -46.629);
    const keyBA = buildRouteCacheKey(-23.5435, -46.629, -23.5501, -46.6333);
    expect(keyAB).not.toBe(keyBA);
  });

  it("diferenças na 5ª casa decimal resultam na mesma chave", () => {
    const key1 = buildRouteCacheKey(-23.55011, -46.6333, -23.5435, -46.629);
    const key2 = buildRouteCacheKey(-23.55014, -46.6333, -23.5435, -46.629);
    expect(key1).toBe(key2);
  });

  it("não inclui time bucket na chave", () => {
    const key = buildRouteCacheKey(-23.5501, -46.6333, -23.5435, -46.629);
    expect(key).not.toContain("MORNING");
    expect(key).not.toContain("AFTERNOON");
    expect(key).not.toContain("EVENING");
  });
});

describe("buildGeocodingCacheKey", () => {
  it("normaliza query em lowercase e trim", () => {
    const k1 = buildGeocodingCacheKey("  Rua das Flores, 123  ");
    const k2 = buildGeocodingCacheKey("rua das flores, 123");
    expect(k1).toBe(k2);
  });

  it("gera hash diferente para queries distintas", () => {
    const k1 = buildGeocodingCacheKey("Rua A");
    const k2 = buildGeocodingCacheKey("Rua B");
    expect(k1).not.toBe(k2);
  });

  it("retorna string de 32 caracteres", () => {
    expect(buildGeocodingCacheKey("Rua Qualquer")).toHaveLength(32);
  });
});
