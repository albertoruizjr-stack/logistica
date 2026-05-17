import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

// Esquema do ping. Vem do browser do motorista (PWA) a cada ~30s.
// accuracy/speed/heading podem faltar dependendo do sensor.
const pingSchema = z.object({
  lat:      z.number().gte(-90).lte(90),
  lng:      z.number().gte(-180).lte(180),
  speed:    z.number().nullable().optional(),
  heading:  z.number().nullable().optional(),
  accuracy: z.number().nullable().optional(),
});

// Pings imprecisos demais são lixo — descartamos no servidor pra não poluir o DB
// e atrapalhar cálculos de ETA. 100m é o suficiente pra rastreio urbano.
const MAX_ACCEPTABLE_ACCURACY_M = 100;

// POST /api/driver/location
// Grava um DriverLocation novo. Apenas role=DRIVER. Idempotência via timestamp.
export async function POST(req: NextRequest) {
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
    if (!driver) return NextResponse.json(apiError("Motorista não vinculado", "FORBIDDEN"), { status: 403 });

    const body = await req.json();
    const parsed = pingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    const { lat, lng, speed, heading, accuracy } = parsed.data;

    if (accuracy != null && accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
      return NextResponse.json(apiSuccess({ stored: false, reason: "accuracy_too_low" }));
    }

    await prisma.driverLocation.create({
      data: {
        driverId: driver.id,
        lat,
        lng,
        speed:    speed    ?? null,
        heading:  heading  ?? null,
        accuracy: accuracy ?? null,
        source:   "APP",
      },
    });

    return NextResponse.json(apiSuccess({ stored: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao gravar localização";
    console.error("[POST /api/driver/location]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
