// app/api/torre/dashboard/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiError } from "@/types";
import type { TowerDashboardStats, TowerStoreHealth, StoreHealthColor } from "@/types/torre";

function storeHealthColor(critical: number, warning: number): StoreHealthColor {
  if (critical > 0) return "RED";
  if (warning > 0) return "YELLOW";
  return "GREEN";
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const [alertCounts, stores, lastSync, overdueCount] = await Promise.all([
      // Contadores por loja + severidade (apenas alertas abertos)
      prisma.controlTowerAlert.groupBy({
        by: ["storeId", "severity"],
        where: { status: { in: ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] } },
        _count: { id: true },
      }),
      // Todas as lojas ativas para mostrar mesmo as sem alertas
      prisma.store.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      }),
      // Último sync bem-sucedido
      prisma.citelSyncJob.findFirst({
        where: { type: "STOCK", status: { in: ["SUCCESS", "PARTIAL"] } },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
      // Alertas com SLA vencido
      prisma.controlTowerAlert.count({
        where: {
          status: { in: ["PENDING", "IN_PROGRESS"] },
          slaStatus: "OVERDUE",
        },
      }),
    ]);

    // Monta mapa de contadores: storeId → { CRITICAL, WARNING, INFO }
    const countMap = new Map<string, { CRITICAL: number; WARNING: number; INFO: number }>();
    for (const row of alertCounts) {
      if (!countMap.has(row.storeId)) {
        countMap.set(row.storeId, { CRITICAL: 0, WARNING: 0, INFO: 0 });
      }
      countMap.get(row.storeId)![row.severity] += row._count.id;
    }

    const storeHealthList: TowerStoreHealth[] = stores.map((s) => {
      const counts = countMap.get(s.id) ?? { CRITICAL: 0, WARNING: 0, INFO: 0 };
      return {
        storeId: s.id,
        storeCode: s.code,
        storeName: s.name,
        health: storeHealthColor(counts.CRITICAL, counts.WARNING),
        criticalCount: counts.CRITICAL,
        warningCount: counts.WARNING,
        infoCount: counts.INFO,
      };
    });

    // Totais globais
    const totals = alertCounts.reduce(
      (acc, row) => { acc[row.severity] = (acc[row.severity] ?? 0) + row._count.id; return acc; },
      {} as Record<string, number>
    );

    const stats: TowerDashboardStats = {
      critical: totals["CRITICAL"] ?? 0,
      warning: totals["WARNING"] ?? 0,
      info: totals["INFO"] ?? 0,
      overdueCount,
      stores: storeHealthList,
      lastSyncAt: lastSync?.finishedAt ?? null,
    };

    return NextResponse.json(stats);
  } catch (err) {
    console.error("[GET /api/torre/dashboard]", err);
    return NextResponse.json(apiError("Erro interno"), { status: 500 });
  }
}
