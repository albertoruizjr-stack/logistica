import { describe, it, expect } from "vitest";
import { scoreDriverWithETA, computeMinutesUntilFree } from "@/services/driver-eta.service";

describe("scoreDriverWithETA", () => {
  it("retorna 0 quando motorista leva mais de 45 min para ficar livre", () => {
    expect(scoreDriverWithETA(46, 2, 0)).toBe(0);
    expect(scoreDriverWithETA(60, 0, 0)).toBe(0);
  });

  it("retorna 0 quando motorista está a mais de 18 km da origem", () => {
    expect(scoreDriverWithETA(0, 19, 0)).toBe(0);
    expect(scoreDriverWithETA(10, 20, 1)).toBe(0);
  });

  it("score máximo = 100 para motorista livre, próximo e sem carga", () => {
    // minutesUntilFree=0: avail=45, dOriginKm=0: proximity=35, load=0: loadScore=20 → 100
    expect(scoreDriverWithETA(0, 0, 0)).toBe(100);
  });

  it("score decresce conforme o motorista demora mais para ficar livre", () => {
    const s0  = scoreDriverWithETA(0,  0, 0);
    const s20 = scoreDriverWithETA(20, 0, 0);
    const s40 = scoreDriverWithETA(40, 0, 0);
    expect(s0).toBeGreaterThan(s20);
    expect(s20).toBeGreaterThan(s40);
  });

  it("score decresce conforme aumenta distância até a origem", () => {
    const s0  = scoreDriverWithETA(0, 0,  0);
    const s10 = scoreDriverWithETA(0, 10, 0);
    const s17 = scoreDriverWithETA(0, 17, 0);
    expect(s0).toBeGreaterThan(s10);
    expect(s10).toBeGreaterThan(s17);
  });

  it("penalidade correta por carga: 0→20, 1→10, 2→4, 3+→0", () => {
    // Fixa minutesUntilFree=0 e dOriginKm=0 para isolar loadScore
    const base = 45 + 35; // availScore + proximityScore com (0, 0)
    expect(scoreDriverWithETA(0, 0, 0)).toBe(base + 20);
    expect(scoreDriverWithETA(0, 0, 1)).toBe(base + 10);
    expect(scoreDriverWithETA(0, 0, 2)).toBe(base +  4);
    expect(scoreDriverWithETA(0, 0, 3)).toBe(base +  0);
  });
});

describe("computeMinutesUntilFree", () => {
  const now = new Date("2026-05-11T10:00:00Z");

  it("retorna 0 quando não há despachos ativos", () => {
    expect(computeMinutesUntilFree([], now)).toBe(0);
  });

  it("calcula restante corretamente para entrega em trânsito há 15 min (duração 40 min + 10 buffer)", () => {
    const dispatchedAt = new Date("2026-05-11T09:45:00Z"); // 15 min atrás
    const dispatches = [{ status: "IN_TRANSIT", dispatchedAt, durationMin: 40 }];
    // elapsed=15, total=40+10=50, remaining=35
    const result = computeMinutesUntilFree(dispatches, now);
    expect(result).toBeCloseTo(35, 0);
  });

  it("retorna 0 quando entrega já deveria ter terminado (elapsed > total)", () => {
    const dispatchedAt = new Date("2026-05-11T08:00:00Z"); // 120 min atrás
    const dispatches = [{ status: "IN_TRANSIT", dispatchedAt, durationMin: 40 }];
    // elapsed=120, total=50 → remaining=0
    expect(computeMinutesUntilFree(dispatches, now)).toBe(0);
  });

  it("encadeia dois despachos: IN_TRANSIT restante + ASSIGNED completo", () => {
    const dispatchedAt = new Date("2026-05-11T09:45:00Z"); // 15 min atrás
    const dispatches = [
      { status: "IN_TRANSIT", dispatchedAt, durationMin: 40 }, // 35 min restando
      { status: "ASSIGNED",   dispatchedAt: null, durationMin: 30 }, // + 30+10 = 40 min
    ];
    // 35 + 40 = 75 min
    const result = computeMinutesUntilFree(dispatches, now);
    expect(result).toBeCloseTo(75, 0);
  });

  it("usa FALLBACK_DURATION_MIN=45 quando durationMin é null", () => {
    const dispatchedAt = new Date("2026-05-11T09:45:00Z");
    const dispatches = [{ status: "IN_TRANSIT", dispatchedAt, durationMin: null }];
    // elapsed=15, total=45+10=55, remaining=40
    const result = computeMinutesUntilFree(dispatches, now);
    expect(result).toBeCloseTo(40, 0);
  });
});
