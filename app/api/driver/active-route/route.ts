import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

// GET /api/driver/active-route
// Resposta minimal usada pelo DriverLocationTracker pra saber se deve ligar o GPS.
// { hasActive: true } quando o motorista tem rota DISPATCHED não-completed.
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (session.role !== "DRIVER") {
      return NextResponse.json(apiError("Apenas motoristas", "FORBIDDEN"), { status: 403 });
    }

    const driver = await prisma.driver.findFirst({
      where:  { userId: session.userId },
      select: { id: true },
    });
    if (!driver) return NextResponse.json(apiSuccess({ hasActive: false }));

    const route = await prisma.route.findFirst({
      where:  { driverId: driver.id, status: "DISPATCHED" },
      select: { id: true },
    });

    return NextResponse.json(apiSuccess({ hasActive: Boolean(route), routeId: route?.id ?? null }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro";
    console.error("[GET /api/driver/active-route]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
