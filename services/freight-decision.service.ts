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
  DecisionContext,
} from "@/types";
import { calculateHaversineDistance } from "@/lib/utils";
import { INTERNAL_VEHICLE_MARGINS, LALAMOVE_PRICE_MARGIN } from "@/lib/constants";
import { resolveRoute }          from "@/lib/route-resolver";
import { getLalamoveQuote }      from "@/services/lalamove.service";
import { getDriversWithETA }     from "@/services/driver-eta.service";

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
  bestDriver: {
    id: string;
    name: string;
    score: number;
    minutesUntilFree: number;
    etaToOriginMin?: number | null;  // tempo de carro do driver até a loja (Routes API, com trânsito)
  } | null;
  internalCost: number;
  lalamoveCost: number | null;
  isUrgent:     boolean;
  ctx:          DecisionContext;  // contexto de tempo/janela de despacho
}

export interface ModalDecisionResult {
  mode:                     "INTERNAL" | "LALAMOVE";
  vehicle:                  InternalVehicleType | LalamoveServiceType;
  driverId?:                string;
  requiresManualAssignment: boolean;
  reason:                   string;
  consolidationNote?:       string;  // sugestão de consolidação para D+1
}

// Threshold: acima deste tempo de espera, não compensa aguardar frota própria em entrega urgente
const MAX_URGENT_WAIT_MIN = 20;
// Tempo médio que Lalamove leva pra um pickup chegar à loja em SP urbano
const LALAMOVE_PICKUP_MIN = 15;

// Tempo TOTAL até o motorista interno chegar na loja pronto pra sair com o pedido.
// = tempo pra liberar das entregas atuais + tempo de deslocamento até a loja.
// Quando não há GPS, etaToOriginMin é null → usa só minutesUntilFree (mais permissivo
// pra preservar comportamento anterior em drivers sem rastreamento).
function totalInternalReadyMin(d: NonNullable<DecisionParams["bestDriver"]>): number {
  return d.minutesUntilFree + (d.etaToOriginMin ?? 0);
}

export function decideBestDeliveryOption(p: DecisionParams): ModalDecisionResult {
  const internalOk = p.internalVehicle !== "EXCEPTION" && p.bestDriver !== null;
  const lalamoveOk = p.lalamoveVehicle !== "EXCEPTION" && p.lalamoveCost !== null;

  // Regra 0: same-day após corte das 12h → EXPRESS via Lalamove sem avaliar custo
  if (p.ctx.isSameDayAfterCutoff && p.isUrgent) {
    if (lalamoveOk) {
      return {
        mode: "LALAMOVE",
        vehicle: p.lalamoveVehicle as LalamoveServiceType,
        requiresManualAssignment: false,
        reason: `Same-day após corte — Lalamove express obrigatório (R$ ${p.lalamoveCost!.toFixed(2)})`,
      };
    }
    // Lalamove indisponível: frota própria mas com urgência máxima
    if (internalOk) {
      return {
        mode: "INTERNAL",
        vehicle: p.internalVehicle as InternalVehicleType,
        driverId: p.bestDriver!.id,
        requiresManualAssignment: false,
        reason: `Same-day após corte — frota própria (Lalamove indisponível), motorista ${p.bestDriver!.name}`,
      };
    }
  }

  // Regra 1: urgente — compara tempo TOTAL interno (espera + deslocamento até loja)
  // contra tempo do Lalamove (pickup + execução). Decide pelo mais rápido.
  // Quando há GPS, totalReady é preciso; sem GPS cai pra minutesUntilFree apenas.
  const totalReady = p.bestDriver ? totalInternalReadyMin(p.bestDriver) : Infinity;
  const driverTooLong = p.bestDriver !== null && totalReady > MAX_URGENT_WAIT_MIN;
  if (p.isUrgent && lalamoveOk && (driverTooLong || !internalOk)) {
    const etaNote = p.bestDriver?.etaToOriginMin != null
      ? ` (livre em ~${Math.round(p.bestDriver.minutesUntilFree)}min + ${Math.round(p.bestDriver.etaToOriginMin)}min até loja)`
      : "";
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: driverTooLong
        ? `Urgente — motorista ~${Math.round(totalReady)}min pra ficar pronto${etaNote}; Lalamove pickup ~${LALAMOVE_PICKUP_MIN}min (R$ ${p.lalamoveCost!.toFixed(2)})`
        : `Urgente — nenhum motorista disponível; Lalamove (R$ ${p.lalamoveCost!.toFixed(2)})`,
    };
  }

  // Regra 2: custo — Lalamove claramente mais barato (>10% de economia) → Lalamove
  if (lalamoveOk && p.lalamoveCost! < p.internalCost * 0.9) {
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: `Lalamove (R$ ${p.lalamoveCost!.toFixed(2)}) mais econômico que rota interna (R$ ${p.internalCost.toFixed(2)})`,
    };
  }

  // Regra 3: motorista com score alto e custo interno ≤ Lalamove → interno
  if (internalOk && p.bestDriver!.score >= 60 && (!lalamoveOk || p.internalCost <= p.lalamoveCost!)) {
    const waitNote = p.bestDriver!.minutesUntilFree > 0
      ? ` (livre em ~${Math.round(p.bestDriver!.minutesUntilFree)} min)`
      : "";
    const consolidationNote = !p.isUrgent && p.ctx.dispatchWindow === "FIRST_DISPATCH"
      ? "Considere consolidar com outras entregas D+1 no primeiro despacho para reduzir custo por entrega."
      : undefined;
    return {
      mode: "INTERNAL",
      vehicle: p.internalVehicle as InternalVehicleType,
      driverId: p.bestDriver!.id,
      requiresManualAssignment: false,
      reason: `${p.bestDriver!.name}${waitNote}, score ${p.bestDriver!.score} — custo interno R$ ${p.internalCost.toFixed(2)}`,
      consolidationNote,
    };
  }

  // Regra 4: sem motorista com score suficiente → Lalamove
  if (!internalOk && lalamoveOk) {
    return {
      mode: "LALAMOVE",
      vehicle: p.lalamoveVehicle as LalamoveServiceType,
      requiresManualAssignment: false,
      reason: "Nenhum motorista com score suficiente — usando Lalamove",
    };
  }

  // Regra 5: Lalamove indisponível + motorista disponível (qualquer score) → interno
  if (internalOk && !lalamoveOk) {
    return {
      mode: "INTERNAL",
      vehicle: p.internalVehicle as InternalVehicleType,
      driverId: p.bestDriver!.id,
      requiresManualAssignment: false,
      reason: "Lalamove indisponível — usando rota interna",
    };
  }

  // Regra 6: nada disponível → atribuição manual
  return {
    mode: "INTERNAL",
    vehicle: InternalVehicleType.FIORINO,
    requiresManualAssignment: true,
    reason: "Nenhum recurso disponível — requer atribuição manual pelo operador",
  };
}

