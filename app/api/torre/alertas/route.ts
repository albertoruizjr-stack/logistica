// app/api/torre/alertas/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiError } from "@/types";
import { AlertSeverity, AlertStatus } from "@prisma/client";
import type { AlertWithTimeRemaining } from "@/types/torre";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);
    const storeId     = searchParams.get("storeId") ?? undefined;
    const severity    = searchParams.get("severity") as AlertSeverity | null;
    const statusParam = searchParams.get("status") as AlertStatus | null;
    const page        = Math.max(1, Number(searchParams.get("page") ?? "1"));

    // Por padrão lista apenas alertas abertos
    const statusFilter = statusParam
      ? { status: statusParam }
      : { status: { in: ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] as AlertStatus[] } };

    const where = {
      ...(storeId  ? { storeId }  : {}),
      ...(severity ? { severity } : {}),
      ...statusFilter,
    };

    const [alerts, total] = await Promise.all([
      prisma.controlTowerAlert.findMany({
        where,
        orderBy: [
          // CRITICAL primeiro, depois por SLA mais próximo
          { severity: "asc" },
          { slaDeadline: "asc" },
        ],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          type: true,
          severity: true,
          storeId: true,
          actionType: true,
          slaDeadline: true,
          slaStatus: true,
          status: true,
          escalationLevel: true,
          dataConfidence: true,
          createdAt: true,
          store:  { select: { code: true, name: true } },
          owner:  { select: { name: true } },
          items:  {
            orderBy: { abcClassification: "asc" },
            take: 10,
            select: {
              productCode: true,
              productName: true,
              abcClassification: true,
              metricValue: true,
              metricUnit: true,
            },
          },
        },
      }),
      prisma.controlTowerAlert.count({ where }),
    ]);

    const now = Date.now();
    const result: AlertWithTimeRemaining[] = alerts.map((a) => ({
      id:              a.id,
      type:            a.type,
      severity:        a.severity,
      storeId:         a.storeId,
      storeCode:       a.store.code,
      storeName:       a.store.name,
      ownerName:       a.owner.name,
      actionType:      a.actionType,
      slaDeadline:     a.slaDeadline,
      slaStatus:       a.slaStatus,
      timeRemaining:   Math.round((a.slaDeadline.getTime() - now) / 60_000),
      status:          a.status,
      escalationLevel: a.escalationLevel,
      dataConfidence:  a.dataConfidence,
      itemCount:       a.items.length,
      items:           a.items.map((i) => ({
        productCode:       i.productCode,
        productName:       i.productName,
        abcClassification: i.abcClassification ?? undefined,
        metricValue:       i.metricValue,
        metricUnit:        i.metricUnit,
      })),
      createdAt: a.createdAt,
    }));

    return NextResponse.json({
      data: result,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total,
        pages: Math.ceil(total / PAGE_SIZE),
      },
    });
  } catch (err) {
    console.error("[GET /api/torre/alertas]", err);
    return NextResponse.json(apiError("Erro interno"), { status: 500 });
  }
}
