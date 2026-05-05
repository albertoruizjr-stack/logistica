// ──────────────────────────────────────────────
// ORQUESTRADOR DE VÍNCULO AUTOMÁTICO PD → NF
//
// Estratégia híbrida:
//   1. Batch por loja (primary): um único GET por loja, desde o último sync
//   2. Fallback individual: para DRs sem NF após FALLBACK_THRESHOLD_H horas
//
// Regras de faturamento:
//   - Todos jaFaturado + mesmo numeroFaturamento → vincula normalmente
//   - Alguns jaFaturado, outros não            → PARTIAL_BILLING (aguarda)
//   - Itens com NFs diferentes                 → MULTIPLE_NF (revisão manual)
//   - PD não encontrado no Citel               → mantém AGUARDANDO NF
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  fetchPedidoFaturamento,
  fetchPedidosFaturadosBatch,
  type CitelItemFaturado,
} from "./citel-nf.service";
import {
  upsertNfLinkAlert,
  resolveNfLinkAlert,
} from "./torre/alert-engine.service";

// Após quantas horas o fallback individual começa a tentar (batch deveria pegar antes)
const FALLBACK_THRESHOLD_H = 2;
// Intervalo mínimo entre tentativas para a mesma solicitação (30 min)
const MIN_RETRY_INTERVAL_MS = 30 * 60 * 1000;
// Backoff para solicitações com muitas tentativas (>10 → retentar a cada 4h)
const HIGH_ATTEMPT_THRESHOLD = 10;
const HIGH_ATTEMPT_INTERVAL_MS = 4 * 60 * 60 * 1000;

// ──────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────

export interface NfLinkJobResult {
  jobId:           string;
  requestsChecked: number;
  requestsLinked:  number;
  requestsPartial: number;
  requestsMultiNf: number;
  requestsNotFound: number;
  requestsError:   number;
  durationMs:      number;
  skipped:         boolean;
}

type NfClassification =
  | { type: "OK";       invoiceNumber: string; empresaFaturamento: string; chaveAcesso: string | null }
  | { type: "PARTIAL" }
  | { type: "MULTI_NF" }
  | { type: "NOT_BILLED" };

// ──────────────────────────────────────────────
// CLASSIFICAÇÃO DE ITENS
// ──────────────────────────────────────────────

function classifyItens(itens: CitelItemFaturado[]): NfClassification {
  if (itens.length === 0) return { type: "NOT_BILLED" };

  // Verifica se TODOS os itens foram faturados (jaFaturado=true e com número de NF)
  const allBilled = itens.every((i) => i.jaFaturado && i.numeroFaturamento);
  const anyBilled = itens.some((i) => i.jaFaturado && i.numeroFaturamento);

  if (!anyBilled) return { type: "NOT_BILLED" };

  // Faturamento parcial: alguns itens faturados, outros não — RISCO OPERACIONAL
  if (!allBilled) return { type: "PARTIAL" };

  // Todos faturados — verifica unicidade da NF (1 NF → OK, >1 NF → MÚLTIPLAS)
  const nfs = new Set(itens.map((i) => `${i.empresaFaturamento}|${i.numeroFaturamento}`));
  if (nfs.size > 1) return { type: "MULTI_NF" };

  // 1 única NF para todos os itens → vínculo automático
  const first = itens[0];
  return {
    type:               "OK",
    invoiceNumber:      first.numeroFaturamento!,
    empresaFaturamento: first.empresaFaturamento!,
    chaveAcesso:        first.chaveAcesso ?? null,
  };
}

// ──────────────────────────────────────────────
// VÍNCULO INDIVIDUAL — aplica resultado ao banco
// ──────────────────────────────────────────────

async function applyLink(
  requestId: string,
  classification: NfClassification,
  storeCache: Map<string, string>
): Promise<"linked" | "partial" | "multi_nf" | "not_found" | "error"> {
  if (classification.type === "NOT_BILLED") {
    await prisma.deliveryRequest.update({
      where: { id: requestId },
      data: {
        nfLinkLastAttemptAt: new Date(),
        nfLinkAttemptCount:  { increment: 1 },
        nfLinkError:         null,
      },
    });
    return "not_found";
  }

  if (classification.type === "PARTIAL") {
    await prisma.deliveryRequest.update({
      where: { id: requestId },
      data: {
        nfLinkLastAttemptAt: new Date(),
        nfLinkAttemptCount:  { increment: 1 },
        nfLinkError:         "PARTIAL_BILLING",
      },
    });
    return "partial";
  }

  if (classification.type === "MULTI_NF") {
    await prisma.deliveryRequest.update({
      where: { id: requestId },
      data: {
        nfLinkLastAttemptAt: new Date(),
        nfLinkAttemptCount:  { increment: 1 },
        nfLinkError:         "MULTIPLE_NF",
      },
    });
    return "multi_nf";
  }

  // type === "OK" — vincula a NF
  try {
    const { invoiceNumber, empresaFaturamento } = classification;

    // Resolve invoiceStoreId via cache ou banco
    let invoiceStoreId = storeCache.get(empresaFaturamento);
    if (!invoiceStoreId) {
      const store = await prisma.store.findFirst({
        where: { code: empresaFaturamento },
        select: { id: true },
      });
      if (store) {
        invoiceStoreId = store.id;
        storeCache.set(empresaFaturamento, store.id);
      }
    }

    await prisma.deliveryRequest.update({
      where: { id: requestId },
      data: {
        invoiceNumber,
        invoiceStoreId:      invoiceStoreId ?? null,
        nfLinkLastAttemptAt: new Date(),
        nfLinkAttemptCount:  0,
        nfLinkError:         null,
      },
    });

    return "linked";
  } catch {
    return "error";
  }
}

