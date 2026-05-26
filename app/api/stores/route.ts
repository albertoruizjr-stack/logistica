import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";

// GET /api/stores
// Retorna lojas ativas (id, code, name) ordenadas por code.
// Usado pelo modal de "Indicar origem" no fluxo de transferência 5 etapas.

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const stores = await prisma.store.findMany({
      where:   { active: true },
      select:  { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });

    return NextResponse.json(apiSuccess(stores));
  } catch (error) {
    console.error("[GET /api/stores]", error);
    return NextResponse.json(apiError("Erro ao listar lojas"), { status: 500 });
  }
}
