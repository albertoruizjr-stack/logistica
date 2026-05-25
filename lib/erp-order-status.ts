// Classificação do status bruto de um pedido (Autcom/Citel) + mensagens de bloqueio
// e formatação de endereço. Compartilhado entre o endpoint de consulta e a correção.
import type { ERPOrderValidationStatus, CitelEndereco } from "@/types/stock";

const STATUS_RULES: Array<{ pattern: RegExp; result: ERPOrderValidationStatus }> = [
  { pattern: /CANCEL/i,                        result: "CANCELLED"         },
  { pattern: /BLOQ/i,                          result: "BLOCKED"           },
  { pattern: /AGUARDANDO.*(APRO|LIBERA)/i,     result: "APPROVAL_PENDING"  },
  { pattern: /FATURA|NF.EMIT|ENCERR|CONCLU/i,  result: "ALREADY_FULFILLED" },
];

export const BLOCKED_MESSAGES: Record<string, string> = {
  CANCELLED:         "Pedido cancelado — não é possível criar entrega para pedidos cancelados.",
  BLOCKED:           "Pedido bloqueado — entre em contato com a equipe de crédito antes de prosseguir.",
  APPROVAL_PENDING:  "Pedido aguardando aprovação — não pode ser despachado até aprovação do comercial.",
  ALREADY_FULFILLED: "Pedido já faturado ou encerrado — a NF já foi emitida para este pedido.",
};

export function classifyOrderStatus(rawStatus: string | null): ERPOrderValidationStatus {
  if (!rawStatus) return "VALID";
  for (const { pattern, result } of STATUS_RULES) {
    if (pattern.test(rawStatus)) return result;
  }
  return "VALID";
}

export function formatEndereco(e: CitelEndereco): string {
  return [e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.estado]
    .filter(Boolean)
    .join(", ");
}
