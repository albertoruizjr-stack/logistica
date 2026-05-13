// ──────────────────────────────────────────────
// NOTIFICAÇÕES IN-APP
// Service principal: criação + helpers de seleção de destinatários.
//
// Cada função `findXxxUsers` retorna user IDs ativos correspondentes ao papel.
// `createNotification` insere uma notificação por destinatário.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import type { NotificationType } from "@/lib/notifications-types";

interface CreatePayload {
  type:     NotificationType;
  title:    string;
  body?:    string | null;
  link?:    string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Cria uma notificação para cada user listado.
 * Best-effort: erros não bloqueiam o fluxo principal.
 */
export async function createNotification(userIds: string[], payload: CreatePayload): Promise<void> {
  if (userIds.length === 0) return;
  const data = userIds.map((userId) => ({
    userId,
    type:     payload.type,
    title:    payload.title,
    body:     payload.body ?? null,
    link:     payload.link ?? null,
    metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
  }));
  try {
    await prisma.notification.createMany({ data });
  } catch (err) {
    console.error("[notifications] createNotification failed:", err instanceof Error ? err.message : err);
  }
}

// ──────────────────────────────────────────────
// SELECTORS DE DESTINATÁRIOS
// ──────────────────────────────────────────────

/** Operadores de estoque ativos (Jhow + futuros). Inclui OPERATOR legado. */
export async function findStockOperators(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: [Role.STOCK_OPERATOR, Role.OPERATOR] }, active: true },
    select: { id: true },
  });
  return users.map(u => u.id);
}

/** Operadores de logística ativos (Jane + futuros). Inclui OPERATOR legado. */
export async function findLogisticsOperators(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: [Role.LOGISTICS_OPERATOR, Role.OPERATOR] }, active: true },
    select: { id: true },
  });
  return users.map(u => u.id);
}

/** Admins ativos. */
export async function findAdmins(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: Role.ADMIN, active: true },
    select: { id: true },
  });
  return users.map(u => u.id);
}

/** O vendedor que criou determinada solicitação. */
export async function findSellerOfRequest(deliveryRequestId: string): Promise<string[]> {
  const r = await prisma.deliveryRequest.findUnique({
    where: { id: deliveryRequestId },
    select: { sellerId: true },
  });
  return r?.sellerId ? [r.sellerId] : [];
}

/**
 * Motorista de um dispatch específico.
 * Hoje Driver não está vinculado a User — quando esse vínculo existir,
 * trocar para retornar o User.id correspondente.
 * Por enquanto: retorna [] (gatilho de motorista fica silencioso até vincular).
 */
export async function findDriverOfDispatch(_dispatchId: string): Promise<string[]> {
  return [];
}

/** Combina vários selectors e remove duplicatas. */
export async function combineRecipients(...selectors: Array<Promise<string[]>>): Promise<string[]> {
  const lists = await Promise.all(selectors);
  return [...new Set(lists.flat())];
}

// ──────────────────────────────────────────────
// HELPERS PRONTOS PARA OS 14 GATILHOS
// Cada um já compõe destinatários certos + título + link.
// Use direto nos endpoints onde a ação acontece.
// ──────────────────────────────────────────────

interface RequestRefs {
  deliveryRequestId: string;
  orderNumber:       string | null;
  storeCode?:        string;
}

interface TransferRefs extends RequestRefs {
  transferId:    string;
  itemCount:     number;
  fromStoreCode: string;
}

const reqLabel = (r: RequestRefs) => r.orderNumber
  ? `PD ${r.orderNumber}${r.storeCode ? ` · Loja ${r.storeCode}` : ""}`
  : `Solicitação #${r.deliveryRequestId.slice(-6)}`;

// #1 — Transferência criada → Jhow + Jane
export async function notifyTransferCreated(t: TransferRefs) {
  const recipients = await combineRecipients(findStockOperators(), findLogisticsOperators());
  await createNotification(recipients, {
    type:  "TRANSFER_CREATED",
    title: "Nova transferência pendente",
    body:  `${reqLabel(t)} · ${t.itemCount} ${t.itemCount === 1 ? "item" : "itens"} a transferir`,
    link:  `/solicitacoes?detail=${t.deliveryRequestId}`,
    metadata: { transferId: t.transferId, deliveryRequestId: t.deliveryRequestId },
  });
}

