import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { addExtraStopToRoute, removeExtraStop } from "@/services/routing-wave.service";
import { prisma } from "@/lib/prisma";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

const postSchema = z.object({
  kind:              z.enum(["STORE_VISIT", "EXTRA_STOP"]),
  storeId:           z.string().optional(),
  address:           z.string().optional(),
  notes:             z.string().optional(),
  insertAtPosition:  z.number().int().min(1).optional(),
});

const deleteSchema = z.object({
  stopId: z.string().min(1),
});

// POST /api/roteirizacao/routes/[id]/extra-stop
// Adiciona uma parada extra (loja ou endereço livre) à rota.
// Permite mesmo após o despacho (mas não em rota COMPLETED/CANCELLED).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ALLOWED_ROLES.includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    // Pra STORE_VISIT, busca lat/lng da loja pra mostrar no mapa
    let lat: number | null = null;
    let lng: number | null = null;
    if (parsed.data.kind === "STORE_VISIT" && parsed.data.storeId) {
      const store = await prisma.store.findUnique({
        where:  { id: parsed.data.storeId },
        select: { lat: true, lng: true },
      });
      lat = store?.lat ?? null;
      lng = store?.lng ?? null;
    }

    const result = await addExtraStopToRoute(params.id, {
      kind:              parsed.data.kind,
      storeId:           parsed.data.storeId,
      address:           parsed.data.address,
      lat,
      lng,
      notes:             parsed.data.notes,
      insertAtPosition:  parsed.data.insertAtPosition,
    });

    return NextResponse.json(apiSuccess(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao adicionar parada";
    console.error(`[POST /api/roteirizacao/routes/${params.id}/extra-stop]`, err);
    return NextResponse.json(apiError(msg), { status: 400 });
  }
}

// DELETE /api/roteirizacao/routes/[id]/extra-stop?stopId=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ALLOWED_ROLES.includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const stopId = req.nextUrl.searchParams.get("stopId");
    const parsed = deleteSchema.safeParse({ stopId });
    if (!parsed.success) {
      return NextResponse.json(apiError("stopId é obrigatório", "VALIDATION_ERROR"), { status: 400 });
    }

    const result = await removeExtraStop(params.id, parsed.data.stopId);
    return NextResponse.json(apiSuccess(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao remover parada";
    console.error(`[DELETE /api/roteirizacao/routes/${params.id}/extra-stop]`, err);
    return NextResponse.json(apiError(msg), { status: 400 });
  }
}
