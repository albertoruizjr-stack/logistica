// ──────────────────────────────────────────────
// SERVIÇO DE CLAIM — Controle de Concorrência Operacional
//
// Implementa lock temporário por card para evitar que
// múltiplos operadores atuem simultaneamente na mesma
// solicitação.
//
// Regras centrais:
//   - Um claim ativo bloqueia ações críticas de outros operadores
//   - Claims expiram automaticamente (SEPARACAO=20m, FISCAL=15m, etc.)
//   - O mesmo operador pode renovar seu próprio claim
//   - Ações do sistema (actorId="SYSTEM") ignoram claims
//   - Toda validação crítica acontece no backend, dentro de transaction
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { DeliveryRequestStatus, Prisma } from "@prisma/client";

// ── Tipos públicos ───────────────────────────────────────────────────────────

export type LockReason = "SEPARACAO" | "FISCAL" | "ROTEIRIZACAO" | "DESPACHO" | "OCORRENCIA";

export interface ClaimInfo {
  lockedBy:      string;   // userId
  lockedByName:  string;   // nome do operador
  lockedAt:      Date;
  lockExpiresAt: Date;
  lockReason:    LockReason;
  minutesLeft:   number;
}

export interface ClaimResult {
  success: true;
  expiresAt: Date;
  durationMinutes: number;
}

export class ClaimError extends Error {
  constructor(
    message: string,
    public readonly code: "CLAIMED_BY_OTHER" | "NOT_FOUND" | "ALREADY_EXPIRED",
    public readonly claim?: ClaimInfo
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

// ── Duração por fase operacional ─────────────────────────────────────────────

const LOCK_DURATION_MINUTES: Record<LockReason, number> = {
  SEPARACAO:    20,
  FISCAL:       15,
  ROTEIRIZACAO: 10,
  DESPACHO:     5,
  OCORRENCIA:   15,
};

// ── Derivação automática da fase a partir do status ──────────────────────────

const S = DeliveryRequestStatus;

export function getLockReasonFromStatus(status: DeliveryRequestStatus): LockReason {
  const SEPARACAO:    DeliveryRequestStatus[] = [S.PENDING, S.AWAITING_ITEMS, S.AWAITING_TRANSFER];
  const FISCAL:       DeliveryRequestStatus[] = [S.SEPARADO, S.AGUARDANDO_NF, S.NF_EMITIDA, S.NF_VINCULADA];
  const ROTEIRIZACAO: DeliveryRequestStatus[] = [S.PRONTO_ROTEIRIZACAO, S.ROTEIRIZADO];
  const DESPACHO:     DeliveryRequestStatus[] = [S.DISPATCHED, S.IN_TRANSIT];
  if (SEPARACAO.includes(status))    return "SEPARACAO";
  if (FISCAL.includes(status))       return "FISCAL";
  if (ROTEIRIZACAO.includes(status)) return "ROTEIRIZACAO";
  if (DESPACHO.includes(status))     return "DESPACHO";
  return "OCORRENCIA";
}

// ── Helper interno ───────────────────────────────────────────────────────────

type DbClient = Prisma.TransactionClient | typeof prisma;

function isLockActive(lockExpiresAt: Date | null): boolean {
  if (!lockExpiresAt) return false;
  return lockExpiresAt > new Date();
}

function buildClaimInfo(r: {
  lockedBy: string;
  lockedByName: string;
  lockedAt: Date;
  lockExpiresAt: Date;
  lockReason: string;
}): ClaimInfo {
  const minutesLeft = Math.max(
    0,
    Math.floor((r.lockExpiresAt.getTime() - Date.now()) / 60_000)
  );
  return {
    lockedBy:      r.lockedBy,
    lockedByName:  r.lockedByName,
    lockedAt:      r.lockedAt,
    lockExpiresAt: r.lockExpiresAt,
    lockReason:    r.lockReason as LockReason,
    minutesLeft,
  };
}

// ── claimDeliveryRequest ─────────────────────────────────────────────────────
//
// Adquire o lock para o operador. Se o card já estiver claimed por outro
// operador (e o lock ainda estiver ativo), lança ClaimError com CLAIMED_BY_OTHER.
// O mesmo operador pode renovar seu próprio claim.

export async function claimDeliveryRequest(
  requestId: string,
  userId: string,
  userName: string,
  reason?: LockReason
): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    const req = await tx.deliveryRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        lockedBy: true,
        lockedByName: true,
        lockedAt: true,
        lockExpiresAt: true,
        lockReason: true,
      },
    });

    if (!req) throw new ClaimError("Solicitação não encontrada.", "NOT_FOUND");

    // Se há lock ativo de outro operador → conflito
    if (
      req.lockedBy &&
      req.lockedBy !== userId &&
      isLockActive(req.lockExpiresAt)
    ) {
      throw new ClaimError(
        `Esta solicitação está sendo operada por ${req.lockedByName}.`,
        "CLAIMED_BY_OTHER",
        buildClaimInfo({
          lockedBy:      req.lockedBy,
          lockedByName:  req.lockedByName!,
          lockedAt:      req.lockedAt!,
          lockExpiresAt: req.lockExpiresAt!,
          lockReason:    req.lockReason!,
        })
      );
    }

    // Determina o lockReason a partir do status atual se não fornecido
    const lockReason = reason ?? getLockReasonFromStatus(req.status);
    const durationMinutes = LOCK_DURATION_MINUTES[lockReason];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);

    await tx.deliveryRequest.update({
      where: { id: requestId },
      data: {
        lockedBy:      userId,
        lockedByName:  userName,
        lockedAt:      now,
        lockExpiresAt: expiresAt,
        lockReason:    lockReason,
      },
    });

    return { success: true, expiresAt, durationMinutes };
  });
}

