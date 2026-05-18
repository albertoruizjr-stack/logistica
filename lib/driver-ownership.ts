// lib/driver-ownership.ts
// Verifica se uma DeliveryRequest está atribuída a um motorista.
//
// CONTEXTO: A "propriedade" da entrega pelo motorista acontece em duas fases:
//   1. ROTEIRIZADO → Route criada com driverId. Dispatch AINDA NÃO EXISTE.
//   2. DISPATCHED  → Dispatch criado também, com driverId+routeId.
//
// Verificar só Dispatch quebrava o app na fase 1 (entrega "não é sua" ao tocar).

import { prisma } from "@/lib/prisma";

export async function isDeliveryAssignedToDriver(
  deliveryRequestId: string,
  driverId: string,
): Promise<boolean> {
  // 1) Caminho rápido: dispatch direto na DR (fase pós-despacho)
  const dispatch = await prisma.dispatch.findUnique({
    where:  { deliveryRequestId },
    select: { driverId: true },
  });
  if (dispatch?.driverId === driverId) return true;

  // 2) Fase pré-despacho: a DR está em alguma Route ATIVA/DESPACHADA desse motorista.
  // sequenceJson é Json[] no Prisma — usamos JSONB containment direto no Postgres
  // pra evitar carregar todas as rotas em memória.
  const matches = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM routes
    WHERE "driverId" = ${driverId}
      AND status IN ('ACTIVE', 'DISPATCHED')
      AND "sequenceJson" @> ${JSON.stringify([{ deliveryRequestId }])}::jsonb
    LIMIT 1
  `;
  return matches.length > 0;
}
