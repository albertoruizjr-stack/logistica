import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { createWave, listWaves } from "@/services/routing-wave.service";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

const createWaveSchema = z.object({
  name:               z.string().min(1).max(100),
  date:               z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  deliveryRequestIds: z.array(z.string()).min(1),
  driverIds:          z.array(z.string()).min(1),
  notes:              z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ALLOWED_ROLES.includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão para criar wave", "FORBIDDEN"), { status: 403 });
    }

    const body = await req.json();
    const parsed = createWaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    // Normaliza pra meio-dia UTC do dia escolhido — evita que "2026-05-13" salvo como
    // midnight UTC apareça como "12/05" em Brasília (UTC-3). Meio-dia UTC garante que
    // qualquer timezone razoável mostre o mesmo dia civil.
    const dateOnly = parsed.data.date.slice(0, 10); // "2026-05-13"
    const normalizedDate = new Date(`${dateOnly}T12:00:00.000Z`);

    const wave = await createWave({
      name:               parsed.data.name,
      date:               normalizedDate,
      createdById:        session.userId,
      deliveryRequestIds: parsed.data.deliveryRequestIds,
      driverIds:          parsed.data.driverIds,
      notes:              parsed.data.notes,
    });

    return NextResponse.json(apiSuccess(wave), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao criar wave";
    console.error("[POST /api/roteirizacao/waves]", err);
    return NextResponse.json(apiError(msg), { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const url = new URL(req.url);
    const limit  = Number(url.searchParams.get("limit")  ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);

    const waves = await listWaves({ limit, offset });
    return NextResponse.json(apiSuccess(waves));
  } catch (err) {
    console.error("[GET /api/roteirizacao/waves]", err);
    return NextResponse.json(apiError("Erro ao listar waves"), { status: 500 });
  }
}
