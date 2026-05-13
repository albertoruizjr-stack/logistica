// ──────────────────────────────────────────────
// PERMISSÕES DE ROLE — CONJUNTOS REUTILIZÁVEIS
//
// Modelo evolui de OPERATOR (legado) para
// STOCK_OPERATOR + LOGISTICS_OPERATOR (mais granular).
// Estes conjuntos garantem compatibilidade durante a transição.
// ──────────────────────────────────────────────

import type { Role } from "@prisma/client";

/** Roles considerados "operador" (qualquer flavor de operação) */
export const ALL_OPERATOR_ROLES: Role[] = ["OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR"];

/** Pode mudar status de transferência, validar fiscal, despachar, etc.
 *  STORE_LEADER incluso (líder de loja aprova transferências da própria loja). */
export const PRIVILEGED_ROLES: Role[] = ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"];

/** Pode acessar área administrativa total (relatórios, configurações) */
export const ADMIN_ROLES: Role[] = ["ADMIN", "LOGISTICS_OPERATOR"];

/** Pode mexer em estoque/separação/transferência (Jhow + líderes de loja) */
export const STOCK_ROLES: Role[] = ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "STORE_LEADER"];

/** Pode mexer em rota/despacho/logística (Jane) */
export const LOGISTICS_ROLES: Role[] = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

/** Helpers ergonômicos */
export const hasPrivilege = (role: Role | string): boolean => PRIVILEGED_ROLES.includes(role as Role);
export const isStockRole  = (role: Role | string): boolean => STOCK_ROLES.includes(role as Role);
export const isLogisticsRole = (role: Role | string): boolean => LOGISTICS_ROLES.includes(role as Role);
export const isAdminRole  = (role: Role | string): boolean => ADMIN_ROLES.includes(role as Role);