// ──────────────────────────────────────────────
// PASSO 8 — PREÇO SUGERIDO AO CLIENTE
// Tabela zonal fechada — `basePrice` normal ou `expressBasePrice` se URGENT.
// `expressBasePrice` é valor TOTAL do express (não multiplicador) — definido por zona em
// migration_fase1_tabela_e_organograma.sql. Quando ausente, cai pro urgentFactor legado.
// ──────────────────────────────────────────────

export function calculateCustomerPrice(params: {
  zone:             { basePrice: number; expressBasePrice?: number | null; urgentFactor?: number } | null;
  // params abaixo mantidos por compat na assinatura — não influenciam mais o preço.
  // Decisão de modal (INTERNAL × LALAMOVE) é separada e segue em decideBestDeliveryOption.
  internalCost?:     number;
  lalamoveCost?:     number | null;
  selectedMode?:     "INTERNAL" | "LALAMOVE";
  internalVehicle?:  InternalVehicleType | "EXCEPTION";
  isUrgent:         boolean;
  urgencySurcharge?: number;
}): number {
  const { zone, isUrgent, urgencySurcharge } = params;

  if (!zone) return 0;

  if (isUrgent) {
    // Quando a zona tem express explícito, usa o valor absoluto (R$ definido na tabela).
    if (zone.expressBasePrice != null && zone.expressBasePrice > 0) {
      return zone.expressBasePrice;
    }
    // Fallback p/ zonas legadas sem expressBasePrice: aplica urgentFactor ou urgencySurcharge.
    const factor = zone.urgentFactor ?? urgencySurcharge ?? 1.3;
    return zone.basePrice * factor;
  }

  return zone.basePrice;
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

  // 4. Custo interno — usa duração com trânsito quando disponível (mais precisa)
  const effectiveDurationMin = route.durationInTrafficMin ?? route.durationMin;
  const internalCost = calculateInternalCost({ ...route, durationMin: effectiveDurationMin }, cfg);

  // 5. Motoristas com ETA real (score inclui tempo de espera + proximidade)
  const driversWithETA = cargo.internalVehicle !== "EXCEPTION"
    ? await getDriversWithETA(input.storeId, input.originLat, input.originLng)
    : [];

  const ranked = driversWithETA
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score);

  const bestDriver = ranked[0]
    ? {
        id:               ranked[0].driverId,
        name:             ranked[0].driverName,
        score:            ranked[0].score,
        minutesUntilFree: ranked[0].minutesUntilFree,
        etaToOriginMin:   ranked[0].etaToOriginMin,
      }
    : null;

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

  // 7. Decisão de modal — com contexto de ETA e janela de despacho
  const now = new Date();
  const sameDayCutoff = new Date();
  sameDayCutoff.setHours(12, 0, 0, 0);
  const isSameDayAfterCutoff = input.isUrgent && now >= sameDayCutoff;

  const ctx: DecisionContext = {
    driverEtaMin:         bestDriver?.minutesUntilFree ?? null,
    isSameDayAfterCutoff,
    dispatchWindow:       input.isUrgent ? "EXPRESS" : now.getHours() < 17 ? "FIRST_DISPATCH" : "SECOND_DISPATCH",
  };

  const decision = decideBestDeliveryOption({
    internalVehicle: cargo.internalVehicle,
    lalamoveVehicle: cargo.lalamoveVehicle,
    bestDriver,
    internalCost,
    lalamoveCost,
    isUrgent: input.isUrgent,
    ctx,
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
    distanceKm:               route.distanceKm,
    durationMinutes:          effectiveDurationMin,
    durationInTrafficMinutes: route.durationInTrafficMin ?? null,
    isApproximate:            route.isApproximate,
    internalCost,
    lalamoveCost,
    suggestedPrice,
    decisionReason:           decision.reason,
    consolidationNote:        decision.consolidationNote,
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
