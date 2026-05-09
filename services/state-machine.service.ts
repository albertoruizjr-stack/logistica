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
  [S.SEPARADO]:            [S.AGUARDANDO_NF, S.CANCELLED, S.OCORRENCIA],
  [S.AGUARDANDO_NF]:       [S.NF_EMITIDA, S.CANCELLED, S.OCORRENCIA],
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
  deliveryAddress: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  invoiceNumber: string | null;
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
      if (!request.deliveryLat || !request.deliveryLng) {
        throw new StateMachineError(
          "Coordenadas de entrega ausentes. Execute a geocodificação do endereço antes de avançar.",
          "GATE_FAILED"
        );
      }
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

  // Valida gates operacionais
  await validateOperationalGates(tx, request, ctx.toStatus, ctx.metadata);

  // Dados extras por status
  const extraData = buildStatusUpdateData(ctx.toStatus, ctx.metadata);

  // Atualiza status + campos extras
  const updated = await tx.deliveryRequest.update({
    where: { id: requestId },
    data: { status: ctx.toStatus, ...extraData },
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

  return updated;
}

// ──────────────────────────────────────────────
// API PÚBLICA — transitionDeliveryRequest
// Cria sua própria transaction. Use para chamadas standalone.
// ──────────────────────────────────────────────

export async function transitionDeliveryRequest(
  ctx: TransitionContext
): Promise<{ id: string; status: DeliveryRequestStatus }> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.deliveryRequest.findUnique({
      where: { id: ctx.requestId },
      select: {
        id: true,
        status: true,
        deliveryAddress: true,
        deliveryLat: true,
        deliveryLng: true,
        invoiceNumber: true,
      },
    });

    if (!request) {
      throw new StateMachineError("Solicitação de entrega não encontrada.", "NOT_FOUND");
    }

    return _applyTransition(tx, ctx.requestId, request.status, request, ctx);
  });
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
      status: true,
      deliveryAddress: true,
      deliveryLat: true,
      deliveryLng: true,
      invoiceNumber: true,
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
    default:                  return { status: 500, code: "INTERNAL_ERROR", message: err.message };
  }
}
