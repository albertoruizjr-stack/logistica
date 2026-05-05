import { NextRequest, NextResponse } from "next/server";
import { runNfLinkJob } from "@/services/nf-link.service";

// GET /api/cron/vincular-nf
// Chamado automaticamente pelo Vercel Cron (*/15 * * * *)
// Também aceita POST para disparo manual autenticado
export async function GET(req: NextRequest) {
  // Vercel injeta o header Authorization com o CRON_SECRET configurado
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await runNfLinkJob("CRON");

    if (result.skipped) {
      return NextResponse.json({ message: "Job ignorado — execução recente em andamento", result });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[CRON vincular-nf]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno" },
      { status: 500 }
    );
  }
}
