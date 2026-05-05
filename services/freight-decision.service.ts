// services/freight-decision.service.ts
// Motor de decisão logística: classifica carga, calcula custos, decide modal.
// Funções puras recebem configs como parâmetro — sem Prisma — para facilitar testes.

import { InternalVehicleType, LalamoveServiceType } from "@/types";
import { prisma } from "@/lib/prisma";
import { DispatchStatus } from "@prisma/client";
import type {
  FreightDecisionInput,
  VehicleConfig,
  CostConfig,
  LalamoveStop,
  FreightDecisionResult,
} from "@/types";
import { calculateHaversineDistance } from "@/lib/utils";
import { INTERNAL_VEHICLE_MARGINS, LALAMOVE_PRICE_MARGIN } from "@/lib/constants";
import { resolveRoute }       from "@/lib/route-resolver";
import { getLalamoveQuote }   from "@/services/lalamove.service";

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

// ──────────────────────────────────────────────
// PASSO 7 — DECISÃO DE MODAL (6 regras de prioridade)
// ──────────────────────────────────────────────

export interface DecisionParams {
  internalVehicle: InternalVehicleType | "EXCEPTION";
  lalamoveVehicle: LalamoveServiceType | "EXCEPTION";
  bestDriver: { id: string; name: string; score: number } | null;
  internalCost: number;
  lalamoveCost: number | null;
  isUrgent:     boolean;
}

export interface ModalDecisionResult {
  mode:                     "INTERNAL" | "LALAMOVE";
  vehicle:                  InternalVehicleType | LalamoveServiceType;
  driverId?:                string;
  requiresManualAssignment: boolean;
  reason:                   string;
}

export function decideBestDeliveryOption(p: DecisionParams): ModalDecisionResult {
  const internalOk = p.internalVehicle !== "EXCEPTION" && p.bestDriver !== null;
  const lalamoveOk = p.lalamoveVehicle !== "EXCEPTION" && p.lalamoveCost !== null;

  // Regra 1: urgente + Lalamove disponível e não muito mais caro → Lalamove
  if (p.isUrgent && lalamoveOk && p.lalamoveCost! < p.internalCost * 1.2) {
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: `Urgente — Lalamove (R$ ${p.lalamoveCost!.toFixed(2)}) preferido vs interno (R$ ${p.internalCost.toFixed(2)})`,
    };
  }

  // Regra 2: motorista com score ≥ 60 e custo interno ≤ Lalamove → interno
  if (internalOk && p.bestDriver!.score >= 60 && (!lalamoveOk || p.internalCost <= p.lalamoveCost!)) {
    return {
      mode: "INTERNAL",
      vehicle: p.internalVehicle as InternalVehicleType,
      driverId: p.bestDriver!.id,
      requiresManualAssignment: false,
      reason: `${p.bestDriver!.name} disponível (score ${p.bestDriver!.score}) — custo interno R$ ${p.internalCost.toFixed(2)}`,
    };
  }

  // Regra 3: Lalamove mais barato
  if (lalamoveOk && internalOk && p.lalamoveCost! < p.internalCost) {
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: `Lalamove (R$ ${p.lalamoveCost!.toFixed(2)}) mais econômico que rota interna (R$ ${p.internalCost.toFixed(2)})`,
    };
  }

  // Regra 4: sem motorista → Lalamove
  if (!internalOk && lalamoveOk) {
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: "Nenhum motorista disponível — usando Lalamove",
    };
  }

  // Regra 5: Lalamove indisponível + motorista disponível → interno
  if (internalOk && !lalamoveOk) {
    return {
      mode: "INTERNAL",
      vehicle: p.internalVehicle as InternalVehicleType,
      driverId: p.bestDriver!.id,
      requiresManualAssignment: false,
      reason: "Lalamove indisponível — usando rota interna",
    };
  }

  // Regra 6: nada disponível → interno com atribuição manual
  return {
    mode: "INTERNAL",
    vehicle: InternalVehicleType.FIORINO,
    requiresManualAssignment: true,
    reason: "Nenhum recurso disponível — requer atribuição manual pelo operador",
  };
}

