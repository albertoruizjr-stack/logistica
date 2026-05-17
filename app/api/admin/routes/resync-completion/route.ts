import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { checkAndCompleteRoute } from "@/services/route-dispatch.service";

// POST /api/admin/routes/resync-completion
// Varre todas as rotas DISPATCHED e fecha as que já têm todas DRs finalizadas.
// Útil pra corrigir rotas órfãs criadas antes do fix automático ter sido deployado.
// Acesso: ADMIN | OPERATOR | LOGISTICS_OPERATOR.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    const allowed = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];
    if (!allowed.includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const dispatchedRoutes = await prisma.route.findMany({
      where:  { status: "DISPATCHED" },
      select: { id: true },
    });

    const results = await Promise.all(
      dispatchedRoutes.map(async (r) => {
        const res = await checkAndCompleteRoute(r.id).catch((e) => ({
          skipped: true,
          reason: e instanceof Error ? e.message : String(e),
        }));
        return { routeId: r.id, ...res };
      }),
    );

    const closed = results.filter((r) => "completed" in r && r.completed).length;
    return NextResponse.json(apiSuccess({ scanned: results.length, closed, details: results }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao reprocessar rotas";
    console.error("[POST /api/admin/routes/resync-completion]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