// #2 — Transferência confirmada no Autcom (Jhow clicou) → Jane + vendedor
export async function notifyTransferConfirmed(t: TransferRefs) {
  const recipients = await combineRecipients(
    findLogisticsOperators(),
    findSellerOfRequest(t.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "TRANSFER_CONFIRMED",
    title: "Transferência confirmada no Autcom",
    body:  `${reqLabel(t)} · aguardando coleta`,
    link:  `/solicitacoes?detail=${t.deliveryRequestId}`,
    metadata: { transferId: t.transferId, deliveryRequestId: t.deliveryRequestId },
  });
}

// #3 — Transferência pronta pra despacho (PD interno vinculado) → Jane + vendedor
export async function notifyTransferReadyDispatch(t: TransferRefs) {
  const recipients = await combineRecipients(
    findLogisticsOperators(),
    findSellerOfRequest(t.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "TRANSFER_READY_DISPATCH",
    title: "Transferência pronta para despacho",
    body:  `${reqLabel(t)} · ${t.fromStoreCode} → destino`,
    link:  `/solicitacoes?detail=${t.deliveryRequestId}`,
    metadata: { transferId: t.transferId, deliveryRequestId: t.deliveryRequestId },
  });
}

// #4 — Transferência despachada → Jhow + Jane + vendedor
export async function notifyTransferDispatched(t: TransferRefs) {
  const recipients = await combineRecipients(
    findStockOperators(),
    findLogisticsOperators(),
    findSellerOfRequest(t.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "TRANSFER_DISPATCHED",
    title: "Transferência em trânsito",
    body:  `${reqLabel(t)} · saiu da Loja ${t.fromStoreCode}`,
    link:  `/solicitacoes?detail=${t.deliveryRequestId}`,
    metadata: { transferId: t.transferId, deliveryRequestId: t.deliveryRequestId },
  });
}

// #5 — Nova parada na rota → motorista
export async function notifyRouteStopAdded(args: { driverUserId: string; transferId: string; storeCode: string }) {
  await createNotification([args.driverUserId], {
    type:  "ROUTE_STOP_ADDED",
    title: "Nova parada na rota",
    body:  `Coleta de transferência na Loja ${args.storeCode}`,
    link:  `/rastreamento`,
    metadata: { transferId: args.transferId },
  });
}

// #6 — Transferência recebida → Jhow + Jane + vendedor
export async function notifyTransferReceived(t: TransferRefs) {
  const recipients = await combineRecipients(
    findStockOperators(),
    findLogisticsOperators(),
    findSellerOfRequest(t.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "TRANSFER_RECEIVED",
    title: "Transferência recebida",
    body:  `${reqLabel(t)} · estoque atualizado, pronto para separação`,
    link:  `/solicitacoes?detail=${t.deliveryRequestId}`,
    metadata: { transferId: t.transferId, deliveryRequestId: t.deliveryRequestId },
  });
}

// #7 — Pedido separado → Jane + vendedor
export async function notifyOrderSeparated(r: RequestRefs) {
  const recipients = await combineRecipients(
    findLogisticsOperators(),
    findSellerOfRequest(r.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "ORDER_SEPARATED",
    title: "Pedido separado",
    body:  `${reqLabel(r)} · pronto para fiscal / despacho`,
    link:  `/solicitacoes?detail=${r.deliveryRequestId}`,
    metadata: { deliveryRequestId: r.deliveryRequestId },
  });
}

// #8 — Pedido em rota (despachado) → vendedor
export async function notifyOrderDispatched(r: RequestRefs) {
  const recipients = await findSellerOfRequest(r.deliveryRequestId);
  await createNotification(recipients, {
    type:  "ORDER_DISPATCHED",
    title: "Pedido saiu para entrega",
    body:  `${reqLabel(r)} · motorista a caminho`,
    link:  `/solicitacoes?detail=${r.deliveryRequestId}`,
    metadata: { deliveryRequestId: r.deliveryRequestId },
  });
}

// #9 — Pedido entregue → vendedor + Jane
export async function notifyOrderDelivered(r: RequestRefs) {
  const recipients = await combineRecipients(
    findLogisticsOperators(),
    findSellerOfRequest(r.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "ORDER_DELIVERED",
    title: "Pedido entregue",
    body:  `${reqLabel(r)} · concluído`,
    link:  `/solicitacoes?detail=${r.deliveryRequestId}`,
    metadata: { deliveryRequestId: r.deliveryRequestId },
  });
}

