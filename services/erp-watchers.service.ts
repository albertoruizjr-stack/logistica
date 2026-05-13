// ──────────────────────────────────────────────
// ERP WATCHER SERVICE
//
// Monitora solicitações ativas e detecta divergências
// entre o snapshot capturado na criação e o estado atual
// do pedido no Citel. Gera ERPSyncAlerts sem bloquear
// o fluxo operacional.
//
// Projetado para execução via Vercel Cron (a cada 15 min).
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { fetchPedidoCabecalho, fetchPedidoItens, isCitelConfigured } from "@/services/citel.service";
import type { CitelPedidoCabecalho } from "@/types/stock";

type CitelItemSimple = { codigo: string; quantidade: number; descricao?: string; unidade?: string };

// ─── Tipos ────────────────────────────────────────────────

export type ERPAlertType =
  | "ORDER_CANCELLED"
  | "ORDER_ALREADY_INVOICED"
  | "ITEM_REMOVED"
  | "ITEM_QUANTITY_CHANGED"
  | "DELIVERY_ADDRESS_CHANGED"
  | "CUSTOMER_CHANGED";

export type ERPAlertSeverity = "CRITICAL" | "WARNING" | "INFO";

interface AlertSpec {
  alertType: ERPAlertType;
  severity: ERPAlertSeverity;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface WatcherRunResult {
  checkedCount: number;
  alertsCreated: number;
  skippedCount: number;
  errorCount: number;
  durationMs: number;
}

// ─── Configuração ──────────────────────────────────────────

// Statuses onde o watcher monitora ativamente
const MONITORABLE_STATUSES = [
  "PENDING",
  "AWAITING_ITEMS",
  "AWAITING_TRANSFER",
  "SEPARADO",
  "AGUARDANDO_NF",
  "NF_EMITIDA",
  "NF_VINCULADA",
  "PRONTO_ROTEIRIZACAO",
];

// Após NF emitida: apenas alerta, watcher não faz auto-sync de dados
const POST_NF_STATUSES = new Set([
  "NF_EMITIDA",
  "NF_VINCULADA",
  "PRONTO_ROTEIRIZACAO",
  "ROTEIRIZADO",
]);

// Statuses Citel que indicam cancelamento
const CANCELLED_PATTERNS = [/CANCEL/i, /ANULAD/i];
// Statuses Citel que indicam faturamento
const INVOICED_PATTERNS = [/FATURA/i, /NF.EMIT/i, /ENCERR/i, /CONCLU/i];

// ─── Helpers ──────────────────────────────────────────────

function matchesAny(value: string | null | undefined, patterns: RegExp[]): boolean {
  if (!value) return false;
  return patterns.some((p) => p.test(value));
}

function normalizeAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as Record<string, unknown>;
  return [a.logradouro, a.numero, a.complemento, a.bairro, a.cidade, a.estado, a.cep]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .join("|");
}

function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// ─── Deduplicação de alertas ───────────────────────────────

async function hasUnresolvedAlert(
  deliveryRequestId: string,
  alertType: ERPAlertType,
): Promise<boolean> {
  const existing = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) AS count FROM "erp_sync_alerts"
     WHERE "deliveryRequestId" = $1 AND "alertType" = $2 AND "isResolved" = FALSE`,
    deliveryRequestId,
    alertType,
  );
  return Number(existing[0]?.count ?? 0) > 0;
}

async function createAlert(
  deliveryRequestId: string,
  orderNumber: string,
  storeCode: string,
  spec: AlertSpec,
): Promise<boolean> {
  const isDupe = await hasUnresolvedAlert(deliveryRequestId, spec.alertType);
  if (isDupe) return false;

  const id = `esa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "erp_sync_alerts"
       ("id","deliveryRequestId","orderNumber","storeCode","alertType","severity","oldValue","newValue","isResolved","detectedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,NOW())`,
    id,
    deliveryRequestId,
    orderNumber,
    storeCode,
    spec.alertType,
    spec.severity,
    spec.oldValue != null ? JSON.stringify(spec.oldValue) : null,
    spec.newValue != null ? JSON.stringify(spec.newValue) : null,
  );

  // Notifica vendedor + Jane (gatilho #12) — não-bloqueante
  try {
    const { notifyErpAlert } = await import("./notifications.service");
    await notifyErpAlert({
      deliveryRequestId,
      orderNumber,
      storeCode,
      alertType: spec.alertType,
    });
  } catch (e) {
    console.warn("[erp-watcher] notify failed:", e instanceof Error ? e.message : e);
  }

  return true;
}