// ──────────────────────────────────────────────
// ROTINA PRINCIPAL
// ──────────────────────────────────────────────

export async function runNfLinkJob(
  trigger: "CRON" | "MANUAL" = "CRON"
): Promise<NfLinkJobResult> {
  const start = Date.now();

  // Anti-duplicata: pular se já há job RUNNING nos últimos 12 min
  const recentRunning = await prisma.nfLinkJob.findFirst({
    where: {
      status:    "RUNNING",
      startedAt: { gte: new Date(Date.now() - 12 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recentRunning) {
    return {
      jobId: recentRunning.id, requestsChecked: 0, requestsLinked: 0,
      requestsPartial: 0, requestsMultiNf: 0, requestsNotFound: 0,
      requestsError: 0, durationMs: 0, skipped: true,
    };
  }

  const job = await prisma.nfLinkJob.create({
    data: { status: "RUNNING", trigger },
  });

  let checked = 0, linked = 0, partial = 0, multiNf = 0, notFound = 0, errors = 0;
  const storeCache = new Map<string, string>(); // storeCode → storeId

  try {
    // ── FASE 1: Batch por loja ──────────────────
    const stores = await prisma.store.findMany({
      where:  { active: true },
      select: { id: true, code: true },
    });

    // "desde" = última execução bem-sucedida ou 24h atrás
    const lastSuccess = await prisma.nfLinkJob.findFirst({
      where:   { status: { in: ["SUCCESS", "PARTIAL"] } },
      orderBy: { finishedAt: "desc" },
      select:  { finishedAt: true },
    });
    const since = lastSuccess?.finishedAt
      ? new Date(lastSuccess.finishedAt.getTime() - 5 * 60 * 1000) // 5min de overlap para segurança
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Pré-carrega DRs pendentes indexadas por (orderNumber|storeCode)
    const pendingRequests = await prisma.deliveryRequest.findMany({
      where: {
        invoiceNumber: null,
        orderNumber:   { not: null },
        orderStoreId:  { not: null },
        status:        { notIn: ["CANCELLED", "DELIVERED"] },
      },
      include: { orderStore: { select: { code: true } } },
    });

    const pendingMap = new Map<string, string>(); // "orderNumber|storeCode" → requestId
    const pendingById = new Map<string, (typeof pendingRequests)[0]>(); // requestId → DR completo
    for (const req of pendingRequests) {
      pendingById.set(req.id, req);
      if (req.orderNumber && req.orderStore?.code) {
        pendingMap.set(`${req.orderNumber}|${req.orderStore.code}`, req.id);
      }
    }

    // Chama batch por loja e processa matches
    const batchProcessed = new Set<string>(); // requestIds já processados

    for (const store of stores) {
      const faturados = await fetchPedidosFaturadosBatch(store.code, since);

      for (const pedido of faturados) {
        const key = `${pedido.numeroDocumento}|${pedido.codigoEmpresa}`;
        const requestId = pendingMap.get(key);
        if (!requestId || batchProcessed.has(requestId)) continue;

        checked++;
        const classification = classifyItens(pedido.itens);
        const result = await applyLink(requestId, classification, storeCache);
        batchProcessed.add(requestId);

        const req = pendingById.get(requestId)!;
        if (result === "linked") {
          resolveNfLinkAlert(req.id).catch(() => null);
          linked++;
        } else if (result === "partial" || result === "multi_nf") {
          upsertNfLinkAlert({
            requestId:   req.id,
            storeId:     req.storeId,
            orderNumber: req.orderNumber!,
            storeCode:   req.orderStore?.code ?? "???",
            errorType:   result === "partial" ? "PARTIAL_BILLING" : "MULTIPLE_NF",
            deliveryType: req.deliveryType,
            scheduledFor: req.scheduledFor,
            attemptCount: req.nfLinkAttemptCount,
          }).catch(() => null);
          if (result === "partial") partial++;
          else multiNf++;
        } else if (result === "not_found") notFound++;
        else errors++;
      }
    }

    // ── FASE 2: Fallback individual (DRs ainda sem NF após threshold) ──
    const fallbackThreshold = new Date(Date.now() - FALLBACK_THRESHOLD_H * 60 * 60 * 1000);

    const fallbackRequests = pendingRequests.filter((req) => {
      if (batchProcessed.has(req.id)) return false;
      // Erros que exigem revisão manual ou já foram reconhecidos — não retentar via fallback
      if (req.nfLinkError === "MULTIPLE_NF")           return false;
      if (req.nfLinkError === "MULTIPLE_NF_REVIEWED")  return false; // revisado: aguarda batch
      if (req.nfLinkError === "PD_CANCELLED_IN_CITEL") return false;
      if (req.nfLinkError === "PD_NOT_FOUND")          return false;
      // PARTIAL_BILLING_REVIEWED: operador reconheceu, mas batch ainda tenta vincular
      if (req.nfLinkError === "PARTIAL_BILLING_REVIEWED") return false;

      const createdLongAgo = req.createdAt < fallbackThreshold;
      if (!createdLongAgo) return false;

      // Backoff por tentativas
      if (req.nfLinkLastAttemptAt) {
        const interval = req.nfLinkAttemptCount >= HIGH_ATTEMPT_THRESHOLD
          ? HIGH_ATTEMPT_INTERVAL_MS
          : MIN_RETRY_INTERVAL_MS;
        if (Date.now() - req.nfLinkLastAttemptAt.getTime() < interval) return false;
      }

      return true;
    });

    // Processa fallback com concorrência limitada (5 em paralelo)
    const CONCURRENCY = 5;
    for (let i = 0; i < fallbackRequests.length; i += CONCURRENCY) {
      const batch = fallbackRequests.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (req) => {
          if (!req.orderNumber || !req.orderStore?.code) return;

          checked++;
          const pedido = await fetchPedidoFaturamento(req.orderNumber, req.orderStore.code);

          if (!pedido) {
            // PD não encontrado — incrementa tentativas; após threshold vira PD_NOT_FOUND
            const newCount    = req.nfLinkAttemptCount + 1;
            const isExhausted = newCount >= HIGH_ATTEMPT_THRESHOLD;
            await prisma.deliveryRequest.update({
              where: { id: req.id },
              data: {
                nfLinkLastAttemptAt: new Date(),
                nfLinkAttemptCount:  { increment: 1 },
                ...(isExhausted ? { nfLinkError: "PD_NOT_FOUND" } : {}),
              },
            });
            if (isExhausted) {
              upsertNfLinkAlert({
                requestId:    req.id,
                storeId:      req.storeId,
                orderNumber:  req.orderNumber!,
                storeCode:    req.orderStore?.code ?? "???",
                errorType:    "PD_NOT_FOUND",
                deliveryType: req.deliveryType,
                scheduledFor: req.scheduledFor,
                attemptCount: newCount,
              }).catch(() => null);
            }
            notFound++;
            return;
          }

          if (pedido.cancelado) {
            // PD cancelado no Citel — revisão manual, não retentar
            await prisma.deliveryRequest.update({
              where: { id: req.id },
              data: { nfLinkLastAttemptAt: new Date(), nfLinkError: "PD_CANCELLED_IN_CITEL" },
            });
            upsertNfLinkAlert({
              requestId:    req.id,
              storeId:      req.storeId,
              orderNumber:  req.orderNumber!,
              storeCode:    req.orderStore?.code ?? "???",
              errorType:    "PD_CANCELLED_IN_CITEL",
              deliveryType: req.deliveryType,
              scheduledFor: req.scheduledFor,
              attemptCount: req.nfLinkAttemptCount,
            }).catch(() => null);
            errors++;
            return;
          }

          const classification = classifyItens(pedido.itens);
          const result = await applyLink(req.id, classification, storeCache);

          if (result === "linked") {
            resolveNfLinkAlert(req.id).catch(() => null);
            linked++;
          } else if (result === "partial" || result === "multi_nf") {
            upsertNfLinkAlert({
              requestId:    req.id,
              storeId:      req.storeId,
              orderNumber:  req.orderNumber!,
              storeCode:    req.orderStore?.code ?? "???",
              errorType:    result === "partial" ? "PARTIAL_BILLING" : "MULTIPLE_NF",
              deliveryType: req.deliveryType,
              scheduledFor: req.scheduledFor,
              attemptCount: req.nfLinkAttemptCount,
            }).catch(() => null);
            if (result === "partial") partial++;
            else multiNf++;
          } else if (result === "not_found") notFound++;
          else errors++;
        })
      );
    }

    // Finaliza job
    const finalStatus = errors > 0 || partial > 0 || multiNf > 0 ? "PARTIAL" : "SUCCESS";
    await prisma.nfLinkJob.update({
      where: { id: job.id },
      data:  {
        status:          finalStatus,
        requestsChecked: checked,
        requestsLinked:  linked,
        requestsPartial: partial,
        requestsMultiNf: multiNf,
        requestsNotFound: notFound,
        requestsError:   errors,
        finishedAt:      new Date(),
      },
    });
  } catch (fatalError) {
    await prisma.nfLinkJob.update({
      where: { id: job.id },
      data: {
        status:      "FAILED",
        finishedAt:  new Date(),
        errorDetail: fatalError instanceof Error ? fatalError.message : String(fatalError),
      },
    });
    throw fatalError;
  }

  return {
    jobId: job.id, requestsChecked: checked, requestsLinked: linked,
    requestsPartial: partial, requestsMultiNf: multiNf,
    requestsNotFound: notFound, requestsError: errors,
    durationMs: Date.now() - start, skipped: false,
  };
}