// ── releaseClaim ─────────────────────────────────────────────────────────────
//
// Libera o lock. Só funciona se o userId for o dono do claim atual.
// Silencioso se não há claim ou já expirou.

export async function releaseClaim(
  requestId: string,
  userId: string,
  db: DbClient = prisma
): Promise<void> {
  // Só limpa se o dono é o userId informado (evita um operador liberar lock de outro)
  await db.deliveryRequest.updateMany({
    where: {
      id: requestId,
      lockedBy: userId,
    },
    data: {
      lockedBy:      null,
      lockedByName:  null,
      lockedAt:      null,
      lockExpiresAt: null,
      lockReason:    null,
    },
  });
}

// ── renewClaim ───────────────────────────────────────────────────────────────
//
// Renova o lock (estende o prazo). Apenas o dono pode renovar.

export async function renewClaim(
  requestId: string,
  userId: string,
  db: DbClient = prisma
): Promise<{ expiresAt: Date } | null> {
  const req = await db.deliveryRequest.findUnique({
    where: { id: requestId },
    select: { lockedBy: true, lockReason: true, lockExpiresAt: true },
  });

  if (!req || req.lockedBy !== userId || !isLockActive(req.lockExpiresAt)) {
    return null; // claim não pertence a este operador ou já expirou
  }

  const lockReason = (req.lockReason ?? "SEPARACAO") as LockReason;
  const durationMinutes = LOCK_DURATION_MINUTES[lockReason];
  const expiresAt = new Date(Date.now() + durationMinutes * 60_000);

  await db.deliveryRequest.update({
    where: { id: requestId },
    data: { lockExpiresAt: expiresAt },
  });

  return { expiresAt };
}

// ── validateClaimOwnership ───────────────────────────────────────────────────
//
// Valida que o userId possui o claim ativo para o requestId.
// Chamado dentro da transaction da state machine antes de aplicar a transição.
// Atores do sistema ("SYSTEM") sempre passam.

export async function validateClaimOwnership(
  db: DbClient,
  requestId: string,
  userId: string
): Promise<void> {
  // Sistema sempre pode transicionar (cron, webhooks, etc.)
  if (userId === "SYSTEM") return;

  const req = await db.deliveryRequest.findUnique({
    where: { id: requestId },
    select: {
      lockedBy:      true,
      lockedByName:  true,
      lockedAt:      true,
      lockExpiresAt: true,
      lockReason:    true,
    },
  });

  if (!req) return; // NOT_FOUND será tratado pela state machine

  // Sem lock ativo → permite (operador não pré-claimou, mas ação é sua)
  if (!req.lockedBy || !isLockActive(req.lockExpiresAt)) return;

  // Lock ativo do próprio operador → ok
  if (req.lockedBy === userId) return;

  // Lock ativo de outro operador → conflito
  throw new ClaimError(
    `Esta solicitação está sendo operada por ${req.lockedByName} — tente novamente em ${
      Math.max(0, Math.floor((req.lockExpiresAt!.getTime() - Date.now()) / 60_000))
    } minuto(s).`,
    "CLAIMED_BY_OTHER",
    buildClaimInfo({
      lockedBy:      req.lockedBy,
      lockedByName:  req.lockedByName!,
      lockedAt:      req.lockedAt!,
      lockExpiresAt: req.lockExpiresAt!,
      lockReason:    req.lockReason!,
    })
  );
}

// ── releaseExpiredClaims ─────────────────────────────────────────────────────
//
// Limpa todos os locks expirados. Chamar periodicamente (ex: a cada 5 min).
// Retorna o número de registros liberados.

export async function releaseExpiredClaims(): Promise<number> {
  const result = await prisma.deliveryRequest.updateMany({
    where: {
      lockedBy:      { not: null },
      lockExpiresAt: { lte: new Date() },
    },
    data: {
      lockedBy:      null,
      lockedByName:  null,
      lockedAt:      null,
      lockExpiresAt: null,
      lockReason:    null,
    },
  });

  return result.count;
}

// ── getActiveClaims ──────────────────────────────────────────────────────────
//
// Lista todos os claims ativos (para diagnóstico / painel admin).

export async function getActiveClaims() {
  return prisma.deliveryRequest.findMany({
    where: {
      lockedBy:      { not: null },
      lockExpiresAt: { gt: new Date() },
    },
    select: {
      id:            true,
      orderNumber:   true,
      invoiceNumber: true,
      customerName:  true,
      status:        true,
      lockedBy:      true,
      lockedByName:  true,
      lockedAt:      true,
      lockExpiresAt: true,
      lockReason:    true,
    },
    orderBy: { lockedAt: "asc" },
  });
}