// ─── Extras (#10–14) ──────────────────────────────────────────────

// #10 — Ocorrência na entrega → vendedor + Jane
export async function notifyDeliveryOccurrence(args: RequestRefs & { occurrence: string }) {
  const recipients = await combineRecipients(
    findLogisticsOperators(),
    findSellerOfRequest(args.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "DELIVERY_OCCURRENCE",
    title: "Ocorrência na entrega",
    body:  `${reqLabel(args)} · ${args.occurrence}`,
    link:  `/solicitacoes?detail=${args.deliveryRequestId}`,
    metadata: { deliveryRequestId: args.deliveryRequestId, occurrence: args.occurrence },
  });
}

// #11 — SLA estourado → Jane
export async function notifySlaBreach(args: RequestRefs & { status: string; hoursOver: number }) {
  const recipients = await findLogisticsOperators();
  await createNotification(recipients, {
    type:  "SLA_BREACH",
    title: "SLA estourado",
    body:  `${reqLabel(args)} · parado há ${args.hoursOver}h em ${args.status}`,
    link:  `/operacao`,
    metadata: { deliveryRequestId: args.deliveryRequestId },
  });
}

// #12 — Alerta ERP (PD alterado/cancelado no Autcom) → vendedor + Jane
export async function notifyErpAlert(args: RequestRefs & { alertType: string }) {
  const recipients = await combineRecipients(
    findLogisticsOperators(),
    findSellerOfRequest(args.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "ERP_ALERT",
    title: "Divergência detectada no ERP",
    body:  `${reqLabel(args)} · ${args.alertType}`,
    link:  `/solicitacoes?detail=${args.deliveryRequestId}`,
    metadata: { deliveryRequestId: args.deliveryRequestId, alertType: args.alertType },
  });
}

// #13 — Solicitação cancelada → Jhow + Jane (se já tinha transfer)
export async function notifyRequestCancelled(args: RequestRefs & { hadTransfer: boolean }) {
  const recipients = args.hadTransfer
    ? await combineRecipients(findStockOperators(), findLogisticsOperators())
    : await findLogisticsOperators();
  await createNotification(recipients, {
    type:  "REQUEST_CANCELLED",
    title: "Solicitação cancelada",
    body:  args.hadTransfer
      ? `${reqLabel(args)} · cancele a transferência em paralelo`
      : `${reqLabel(args)}`,
    link:  `/solicitacoes?detail=${args.deliveryRequestId}`,
    metadata: { deliveryRequestId: args.deliveryRequestId },
  });
}

// #15 — Loja origem cancelou a transferência → Jhow + Jane + vendedor (crítico)
export async function notifyTransferCancelled(args: TransferRefs & {
  cancelledByStoreCode: string;
  cancelledByName?:     string;
  reason:               string;
}) {
  const recipients = await combineRecipients(
    findStockOperators(),
    findLogisticsOperators(),
    findSellerOfRequest(args.deliveryRequestId),
  );
  await createNotification(recipients, {
    type:  "TRANSFER_CANCELLED",
    title: `Transferência cancelada pela Loja ${args.cancelledByStoreCode}`,
    body:  `${reqLabel(args)} — motivo: ${args.reason.slice(0, 120)}${args.reason.length > 120 ? "…" : ""}. Refaça o pedido de transferência.`,
    link:  `/solicitacoes?detail=${args.deliveryRequestId}`,
    metadata: {
      transferId:        args.transferId,
      deliveryRequestId: args.deliveryRequestId,
      cancelledByStoreCode: args.cancelledByStoreCode,
      reason: args.reason,
    },
  });
}

// #14 — Aprovação de exceção → Jane
export async function notifyExceptionApprovalNeeded(args: RequestRefs & { exceptionType: string; reason: string }) {
  const recipients = await findLogisticsOperators();
  await createNotification(recipients, {
    type:  "EXCEPTION_APPROVAL_NEEDED",
    title: "Exceção operacional solicitada",
    body:  `${reqLabel(args)} · ${args.exceptionType}: ${args.reason.slice(0, 60)}`,
    link:  `/solicitacoes?detail=${args.deliveryRequestId}`,
    metadata: { deliveryRequestId: args.deliveryRequestId, exceptionType: args.exceptionType },
  });
}