// ─── Lógica de diff ────────────────────────────────────────

async function diffRequest(
  req: {
    id: string;
    orderNumber: string;
    storeCode: string;
    status: string;
    erpOrderStatus: string | null;
    customerAddressSnapshot: string | null;
    deliveryAddressSnapshot: string | null;
    itemsSnapshot: Array<{ productCode: string; quantity: number }>;
  },
  cab: CitelPedidoCabecalho,
  itens: CitelItemSimple[] | null,
): Promise<AlertSpec[]> {
  const alerts: AlertSpec[] = [];
  const isPostNf = POST_NF_STATUSES.has(req.status);

  // 1 — Pedido cancelado no ERP
  if (matchesAny(cab.status, CANCELLED_PATTERNS)) {
    alerts.push({ alertType: "ORDER_CANCELLED", severity: "CRITICAL", oldValue: req.erpOrderStatus, newValue: cab.status });
    return alerts; // cancelamento suprime outros diffs
  }

  // 2 — Pedido faturado no ERP (só relevante antes de NF_EMITIDA no nosso sistema)
  if (!isPostNf && matchesAny(cab.status, INVOICED_PATTERNS)) {
    alerts.push({ alertType: "ORDER_ALREADY_INVOICED", severity: "WARNING", oldValue: req.erpOrderStatus, newValue: cab.status });
  }

  // 3 — Cliente mudou
  const snapshotCliente = parseJsonSafe<{ nomeCliente?: string }>(req.customerAddressSnapshot);
  if (snapshotCliente?.nomeCliente && cab.nomeCliente &&
      snapshotCliente.nomeCliente.trim().toLowerCase() !== cab.nomeCliente.trim().toLowerCase()) {
    alerts.push({
      alertType: "CUSTOMER_CHANGED",
      severity: isPostNf ? "WARNING" : "INFO",
      oldValue: snapshotCliente.nomeCliente,
      newValue: cab.nomeCliente,
    });
  }

  // 4 — Endereço de entrega mudou
  const snapshotDelivery = parseJsonSafe(req.deliveryAddressSnapshot);
  const currentDelivery = cab.deliveryAddress ?? cab.customerAddress;
  if (snapshotDelivery) {
    const snapNorm = normalizeAddress(snapshotDelivery);
    const currNorm = normalizeAddress(currentDelivery);
    if (snapNorm && currNorm && snapNorm !== currNorm) {
      alerts.push({
        alertType: "DELIVERY_ADDRESS_CHANGED",
        severity: isPostNf ? "WARNING" : "INFO",
        oldValue: snapshotDelivery,
        newValue: currentDelivery,
      });
    }
  }

  // 5 — Itens: só compara se temos snapshot de itens E itens atuais da Citel
  if (itens && req.itemsSnapshot.length > 0) {
    const currentMap = new Map(itens.map((i) => [i.codigo, i.quantidade]));
    const snapshotMap = new Map(req.itemsSnapshot.map((i) => [i.productCode, i.quantity]));

    for (const [code, snapQty] of snapshotMap) {
      const currQty = currentMap.get(code);
      if (currQty === undefined) {
        alerts.push({
          alertType: "ITEM_REMOVED",
          severity: "WARNING",
          oldValue: { productCode: code, quantity: snapQty },
          newValue: null,
        });
      } else if (Math.abs(currQty - snapQty) > 0.001) {
        alerts.push({
          alertType: "ITEM_QUANTITY_CHANGED",
          severity: "WARNING",
          oldValue: { productCode: code, quantity: snapQty },
          newValue: { productCode: code, quantity: currQty },
        });
      }
    }
  }

  return alerts;
}

