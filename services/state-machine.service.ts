// ──────────────────────────────────────────────
// STATE MACHINE — DeliveryRequest
//
// Ponto central e único de controle de transições de status.
// Todas as mudanças de status DEVEM passar por este serviço.
//
// Oferece duas APIs:
//   transitionDeliveryRequest()         — cria sua própria transaction
//   transitionDeliveryRequestWithTx()   — usa transaction existente (evita aninhamento)
// ──────────────────────────────────────────────

import { DeliveryRequestStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateClaimOwnership, ClaimError, type ClaimInfo } from "./claim.service";
import { DeliveryType, DispatchWindow, SLAType } from "@prisma/client";

const S = DeliveryRequestStatus;

// ──────────────────────────────────────────────
// ESTADOS TERMINAIS
// ──────────────────────────────────────────────

export const TERMINAL_STATES = new Set<DeliveryRequestStatus>([
  S.DELIVERED,
  S.CANCELLED,
]);

// ──────────────────────────────────────────────
// MAPA DE TRANSIÇÕES PERMITIDAS
//
// Regra geral: avança para frente no fluxo ou para OCORRENCIA/CANCELLED.
// OCORRENCIA permite retornar a qualquer estado anterior (resolução operacional).
// READY é mantido para compatibilidade com o fluxo legado.
// ──────────────────────────────────────────────

export const ALLOWED_TRANSITIONS: Record<DeliveryRequestStatus, DeliveryRequestStatus[]> = {
  // Fase de preparação
  [S.PENDING]:             [S.AWAITING_ITEMS, S.AWAITING_TRANSFER, S.SEPARADO, S.CANCELLED],
  [S.AWAITING_ITEMS]:      [S.PENDING, S.AWAITING_TRANSFER, S.SEPARADO, S.CANCELLED, S.OCORRENCIA],
  [S.AWAITING_TRANSFER]:   [S.SEPARADO, S.AWAITING_ITEMS, S.CANCELLED, S.OCORRENCIA],
  // Fase fiscal
  // SEPARADO → NF_VINCULADA é o caminho novo: cron Citel vincula NF automaticamente
  // e dispara as transições. AGUARDANDO_NF mantido como fallback manual.
  [S.SEPARADO]:            [S.NF_VINCULADA, S.AGUARDANDO_NF, S.CANCELLED, S.OCORRENCIA],
  // Etapa NF unificada: "NF emitida no Citel" leva direto pra NF_VINCULADA.
  [S.AGUARDANDO_NF]:       [S.NF_VINCULADA, S.NF_EMITIDA, S.CANCELLED, S.OCORRENCIA],
  // NF_EMITIDA mantida só pra registros antigos — pode evoluir para NF_VINCULADA.
  [S.NF_EMITIDA]:          [S.NF_VINCULADA, S.AGUARDANDO_NF, S.CANCELLED, S.OCORRENCIA],
  [S.NF_VINCULADA]:        [S.PRONTO_ROTEIRIZACAO, S.CANCELLED, S.OCORRENCIA],
  // Fase logística
  [S.PRONTO_ROTEIRIZACAO]: [S.ROTEIRIZADO, S.CANCELLED, S.OCORRENCIA],
  [S.ROTEIRIZADO]:         [S.DISPATCHED, S.PRONTO_ROTEIRIZACAO, S.CANCELLED, S.OCORRENCIA],
  [S.DISPATCHED]:          [S.IN_TRANSIT, S.OCORRENCIA],
  [S.IN_TRANSIT]:          [S.DELIVERED, S.OCORRENCIA],
  // Terminais
  [S.DELIVERED]:           [],
  [S.CANCELLED]:           [],
  // Ocorrência — retorna a qualquer estado pré-despacho para resolução
  [S.OCORRENCIA]:          [
    S.PENDING, S.AWAITING_ITEMS, S.AWAITING_TRANSFER,
    S.SEPARADO, S.AGUARDANDO_NF, S.NF_EMITIDA, S.NF_VINCULADA,
    S.PRONTO_ROTEIRIZACAO, S.ROTEIRIZADO, S.CANCELLED,
  ],
  // Legado — READY: usado pelo fluxo antigo antes dos novos status
  [S.READY]: [S.SEPARADO, S.PRONTO_ROTEIRIZACAO, S.DISPATCHED, S.CANCELLED, S.OCORRENCIA],
};

