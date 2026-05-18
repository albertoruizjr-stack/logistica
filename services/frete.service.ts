// services/frete.service.ts
// Cálculo, persistência e listagem de cotações de frete.

import { prisma } from "@/lib/prisma";
import { resolveRoute } from "@/lib/route-resolver";
import { DEFAULT_URGENT_MULTIPLIER } from "@/lib/constants";
import { DeliveryType, SLAType, DispatchWindow, FreightQuoteStatus } from "@prisma/client";
import { getBrasiliaTime, BRASILIA_TZ } from "@/lib/cutoff";
import type { FreightQuoteInput, FreightQuoteResult, DeliveryOption } from "@/types";

const FALLBACK_WARNING =
  "Distância calculada por linha reta (Google Maps indisponível). " +
  "O valor sugerido pode divergir do real — confirme com o operador antes de cobrar.";

// ─── mapeamento de DeliveryOption → enums internos ──────────────────────────

interface OptionMapping {
  slaType:       SLAType;
  dispatchWindow: DispatchWindow;
  deliveryType:  DeliveryType;
  isUrgent:      boolean;
  estimatedDays: number;
  windowLabel:   string;
}

const DELIVERY_OPTION_MAP: Record<DeliveryOption, OptionMapping> = {
  // SAME_DAY = entrega hoje pela frota interna na 2ª onda da tarde.
  // Custo marginal da frota é zero (R$ 26k/mês fixos), então NÃO aplica
  // multiplicador de urgência — usa tabela normal. Só EXPRESS (Lalamove/99)
  // continua sendo "urgent" e cobra a tabela express por zona.
  SAME_DAY: {
    slaType:       SLAType.STANDARD,
    dispatchWindow: DispatchWindow.SECOND_DISPATCH,
    deliveryType:  DeliveryType.STANDARD,
    isUrgent:      false,
    estimatedDays: 0,
    windowLabel:   "Entrega hoje — Same Day",
  },
  TOMORROW_FIRST: {
    slaType:       SLAType.STANDARD,
    dispatchWindow: DispatchWindow.FIRST_DISPATCH,
    deliveryType:  DeliveryType.STANDARD,
    isUrgent:      false,
    estimatedDays: 1,
    windowLabel:   "1º Despacho — manhã D+1",
  },
  TOMORROW_SECOND: {
    slaType:       SLAType.STANDARD,
    dispatchWindow: DispatchWindow.SECOND_DISPATCH,
    deliveryType:  DeliveryType.STANDARD,
    isUrgent:      false,
    estimatedDays: 1,
    windowLabel:   "2º Despacho — tarde D+1",
  },
  EXPRESS: {
    slaType:       SLAType.EXPRESS,
    dispatchWindow: DispatchWindow.EXPRESS,
    deliveryType:  DeliveryType.URGENT,
    isUrgent:      true,
    estimatedDays: 0,
    windowLabel:   "Entrega expressa — Lalamove/99",
  },
  SCHEDULED: {
    slaType:       SLAType.SCHEDULED,
    dispatchWindow: DispatchWindow.FIRST_DISPATCH,
    deliveryType:  DeliveryType.STANDARD,
    isUrgent:      false,
    estimatedDays: 1,
    windowLabel:   "Entrega agendada",
  },
};

// ─── calcula fim do dia em Brasília ─────────────────────────────────────────

function endOfDayBrasilia(): Date {
  const now = new Date();
  const brt = getBrasiliaTime(now);

  // monta um Date local com hora 23:59:59 no fuso de Brasília
  // usando Intl para encontrar a data atual em SP
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: BRASILIA_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const dateStr = fmt.format(now); // "YYYY-MM-DD"
  const eod = new Date(`${dateStr}T23:59:59-03:00`);
  return eod;
}

// ─── calculateFreightQuote ───────────────────────────────────────────────────

export async function calculateFreightQuote(
  input: FreightQuoteInput
): Promise<FreightQuoteResult> {
  const deliveryOption: DeliveryOption = input.deliveryOption ?? "TOMORROW_FIRST";
  const mapping = DELIVERY_OPTION_MAP[deliveryOption];

  const route = await resolveRoute(
    input.originLat,
    input.originLng,
    input.destLat,
    input.destLng
  );

  const zone = await prisma.freightZone.findFirst({
    where: {
      active: true,
      minKm: { lte: route.distanceKm },
      OR: [{ maxKm: null }, { maxKm: { gt: route.distanceKm } }],
    },
    orderBy: { minKm: "asc" },
  });

  const urgentConfig = await prisma.systemConfig.findUnique({
    where: { key: "URGENT_MULTIPLIER" },
  });
  const urgentFactor = urgentConfig
    ? parseFloat(urgentConfig.value)
    : DEFAULT_URGENT_MULTIPLIER;

  const warning = route.isApproximate ? FALLBACK_WARNING : undefined;

  if (!zone || zone.underConsultation) {
    return {
      distanceKm:               route.distanceKm,
      durationMinutes:          route.durationInTrafficMin ?? route.durationMin,
      durationMinutesNoTraffic: route.durationMin,
      durationInTrafficMinutes: route.durationInTrafficMin ?? null,
      isApproximate:            route.isApproximate,
      isTrafficFresh:           route.isTrafficFresh,
      warning,
      zone:              zone ?? null,
      suggestedPrice:    0,
      isUrgent:          mapping.isUrgent,
      urgentFactor:      null,
      estimatedDays:     1,
      deliveryType:      DeliveryType.EXCEPTION,
      deliveryOption,
      dispatchWindowLabel: "Sob consulta",
      underConsultation: true,
    };
  }

  let suggestedPrice = zone.basePrice;
  if (mapping.isUrgent) suggestedPrice = suggestedPrice * urgentFactor;

  // para SCHEDULED: estimatedDays calculado pela data escolhida
  let estimatedDays = mapping.estimatedDays;
  if (deliveryOption === "SCHEDULED" && input.scheduledFor) {
    const scheduled = new Date(input.scheduledFor);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffMs = scheduled.getTime() - today.getTime();
    estimatedDays = Math.max(0, Math.round(diffMs / 86_400_000));
  }

  const durationMinutes = route.durationInTrafficMin ?? route.durationMin;

  return {
    distanceKm:               route.distanceKm,
    durationMinutes,
    durationMinutesNoTraffic: route.durationMin,
    durationInTrafficMinutes: route.durationInTrafficMin ?? null,
    isApproximate:            route.isApproximate,
    isTrafficFresh:           route.isTrafficFresh,
    warning,
    zone,
    suggestedPrice,
    isUrgent:            mapping.isUrgent,
    urgentFactor:        mapping.isUrgent ? urgentFactor : null,
    estimatedDays,
    deliveryType:        mapping.deliveryType,
    deliveryOption,
    dispatchWindowLabel: mapping.windowLabel,
    underConsultation:   false,
  };
}

