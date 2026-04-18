// services/frete.service.ts
// Cálculo de frete: zona, preço sugerido e tipo de entrega.
// A distância e duração vêm do resolveRoute (cache → Google Maps → Haversine).
// Quando o fallback Haversine é ativado, o resultado é marcado como estimado
// e inclui um warning visível para o operador.

import { prisma } from "@/lib/prisma";
import { resolveRoute } from "@/lib/route-resolver";
import { DEFAULT_URGENT_MULTIPLIER, INTERNAL_ROUTE_CUTOFF_HOUR } from "@/lib/constants";
import { DeliveryType } from "@prisma/client";
import type { FreightQuoteInput, FreightQuoteResult } from "@/types";

const FALLBACK_WARNING =
  "Distância calculada por linha reta (Google Maps indisponível). " +
  "O valor sugerido pode divergir do real — confirme com o operador antes de cobrar.";

export async function calculateFreightQuote(
  input: FreightQuoteInput
): Promise<FreightQuoteResult> {
  // 1. resolve rota: cache → Google Maps → Haversine
  const route = await resolveRoute(
    input.originLat,
    input.originLng,
    input.destLat,
    input.destLng
  );

  // 2. busca zona correspondente à distância real
  const zone = await prisma.freightZone.findFirst({
    where: {
      active: true,
      minKm: { lte: route.distanceKm },
      OR: [
        { maxKm: null },
        { maxKm: { gt: route.distanceKm } },
      ],
    },
    orderBy: { minKm: "asc" },
  });

  // 3. multiplicador urgente (banco → fallback da constante)
  const urgentConfig = await prisma.systemConfig.findUnique({
    where: { key: "URGENT_MULTIPLIER" },
  });
  const urgentFactor = urgentConfig
    ? parseFloat(urgentConfig.value)
    : DEFAULT_URGENT_MULTIPLIER;

  // aviso quando a distância é aproximada (fallback Haversine)
  const warning = route.isApproximate ? FALLBACK_WARNING : undefined;

  // 4. calcula preço
  let suggestedPrice = 0;
  let deliveryType: DeliveryType = DeliveryType.STANDARD;

  if (!zone || zone.underConsultation) {
    return {
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMin,
      isApproximate: route.isApproximate,
      warning,
      zone: zone ?? null,
      suggestedPrice: 0,
      isUrgent: input.isUrgent,
      urgentFactor: null,
      estimatedDays: 1,
      deliveryType: DeliveryType.EXCEPTION,
      underConsultation: true,
    };
  }

  suggestedPrice = zone.basePrice;

  if (input.isUrgent) {
    suggestedPrice = suggestedPrice * urgentFactor;
    deliveryType = DeliveryType.URGENT;
  }

  // 5. prazo estimado
  const currentHour = new Date().getHours();
  const estimatedDays =
    deliveryType === DeliveryType.URGENT
      ? 0
      : currentHour >= INTERNAL_ROUTE_CUTOFF_HOUR
      ? 1
      : 0;

  return {
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMin,
    isApproximate: route.isApproximate,
    warning,
    zone,
    suggestedPrice,
    isUrgent: input.isUrgent,
    urgentFactor: input.isUrgent ? urgentFactor : null,
    estimatedDays,
    deliveryType,
    underConsultation: false,
  };
}

// persiste a cotação incluindo os campos de rota real
export async function saveFreightQuote(
  input: FreightQuoteInput,
  result: FreightQuoteResult,
  userId: string
) {
  return prisma.freightQuote.create({
    data: {
      storeId: input.storeId,
      originAddress: input.originAddress,
      originLat: input.originLat,
      originLng: input.originLng,
      destAddress: input.destAddress,
      destLat: input.destLat,
      destLng: input.destLng,
      distanceKm: result.distanceKm,
      durationMinutes: result.durationMinutes,
      isApproximate: result.isApproximate,
      zoneId: result.zone?.id ?? null,
      suggestedPrice: result.suggestedPrice,
      isUrgent: result.isUrgent,
      urgentFactor: result.urgentFactor,
      estimatedDays: result.estimatedDays,
      deliveryType: result.deliveryType,
      createdById: userId,
    },
    include: { zone: true },
  });
}

export async function getFreightZones() {
  return prisma.freightZone.findMany({
    where: { active: true },
    orderBy: { minKm: "asc" },
  });
}