// ──────────────────────────────────────────────
// TIPOS PÚBLICOS
// ──────────────────────────────────────────────

export interface TransitionMetadata {
  reason?: string;
  // SEPARADO
  separatedBy?: string;         // userId — obrigatório
  // ROTEIRIZADO
  routeId?: string;             // obrigatório
  waveId?: string;              // opcional — wave que originou a rota
  // DISPATCHED (rota)
  dispatchedByRoute?: boolean;  // marca que o dispatch veio de uma Route inteira
  // SEPARADO com divergências (auto via transfer)
  hasDivergences?: boolean;
  totalDivergences?: number;
  // DELIVERED
  deliveredAt?: string;         // ISO date — opcional (usa now() se ausente)
  // OCORRENCIA
  occurrenceType?: string;      // ex: AVARIA, RECUSA_ENTREGA, ENDERECO_ERRADO, AUSENTE
  occurrenceNotes?: string;     // descrição detalhada (min 10 chars)
  // CANCELLED forçado (IN_TRANSIT)
  forceCancel?: boolean;
  cancellationReason?: string;  // obrigatório com forceCancel
}

export interface TransitionContext {
  requestId: string;
  actorId: string;              // userId do ator (operador, sistema, etc.)
  actorRole: string;            // "ADMIN" | "OPERATOR" | "SELLER" | "DRIVER" | "SYSTEM"
  toStatus: DeliveryRequestStatus;
  metadata?: TransitionMetadata;
}

// ──────────────────────────────────────────────
// CLASSE DE ERRO DA STATE MACHINE
// ──────────────────────────────────────────────

export class StateMachineError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_TRANSITION"
      | "GATE_FAILED"
      | "PERMISSION_DENIED"
      | "NOT_FOUND"
      | "CLAIM_VIOLATION",
    // Preenchido apenas em CLAIM_VIOLATION — contém info do operador que tem o lock
    public readonly claimInfo?: ClaimInfo
  ) {
    super(message);
    this.name = "StateMachineError";
  }
}

// ──────────────────────────────────────────────
// VALIDAÇÃO DE TRANSIÇÃO
// Verifica se a transição é estruturalmente permitida
// e se o ator tem permissão para executá-la.
// ──────────────────────────────────────────────

export function validateTransition(
  fromStatus: DeliveryRequestStatus,
  toStatus: DeliveryRequestStatus,
  actorRole: string,
  metadata?: TransitionMetadata
): void {
  // Terminais nunca transitam
  if (TERMINAL_STATES.has(fromStatus)) {
    throw new StateMachineError(
      `${fromStatus} é um estado terminal — nenhuma transição é permitida.`,
      "INVALID_TRANSITION"
    );
  }

  // Cancelamento de IN_TRANSIT: requer ADMIN + forceCancel explícito
  if (fromStatus === S.IN_TRANSIT && toStatus === S.CANCELLED) {
    if (actorRole !== "ADMIN") {
      throw new StateMachineError(
        "Cancelar uma entrega em trânsito requer perfil ADMIN.",
        "PERMISSION_DENIED"
      );
    }
    if (!metadata?.forceCancel || !metadata.cancellationReason) {
      throw new StateMachineError(
        "Para cancelar em trânsito: forceCancel=true e cancellationReason são obrigatórios.",
        "GATE_FAILED"
      );
    }
    return; // caso especial válido
  }

  // DISPATCHED nunca volta para PENDING
  if (fromStatus === S.DISPATCHED && toStatus === S.PENDING) {
    throw new StateMachineError(
      "DISPATCHED → PENDING não é permitido. Use OCORRENCIA para registrar problemas.",
      "INVALID_TRANSITION"
    );
  }

  const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new StateMachineError(
      `Transição inválida: ${fromStatus} → ${toStatus}. ` +
      `Permitido: ${allowed.join(", ") || "(nenhum)"}`,
      "INVALID_TRANSITION"
    );
  }
}

// ──────────────────────────────────────────────
// VALIDAÇÃO DE GATES OPERACIONAIS
// Verifica pré-condições específicas para estados críticos.
// Usa o cliente de transação para evitar leituras sujas.
// ──────────────────────────────────────────────

type DbClient = Prisma.TransactionClient | typeof prisma;