// ──────────────────────────────────────────────
// PASSO 8 — PREÇO SUGERIDO AO CLIENTE
// MAX(zona, custo_real × margem) + sobretaxa de urgência
// ──────────────────────────────────────────────

export function calculateCustomerPrice(params: {
  zone:             { basePrice: number } | null;
  internalCost:     number;
  lalamoveCost:     number | null;
  selectedMode:     "INTERNAL" | "LALAMOVE";
  internalVehicle:  InternalVehicleType | "EXCEPTION";
  isUrgent:         boolean;
  urgencySurcharge: number;
}): number {
  const { zone, internalCost, lalamoveCost, selectedMode, internalVehicle, isUrgent, urgencySurcharge } = params;

  let basePrice: number;

  if (selectedMode === "INTERNAL" && internalVehicle !== "EXCEPTION") {
    const margin = INTERNAL_VEHICLE_MARGINS[internalVehicle] ?? 1.3;
    basePrice = Math.max(zone?.basePrice ?? 0, internalCost * margin);
  } else {
    const lalamoveBase = lalamoveCost != null ? lalamoveCost * LALAMOVE_PRICE_MARGIN : 0;
    basePrice = Math.max(zone?.basePrice ?? 0, lalamoveBase);
  }

  return isUrgent ? basePrice * urgencySurcharge : basePrice;
}

// ──────────────────────────────────────────────
// PASSO 4 — MOTORISTAS DISPONÍVEIS
// ──────────────────────────────────────────────

export interface AvailableDriver {
  id:               string;
  name:             string;
  lastLat:          number | null;
  lastLng:          number | null;
  activeDispatches: number;
}

export async function getAvailableDrivers(
  storeId:           string,
  maxLocationAgeMin: number
): Promise<AvailableDriver[]> {
  const cutoff = new Date(Date.now() - maxLocationAgeMin * 60 * 1000);

  const drivers = await prisma.driver.findMany({
    where: { storeId, active: true, available: true },
    include: {
      locations: {
        where:   { timestamp: { gte: cutoff } },
        orderBy: { timestamp: "desc" },
        take:    1,
      },
      dispatches: {
        where:  { status: { in: [DispatchStatus.PENDING, DispatchStatus.ASSIGNED, DispatchStatus.IN_TRANSIT] } },
        select: { id: true },
      },
    },
  });

  return drivers.map((d) => ({
    id:               d.id,
    name:             d.name,
    lastLat:          d.locations[0]?.lat ?? null,
    lastLng:          d.locations[0]?.lng ?? null,
    activeDispatches: d.dispatches.length,
  }));
}

// ──────────────────────────────────────────────
// ORQUESTRADOR PRINCIPAL
// ──────────────────────────────────────────────

const DECISION_CONFIG_KEYS = [
  "COST_PER_KM", "COST_PER_HOUR", "FIXED_ROUTE_COST",
  "INTERNAL_MOTO_MAX_KG", "INTERNAL_FIORINO_MAX_KG", "INTERNAL_FIORINO_MAX_LATAS",
  "INTERNAL_CAMINHAO_MAX_KG", "INTERNAL_CAMINHAO_MAX_LATAS",
  "LALA_LALAPRO_MAX_KG", "LALA_UTILITARIO_MAX_KG", "LALA_VAN_MAX_KG",
  "LALA_CARRETO_MAX_KG", "LALA_CAMINHAO_MAX_KG",
  "URGENCY_SURCHARGE_MIN", "DRIVER_MAX_LOCATION_AGE_MIN",
] as const;

