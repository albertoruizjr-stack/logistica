// app/api/torre/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { runFastStandardSync, runManualSyncForStore } from "@/services/torre/sync-orchestrator.service";

// POST /api/torre/sync — sync geral (todas as lojas) ou específico por loja
// Body opcional: { storeId: string } para sync de loja específica
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const storeId = body?.storeId as string | undefined;

    const result = storeId
      ? await runManualSyncForStore(storeId)
      : await runFastStandardSync();

    if (result.skipped) {
      return NextResponse.json(
        { message: "Sync ignorado — já existe um job em execução nos últimos 10 minutos", result },
        { status: 200 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno" },
      { status: 500 }
    );
  }
}