interface GateRequest {
  id: string;
  storeId: string;
  deliveryAddress: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  invoiceNumber: string | null;
  slaType: SLAType;
  deliveryType: DeliveryType;
  dispatchWindow: DispatchWindow | null;
  createdAt: Date;
}

export async function validateOperationalGates(
  db: DbClient,
  request: GateRequest,
  toStatus: DeliveryRequestStatus,
  metadata?: TransitionMetadata
): Promise<void> {
  switch (toStatus) {
    case S.SEPARADO: {
      if (!metadata?.separatedBy) {
        throw new StateMachineError(
          "separatedBy (userId do estoquista) é obrigatório para marcar como SEPARADO.",
          "GATE_FAILED"
        );
      }
      // Verifica que não há itens pendentes de transferência
      const unavailable = await db.deliveryItem.findFirst({
        where: { deliveryRequestId: request.id, availableAtStore: false },
        select: { id: true },
      });
      if (unavailable) {
        throw new StateMachineError(
          "Existem itens não disponíveis na loja. Aguarde as transferências antes de marcar como SEPARADO.",
          "GATE_FAILED"
        );
      }
      break;
    }

    case S.NF_VINCULADA: {
      if (!request.invoiceNumber) {
        throw new StateMachineError(
          "Número da NF é obrigatório para NF_VINCULADA. Vincule a nota fiscal antes de avançar.",
          "GATE_FAILED"
        );
      }
      break;
    }

    case S.PRONTO_ROTEIRIZACAO: {
      if (!request.deliveryAddress) {
        throw new StateMachineError(
          "Endereço de entrega é obrigatório para roteirização.",
          "GATE_FAILED"
        );
      }
      // Coordenadas (lat/lng) NÃO são exigidas — o Spoke geocodifica internamente.
      break;
    }

    case S.ROTEIRIZADO: {
      if (!metadata?.routeId) {
        throw new StateMachineError(
          "routeId é obrigatório para ROTEIRIZADO. Atribua a solicitação a uma rota.",
          "GATE_FAILED"
        );
      }
      break;
    }

    case S.DISPATCHED: {
      const dispatch = await db.dispatch.findFirst({
        where: { deliveryRequestId: request.id },
        select: { id: true },
      });
      if (!dispatch) {
        throw new StateMachineError(
          "Nenhum despacho encontrado para esta solicitação. Crie o despacho antes de marcar como DISPATCHED.",
          "GATE_FAILED"
        );
      }
      break;
    }

    case S.OCORRENCIA: {
      if (!metadata?.occurrenceType) {
        throw new StateMachineError(
          "occurrenceType é obrigatório ao registrar uma ocorrência (ex: AVARIA, RECUSA_ENTREGA, ENDERECO_ERRADO).",
          "GATE_FAILED"
        );
      }
      if (!metadata.occurrenceNotes || metadata.occurrenceNotes.trim().length < 10) {
        throw new StateMachineError(
          "occurrenceNotes deve ter pelo menos 10 caracteres descrevendo a ocorrência.",
          "GATE_FAILED"
        );
      }
      break;
    }

    // IN_TRANSIT, DELIVERED, CANCELLED, demais: sem gate extra (validação estrutural já cobre)
    default:
      break;
  }
}

// ──────────────────────────────────────────────
// DADOS DE UPDATE POR STATUS
// Campos adicionais que devem ser preenchidos em cada transição.
// ──────────────────────────────────────────────

function buildStatusUpdateData(
  toStatus: DeliveryRequestStatus,
  metadata?: TransitionMetadata
): Prisma.DeliveryRequestUpdateInput {
  switch (toStatus) {
    case S.SEPARADO:
      return {
        separatedBy: metadata?.separatedBy,
        separatedAt: new Date(),
        isComplete: true,
      };

    case S.OCORRENCIA:
      return {
        occurrenceType: metadata?.occurrenceType,
        occurrenceNotes: metadata?.occurrenceNotes,
      };

    case S.CANCELLED:
      if (metadata?.cancellationReason) {
        return { notes: `[CANCELADO] ${metadata.cancellationReason}` };
      }
      return {};

    // Limpa campos de ocorrência ao sair do estado OCORRENCIA
    case S.PENDING:
    case S.AWAITING_ITEMS:
    case S.AWAITING_TRANSFER:
    case S.AGUARDANDO_NF:
    case S.PRONTO_ROTEIRIZACAO:
      return { occurrenceType: null, occurrenceNotes: null };

    default:
      return {};
  }
}

