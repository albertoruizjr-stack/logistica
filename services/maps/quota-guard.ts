// services/maps/quota-guard.ts
// Verifica se o uso diário da API do Google Maps ultrapassou o limite configurado.
// Quando o limite é atingido, o fluxo deve usar cache ou Haversine em vez de chamar a API.

import { prisma } from "@/lib/prisma";

// Endpoints que efetivamente geram custo na Google (exclui hits de cache e fallback)
const BILLABLE_ENDPOINTS = ["COMPUTE_ROUTES", "GEOCODE"] as const;

export interface QuotaStatus {
  allowed:    boolean;
  count:      number;  // chamadas billable hoje
  limit:      number;
  nearLimit:  boolean; // acima de 80% do limite
}

export async function checkMapsQuota(): Promise<QuotaStatus> {
  const limit = parseInt(process.env.MAX_MAPS_CALLS_PER_DAY ?? "500", 10);
  const alertThreshold = parseInt(process.env.MAPS_USAGE_ALERT_THRESHOLD ?? "400", 10);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const count = await prisma.mapsUsageLog.count({
    where: {
      endpoint:  { in: BILLABLE_ENDPOINTS as unknown as string[] },
      createdAt: { gte: startOfDay },
    },
  });

  return {
    allowed:   count < limit,
    count,
    limit,
    nearLimit: count >= alertThreshold,
  };
}