// ─── saveFreightQuote ────────────────────────────────────────────────────────

export async function saveFreightQuote(
  input: FreightQuoteInput,
  result: FreightQuoteResult,
  userId: string
) {
  const deliveryOption: DeliveryOption = input.deliveryOption ?? "TOMORROW_FIRST";
  const mapping = DELIVERY_OPTION_MAP[deliveryOption];

  const expiresAt = deliveryOption === "EXPRESS"
    ? new Date(Date.now() + 30 * 60 * 1000)   // expressa: 30 min
    : endOfDayBrasilia();                       // padrão: fim do dia

  return prisma.freightQuote.create({
    data: {
      storeId:           input.storeId,
      originAddress:     input.originAddress,
      originLat:         input.originLat,
      originLng:         input.originLng,
      destAddress:       input.destAddress,
      destLat:           input.destLat,
      destLng:           input.destLng,
      distanceKm:        result.distanceKm,
      durationMinutes:   result.durationMinutes,
      isApproximate:     result.isApproximate,
      zoneId:            result.zone?.id ?? null,
      suggestedPrice:    result.suggestedPrice,
      isUrgent:          mapping.isUrgent,
      urgentFactor:      result.urgentFactor,
      estimatedDays:     result.estimatedDays,
      deliveryType:      mapping.deliveryType,

      // campos v2
      status:             FreightQuoteStatus.QUOTED,
      deliveryOption,
      slaType:            mapping.slaType,
      dispatchWindow:     mapping.dispatchWindow,
      city:               input.city,
      state:              input.state,
      quotedAddress:      input.quotedAddress,
      expiresAt,
      scheduledFor:       input.scheduledFor ? new Date(input.scheduledFor) : null,
      cutoffException:    input.cutoffException ?? false,
      cutoffExceptionReason: input.cutoffExceptionReason,

      createdById: userId,
    },
    include: { zone: true, store: { select: { code: true, name: true } } },
  });
}

// ─── updateQuoteStatus ───────────────────────────────────────────────────────

export async function updateQuoteStatus(
  id: string,
  status: FreightQuoteStatus,
  extra?: { convertedAt?: Date }
) {
  return prisma.freightQuote.update({
    where: { id },
    data: { status, ...extra },
  });
}

// ─── listFreightQuotes ───────────────────────────────────────────────────────

export interface ListQuotesFilter {
  userId?:   string;     // "minhas cotações"
  storeId?:  string;
  status?:   FreightQuoteStatus | FreightQuoteStatus[];
  search?:   string;     // destAddress / city
  page?:     number;
  limit?:    number;
}

export async function listFreightQuotes(filter: ListQuotesFilter = {}) {
  const { userId, storeId, status, search, page = 1, limit = 30 } = filter;

  // expirar automaticamente cotações QUOTED vencidas
  await prisma.freightQuote.updateMany({
    where: {
      status: FreightQuoteStatus.QUOTED,
      expiresAt: { lt: new Date() },
    },
    data: { status: FreightQuoteStatus.EXPIRED },
  });

  const where = {
    ...(userId  ? { createdById: userId }  : {}),
    ...(storeId ? { storeId }              : {}),
    ...(status
      ? Array.isArray(status)
        ? { status: { in: status } }
        : { status }
      : {}),
    ...(search
      ? {
          OR: [
            { destAddress: { contains: search, mode: "insensitive" as const } },
            { city:        { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.freightQuote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, status: true, deliveryOption: true,
        destAddress: true, city: true, state: true,
        distanceKm: true, suggestedPrice: true, dispatchWindow: true,
        isUrgent: true, storeId: true,
        expiresAt: true, createdAt: true,
        store:     { select: { code: true, name: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.freightQuote.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// ─── getFreightZones ─────────────────────────────────────────────────────────

export async function getFreightZones() {
  return prisma.freightZone.findMany({
    where: { active: true },
    orderBy: { minKm: "asc" },
  });
}