// ──────────────────────────────────────────────
// SNAPSHOT DE MÉTRICAS OPERACIONAIS
// Fecha o snapshot do status anterior e abre novo.
// Best-effort: erros não bloqueiam a transição.
// ──────────────────────────────────────────────

async function _recordSnapshot(
  tx: DbClient,
  requestId: string,
  fromStatus: DeliveryRequestStatus,
  toStatus: DeliveryRequestStatus,
  request: GateRequest,
  actorId: string,
): Promise<void> {
  const now = new Date();

  try {
    // Lookup operator name (only for human actors)
    let operatorName: string | null = null;
    if (actorId !== "SYSTEM") {
      const user = await tx.user.findUnique({
        where: { id: actorId },
        select: { name: true },
      });
      operatorName = user?.name ?? null;
    }

    // Find the open snapshot for this request
    let openSnapshot = await tx.operationalMetricsSnapshot.findFirst({
      where: { deliveryRequestId: requestId, exitedAt: null },
      select: { id: true, enteredAt: true },
      orderBy: { enteredAt: "desc" },
    });

    // If no open snapshot exists and this is the first transition,
    // create a retroactive one for the initial PENDING state
    if (!openSnapshot) {
      const count = await tx.operationalMetricsSnapshot.count({
        where: { deliveryRequestId: requestId },
      });
      if (count === 0) {
        const retroactive = await tx.operationalMetricsSnapshot.create({
          data: {
            deliveryRequestId: requestId,
            status:            fromStatus,
            enteredAt:         request.createdAt,
            storeId:           request.storeId,
            slaType:           request.slaType,
            deliveryType:      request.deliveryType,
            dispatchWindow:    request.dispatchWindow,
          },
          select: { id: true, enteredAt: true },
        });
        openSnapshot = retroactive;
      }
    }

    // Close the previous snapshot
    if (openSnapshot) {
      const durationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - openSnapshot.enteredAt.getTime()) / 1000)
      );
      await tx.operationalMetricsSnapshot.update({
        where: { id: openSnapshot.id },
        data: { exitedAt: now, durationSeconds },
      });
    }

    // Don't open a new snapshot for terminal states
    if (toStatus === S.DELIVERED || toStatus === S.CANCELLED) return;

    await tx.operationalMetricsSnapshot.create({
      data: {
        deliveryRequestId: requestId,
        status:            toStatus,
        enteredAt:         now,
        operatorId:        actorId !== "SYSTEM" ? actorId : null,
        operatorName,
        storeId:           request.storeId,
        slaType:           request.slaType,
        deliveryType:      request.deliveryType,
        dispatchWindow:    request.dispatchWindow,
      },
    });
  } catch (err) {
    // Snapshot failure never blocks the operational transition
    console.error("[snapshot] Falha ao registrar snapshot:", err);
  }
}

// ──────────────────────────────────────────────
// NÚCLEO DA TRANSIÇÃO (uso interno)
// Executa dentro de uma tx existente — nunca cria transaction.
// ──────────────────────────────────────────────

