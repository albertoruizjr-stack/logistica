import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

// PATCH /api/solicitacoes/[id]/nf-review
// Registra que o operador revisou o estado de vínculo NF (MULTIPLE_NF ou PARTIAL_BILLING).
// Usa nfLinkLastAttemptAt como timestamp da revisão.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSessionFromRequest(req);
  if (!session || !["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
    return NextResponse.json(apiError("Não autorizado"), { status: 401 });
  }

  const dr = await prisma.deliveryRequest.findUnique({
    where:  { id: params.id },
    select: { nfLinkError: true },
  });

  if (!dr) {
    return NextResponse.json(apiError("Solicitação não encontrada"), { status: 404 });
  }

  const reviewable = ["MULTIPLE_NF", "PARTIAL_BILLING"];
  if (!dr.nfLinkError || !reviewable.includes(dr.nfLinkError)) {
    return NextResponse.json(
      apiError("Estado não permite revisão", "NOT_REVIEWABLE"),
      { status: 409 }
    );
  }

  const reviewedValue =
    dr.nfLinkError === "MULTIPLE_NF" ? "MULTIPLE_NF_REVIEWED" : "PARTIAL_BILLING_REVIEWED";

  await prisma.deliveryRequest.update({
    where: { id: params.id },
    data: {
      nfLinkError:         reviewedValue,
      nfLinkLastAttemptAt: new Date(), // timestamp da revisão
    },
  });

  return NextResponse.json(
    apiSuccess({ reviewed: true, state: reviewedValue, reviewedAt: new Date().toISOString() })
  );
}
