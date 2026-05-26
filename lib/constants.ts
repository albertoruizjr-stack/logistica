// ──────────────────────────────────────────────
// CONSTANTES DO SISTEMA
// ──────────────────────────────────────────────

import { InternalVehicleType, LalamoveServiceType } from "@/types"

// códigos das lojas (para validação e seeds)
export const STORE_CODES = ["067", "131", "132", "173", "191"] as const;
export type StoreCode = (typeof STORE_CODES)[number];

// hora de corte para rota do dia — mantido para compatibilidade com código legado
export const INTERNAL_ROUTE_CUTOFF_HOUR = 16;

// regras de corte da janela de despacho (use lib/cutoff.ts para lógica completa)
export const FIRST_DISPATCH_CUTOFF_HOUR   = 17;
export const FIRST_DISPATCH_CUTOFF_MINUTE = 30;
export const SECOND_DISPATCH_CUTOFF_HOUR  = 12;
export const SECOND_DISPATCH_CUTOFF_MINUTE = 0;

// limite máximo de km para rota interna padrão (acima disso sugerir Lalamove)
export const MAX_STANDARD_KM = 20;

// multiplicador padrão para frete urgente (pode ser sobrescrito pelo banco)
export const DEFAULT_URGENT_MULTIPLIER = 1.8;

// labels dos status de transferência (pt-BR) — fluxo de 5 etapas
export const TRANSFER_STATUS_LABELS: Record<string, string> = {
  PENDING:           "Pendente",
  AWAITING_APPROVAL: "Aguard. aprovação",
  READY_TO_COLLECT:  "Pronta p/ coleta",
  IN_TRANSIT:        "Em rota",
  DELIVERED:         "Entregue",
  CANCELLED:         "Cancelada",
  // legados — preservados para transferências antigas
  APPROVED:          "Aprovada (legado)",
  PREPARING:         "Em preparação (legado)",
  PREPARED:          "Separada (legado)",
  RECEIVED:          "Recebida (legado)",
};

// labels das prioridades de transferência
export const TRANSFER_PRIORITY_LABELS: Record<string, string> = {
  ANTICIPATED: "Antecipada",
  ON_ROUTE: "Na rota",
  URGENT: "Urgente",
};

// cores de badge por status de transferência (classes Tailwind) — 5 etapas
export const TRANSFER_STATUS_COLORS: Record<string, string> = {
  PENDING:           "bg-yellow-100 text-yellow-800 border-yellow-200",
  AWAITING_APPROVAL: "bg-amber-100 text-amber-900 border-amber-200",
  READY_TO_COLLECT:  "bg-teal-100 text-teal-800 border-teal-200",
  IN_TRANSIT:        "bg-orange-100 text-orange-800 border-orange-200",
  DELIVERED:         "bg-green-100 text-green-800 border-green-200",
  CANCELLED:         "bg-gray-100 text-gray-600 border-gray-200",
  // legados
  APPROVED:          "bg-blue-100 text-blue-800 border-blue-200",
  PREPARING:         "bg-purple-100 text-purple-800 border-purple-200",
  PREPARED:          "bg-teal-100 text-teal-800 border-teal-200",
  RECEIVED:          "bg-green-100 text-green-800 border-green-200",
};

// cores por prioridade
export const TRANSFER_PRIORITY_COLORS: Record<string, string> = {
  ANTICIPATED: "bg-blue-50 text-blue-700 border-blue-200",
  ON_ROUTE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  URGENT: "bg-red-50 text-red-700 border-red-200",
};

// labels dos status de entrega
export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  AWAITING_ITEMS: "Aguard. Itens",
  AWAITING_TRANSFER: "Aguard. Transferência",
  READY: "Pronto para Despacho",
  DISPATCHED: "Despachado",
  IN_TRANSIT: "Em trânsito",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};

export const DELIVERY_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  AWAITING_ITEMS: "bg-amber-100 text-amber-800",
  AWAITING_TRANSFER: "bg-orange-100 text-orange-800",
  READY: "bg-blue-100 text-blue-800",
  DISPATCHED: "bg-purple-100 text-purple-800",
  IN_TRANSIT: "bg-indigo-100 text-indigo-800",
  DELIVERED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
};

// labels dos modais de despacho
export const DISPATCH_MODAL_LABELS: Record<string, string> = {
  INTERNAL_ROUTE: "Rota Interna",
  LALAMOVE: "Lalamove",
  PARTNER: "Parceiro",
  EXCEPTION: "Exceção Operacional",
};

// Lalamove — tipo de serviço default no Brasil (códigos atualizados 2026).
// Antigo "MOTORCYCLE" foi descontinuado; o equivalente é LALAPRO (moto com baú).
export const LALAMOVE_SERVICE_TYPE = "LALAPRO";
export const LALAMOVE_API_BASE_URL = "https://rest.lalamove.com";
// Sandbox URL corrigida: oficial é "rest.sandbox.lalamove.com" (não "sandbox-rest.lalamove.com")
export const LALAMOVE_SANDBOX_URL = "https://rest.sandbox.lalamove.com";

// Labels amigáveis por tipo de veículo Lalamove (para exibição ao operador)
export const LALAMOVE_VEHICLE_LABELS: Record<keyof typeof LalamoveServiceType, string> = {
  LALAPRO:    "LalaPro (moto)",
  UV_FIORINO: "Utilitário (Fiorino)",
  VAN:        "Van",
  TRUCK330:   "Carreto",
  TRUCK3_5T:  "Caminhão 2,5t",
};

// Motor de Decisão — identity map (códigos internos = códigos da API agora).
export const LALAMOVE_VEHICLE_MAP: Record<keyof typeof LalamoveServiceType, string> = {
  LALAPRO:    "LALAPRO",
  UV_FIORINO: "UV_FIORINO",
  VAN:        "VAN",
  TRUCK330:   "TRUCK330",
  TRUCK3_5T:  "TRUCK3_5T",
}

// Margem por tipo de veículo interno: precoBase = MAX(zona, custo × margem)
export const INTERNAL_VEHICLE_MARGINS: Record<InternalVehicleType, number> = {
  MOTO:     1.8,
  FIORINO:  1.4,
  CAMINHAO: 1.3,
}

// Margem sobre custo Lalamove quando selectedMode = LALAMOVE
export const LALAMOVE_PRICE_MARGIN = 1.15