async function _applyTransition(
  tx: DbClient,
  requestId: string,
  fromStatus: DeliveryRequestStatus,
  request: GateRequest,
  ctx: Omit<TransitionContext, "requestId">
): Promise<{ id: string; status: DeliveryRequestStatus }> {
  // Valida estruturalmente
  validateTransition(fromStatus, ctx.toStatus, ctx.actorRole, ctx.metadata);

  // Valida ownership do claim (atores do sistema são isentos)
  if (ctx.actorId !== "SYSTEM") {
    try {
      await validateClaimOwnership(tx, requestId, ctx.actorId);
    } catch (err) {
      if (err instanceof ClaimError && err.code === "CLAIMED_BY_OTHER") {
        throw new StateMachineError(err.message, "CLAIM_VIOLATION", err.claim);
      }
      throw err;
    }
  }

  // Valida gates operacionais
  await validateOperationalGates(tx, request, ctx.toStatus, ctx.metadata);

  // Dados extras por status
  const extraData = buildStatusUpdateData(ctx.toStatus, ctx.metadata);

  // Atualiza status + campos extras + libera o claim do ator após transição bem-sucedida
  const updated = await tx.deliveryRequest.update({
    where: { id: requestId },
    data: {
      status: ctx.toStatus,
      ...extraData,
      // Libera o claim se o ator é o dono (ou se não há claim)
      ...(ctx.actorId !== "SYSTEM" ? {
        lockedBy:      null,
        lockedByName:  null,
        lockedAt:      null,
        lockExpiresAt: null,
        lockReason:    null,
      } : {}),
    },
    select: { id: true, status: true },
  });

  // Registra no histórico de auditoria
  await tx.deliveryStatusHistory.create({
    data: {
      deliveryRequestId: requestId,
      fromStatus,
      toStatus: ctx.toStatus,
      changedById: ctx.actorId !== "SYSTEM" ? ctx.actorId : null,
      reason: ctx.metadata?.reason,
      metadata: ctx.metadata
        ? (ctx.metadata as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });

  // Registra snapshot de métricas operacionais (best-effort)
  await _recordSnapshot(tx, requestId, fromStatus, ctx.toStatus, request, ctx.actorId);

  return updated;
}

// ──────────────────────────────────────────────
// API PÚBLICA — transitionDeliveryRequest
// Cria sua própria transaction. Use para chamadas standalone.
// ──────────────────────────────────────────────

export async function transitionDeliveryRequest(
  ctx: TransitionContext
): Promise<{ id: string; status: DeliveryRequestStatus }> {
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.deliveryRequest.findUnique({
      where: { id: ctx.requestId },
      select: {
        id: true,
        storeId: true,
        status: true,
        deliveryAddress: true,
        deliveryLat: true,
        deliveryLng: true,
        invoiceNumber: true,
        slaType: true,
        deliveryType: true,
        dispatchWindow: true,
        createdAt: true,
      },
    });

    if (!request) {
      throw new StateMachineError("Solicitação de entrega não encontrada.", "NOT_FOUND");
    }

    return _applyTransition(tx, ctx.requestId, request.status, request, ctx);
  });

  // Pós-commit: notifica o próximo responsável (best-effort, não bloqueia).
  // Excluir o ator atual (quem acabou de fazer a ação não recebe notificação pra próxima).
  void (async () => {
    try {
      const { notifyNextResponsible } = await import("@/services/notifications.service");
      await notifyNextResponsible({
        deliveryRequestId: ctx.requestId,
        excludeUserId:     ctx.actorId !== "SYSTEM" ? ctx.actorId : undefined,
      });
    } catch (err) {
      console.error("[state-machine] notifyNextResponsible falhou:", err instanceof Error ? err.message : err);
    }
  })();

  return result;
}

// ──────────────────────────────────────────────
// API PÚBLICA — transitionDeliveryRequestWithTx
// Usa tx existente. Ideal para serviços que já estão em transaction
// (createDispatch, updateDispatchStatus, checkAndAdvanceDeliveryRequest).
// Evita transações aninhadas que o Prisma/PostgreSQL não suporta.
// ──────────────────────────────────────────────

export async function transitionDeliveryRequestWithTx(
  tx: Prisma.TransactionClient,
  requestId: string,
  ctx: Omit<TransitionContext, "requestId">
): Promise<{ id: string; status: DeliveryRequestStatus }> {
  const request = await tx.deliveryRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      storeId: true,
      status: true,
      deliveryAddress: true,
      deliveryLat: true,
      deliveryLng: true,
      invoiceNumber: true,
      slaType: true,
      deliveryType: true,
      dispatchWindow: true,
      createdAt: true,
    },
  });

  if (!request) {
    throw new StateMachineError("Solicitação de entrega não encontrada.", "NOT_FOUND");
  }

  return _applyTransition(tx, requestId, request.status, request, ctx);
}

// ──────────────────────────────────────────────
// HELPER: mapeia StateMachineError para HTTP status
// ──────────────────────────────────────────────

export function stateMachineErrorToHttp(err: StateMachineError): {
  status: number;
  code: string;
  message: string;
} {
  switch (err.code) {
    case "NOT_FOUND":         return { status: 404, code: err.code, message: err.message };
    case "PERMISSION_DENIED": return { status: 403, code: err.code, message: err.message };
    case "GATE_FAILED":       return { status: 422, code: err.code, message: err.message };
    case "INVALID_TRANSITION":return { status: 422, code: err.code, message: err.message };
    case "CLAIM_VIOLATION":   return { status: 409, code: err.code, message: err.message };
    default:                  return { status: 500, code: "INTERNAL_ERROR", message: err.message };
  }
}
