import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import {
  claimDeliveryRequest,
  releaseClaim,
  renewClaim,
  ClaimError,
  type LockReason,
} from "@/services/claim.service";

const schema = z.object({
  requestId: z.string().min(1),
  action:    z.enum(["claim", "release", "renew"]),
  reason:    z.enum(["SEPARACAO", "FISCAL", "ROTEIRIZACAO", "DESPACHO", "OCORRENCIA"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
      return NextResponse.json(apiError("Acesso restrito"), { status: 403 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const { requestId, action, reason } = parsed.data;

    switch (action) {
      case "claim": {
        const result = await claimDeliveryRequest(
          requestId,
          session.userId,
          session.name,
          reason as LockReason | undefined
        );
        return NextResponse.json(apiSuccess(result));
      }

      case "release": {
        await releaseClaim(requestId, session.userId);
        return NextResponse.json(apiSuccess({ released: true }));
      }

      case "renew": {
        const result = await renewClaim(requestId, session.userId);
        if (!result) {
          return NextResponse.json(
            apiError("Claim não encontrado ou não pertence a você", "NOT_FOUND"),
            { status: 404 }
          );
        }
        return NextResponse.json(apiSuccess(result));
      }
    }
  } catch (error) {
    if (error instanceof ClaimError) {
      if (error.code === "CLAIMED_BY_OTHER") {
        return NextResponse.json(
          { success: false, error: error.message, code: error.code, claim: error.claim },
          { status: 409 }
        );
      }
      return NextResponse.json(apiError(error.message, error.code), { status: 404 });
    }
    console.error("[POST /api/operacao/claim]", error);
    return NextResponse.json(apiError("Erro no claim"), { status: 500 });
  }
}
