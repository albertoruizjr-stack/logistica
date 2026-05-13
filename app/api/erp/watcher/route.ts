import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { runERPWatcher } from "@/services/erp-watchers.service";

// Verifica autorização: ADMIN, OPERATOR, ou cron-secret header
function isAuthorized(req: NextRequest, role: string | undefined): boolean {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === process.env.CRON_SECRET) return true;
  return role === "ADMIN" || role === "OPERATOR" || role === "STOCK_OPERATOR" || role === "LOGISTICS_OPERATOR";
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);

  if (!isAuthorized(req, session?.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const storeCode = url.searchParams.get("storeCode") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 200) : 50;

  const result = await runERPWatcher({ limitPerRun: limit, storeCode });

  return NextResponse.json({
    ok: true,
    ...result,
    runAt: new Date().toISOString(),
  });
}
