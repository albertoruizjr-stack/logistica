import { describe, it, expect } from "vitest";
import {
  classifyVehicle,
  calculateInternalCost,
  scoreDriverForDelivery,
  decideBestDeliveryOption,
} from "@/services/freight-decision.service";
import { InternalVehicleType, LalamoveServiceType } from "@/types";
import type { VehicleConfig } from "@/types";
import type { CostConfig } from "@/types";

const defaultVehicleConfig: VehicleConfig = {
  INTERNAL_MOTO_MAX_KG:        20,
  INTERNAL_FIORINO_MAX_KG:     500,
  INTERNAL_FIORINO_MAX_LATAS:  20,
  INTERNAL_CAMINHAO_MAX_KG:    1500,
  INTERNAL_CAMINHAO_MAX_LATAS: 67,
  LALA_LALAPRO_MAX_KG:         20,
  LALA_UTILITARIO_MAX_KG:      500,
  LALA_VAN_MAX_KG:             1000,
  LALA_CARRETO_MAX_KG:         1500,
  LALA_CAMINHAO_MAX_KG:        2500,
};

describe("classifyVehicle", () => {
  it("5 kg → MOTO interno, LALAPRO Lalamove", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 1, weightKg: 5 }], defaultVehicleConfig);
    expect(r.internalVehicle).toBe(InternalVehicleType.MOTO);
    expect(r.lalamoveVehicle).toBe(LalamoveServiceType.LALAPRO);
    expect(r.totalWeightKg).toBe(5);
  });

  it("100 kg → FIORINO interno, UTILITARIO Lalamove", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 2, weightKg: 50 }], defaultVehicleConfig);
    expect(r.internalVehicle).toBe(InternalVehicleType.FIORINO);
    expect(r.lalamoveVehicle).toBe(LalamoveServiceType.UTILITARIO);
    expect(r.totalWeightKg).toBe(100);
  });

  it("700 kg → CAMINHAO interno, VAN Lalamove", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 1, weightKg: 700 }], defaultVehicleConfig);
    expect(r.internalVehicle).toBe(InternalVehicleType.CAMINHAO);
    expect(r.lalamoveVehicle).toBe(LalamoveServiceType.VAN);
  });

  it("21 latas mas 420 kg → excede limite de latas do FIORINO → CAMINHAO interno", () => {
    const r = classifyVehicle(
      [{ productCode: "T01", quantity: 21, weightKg: 20, latas: 1 }],
      defaultVehicleConfig
    );
    expect(r.internalVehicle).toBe(InternalVehicleType.CAMINHAO);
    expect(r.totalLatas).toBe(21);
  });

  it("68 latas → excede limite de latas do CAMINHAO → EXCEPTION interno", () => {
    const r = classifyVehicle(
      [{ productCode: "T01", quantity: 68, weightKg: 20, latas: 1 }],
      defaultVehicleConfig
    );
    expect(r.internalVehicle).toBe("EXCEPTION");
  });

  it("2600 kg → EXCEPTION interno e EXCEPTION Lalamove", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 1, weightKg: 2600 }], defaultVehicleConfig);
    expect(r.internalVehicle).toBe("EXCEPTION");
    expect(r.lalamoveVehicle).toBe("EXCEPTION");
  });

  it("sem latas informadas → usa apenas peso para frota própria", () => {
    const r = classifyVehicle([{ productCode: "T01", quantity: 100, weightKg: 4 }], defaultVehicleConfig);
    // 400 kg sem latas → não bloqueia por latas
    expect(r.internalVehicle).toBe(InternalVehicleType.FIORINO);
    expect(r.totalLatas).toBe(0);
  });
});

const defaultCostConfig: CostConfig = {
  COST_PER_KM:      1.50,
  COST_PER_HOUR:    30.00,
  FIXED_ROUTE_COST:  8.00,
};

