// services/freight-decision.service.ts
// Motor de decisão logística: classifica carga, calcula custos, decide modal.
// Funções puras recebem configs como parâmetro — sem Prisma — para facilitar testes.

import { InternalVehicleType, LalamoveServiceType } from "@/types";
import type {
  FreightDecisionInput,
  VehicleConfig,
  CostConfig,
} from "@/types";
import { calculateHaversineDistance } from "@/lib/utils";

// ──────────────────────────────────────────────
// PASSO 1 — CLASSIFICAÇÃO DA CARGA
// ──────────────────────────────────────────────

export interface CargoClassification {
  internalVehicle: InternalVehicleType | "EXCEPTION";
  lalamoveVehicle: LalamoveServiceType | "EXCEPTION";
  totalWeightKg:   number;
  totalLatas:      number;
}

export function classifyVehicle(
  items: FreightDecisionInput["items"],
  config: VehicleConfig
): CargoClassification {
  const totalWeightKg = items.reduce((s, i) => s + i.weightKg * i.quantity, 0);
  const totalLatas    = items.reduce((s, i) => s + (i.latas ?? 0) * i.quantity, 0);

  // Frota própria: peso E latas (ambos devem caber)
  let internalVehicle: InternalVehicleType | "EXCEPTION";
  const latasOk = (max: number) => totalLatas === 0 || totalLatas <= max;

  if (totalWeightKg <= config.INTERNAL_MOTO_MAX_KG) {
    // MOTO: sem limite de latas — peso é o único critério (regra de negócio)
    internalVehicle = InternalVehicleType.MOTO;
  } else if (totalWeightKg <= config.INTERNAL_FIORINO_MAX_KG && latasOk(config.INTERNAL_FIORINO_MAX_LATAS)) {
    internalVehicle = InternalVehicleType.FIORINO;
  } else if (totalWeightKg <= config.INTERNAL_CAMINHAO_MAX_KG && latasOk(config.INTERNAL_CAMINHAO_MAX_LATAS)) {
    internalVehicle = InternalVehicleType.CAMINHAO;
  } else {
    internalVehicle = "EXCEPTION";
  }

  // Lalamove: apenas peso
  let lalamoveVehicle: LalamoveServiceType | "EXCEPTION";
  if      (totalWeightKg <= config.LALA_LALAPRO_MAX_KG)    lalamoveVehicle = LalamoveServiceType.LALAPRO;
  else if (totalWeightKg <= config.LALA_UTILITARIO_MAX_KG) lalamoveVehicle = LalamoveServiceType.UTILITARIO;
  else if (totalWeightKg <= config.LALA_VAN_MAX_KG)        lalamoveVehicle = LalamoveServiceType.VAN;
  else if (totalWeightKg <= config.LALA_CARRETO_MAX_KG)    lalamoveVehicle = LalamoveServiceType.CARRETO;
  else if (totalWeightKg <= config.LALA_CAMINHAO_MAX_KG)   lalamoveVehicle = LalamoveServiceType.CAMINHAO;
  else                                                      lalamoveVehicle = "EXCEPTION";

  return { internalVehicle, lalamoveVehicle, totalWeightKg, totalLatas };
}

// ──────────────────────────────────────────────
// PASSO 3 — CUSTO DE ROTA INTERNA
// Custo flat — não varia por tipo de veículo.
// ──────────────────────────────────────────────

export function calculateInternalCost(
  route: { distanceKm: number; durationMin: number },
  config: CostConfig
): number {
  return (
    config.FIXED_ROUTE_COST +
    route.distanceKm * config.COST_PER_KM +
    (route.durationMin / 60) * config.COST_PER_HOUR
  );
}

// ──────────────────────────────────────────────
// PASSO 5 — SCORE DE MOTORISTA (0-100)
// ──────────────────────────────────────────────

export interface DriverCandidate {
  lastLat:          number | null;
  lastLng:          number | null;
  activeDispatches: number;
}

const MAX_PROXIMITY_KM = 20; // distâncias além disso valem 0 pts de proximidade

export function scoreDriverForDelivery(
  driver:    DriverCandidate,
  originLat: number,
  originLng: number,
  destLat:   number,
  destLng:   number
): number {
  if (driver.lastLat === null || driver.lastLng === null) return 0;

  const dOrigin = calculateHaversineDistance(driver.lastLat, driver.lastLng, originLat, originLng);
  const dDest   = calculateHaversineDistance(driver.lastLat, driver.lastLng, destLat, destLng);

  const originScore   = Math.max(0, 40 * (1 - dOrigin / MAX_PROXIMITY_KM));
  const destScore     = Math.max(0, 30 * (1 - dDest   / MAX_PROXIMITY_KM));
  const dispatchScore = driver.activeDispatches === 0 ? 30 : driver.activeDispatches === 1 ? 15 : 0;

  return Math.round(originScore + destScore + dispatchScore);
}
