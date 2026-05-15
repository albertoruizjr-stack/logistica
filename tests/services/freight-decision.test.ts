import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyVehicle,
  calculateInternalCost,
  scoreDriverForDelivery,
  decideBestDeliveryOption,
  calculateCustomerPrice,
  makeFreightDecision,
} from "@/services/freight-decision.service";
import { InternalVehicleType, LalamoveServiceType } from "@/types";
import type { VehicleConfig, FreightDecisionInput } from "@/types";
import type { CostConfig } from "@/types";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: {
      findMany: vi.fn(),
    },
    freightZone: {
      findFirst: vi.fn(),
    },
    driver: {
      findMany: vi.fn(),
    },
    freightDecisionLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/route-resolver", () => ({
  resolveRoute: vi.fn(),
}));

vi.mock("@/services/lalamove.service", () => ({
  getLalamoveQuote: vi.fn(),
}));

import { prisma }           from "@/lib/prisma";
import { resolveRoute }     from "@/lib/route-resolver";
import { getLalamoveQuote } from "@/services/lalamove.service";

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

const CTX_DEFAULT = {
  driverEtaMin:         0,
  isSameDayAfterCutoff: false,
  dispatchWindow:       "FIRST_DISPATCH" as const,
};
const CTX_URGENT_AFTER_CUTOFF = {
  driverEtaMin:         0,
  isSameDayAfterCutoff: true,
  dispatchWindow:       "EXPRESS" as const,
};

const mockDriver = { id: "d1", name: "João", score: 80, minutesUntilFree: 0 };
const mockDriverBusy = { id: "d1", name: "João", score: 80, minutesUntilFree: 30 };

describe("decideBestDeliveryOption", () => {
  // Regra 0: same-day após corte → EXPRESS Lalamove obrigatório
  it("regra 0: same-day após 12h + Lalamove disponível → LALAMOVE express", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,
      internalCost: 50,
      lalamoveCost: 80,
      isUrgent: true,
      ctx: CTX_URGENT_AFTER_CUTOFF,
    });
    expect(r.mode).toBe("LALAMOVE");
    expect(r.reason).toContain("Same-day");
  });

  // Regra 1: Urgente + motorista ocupado → Lalamove
  it("regra 1: urgente com motorista ocupado > 20 min → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriverBusy,
      internalCost: 50,
      lalamoveCost: 40,
      isUrgent: true,
      ctx: CTX_DEFAULT,
    });
    expect(r.mode).toBe("LALAMOVE");
    expect(r.requiresManualAssignment).toBe(false);
  });

  // Regra 2: Motorista livre, score >= 60, custo interno ≤ Lalamove → INTERNAL
  it("regra 2: motorista livre com score >= 60 e mais barato → INTERNAL", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,
      internalCost: 35,
      lalamoveCost: 40,
      isUrgent: false,
      ctx: CTX_DEFAULT,
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.driverId).toBe("d1");
  });

  // Regra 2: Lalamove claramente mais barato (>10% economia) → LALAMOVE
  it("regra 2: Lalamove >10% mais barato → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: { id: "d1", name: "João", score: 70, minutesUntilFree: 0 },
      internalCost: 60,
      lalamoveCost: 30,  // 50% mais barato
      isUrgent: false,
      ctx: CTX_DEFAULT,
    });
    expect(r.mode).toBe("LALAMOVE");
  });

  // Regra 4: Sem motorista com score suficiente → LALAMOVE
  it("regra 4: nenhum motorista com score suficiente → LALAMOVE", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: null,
      internalCost: 35,
      lalamoveCost: 40,
      isUrgent: false,
      ctx: CTX_DEFAULT,
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
      ctx: CTX_DEFAULT,
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
      ctx: CTX_DEFAULT,
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.requiresManualAssignment).toBe(true);
  });

  // Consolidation note: D+1 com frota própria deve incluir sugestão
  it("D+1 com motorista bom inclui consolidationNote", () => {
    const r = decideBestDeliveryOption({
      internalVehicle: InternalVehicleType.FIORINO,
      lalamoveVehicle: LalamoveServiceType.UTILITARIO,
      bestDriver: mockDriver,
      internalCost: 35,
      lalamoveCost: 36,   // custo similar — interno vence
      isUrgent: false,
      ctx: { ...CTX_DEFAULT, dispatchWindow: "FIRST_DISPATCH" },
    });
    expect(r.mode).toBe("INTERNAL");
    expect(r.consolidationNote).toBeDefined();
  });
});

describe("calculateCustomerPrice (Fase 2 — tabela zonal fechada)", () => {
  // Zona com express explícito (formato novo migration_fase1)
  const zoneNova = { basePrice: 22, expressBasePrice: 35 };
  // Zona legada sem express (cai pra urgentFactor)
  const zoneLegada = { basePrice: 25, urgentFactor: 1.8 };

  it("normal → retorna basePrice direto", () => {
    expect(calculateCustomerPrice({ zone: zoneNova, isUrgent: false })).toBe(22);
  });

  it("urgente com expressBasePrice → retorna express absoluto", () => {
    expect(calculateCustomerPrice({ zone: zoneNova, isUrgent: true })).toBe(35);
  });

  it("urgente sem expressBasePrice → aplica urgentFactor legado", () => {
    // 25 × 1.8 = 45
    expect(calculateCustomerPrice({ zone: zoneLegada, isUrgent: true })).toBeCloseTo(45, 2);
  });

  it("urgente sem urgentFactor nem expressBasePrice → fallback urgencySurcharge", () => {
    const zoneSemFactor = { basePrice: 20 };
    expect(calculateCustomerPrice({
      zone: zoneSemFactor, isUrgent: true, urgencySurcharge: 1.3,
    })).toBeCloseTo(26, 2);
  });

  it("zona null → retorna 0 (sob consulta)", () => {
    expect(calculateCustomerPrice({ zone: null, isUrgent: false })).toBe(0);
  });

  it("compat: params antigos (internalCost, lalamoveCost, etc.) são ignorados", () => {
    // Garante que código existente que passa esses params não quebra
    expect(calculateCustomerPrice({
      zone: zoneNova,
      isUrgent: false,
      internalCost: 999,            // ignorado
      lalamoveCost: 999,            // ignorado
      selectedMode: "INTERNAL",     // ignorado
      internalVehicle: InternalVehicleType.FIORINO, // ignorado
      urgencySurcharge: 99,         // ignorado quando há expressBasePrice
    })).toBe(22);
  });
});

