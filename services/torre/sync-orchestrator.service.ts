// services/torre/sync-orchestrator.service.ts
import { prisma } from "@/lib/prisma";
import { syncFromCitel } from "@/services/stock-ledger.service";
import { evaluateRules } from "./audit-engine.service";
import { processOccurrences } from "./alert-engine.service";

export interface OrchestratorResult {
  jobId: string;
  tier: string;
  storesProcessed: number;
  storesFailed: number;
  totalSynced: number;
  totalErrors: number;
  occurrencesFound: number;
  durationMs: number;
  skipped: boolean;
}

const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

async function isAlreadyRunning(type: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
  const running = await prisma.citelSyncJob.findFirst({
    where: {
      type: type as any,
      status: "RUNNING",
      startedAt: { gte: cutoff },
    },
    select: { id: true },
  });
  return running !== null;
}

export async function runFastStandardSync(): Promise<OrchestratorResult> {
  const start = Date.now();
  const tier = "FAST_STANDARD";
  const type = "STOCK";

  // Anti-duplicata: pular se já há job RUNNING nos últimos 10 min
  if (await isAlreadyRunning(type)) {
    return {
      jobId: "",
      tier,
      storesProcessed: 0,
      storesFailed: 0,
      totalSynced: 0,
      totalErrors: 0,
      occurrencesFound: 0,
      durationMs: Date.now() - start,
      skipped: true,
    };
  }

  // Registrar job
  const job = await prisma.citelSyncJob.create({
    data: { type: "STOCK", tier: "FAST_STANDARD", status: "RUNNING", source: "API" },
  });

  const stores = await prisma.store.findMany({
    where: { active: true, codigoEmpresaCitel: { not: null } },
    select: { id: true, codigoEmpresaCitel: true },
  });

  let storesProcessed = 0;
  let storesFailed = 0;
  let totalSynced = 0;
  let totalErrors = 0;
  let occurrencesFound = 0;

  for (const store of stores) {
    try {
      // 1. Sync de estoque (já chama calculateCoverageForStore internamente)
      const syncResult = await syncFromCitel(store.id, store.codigoEmpresaCitel!);
      totalSynced += syncResult.synced;
      totalErrors += syncResult.errors;

      // 2. Audit Engine — avalia R03 e R10 para esta loja
      const occurrences = await evaluateRules(store.id);
      occurrencesFound += occurrences.length;

      // 3. Alert Engine — criar/atualizar alertas e auto-resolver os resolvidos
      await processOccurrences(occurrences, {
        storeId: store.id,
        ruleIds: ["R03", "R10"],
      });

      storesProcessed++;
    } catch (err) {
      storesFailed++;
      totalErrors++;
      console.error(`[SyncOrchestrator] Falha na loja ${store.id}:`, err);
      // Falha parcial: continua com próxima loja
    }
  }

  // Determinar status final do job
  const finalStatus =
    storesFailed === 0 ? "SUCCESS" :
    storesProcessed > 0 ? "PARTIAL" :
    "FAILED";

  await prisma.citelSyncJob.update({
    where: { id: job.id },
    data: {
      status: finalStatus,
      recordsProcessed: totalSynced,
      errors: totalErrors,
      finishedAt: new Date(),
    },
  });

  return {
    jobId: job.id,
    tier,
    storesProcessed,
    storesFailed,
    totalSynced,
    totalErrors,
    occurrencesFound,
    durationMs: Date.now() - start,
    skipped: false,
  };
}

// Executa sync manual para uma loja específica (usado na API de sync manual)
export async function runManualSyncForStore(storeId: string): Promise<OrchestratorResult> {
  const start = Date.now();

  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { id: true, codigoEmpresaCitel: true },
  });

  if (!store.codigoEmpresaCitel) {
    throw new Error(`Loja ${storeId} não tem codigoEmpresaCitel configurado`);
  }

  const job = await prisma.citelSyncJob.create({
    data: { type: "STOCK", tier: "FAST_STANDARD", status: "RUNNING", source: "API" },
  });

  let synced = 0;
  let errors = 0;
  let occurrencesFound = 0;

  try {
    const syncResult = await syncFromCitel(store.id, store.codigoEmpresaCitel);
    synced = syncResult.synced;
    errors = syncResult.errors;

    const occurrences = await evaluateRules(store.id);
    occurrencesFound = occurrences.length;
    await processOccurrences(occurrences, { storeId: store.id, ruleIds: ["R03", "R10"] });

    await prisma.citelSyncJob.update({
      where: { id: job.id },
      data: {
        status: errors === 0 ? "SUCCESS" : "PARTIAL",
        recordsProcessed: synced,
        errors,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.citelSyncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errors: 1,
        finishedAt: new Date(),
        errorDetail: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  return {
    jobId: job.id,
    tier: "FAST_STANDARD",
    storesProcessed: 1,
    storesFailed: 0,
    totalSynced: synced,
    totalErrors: errors,
    occurrencesFound,
    durationMs: Date.now() - start,
    skipped: false,
  };
}
