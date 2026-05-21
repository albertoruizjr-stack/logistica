import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { uploadRouteStartPhoto, isStorageConfigured } from "@/lib/supabase-storage";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

// POST /api/driver/rotas/[id]/iniciar
// multipart/form-data com 1 arquivo: "photo" (image/*) — foto do veículo carregado.
// Faz upload pro Supabase Storage e grava startedAt + foto na Route.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (session.role !== "DRIVER") {
      return NextResponse.json(apiError("Apenas motoristas", "FORBIDDEN"), { status: 403 });
    }

    if (!isStorageConfigured()) {
      return NextResponse.json(
        apiError("Armazenamento de fotos não configurado — peça ao operador pra ativar.", "STORAGE_NOT_CONFIGURED"),
        { status: 503 },
      );
    }

    const driver = await prisma.driver.findFirst({
      where:  { userId: session.userId },
      select: { id: true },
    });
    if (!driver) return NextResponse.json(apiError("Motorista não vinculado"), { status: 403 });

    const route = await prisma.route.findUnique({
      where:  { id: params.id },
      select: { id: true, driverId: true, startedAt: true },
    });
    if (!route) return NextResponse.json(apiError("Rota não encontrada", "NOT_FOUND"), { status: 404 });
    if (route.driverId !== driver.id) {
      return NextResponse.json(apiError("Rota não é sua", "FORBIDDEN"), { status: 403 });
    }

    const form  = await req.formData();
    const photo = form.get("photo") as File | null;
    if (!photo) {
      return NextResponse.json(apiError("Foto de saída é obrigatória", "MISSING_PHOTO"), { status: 400 });
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(apiError(`Foto ${photo.name} maior que 10 MB`, "TOO_LARGE"), { status: 400 });
    }
    if (!photo.type.startsWith("image/")) {
      return NextResponse.json(apiError(`Arquivo ${photo.name} não é imagem`, "INVALID_TYPE"), { status: 400 });
    }

    const buf = Buffer.from(await photo.arrayBuffer());
    const ext = photo.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const r = await uploadRouteStartPhoto({
      routeId:     route.id,
      buffer:      buf,
      contentType: photo.type,
      extension:   ext,
    });

    const startedAt = new Date();
    // Se a rota já estava iniciada, sobrescreve com a nova foto/horário (comportamento aceito).
    await prisma.route.update({
      where: { id: route.id },
      data:  { startedAt, startPhotoUrl: r.publicUrl, startPhotoPath: r.path },
    });

    return NextResponse.json(apiSuccess({ routeId: route.id, startedAt }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao iniciar a rota";
    console.error(`[POST /api/driver/rotas/${params.id}/iniciar]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
