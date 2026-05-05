import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { runNfLinkJob } from "@/services/nf-link.service";
import { prisma } from "@/lib/prisma";

// POST /api/admin/nf-link — disparo manual (ADMIN only)
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json(apiError("Não autorizado"), { status: 401 });
  }

  try {
    const result = await runNfLinkJob("MANUAL");

    if (result.skipped) {
      return NextResponse.json(
        apiError("Job ignorado — execução recente ainda em andamento. Aguarde alguns minutos.", "JOB_RUNNING"),
        { status: 409 }
      );
    }

    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    console.error("[POST /api/admin/nf-link]", error);
    return NextResponse.json(apiError("Erro ao executar job de vínculo NF"), { status: 500 });
  }
}

// GET /api/admin/nf-link — histórico dos últimos jobs (ADMIN only)
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json(apiError("Não autorizado"), { status: 401 });
  }

  const jobs = await prisma.nfLinkJob.findMany({
    orderBy: { startedAt: "desc" },
    take:    20,
  });

  // Resumo de solicitações aguardando NF
  const pendingCount = await prisma.deliveryRequest.count({
    where: {
      invoiceNumber: null,
      orderNumber:   { not: null },
      status:        { notIn: ["CANCELLED", "DELIVERED"] },
    },
  });

  const needsReview = await prisma.deliveryRequest.count({
    where: { nfLinkError: { in: ["MULTIPLE_NF", "PD_CANCELLED_IN_CITEL", "PARTIAL_BILLING", "PD_NOT_FOUND"] } },
  });

  return NextResponse.json(
    apiSuccess({ jobs, pendingCount, needsReview })
  );
}
