// ──────────────────────────────────────────────
// ROUTING WAVE — Orquestração do pipeline Spoke
//
// Estados da Wave (RoutingWaveStatus):
//   DRAFT → SENT → OPTIMIZED → DISTRIBUTED → COMPLETED
//                                ↓
//                              FAILED  (em qualquer ponto)
//
// Estratégia: pipeline em ETAPAS chamadas separadas (idempotentes).
// O frontend chama POST /waves/[id]/advance enquanto status != terminal.
// Isso evita timeouts em serverless e simplifica retry.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { RoutingWaveStatus, type Prisma } from "@prisma/client";
import {
  createPlan,
  importStops,
  optimizePlan,
  distributePlan,
  getOperation,
  getPlan,
  listPlanStops,
  createDriver,
  listDrivers,
  isSpokeConfigured,
  SpokeError,
  type SpokeStopInput,
} from "./spoke.service";
import { transitionDeliveryRequest } from "./state-machine.service";
import { deleteRoute } from "./route-dispatch.service";
import { hashPassword } from "@/lib/auth";

// ──────────────────────────────────────────────
// HELPERS — Sincronização de Drivers com o Spoke
// ──────────────────────────────────────────────

// Garante que cada Driver local tenha spokeDriverId. Cria no Spoke se necessário.
// Retorna mapa: localDriverId → spokeDriverId.
async function ensureDriversSynced(driverIds: string[]): Promise<Map<string, string>> {
  const drivers = await prisma.driver.findMany({
    where:  { id: { in: driverIds } },
    select: { id: true, name: true, email: true, phone: true, spokeDriverId: true },
  });

  const map = new Map<string, string>();

  for (const d of drivers) {
    if (d.spokeDriverId) {
      map.set(d.id, d.spokeDriverId);
      continue;
    }
    if (!d.email) {
      throw new Error(`Motorista ${d.name} sem email — obrigatório para criar no Spoke.`);
    }
    const spokeDriver = await createDriver({
      name:  d.name,
      email: d.email,
      phone: d.phone,
      displayName: d.name,
    });
    await prisma.driver.update({
      where: { id: d.id },
      data:  { spokeDriverId: spokeDriver.id },
    });
    map.set(d.id, spokeDriver.id);
  }

  return map;
}

// ──────────────────────────────────────────────
// CRIAR WAVE
// ──────────────────────────────────────────────

interface CreateWaveInput {
  name:                string;
  date:                Date;
  createdById:         string;
  deliveryRequestIds:  string[];
  driverIds:           string[];
  notes?:              string;
  // Quando true, ignora validação de peso × capacidade dos motoristas.
  // O operador toma a decisão consciente de exceder. Auditado em metadata.
  bypassCapacityCheck?: boolean;
}

interface WaveMetadata {
  driverIds:           string[];
  deliveryRequestIds:  string[];
  optimizeOperationId?: string;
  stopMap?:            Record<string, string>; // spokeStopId → deliveryRequestId
  // Snapshot da decisão de capacidade no momento da criação.
  capacityCheck?: {
    totalWeightKg:   number;
    totalCapacityKg: number;
    exceededBy:      number;
    bypassed:        boolean;
  };
}

// Default por tipo de veículo (mantém igual ao resolveDefaultCapacityKg do client).
function defaultCapacityForType(vehicleType: string | null): number {
  if (!vehicleType) return 500;
  const n = vehicleType.toUpperCase().trim();
  if (n.includes("MOTO"))    return 30;
  if (n.includes("FIORINO")) return 750;
  if (n.includes("VAN"))     return 800;
  if (n.includes("CAMINH"))  return 1650;
  if (n.includes("CARRO"))   return 200;
  return 500;
}

