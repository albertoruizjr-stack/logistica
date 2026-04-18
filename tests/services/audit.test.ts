import { describe, it, expect } from "vitest";
import {
  computeDeviation,
  classifyDeviation,
  isJustificationRequired,
} from "@/services/audit.service";

// ──────────────────────────────────────────────
// computeDeviation
// ──────────────────────────────────────────────

describe("computeDeviation", () => {
  it("calcula desvio positivo quando cobrado > sugerido", () => {
    const result = computeDeviation(50, 70);
    expect(result.deviationAmount).toBeCloseTo(20, 2);
    expect(result.deviationPercent).toBeCloseTo(40, 1); // (70-50)/50*100 = 40%
  });

  it("calcula desvio negativo quando cobrado < sugerido", () => {
    const result = computeDeviation(50, 30);
    expect(result.deviationAmount).toBeCloseTo(-20, 2);
    expect(result.deviationPercent).toBeCloseTo(-40, 1);
  });

  it("retorna zero quando cobrado = sugerido", () => {
    const result = computeDeviation(50, 50);
    expect(result.deviationAmount).toBe(0);
    expect(result.deviationPercent).toBe(0);
  });

  it("retorna deviationPercent zero quando sugerido é zero (evita divisão por zero)", () => {
    const result = computeDeviation(0, 50);
    expect(result.deviationAmount).toBe(50);
    expect(result.deviationPercent).toBe(0);
  });

  it("funciona com valores decimais típicos de frete", () => {
    const result = computeDeviation(12.5, 15);
    expect(result.deviationAmount).toBeCloseTo(2.5, 2);
    expect(result.deviationPercent).toBeCloseTo(20, 1);
  });
});

// ──────────────────────────────────────────────
// classifyDeviation
// ──────────────────────────────────────────────

describe("classifyDeviation", () => {
  it("classifica como WITHIN_RULE quando desvio dentro da tolerância positiva", () => {
    expect(classifyDeviation(10, 15)).toBe("WITHIN_RULE");
    expect(classifyDeviation(0, 15)).toBe("WITHIN_RULE");
    expect(classifyDeviation(15, 15)).toBe("WITHIN_RULE"); // no limite = dentro
  });

  it("classifica como WITHIN_RULE quando desvio dentro da tolerância negativa", () => {
    expect(classifyDeviation(-10, 15)).toBe("WITHIN_RULE");
    expect(classifyDeviation(-15, 15)).toBe("WITHIN_RULE"); // no limite = dentro
  });

  it("classifica como ABOVE_RULE quando cobrado excede tolerância positiva", () => {
    expect(classifyDeviation(15.1, 15)).toBe("ABOVE_RULE");
    expect(classifyDeviation(50, 15)).toBe("ABOVE_RULE");
  });

  it("classifica como BELOW_RULE quando cobrado muito abaixo do sugerido", () => {
    expect(classifyDeviation(-15.1, 15)).toBe("BELOW_RULE");
    expect(classifyDeviation(-50, 15)).toBe("BELOW_RULE");
  });

  it("respeita tolerância customizada", () => {
    expect(classifyDeviation(10, 5)).toBe("ABOVE_RULE");  // 10% > 5% de tolerância
    expect(classifyDeviation(4, 5)).toBe("WITHIN_RULE");  // 4% < 5% de tolerância
  });
});

// ──────────────────────────────────────────────
// isJustificationRequired
// ──────────────────────────────────────────────

describe("isJustificationRequired", () => {
  it("exige justificativa apenas para ABOVE_RULE", () => {
    expect(isJustificationRequired("ABOVE_RULE")).toBe(true);
  });

  it("não exige justificativa para WITHIN_RULE", () => {
    expect(isJustificationRequired("WITHIN_RULE")).toBe(false);
  });

  it("não exige justificativa para BELOW_RULE (subsídio é alerta, não bloqueio)", () => {
    expect(isJustificationRequired("BELOW_RULE")).toBe(false);
  });
});