describe("makeFreightDecision (integração com mocks)", () => {
  const baseInput: FreightDecisionInput = {
    originLat: -23.62, originLng: -46.70,
    destLat:   -23.60, destLng:   -46.73,
    isUrgent:  false,
    deliveryDate:        new Date(),
    deliveryWindowStart: new Date(),
    deliveryWindowEnd:   new Date(),
    items: [{ productCode: "T01", quantity: 2, weightKg: 30, latas: 1 }],
    sellerId: "seller1",
    storeId:  "store1",
  };

  beforeEach(() => {
    vi.mocked(prisma.systemConfig.findMany).mockResolvedValue([
      { id: "1",  key: "COST_PER_KM",                value: "1.50",  type: "number", label: "x", updatedAt: new Date() },
      { id: "2",  key: "COST_PER_HOUR",              value: "30.00", type: "number", label: "x", updatedAt: new Date() },
      { id: "3",  key: "FIXED_ROUTE_COST",           value: "8.00",  type: "number", label: "x", updatedAt: new Date() },
      { id: "4",  key: "INTERNAL_MOTO_MAX_KG",       value: "20",    type: "number", label: "x", updatedAt: new Date() },
      { id: "5",  key: "INTERNAL_FIORINO_MAX_KG",    value: "500",   type: "number", label: "x", updatedAt: new Date() },
      { id: "6",  key: "INTERNAL_FIORINO_MAX_LATAS", value: "20",    type: "number", label: "x", updatedAt: new Date() },
      { id: "7",  key: "INTERNAL_CAMINHAO_MAX_KG",   value: "1500",  type: "number", label: "x", updatedAt: new Date() },
      { id: "8",  key: "INTERNAL_CAMINHAO_MAX_LATAS", value: "67",   type: "number", label: "x", updatedAt: new Date() },
      { id: "9",  key: "LALA_LALAPRO_MAX_KG",        value: "20",    type: "number", label: "x", updatedAt: new Date() },
      { id: "10", key: "LALA_UTILITARIO_MAX_KG",     value: "500",   type: "number", label: "x", updatedAt: new Date() },
      { id: "11", key: "LALA_VAN_MAX_KG",            value: "1000",  type: "number", label: "x", updatedAt: new Date() },
      { id: "12", key: "LALA_CARRETO_MAX_KG",        value: "1500",  type: "number", label: "x", updatedAt: new Date() },
      { id: "13", key: "LALA_CAMINHAO_MAX_KG",       value: "2500",  type: "number", label: "x", updatedAt: new Date() },
      { id: "14", key: "URGENCY_SURCHARGE_MIN",      value: "1.30",  type: "number", label: "x", updatedAt: new Date() },
      { id: "15", key: "DRIVER_MAX_LOCATION_AGE_MIN", value: "30",   type: "number", label: "x", updatedAt: new Date() },
    ]);

    vi.mocked(resolveRoute).mockResolvedValue({
      distanceKm: 8, durationMin: 20, durationInTrafficMin: 25,
      isApproximate: false, isTrafficFresh: true,
    });

    vi.mocked(prisma.driver.findMany).mockResolvedValue([
      {
        id: "d1", name: "João", active: true, available: true,
        storeId: "store1", vehicleType: "van", licensePlate: "ABC-0670",
        phone: "11999990001", createdAt: new Date(), updatedAt: new Date(),
        locations: [{ id: "l1", driverId: "d1", lat: -23.62, lng: -46.70, timestamp: new Date(), createdAt: new Date() }],
        dispatches: [],
      },
    ] as any);

    vi.mocked(prisma.freightZone.findFirst).mockResolvedValue({
      id: "z1", name: "Zona 1", minKm: 0, maxKm: 12, basePrice: 25,
      urgentFactor: 1.8, underConsultation: false, active: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as any);

    vi.mocked(getLalamoveQuote).mockResolvedValue({
      quotationId: "q1",
      priceBreakdown: { total: "40.00", base: "35.00", totalBeforeOptimization: "40.00", currency: "BRL" },
      scheduleAt: "", serviceType: "VAN", specialRequests: [], expiresAt: "", stops: [],
    });
  });

  it("retorna resultado completo com modo, veículo, custos e preço", async () => {
    const result = await makeFreightDecision(baseInput);

    expect(result.distanceKm).toBe(8);
    expect(result.internalCost).toBeGreaterThan(0);
    expect(result.suggestedPrice).toBeGreaterThan(0);
    expect(["INTERNAL", "LALAMOVE"]).toContain(result.selectedMode);
    expect(result.decisionReason.length).toBeGreaterThan(0);
    expect(result.requiresManualAssignment).toBe(false);
  });

  it("quando Lalamove lança erro, continua com modo interno", async () => {
    vi.mocked(getLalamoveQuote).mockRejectedValue(new Error("API timeout"));
    const result = await makeFreightDecision(baseInput);
    expect(result.lalamoveCost).toBeNull();
    expect(result.selectedMode).toBe("INTERNAL");
  });
});
