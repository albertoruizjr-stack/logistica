// services/responsavel.service.ts
// Centraliza a regra "quem é responsável pela próxima ação de uma solicitação".
//
// Inputs:
//   - status atual da DeliveryRequest
//   - entregaPeloCD (Boolean — espelha cabecalho.entregaPeloCD do Citel)
//   - storeId (loja do vendedor / origem comercial)
//   - dispatchStoreId (loja de despacho operacional; 132 se entregaPeloCD)
//
// Outputs:
//   - { responsibleStoreId, primaryRole, fallbackRoles, label }
//
// Regra geral (definida em 2026-05-16 com Alberto):
//   - SEPARAÇÃO (PENDING/AWAITING_TRANSFER):
//       entregaPeloCD=true  → STOCK_OPERATOR do CD (Jhow)
//       entregaPeloCD=false → STORE_LEADER da loja do vendedor (separação local)
//   - PÓS-SEPARAÇÃO (SEPARADO em diante):
//       entregaPeloCD=true  → LOGISTICS_OPERATOR do CD (Jane)
//       entregaPeloCD=false → STORE_LEADER da loja do vendedor (despacho local)
//   - ADMIN é override global (sempre pode agir, em qualquer loja).
//   - STORE_LEADER da loja responsável é fallback (sempre pode agir).

import { Role } from "@prisma/client";

export interface RequestRefsForResponsibility {
  status:          string;
  storeId:         string;
  dispatchStoreId: string | null;
  entregaPeloCD:   boolean;
}

export interface ResponsibilityInfo {
  responsibleStoreId: string;
  primaryRole:        Role;            // role principal esperada pela ação
  fallbackRoles:      Role[];          // outras roles que também podem agir
  actionLabel:        string;          // label legível: "separação", "vinculação de NF", etc.
}

// Mapa de status → ação canônica
const STATUS_LABELS: Record<string, string> = {
  PENDING:             "separação",
  AWAITING_TRANSFER:   "separação",
  SEPARADO:            "solicitação de NF ao CD",
  AGUARDANDO_NF:       "vinculação de NF",
  NF_VINCULADA:        "liberação para roteirização",
  PRONTO_ROTEIRIZACAO: "roteirização",
  ROTEIRIZADO:         "despacho",
  DISPATCHED:          "entrega",
  IN_TRANSIT:          "entrega",
};

// Status considerado "etapa de separação" (responsável depende de entregaPeloCD)
const SEPARATION_STATUSES = new Set(["PENDING", "AWAITING_TRANSFER"]);

export function getResponsibility(req: RequestRefsForResponsibility): ResponsibilityInfo | null {
  const actionLabel = STATUS_LABELS[req.status];
  if (!actionLabel) return null;

  const isSeparation = SEPARATION_STATUSES.has(req.status);

  // Loja responsável:
  //   - separação: depende de entregaPeloCD → se true, CD (dispatchStoreId); senão storeId
  //   - pós-separação: sempre dispatchStoreId (CD se entregaPeloCD, senão storeId — operação local)
  const responsibleStoreId = isSeparation
    ? (req.entregaPeloCD ? (req.dispatchStoreId ?? req.storeId) : req.storeId)
    : (req.dispatchStoreId ?? req.storeId);

  // Role primária e fallbacks:
  if (isSeparation) {
    // SEPARAÇÃO: estoquista é o principal; líder de loja também pode
    return {
      responsibleStoreId,
      primaryRole:   Role.STOCK_OPERATOR,
      fallbackRoles: [Role.STORE_LEADER, Role.OPERATOR],
      actionLabel,
    };
  }

  // PÓS-SEPARAÇÃO: operador de logística é o principal; líder de loja também pode
  return {
    responsibleStoreId,
    primaryRole:   Role.LOGISTICS_OPERATOR,
    fallbackRoles: [Role.STORE_LEADER, Role.OPERATOR],
    actionLabel,
  };
}

// Helper: o usuário X pode agir nessa solicitação?
// ADMIN sempre pode. Outros: precisa estar na loja responsável E ter role compatível.
// Aceita role como string (compat com session.role do JWT) ou Role enum.
export function canUserAct(
  user: { role: string; storeId: string },
  responsibility: ResponsibilityInfo | null,
): boolean {
  if (!responsibility) return false;
  if (user.role === "ADMIN") return true;
  if (user.storeId !== responsibility.responsibleStoreId) return false;
  const allowedRoles: string[] = [responsibility.primaryRole, ...responsibility.fallbackRoles];
  return allowedRoles.includes(user.role);
}