export async function makeFreightDecision(
  input: FreightDecisionInput
): Promise<FreightDecisionResult> {
  // 1. Configs em uma query
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: [...DECISION_CONFIG_KEYS] } },
  });
  const cfg = Object.fromEntries(rows.map((r) => [r.key, parseFloat(r.value)])) as unknown as
    VehicleConfig & CostConfig & { URGENCY_SURCHARGE_MIN: number; DRIVER_MAX_LOCATION_AGE_MIN: number };

  // 2. Classificação da carga
  const cargo = classifyVehicle(input.items, cfg);

  // 3. Rota
  const route = await resolveRoute(input.originLat, input.originLng, input.destLat, input.destLng);

  // 4. Custo interno
  const internalCost = calculateInternalCost(route, cfg);

  // 5. Motoristas disponíveis (só se frota própria é viável)
  const driverCandidates = cargo.internalVehicle !== "EXCEPTION"
    ? await getAvailableDrivers(input.storeId, cfg.DRIVER_MAX_LOCATION_AGE_MIN ?? 30)
    : [];

  const scoredDrivers = driverCandidates
    .map((d) => ({ ...d, score: scoreDriverForDelivery(d, input.originLat, input.originLng, input.destLat, input.destLng) }))
    .sort((a, b) => b.score - a.score);
  const bestDriver = scoredDrivers[0] ?? null;

  // 6. Cotação Lalamove (não bloqueia em caso de erro)
  let lalamoveCost: number | null = null;
  let lalamoveQuote: FreightDecisionResult["lalamoveQuote"] | undefined;

  if (cargo.lalamoveVehicle !== "EXCEPTION") {
    try {
      const origin: LalamoveStop = {
        coordinates: { lat: String(input.originLat), lng: String(input.originLng) },
        address: "",
      };
      const dest: LalamoveStop = {
        coordinates: { lat: String(input.destLat), lng: String(input.destLng) },
        address: "",
      };
      // cargo.lalamoveVehicle já é o código da API (ex: "MOTORCYCLE", "VAN")
      const serviceType = cargo.lalamoveVehicle;
      const quote = await getLalamoveQuote(origin, dest, input.isUrgent, serviceType);
      if (!("reason" in quote)) {
        lalamoveCost = parseFloat(quote.priceBreakdown.total);
        lalamoveQuote = {
          quotationId:    quote.quotationId,
          estimatedPrice: lalamoveCost,
          serviceType:    cargo.lalamoveVehicle,
        };
      }
    } catch {
      // Lalamove indisponível — decisão continua sem cotação externa
    }
  }

  // 7. Decisão de modal
  const decision = decideBestDeliveryOption({
    internalVehicle: cargo.internalVehicle,
    lalamoveVehicle: cargo.lalamoveVehicle,
    bestDriver,
    internalCost,
    lalamoveCost,
    isUrgent: input.isUrgent,
  });

  // 8. Zona de frete + preço ao cliente
  const zone = await prisma.freightZone.findFirst({
    where: {
      active: true,
      minKm:  { lte: route.distanceKm },
      OR:     [{ maxKm: null }, { maxKm: { gt: route.distanceKm } }],
    },
    orderBy: { minKm: "asc" },
  });

  const suggestedPrice = calculateCustomerPrice({
    zone,
    internalCost,
    lalamoveCost,
    selectedMode:     decision.mode,
    internalVehicle:  cargo.internalVehicle,
    isUrgent:         input.isUrgent,
    urgencySurcharge: cfg.URGENCY_SURCHARGE_MIN ?? 1.3,
  });

  const result: FreightDecisionResult = {
    selectedMode:             decision.mode,
    selectedVehicle:          decision.vehicle,
    driverId:                 decision.driverId,
    requiresManualAssignment: decision.requiresManualAssignment,
    lalamoveQuote,
    distanceKm:      route.distanceKm,
    durationMinutes: route.durationMin,
    isApproximate:   route.isApproximate,
    internalCost,
    lalamoveCost,
    suggestedPrice,
    decisionReason: decision.reason,
  };

  // 9. Log assíncrono — não bloqueia a resposta
  // Log assíncrono: void intencional — não bloqueia resposta.
  // Em Vercel serverless, usar next/server `after()` (Next 15) se precisar de garantia de entrega.
  void prisma.freightDecisionLog.create({
    data: {
      storeId:         input.storeId,
      selectedMode:    decision.mode,
      selectedVehicle: String(decision.vehicle),
      driverId:        decision.driverId,
      distanceKm:      route.distanceKm,
      durationMin:     route.durationMin,
      internalCost,
      lalamoveCost,
      suggestedPrice,
      decisionReason:  decision.reason,
      isUrgent:        input.isUrgent,
      isApproximate:   route.isApproximate,
      totalWeightKg:   cargo.totalWeightKg,
      totalLatas:      cargo.totalLatas || null,
    },
  }).catch((err: unknown) => console.error("[FreightDecision] log error:", err));

  return result;
}