export async function createWave(input: CreateWaveInput) {
  if (input.deliveryRequestIds.length === 0) {
    throw new Error("Selecione ao menos uma solicitação.");
  }
  if (input.driverIds.length === 0) {
    throw new Error("Selecione ao menos um motorista.");
  }
  if (!isSpokeConfigured()) {
    throw new Error("Integração com Spoke não está configurada (SPOKE_API_URL/SPOKE_API_KEY).");
  }

  // Valida solicitações: precisam estar em PRONTO_ROTEIRIZACAO e ter endereço
  const requests = await prisma.deliveryRequest.findMany({
    where:  { id: { in: input.deliveryRequestIds } },
    select: { id: true, status: true, deliveryAddress: true, orderNumber: true, totalWeightKg: true },
  });

  if (requests.length !== input.deliveryRequestIds.length) {
    throw new Error("Uma ou mais solicitações não foram encontradas.");
  }

  const ineligible = requests.filter(
    (r) => r.status !== "PRONTO_ROTEIRIZACAO" || !r.deliveryAddress,
  );
  if (ineligible.length > 0) {
    const ids = ineligible.map((r) => r.orderNumber ?? r.id.slice(-6)).join(", ");
    throw new Error(`Solicitações não elegíveis para roteirização: ${ids}`);
  }

  // Validação de capacidade × peso. Cliente já valida pra UX, aqui é defesa em profundidade.
  const driversWithCapacity = await prisma.driver.findMany({
    where:  { id: { in: input.driverIds } },
    select: { id: true, name: true, vehicleType: true, maxLoadKg: true },
  });
  const totalCapacityKg = driversWithCapacity.reduce(
    (acc, d) => acc + (d.maxLoadKg ?? defaultCapacityForType(d.vehicleType)),
    0,
  );
  const totalWeightKg = requests.reduce((acc, r) => acc + (r.totalWeightKg ?? 0), 0);
  const exceededBy = Math.max(0, totalWeightKg - totalCapacityKg);

  if (exceededBy > 0 && !input.bypassCapacityCheck) {
    throw new Error(
      `Carga (${totalWeightKg.toFixed(1)} kg) excede capacidade dos motoristas selecionados (${totalCapacityKg.toFixed(0)} kg) em ${exceededBy.toFixed(1)} kg. Marque "Liberar mesmo assim" pra prosseguir.`,
    );
  }

  const metadata: WaveMetadata = {
    driverIds:          input.driverIds,
    deliveryRequestIds: input.deliveryRequestIds,
    capacityCheck: {
      totalWeightKg,
      totalCapacityKg,
      exceededBy,
      bypassed: exceededBy > 0,
    },
  };

  return prisma.routingWave.create({
    data: {
      name:        input.name,
      date:        input.date,
      status:      RoutingWaveStatus.DRAFT,
      notes:       input.notes ?? null,
      createdById: input.createdById,
      metadata:    metadata as unknown as Prisma.InputJsonValue,
    },
  });
}

// ──────────────────────────────────────────────
// ADVANCE — avança a wave para o próximo estado
// Idempotente: pode ser chamado várias vezes seguidas.
// ──────────────────────────────────────────────

export async function advanceWave(waveId: string) {
  const wave = await prisma.routingWave.findUniqueOrThrow({
    where: { id: waveId },
  });

  switch (wave.status) {
    case RoutingWaveStatus.DRAFT:
      return submitWaveToSpoke(waveId);
    case RoutingWaveStatus.SENT:
      return checkOptimization(waveId);
    case RoutingWaveStatus.OPTIMIZED:
      return distributeWave(waveId);
    case RoutingWaveStatus.DISTRIBUTED:
    case RoutingWaveStatus.DISPATCHED:
    case RoutingWaveStatus.COMPLETED:
    case RoutingWaveStatus.FAILED:
      return wave; // estado terminal — nada a fazer
  }
}

// ──────────────────────────────────────────────
// ETAPA 1: DRAFT → SENT
// Cria Plan no Spoke + importStops + dispara optimize
// ──────────────────────────────────────────────

