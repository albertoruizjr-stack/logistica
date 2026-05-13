import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError } from "@/types";
import { releaseExpiredClaims } from "@/services/claim.service";

// Chamado por cron a cada 5 minutos para limpar locks expirados.
// Protegido por CRON_SECRET para impedir chamadas não autorizadas.

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(apiError("Não autorizado"), { status: 401 });
  }

  try {
    const released = await releaseExpiredClaims();
    return NextResponse.json(apiSuccess({ released }));
  } catch (error) {
    console.error("[POST /api/operacao/cleanup]", error);
    return NextResponse.json(apiError("Erro no cleanup"), { status: 500 });
  }
}
