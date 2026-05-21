// scripts/_unblock-roteirizado.ts
// REMEDIAÇÃO PONTUAL — destrava entregas presas em ROTEIRIZADO dentro de rotas ACTIVE
// que nunca foram despachadas. Para cada DR em ROTEIRIZADO:
//   1. cria o Dispatch que faltava (INTERNAL_ROUTE, IN_TRANSIT) — satisfaz o gate de DISPATCHED
//   2. avança ROTEIRIZADO -> DISPATCHED -> IN_TRANSIT via state machine (mantém histórico)
// Depois marca a rota como DISPATCHED e o motorista como indisponível.
// Tolera paradas em OCORRENCIA na mesma rota (só mexe nas que estão em ROTEIRIZADO).
//
// Uso:  tsx scripts/_unblock-roteirizado.ts           (DRY-RUN: só mostra o plano)
//       tsx scripts/_unblock-roteirizado.ts --apply    (aplica de verdade)
import { prisma } from "@/lib/prisma";
import { transitionDeliveryRequest } from "@/services/state-machine.service";
import { DispatchModal, DispatchStatus } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const tag = APPLY ? "[APPLY]" : "[DRY-RUN]";

type Seq = { deliveryRequestId?: string | null; eta?: string | null };

async function main() {
  // operador "ator" das transições/dispatch (ADMIN ativo)
  const operator = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    select: { id: true, name: true },
  });
  if (!operator) throw new Error("Nenhum usuário ADMIN ativo encontrado para ser o ator.");
  console.log(`${tag} Ator: ${operator.name} (${operator.id})\n`);

  const routes = await prisma.route.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, name: true, driverId: true, spokeRouteId: true, sequenceJson: true,
      driver: { select: { name: true, store: { select: { id: true } } } },
    },
  });

  let touchedRoutes = 0;
  let unblocked = 0;

  for (const route of routes) {
    const seq = ((route.sequenceJson as unknown as Seq[]) ?? []).filter((s) => s.deliveryRequestId);
    const drIds = seq.map((s) => s.deliveryRequestId!) as string[];
    if (drIds.length === 0) continue;

    const drs = await prisma.deliveryRequest.findMany({
      where: { id: { in: drIds } },
      select: { id: true, orderNumber: true, status: true },
    });
    const stuck = drs.filter((d) => d.status === "ROTEIRIZADO");
    if (stuck.length === 0) continue;

    console.log(`Rota "${route.name}" — ${route.driver?.name} (${stuck.length} presa(s) de ${drs.length}):`);
    touchedRoutes++;

    for (const dr of stuck) {
      const stop = seq.find((s) => s.deliveryRequestId === dr.id);
      const existing = await prisma.dispatch.findUnique({
        where: { deliveryRequestId: dr.id },
        select: { id: true },
      });
      console.log(`  • ${dr.orderNumber ?? dr.id.slice(-6)}  ROTEIRIZADO -> IN_TRANSIT` +
        (existing ? " (dispatch já existe)" : " (cria dispatch)"));

      if (!APPLY) { unblocked++; continue; }

      if (!existing) {
        await prisma.dispatch.create({
          data: {
            deliveryRequestId: dr.id,
            storeId:        route.driver!.store.id,
            modal:          DispatchModal.INTERNAL_ROUTE,
            status:         DispatchStatus.IN_TRANSIT,
            driverId:       route.driverId,
            routeId:        route.id,
            spokeRouteId:   route.spokeRouteId,
            dispatchedById: operator.id,
            dispatchedAt:   new Date(),
            predictedDeliveryAt: stop?.eta ? new Date(stop.eta) : null,
          },
        });
      }
      await transitionDeliveryRequest({
        requestId: dr.id, actorId: operator.id, actorRole: "LOGISTICS_OPERATOR",
        toStatus: "DISPATCHED", metadata: { routeId: route.id, autoAdvance: true },
      });
      await transitionDeliveryRequest({
        requestId: dr.id, actorId: operator.id, actorRole: "LOGISTICS_OPERATOR",
        toStatus: "IN_TRANSIT",
        metadata: { routeId: route.id, autoAdvance: true, reason: "Desbloqueio: rota não havia sido despachada" },
      });
      unblocked++;
    }

    if (APPLY) {
      await prisma.route.update({ where: { id: route.id }, data: { status: "DISPATCHED" } });
      await prisma.driver.update({ where: { id: route.driverId }, data: { available: false } });
    }
    console.log("");
  }

  console.log(`${tag} ${unblocked} entrega(s) ${APPLY ? "destravada(s)" : "seriam destravadas"} em ${touchedRoutes} rota(s).`);
  if (!APPLY) console.log("\n→ Rode com  --apply  para aplicar.");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