describe("calculateInternalCost", () => {
  it("10 km, 20 min → 8 + 15 + 10 = 33", () => {
    const cost = calculateInternalCost({ distanceKm: 10, durationMin: 20 }, defaultCostConfig);
    expect(cost).toBeCloseTo(33, 2); // 8 + (10×1.5) + (20/60×30)
  });

  it("0 km, 0 min → apenas custo fixo", () => {
    const cost = calculateInternalCost({ distanceKm: 0, durationMin: 0 }, defaultCostConfig);
    expect(cost).toBeCloseTo(8, 2);
  });

  it("respeita configs customizadas", () => {
    const cfg: CostConfig = { COST_PER_KM: 2, COST_PER_HOUR: 60, FIXED_ROUTE_COST: 10 };
    const cost = calculateInternalCost({ distanceKm: 5, durationMin: 30 }, cfg);
    expect(cost).toBeCloseTo(10 + 10 + 30, 2); // 10 + (5×2) + (30/60×60)
  });
});

describe("scoreDriverForDelivery", () => {
  const origin = { lat: -23.62, lng: -46.70 };
  const dest   = { lat: -23.60, lng: -46.73 };

  it("motorista sem localização → score 0", () => {
    const score = scoreDriverForDelivery(
      { lastLat: null, lastLng: null, activeDispatches: 0 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score).toBe(0);
  });

  it("motorista na origem, 0 dispatches → score alto (≥ 60)", () => {
    const score = scoreDriverForDelivery(
      { lastLat: origin.lat, lastLng: origin.lng, activeDispatches: 0 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("motorista longe (30 km), 2 dispatches → score baixo (< 30)", () => {
    const score = scoreDriverForDelivery(
      { lastLat: -23.00, lastLng: -46.00, activeDispatches: 2 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score).toBeLessThan(30);
  });

  it("2 dispatches ativos → perde os 30 pts de disponibilidade", () => {
    const score0 = scoreDriverForDelivery(
      { lastLat: origin.lat, lastLng: origin.lng, activeDispatches: 0 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    const score2 = scoreDriverForDelivery(
      { lastLat: origin.lat, lastLng: origin.lng, activeDispatches: 2 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score0 - score2).toBeCloseTo(30, 0);
  });

  it("score sempre entre 0 e 100", () => {
    const score = scoreDriverForDelivery(
      { lastLat: origin.lat, lastLng: origin.lng, activeDispatches: 0 },
      origin.lat, origin.lng, dest.lat, dest.lng
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

const mockDriver = { id: "d1", name: "João", score: 80 };

describe("decideBestDeliveryOption", () => {
  // Regra 1: Urgente + Lalamove mais barato → Lalamove
  it("regra 1: urgente com Lalamove barato → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,
      internalCost: 50,
      lalamoveCost: 40,  // < 50 × 1.2 = 60
      isUrgent: true,
    });
    expect(r.mode).toBe("LALAMOVE");
    expect(r.requiresManualAssignment).toBe(false);
  });

  // Regra 2: Motorista bom + custo interno ≤ Lalamove → INTERNAL
  it("regra 2: motorista score >= 60 e mais barato → INTERNAL", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,  // score 80
      internalCost: 35,
      lalamoveCost: 40,
      isUrgent: false,
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.driverId).toBe("d1");
  });

  // Regra 3: Lalamove mais barato → LALAMOVE
  it("regra 3: Lalamove mais barato que interno → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: { id: "d1", name: "João", score: 70 },
      internalCost: 60,
      lalamoveCost: 30,
      isUrgent: false,
    });
    expect(r.mode).toBe("LALAMOVE");
  });

  // Regra 4: Sem motorista disponível → LALAMOVE
  it("regra 4: nenhum motorista disponível → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: null,
      internalCost: 35,
      lalamoveCost: 40,
      isUrgent: false,
    });
    expect(r.mode).toBe("LALAMOVE");
  });

  // Regra 5: Lalamove indisponível + motorista disponível → INTERNAL
  it("regra 5: Lalamove indisponível → INTERNAL", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,
      internalCost: 35,
      lalamoveCost: null,
      isUrgent: false,
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.requiresManualAssignment).toBe(false);
  });

  // Regra 6: Nada disponível → INTERNAL com atribuição manual
  it("regra 6: nenhum recurso → INTERNAL com requiresManualAssignment", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: null,
      internalCost: 35,
      lalamoveCost: null,
      isUrgent: false,
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.requiresManualAssignment).toBe(true);
  });
});
