import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { addJustification } from "@/services/audit.service";

const schema = z.object({
  justification: z.string().min(10, "Justificativa deve ter pelo menos 10 caracteres"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    await addJustification(params.id, parsed.data.justification, session.userId);
    return NextResponse.json(apiSuccess({ message: "Justificativa salva com sucesso." }));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("vazia")) {
      return NextResponse.json(apiError(error.message), { status: 400 });
    }
    console.error("[POST /api/auditoria/frete/[id]/justificativa]", error);
    return NextResponse.json(apiError("Erro ao salvar justificativa"), { status: 500 });
  }
}