async function submitWaveToSpoke(waveId: string) {
  const wave = await prisma.routingWave.findUniqueOrThrow({ where: { id: waveId } });
  const meta = (wave.metadata as unknown as WaveMetadata) ?? null;
  if (!meta) {
    return markFailed(waveId, "metadata da wave ausente");
  }

  try {
    // 1. Sincroniza motoristas
    const driverMap = await ensureDriversSynced(meta.driverIds);
    const spokeDriverIds = Array.from(driverMap.values());

    // 2. Cria Plan no Spoke
    const plan = await createPlan({
      title:   wave.name,
      date:    wave.date,
      drivers: spokeDriverIds,
    });

    // 3. Carrega entregas com itens + endereço
    const requests = await prisma.deliveryRequest.findMany({
      where:   { id: { in: meta.deliveryRequestIds } },
      include: { items: true },
    });

    // 4. Monta stops
    const stops: SpokeStopInput[] = requests.map((r) => ({
      address: {
        addressLineOne: r.deliveryAddress,
        addressLineTwo: r.deliveryComplement ?? undefined,
        city:           r.deliveryCity ?? undefined,
        state:          r.deliveryState ?? undefined,
        country:        "BR",
        latitude:       r.deliveryLat ?? undefined,
        longitude:      r.deliveryLng ?? undefined,
      },
      recipient: {
        name:       r.customerName,
        phone:      r.customerPhone ?? undefined,
        // externalId é o vínculo Stop→DeliveryRequest na hora de processar o response do Spoke.
        // customProperties exigiria cadastro prévio no workspace e foi descartado.
        externalId: r.id,
      },
      notes:        r.notes ?? undefined,
      packageCount: r.totalLatas || r.items.length || 1,
      weight:       r.totalWeightKg
        ? { amount: Math.round(r.totalWeightKg * 100) / 100, unit: "kilogram" as const }
        : undefined,
      activity:     "delivery",
    }));

    // 5. Importa stops e captura mapping
    console.log(`[routing-wave] importStops payload (${stops.length} stops):`, JSON.stringify(stops, null, 2));
    const imported = await importStops(plan.id, stops);
    const stopMap: Record<string, string> = {};
    if (imported.stops) {
      for (const s of imported.stops) {
        const drId = s.recipient?.externalId;
        if (drId && s.id) stopMap[s.id] = drId;
      }
    }

    // 6. Dispara optimize (assíncrono)
    const op = await optimizePlan(plan.id);

    // 7. Atualiza wave para SENT
    const newMeta: WaveMetadata = {
      ...meta,
      optimizeOperationId: op.id,
      stopMap,
    };
    return prisma.routingWave.update({
      where: { id: waveId },
      data: {
        status:      RoutingWaveStatus.SENT,
        spokePlanId: plan.id,
        sentAt:      new Date(),
        metadata:    newMeta as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    return markFailed(waveId, errToString(err));
  }
}

// ──────────────────────────────────────────────
// ETAPA 2: SENT → OPTIMIZED
// Polling da operation. Idempotente.
// ──────────────────────────────────────────────

async function checkOptimization(waveId: string) {
  const wave = await prisma.routingWave.findUniqueOrThrow({ where: { id: waveId } });
  const meta = (wave.metadata as unknown as WaveMetadata) ?? null;
  if (!meta?.optimizeOperationId) {
    return markFailed(waveId, "optimizeOperationId ausente em SENT");
  }

  try {
    const op = await getOperation(meta.optimizeOperationId);
    if (!op.done) {
      return wave; // mantém SENT, frontend re-pollar
    }
    if (op.error) {
      return markFailed(waveId, `optimize falhou: ${JSON.stringify(op.error)}`);
    }
    return prisma.routingWave.update({
      where: { id: waveId },
      data: {
        status:      RoutingWaveStatus.OPTIMIZED,
        optimizedAt: new Date(),
      },
    });
  } catch (err) {
    return markFailed(waveId, errToString(err));
  }
}

// ──────────────────────────────────────────────
// ETAPA 3: OPTIMIZED → DISTRIBUTED
// Distribui no Spoke, cria Routes locais, atualiza DeliveryRequests.
// ──────────────────────────────────────────────

async function distributeWave(waveId: string) {
  const wave = await prisma.routingWave.findUniqueOrThrow({ where: { id: waveId } });
  const meta = (wave.metadata as unknown as WaveMetadata) ?? null;
  if (!wave.spokePlanId || !meta) {
    return markFailed(waveId, "spokePlanId/metadata ausente em OPTIMIZED");
  }

  try {
    // 1. Distribui no Spoke
    const distributed = await distributePlan(wave.spokePlanId);

    // 2. Carrega plan completo com routes
    const plan = distributed.routes && distributed.routes.length > 0
      ? distributed
      : await getPlan(wave.spokePlanId);

    console.log(`[routing-wave] plan.routes returned by Spoke:`, plan.routes);
    console.log(`[routing-wave] spokePlanId:`, wave.spokePlanId);

    // 3. Recupera mapa local localDriver ↔ spokeDriver
    const drivers = await prisma.driver.findMany({
      where:  { id: { in: meta.driverIds } },
      select: { id: true, spokeDriverId: true },
    });
    const localByspoke = new Map(drivers.map((d) => [d.spokeDriverId!, d.id]));

    // 4. Busca todos os stops do plan e agrupa por driver.
    // Mais robusto que iterar GET /plans/X/routes/Y (que pode dar 404 mesmo com a rota
    // listada no plan.routes — eventual consistency do Spoke).
    const allStops = await listPlanStops(wave.spokePlanId);
    if (allStops.length === 0) {
      return markFailed(waveId, "Plan distribuído não tem stops");
    }

    // Driver vem em stop.route.driver após distribute. driverIdentifier é legado.
    // Filtra também stops do depot (type: "start"/"end") — só delivery interessa.
    const stopsByDriver = new Map<string, typeof allStops>();
    for (const stop of allStops) {
      const drv = stop.route?.driver ?? stop.driverIdentifier;
      if (!drv) continue;
      const list = stopsByDriver.get(drv) ?? [];
      list.push(stop);
      stopsByDriver.set(drv, list);
    }

    // 5. Cria Routes locais — uma por driver
    const createdRouteIds: string[] = [];
    const requestToRouteMap: Map<string, string> = new Map();

    // ETA do Spoke vem em Unix seconds. Convert pra Date.
    const etaToDate = (sec: number | undefined | null) =>
      sec ? new Date(sec * 1000) : null;

    for (const [spokeDriverId, driverStops] of stopsByDriver.entries()) {
      const localDriverId = localByspoke.get(spokeDriverId);
      if (!localDriverId) continue;

      // Ordena por stopPosition (Spoke pode não vir ordenado)
      const orderedStops = driverStops
        .slice()
        .sort((a, b) => (a.stopPosition ?? 0) - (b.stopPosition ?? 0));

      // Apenas paradas reais entram no sequenceJson (start/end são o depot).
      // Type real do Spoke: "stop" = parada do cliente. "delivery" era assumption errada.
      const deliveryStops = orderedStops.filter((s) => s.type === "stop" || (!s.type && s.recipient?.externalId));

      const sequence = deliveryStops
        .filter((s) => s.recipient?.externalId)
        .map((s) => ({
          stopPosition:      s.stopPosition,
          deliveryRequestId: s.recipient!.externalId!,
          eta:               etaToDate(s.eta?.estimatedArrivalAt)?.toISOString() ?? null,
        }));

      // O ID completo da route do Spoke está em stop.route.id (ex: "routes/abc").
      // Combinamos com o plan pra formar "plans/X/routes/abc".
      const spokeRouteRaw = orderedStops[0]?.route?.id;
      const spokeRouteRef = spokeRouteRaw
        ? (spokeRouteRaw.startsWith("plans/") ? spokeRouteRaw : `${wave.spokePlanId}/${spokeRouteRaw}`)
        : `${wave.spokePlanId}/routes/${spokeDriverId.split("/").pop()}`;

      // ETA de retorno: o stop "end" tem o último ETA. Se não houver, usa o último delivery.
      const endStop = orderedStops.find((s) => s.type === "end");
      const lastSec = (endStop ?? orderedStops[orderedStops.length - 1])?.eta?.estimatedLatestArrivalAt;

      const route = await prisma.route.create({
        data: {
          name:              orderedStops[0]?.route?.title ?? `${wave.name} · ${spokeDriverId.split("/").pop()}`,
          driverId:          localDriverId,
          date:              wave.date,
          status:            "ACTIVE",
          spokeRouteId:      spokeRouteRef,
          waveId,
          manifestJson:      orderedStops as unknown as Prisma.InputJsonValue,
          sequenceJson:      sequence as unknown as Prisma.InputJsonValue,
          stopCount:         deliveryStops.length,
          estimatedReturnAt: etaToDate(lastSec),
        },
      });
      createdRouteIds.push(route.id);

      for (const s of sequence) {
        requestToRouteMap.set(s.deliveryRequestId, route.id);
      }
    }

    // 5b. RECONCILIAÇÃO — nenhuma entrega pode sumir.
    // Confere que TODA DR selecionada entrou em alguma rota. Se faltar, aplica a
    // política definida em decideOnMissingDeliveries (decisão de negócio — ver função).
    const selectedDrIds = meta.deliveryRequestIds;
    const routedDrIds   = Array.from(requestToRouteMap.keys());
    const missingDrIds  = selectedDrIds.filter((id) => !requestToRouteMap.has(id));

    // Aviso persistido na onda quando entregas ficam de fora (visível na tela de detalhe).
    let distributionWarning: { missingCount: number; selectedCount: number; missingDrIds: string[] } | null = null;

    if (missingDrIds.length > 0) {
      const decision = decideOnMissingDeliveries(selectedDrIds, routedDrIds, missingDrIds);
      if (decision.action === "fail") {
        // Desfaz as rotas recém-criadas pra não despachar onda incompleta.
        // (As DRs ainda NÃO foram transicionadas — isso só acontece depois deste bloco —
        //  então basta apagar os Route recém-criados; nada mais aponta pra eles.)
        if (createdRouteIds.length > 0) {
          await prisma.route.deleteMany({ where: { id: { in: createdRouteIds } } });
        }
        return markFailed(waveId, decision.message);
      }
      // action === "proceed": segue distribuindo o que deu certo, mas registra aviso.
      // As entregas órfãs também aparecem na tela de detalhe da wave (getWaveDetail → orphans).
      distributionWarning = {
        missingCount:  missingDrIds.length,
        selectedCount: selectedDrIds.length,
        missingDrIds,
      };
      console.warn(
        `[routing-wave] wave ${waveId}: ${missingDrIds.length}/${selectedDrIds.length} entrega(s) sem rota — prosseguindo. IDs: ${missingDrIds.join(", ")}`,
      );
    }

    // 5. Atualiza DeliveryRequests para ROTEIRIZADO
    for (const [drId, routeId] of requestToRouteMap.entries()) {
      try {
        await transitionDeliveryRequest({
          requestId: drId,
          actorId:   wave.createdById,
          actorRole: "SYSTEM",
          toStatus:  "ROTEIRIZADO",
          metadata:  { routeId, waveId },
        });
      } catch (err) {
        console.error(`[routing-wave] falha ao avançar DR ${drId} → ROTEIRIZADO`, err);
      }
    }

    // 6. Marca wave como DISTRIBUTED (grava o aviso de distribuição, se houver)
    return prisma.routingWave.update({
      where: { id: waveId },
      data: {
        status:        RoutingWaveStatus.DISTRIBUTED,
        distributedAt: new Date(),
        ...(distributionWarning
          ? { metadata: { ...meta, distributionWarning } as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  } catch (err) {
    return markFailed(waveId, errToString(err));
  }
}

// ──────────────────────────────────────────────
// POLÍTICA DE RECONCILIAÇÃO  ←  DECISÃO DE NEGÓCIO (Alberto)
// ──────────────────────────────────────────────
// Chamada quando, após a distribuição, alguma entrega selecionada NÃO entrou
// em nenhuma rota (ex.: 14 selecionadas, só 13 roteadas).
//
// Política escolhida pelo Alberto: "proceed" — despacha o que deu certo e deixa as
// entregas órfãs visíveis na tela de detalhe da wave (getWaveDetail → orphans) pra
// serem re-roteirizadas. Menos disruptivo que falhar a onda inteira.
//
// Alternativas (caso mude de ideia):
//   "fail"    → falha a onda inteira, apaga as rotas criadas, operador refaz tudo.
//   híbrido   → falhar só se faltar mais de X%; senão prosseguir.
type MissingDeliveryDecision =
  | { action: "fail"; message: string }
  | { action: "proceed" };

function decideOnMissingDeliveries(
  selectedDrIds: string[],
  routedDrIds:   string[],
  missingDrIds:  string[],
): MissingDeliveryDecision {
  return { action: "proceed" };
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

async function markFailed(waveId: string, message: string) {
  console.error(`[routing-wave] wave ${waveId} FAILED: ${message}`);
  return prisma.routingWave.update({
    where: { id: waveId },
    data: {
      status:       RoutingWaveStatus.FAILED,
      errorMessage: message.slice(0, 1000), // cap pra não estourar tamanho da coluna
    },
  });
}

function errToString(err: unknown): string {
  if (err instanceof SpokeError) {
    // Inclui body da resposta — o Spoke retorna detalhes do erro de validação aqui
    const bodyStr = typeof err.body === "string"
      ? err.body
      : JSON.stringify(err.body);
    return `${err.message} | body: ${bodyStr}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ──────────────────────────────────────────────
// LISTAGEM
// ──────────────────────────────────────────────

export async function listWaves(filters: { limit?: number; offset?: number } = {}) {
  return prisma.routingWave.findMany({
    take:    filters.limit  ?? 20,
    skip:    filters.offset ?? 0,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      routes:    {
        select: {
          id: true, name: true, driverId: true, stopCount: true,
          driver: { select: { id: true, name: true } },
        },
      },
    },
  });
}

// Exclui uma wave que ainda não tem rotas despachadas.
// - FAILED/DRAFT/SENT/OPTIMIZED: deleta direto
// - DISTRIBUTED: deleta apenas se nenhuma Route foi despachada; reverte DRs das routes ACTIVE
// - DISPATCHED/COMPLETED: recusa (operação irreversível)
//
// Não tenta deletar o Plan no Spoke (sem endpoint público na API v0.2b).
export async function deleteWave(waveId: string, operatorId: string) {
  const wave = await prisma.routingWave.findUnique({
    where:   { id: waveId },
    include: { routes: { select: { id: true, status: true, sequenceJson: true, driverId: true } } },
  });
  if (!wave) throw new Error("Wave não encontrada");

  if (wave.status === RoutingWaveStatus.DISPATCHED || wave.status === RoutingWaveStatus.COMPLETED) {
    throw new Error(`Wave com status ${wave.status} não pode ser excluída — rotas já saíram para entrega.`);
  }

  // Se há rotas despachadas, recusa
  const hasDispatchedRoute = wave.routes.some((r) => r.status === "DISPATCHED");
  if (hasDispatchedRoute) {
    throw new Error("Wave possui rota já despachada — cancele o despacho antes de excluir a wave.");
  }

  // Reverte cada Route ACTIVE (deleta + libera motorista + reverte DRs)
  for (const route of wave.routes) {
    if (route.status === "ACTIVE") {
      try {
        await deleteRoute(route.id, operatorId);
      } catch (err) {
        console.error(`[wave-delete] falha ao remover route ${route.id}`, err);
      }
    }
  }

  await prisma.routingWave.delete({ where: { id: wave.id } });
  return { waveId: wave.id, status: wave.status };
}

// ──────────────────────────────────────────────
// PARADA EXTRA NUMA ROTA
//
// sequenceJson é Json[], suporta itens com formato distinto:
//   - DELIVERY (padrão):   { stopPosition, deliveryRequestId, eta }
//   - STORE_VISIT:         { stopPosition, type: "STORE_VISIT", storeId, notes, lat, lng }
//   - EXTRA_STOP:          { stopPosition, type: "EXTRA_STOP", address, notes, lat, lng }
//
// Permite operador adicionar uma parada extra mesmo após o despacho — útil
// quando precisa passar numa loja pra pegar algo durante o trajeto.
// ──────────────────────────────────────────────

export interface ExtraStopInput {
  kind:                "STORE_VISIT" | "EXTRA_STOP";
  storeId?:            string;
  address?:            string;
  lat?:                number | null;
  lng?:                number | null;
  notes?:              string;
  insertAtPosition?:   number;  // se omitido, vai pro final
}

export async function addExtraStopToRoute(routeId: string, input: ExtraStopInput) {
  const route = await prisma.route.findUnique({
    where:  { id: routeId },
    select: { id: true, status: true, sequenceJson: true },
  });
  if (!route) throw new Error("Rota não encontrada");
  if (route.status === "COMPLETED" || route.status === "CANCELLED") {
    throw new Error(`Não é possível adicionar parada em rota ${route.status}`);
  }
  if (input.kind === "STORE_VISIT" && !input.storeId) {
    throw new Error("storeId obrigatório para STORE_VISIT");
  }
  if (input.kind === "EXTRA_STOP" && !input.address) {
    throw new Error("address obrigatório para EXTRA_STOP");
  }

  const seq = (route.sequenceJson as unknown as Array<Record<string, unknown>> | null) ?? [];
  const maxPos = seq.reduce((m, s) => Math.max(m, Number(s.stopPosition ?? 0)), 0);
  const insertAt = input.insertAtPosition ?? maxPos + 1;

  // Cria entry com identifier único pra futuro DELETE
  const stopId = `extra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const newStop: Record<string, unknown> = {
    stopId,
    stopPosition: insertAt,
    type:         input.kind,
    notes:        input.notes ?? null,
    lat:          input.lat  ?? null,
    lng:          input.lng  ?? null,
  };
  if (input.kind === "STORE_VISIT") newStop.storeId = input.storeId;
  if (input.kind === "EXTRA_STOP")  newStop.address = input.address;

  // Renumera entradas existentes >= insertAt pra abrir espaço
  const updated = [
    ...seq.map((s) => {
      const pos = Number(s.stopPosition ?? 0);
      return pos >= insertAt ? { ...s, stopPosition: pos + 1 } : s;
    }),
    newStop,
  ].sort((a, b) => Number(a.stopPosition ?? 0) - Number(b.stopPosition ?? 0));

  await prisma.route.update({
    where: { id: routeId },
    data:  {
      sequenceJson: updated as unknown as Prisma.InputJsonValue,
      stopCount:    updated.length,
    },
  });

  return { routeId, stopId, stopPosition: insertAt, total: updated.length };
}

export async function removeExtraStop(routeId: string, stopId: string) {
  const route = await prisma.route.findUnique({
    where:  { id: routeId },
    select: { id: true, status: true, sequenceJson: true },
  });
  if (!route) throw new Error("Rota não encontrada");
  if (route.status === "COMPLETED" || route.status === "CANCELLED") {
    throw new Error(`Não é possível remover parada em rota ${route.status}`);
  }

  const seq = (route.sequenceJson as unknown as Array<Record<string, unknown>> | null) ?? [];
  const target = seq.find((s) => s.stopId === stopId);
  if (!target) throw new Error("Parada não encontrada");
  if (target.type !== "STORE_VISIT" && target.type !== "EXTRA_STOP") {
    throw new Error("Só é possível remover paradas extras (DELIVERY usa cancelamento de DR)");
  }

  const removedPos = Number(target.stopPosition ?? 0);
  const updated = seq
    .filter((s) => s.stopId !== stopId)
    .map((s) => {
      const pos = Number(s.stopPosition ?? 0);
      return pos > removedPos ? { ...s, stopPosition: pos - 1 } : s;
    });

  await prisma.route.update({
    where: { id: routeId },
    data:  {
      sequenceJson: updated as unknown as Prisma.InputJsonValue,
      stopCount:    updated.length,
    },
  });

  return { routeId, removed: stopId, total: updated.length };
}

export async function getWaveDetail(waveId: string) {
  const wave = await prisma.routingWave.findUnique({
    where: { id: waveId },
    include: {
      createdBy: { select: { id: true, name: true } },
      routes: {
        include: {
          driver: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });
  if (!wave) return null;

  // Coleta IDs das DRs que foram incluídas em alguma rota (sucesso)
  const routedIds = new Set<string>();
  for (const r of wave.routes) {
    const seq = (r.sequenceJson as unknown as Array<{ deliveryRequestId: string }> | null) ?? [];
    for (const s of seq) routedIds.add(s.deliveryRequestId);
  }

  // Lista de DRs originalmente pedidas (vem em metadata.deliveryRequestIds quando criou a wave)
  const meta = wave.metadata as unknown as { deliveryRequestIds?: string[]; driverIds?: string[] } | null;
  const requestedIds: string[] = meta?.deliveryRequestIds ?? [];
  const orphanIds = requestedIds.filter((id) => !routedIds.has(id));

  // Busca dados (NF, cliente, status) de todas as DRs relevantes (roteadas + órfãs)
  // pra UI poder mostrar NF em vez de só o ID.
  const allIds = Array.from(new Set([...routedIds, ...orphanIds]));
  const drData = allIds.length > 0
    ? await prisma.deliveryRequest.findMany({
        where:  { id: { in: allIds } },
        select: {
          id:              true,
          orderNumber:     true,
          invoiceNumber:   true,
          customerName:    true,
          deliveryAddress: true,
          status:          true,
        },
      })
    : [];
  const drMap = new Map(drData.map((d) => [d.id, d]));

  // Órfãs só fazem sentido se ainda estão em status que permite roteirização.
  // Se já viraram OCORRENCIA/CANCELLED, ignora (não vale re-roteirizar lixo).
  const orphans = orphanIds
    .map((id) => drMap.get(id))
    .filter((dr): dr is NonNullable<typeof dr> => Boolean(dr))
    .filter((dr) => dr.status === "PRONTO_ROTEIRIZACAO" || dr.status === "ROTEIRIZADO");

  return {
    ...wave,
    orphans,
    drMap,
  };
}

// ──────────────────────────────────────────────
// SYNC DRIVERS DO SPOKE
// Importa todos os motoristas do Spoke para o banco local.
// - Upsert por spokeDriverId
// - Vincula à loja CD (código "132") — motorista da matriz
// - Remove placeholders sem spokeDriverId (drivers locais que nunca foram sincronizados)
// ──────────────────────────────────────────────

export async function syncDriversFromSpoke() {
  if (!isSpokeConfigured()) {
    throw new Error("Integração com Spoke não está configurada (SPOKE_API_URL/SPOKE_API_KEY).");
  }

  // Loja CD — todos os motoristas Spoke ficam vinculados aqui
  const cdStore = await prisma.store.findFirst({
    where:  { code: "132", active: true },
    select: { id: true },
  });
  if (!cdStore) {
    throw new Error("Loja CD (código 132) não encontrada ou inativa.");
  }

  const spokeDrivers = await listDrivers();
  const activeSpoke = spokeDrivers.filter((d) => d.active !== false);

  let created = 0;
  let updated = 0;
  let usersCreated = 0;

  for (const sd of activeSpoke) {
    const driverName = sd.displayName?.trim() || sd.name;
    const existing = await prisma.driver.findUnique({
      where: { spokeDriverId: sd.id },
    });

    let driverId: string;
    if (existing) {
      const upd = await prisma.driver.update({
        where: { id: existing.id },
        data: {
          name:    driverName,
          email:   sd.email ?? existing.email,
          phone:   sd.phone ?? existing.phone,
          storeId: cdStore.id,
          active:  true,
        },
      });
      driverId = upd.id;
      updated++;
    } else {
      const nw = await prisma.driver.create({
        data: {
          name:          driverName,
          email:         sd.email ?? null,
          phone:         sd.phone ?? "",
          storeId:       cdStore.id,
          spokeDriverId: sd.id,
          active:        true,
          available:     true,
        },
      });
      driverId = nw.id;
      created++;
    }

    // Garante User correspondente para login do motorista.
    // Senha placeholder aleatória — Alberto define a real via tela admin (nunca usada para login).
    if (sd.email) {
      const driver = await prisma.driver.findUnique({ where: { id: driverId } });
      if (driver && !driver.userId) {
        // Tenta achar User existente por email (caso já tenha sido criado manualmente)
        let user = await prisma.user.findUnique({ where: { email: sd.email } });
        if (!user) {
          const randomPlaceholder = Math.random().toString(36).slice(2) + Date.now().toString(36);
          user = await prisma.user.create({
            data: {
              name:     driverName,
              email:    sd.email,
              password: await hashPassword(randomPlaceholder),
              role:     "DRIVER",
              storeId:  cdStore.id,
              active:   true,
            },
          });
          usersCreated++;
        }
        await prisma.driver.update({
          where: { id: driverId },
          data:  { userId: user.id },
        });
      }
    }
  }

  // Deleta placeholders antigos (drivers sem spokeDriverId).
  // Se algum estiver referenciado em Dispatch/Route, FK impede e desativamos como fallback.
  let deleted = 0;
  let deactivated = 0;
  const placeholders = await prisma.driver.findMany({
    where:  { spokeDriverId: null },
    select: { id: true, name: true },
  });

  for (const p of placeholders) {
    try {
      await prisma.driver.delete({ where: { id: p.id } });
      deleted++;
    } catch {
      // FK constraint — driver tem Dispatch/Route. Apenas desativa.
      await prisma.driver.update({
        where: { id: p.id },
        data:  { active: false, available: false },
      });
      deactivated++;
    }
  }

  return {
    spokeDriversTotal: spokeDrivers.length,
    spokeActive:       activeSpoke.length,
    created,
    updated,
    usersCreated,
    placeholdersDeleted:     deleted,
    placeholdersDeactivated: deactivated,
  };
}