// ─── Runner principal ──────────────────────────────────────

export async function runERPWatcher(options?: {
  limitPerRun?: number;
  storeCode?: string;
}): Promise<WatcherRunResult> {
  const started = Date.now();

  if (!isCitelConfigured()) {
    return { checkedCount: 0, alertsCreated: 0, skippedCount: 0, errorCount: 0, durationMs: 0 };
  }

  const limit = options?.limitPerRun ?? 50;

  // Busca solicitações monitoráveis que têm orderNumber
  type ReqRow = {
    id: string;
    orderNumber: string;
    storeCode: string;
    status: string;
    erpOrderStatus: string | null;
    customerAddressSnapshot: string | null;
    deliveryAddressSnapshot: string | null;
    itemsSnapshot: string; // JSON array
  };

  const storeFilter = options?.storeCode
    ? `AND s."code" = '${options.storeCode.replace(/'/g, "''")}'`
    : "";

  const rows = await prisma.$queryRawUnsafe<ReqRow[]>(
    `SELECT dr.id, dr."orderNumber", s.code AS "storeCode", dr.status,
            dr."erpOrderStatus", dr."customerAddressSnapshot",
            dr."deliveryAddressSnapshot",
            COALESCE(
              (SELECT json_agg(json_build_object('productCode', di."productCode", 'quantity', di.quantity))
               FROM delivery_items di WHERE di."deliveryRequestId" = dr.id),
              '[]'::json
            )::text AS "itemsSnapshot"
     FROM delivery_requests dr
     JOIN stores s ON s.id = dr."storeId"
     WHERE dr."orderNumber" IS NOT NULL
       AND dr.status = ANY($1::text[])
       ${storeFilter}
     ORDER BY dr."createdAt" ASC
     LIMIT $2`,
    MONITORABLE_STATUSES,
    limit,
  );

  let alertsCreated = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    try {
      const cab = await fetchPedidoCabecalho(row.orderNumber, row.storeCode);
      if (!cab) {
        skippedCount++;
        continue;
      }

      // Itens só são buscados para statuses antes de NF (evita carga desnecessária)
      let itens: CitelItemSimple[] | null = null;
      if (!POST_NF_STATUSES.has(row.status)) {
        itens = await fetchPedidoItens(row.orderNumber, row.storeCode);
      }

      const itemsSnapshot: Array<{ productCode: string; quantity: number }> =
        parseJsonSafe(row.itemsSnapshot) ?? [];

      const specs = await diffRequest(
        {
          id: row.id,
          orderNumber: row.orderNumber,
          storeCode: row.storeCode,
          status: row.status,
          erpOrderStatus: row.erpOrderStatus,
          customerAddressSnapshot: row.customerAddressSnapshot,
          deliveryAddressSnapshot: row.deliveryAddressSnapshot,
          itemsSnapshot,
        },
        cab,
        itens,
      );

      for (const spec of specs) {
        const created = await createAlert(row.id, row.orderNumber, row.storeCode, spec);
        if (created) alertsCreated++;
      }
    } catch (err) {
      console.error(`[erp-watcher] erro em ${row.orderNumber}:`, err);
      errorCount++;
    }
  }

  const durationMs = Date.now() - started;
  console.log(
    `[erp-watcher] checked=${rows.length} alerts=${alertsCreated} skipped=${skippedCount} errors=${errorCount} ms=${durationMs}`,
  );

  return {
    checkedCount: rows.length,
    alertsCreated,
    skippedCount,
    errorCount,
    durationMs,
  };
}
