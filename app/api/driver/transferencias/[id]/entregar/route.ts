import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { uploadTransferDeliveryPhoto, isStorageConfigured } from "@/lib/supabase-storage";
import { deliverTransfer } from "@/services/transferencia.service";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// POST /api/driver/transferencias/[id]/entregar
// multipart/form-data:
//   - photo:         image/* (obrigatória — prova da entrega)
//   - recipientName: string (quem recebeu)
//   - receivedQty:   number (qty efetivamente recebida; se < quantity vira divergência)
//
// Ownership: a transferência precisa estar IN_TRANSIT e pertencer ao dispatch
// do motorista logado.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (session.role !== "DRIVER") {
      return NextResponse.json(apiError("Apenas motoristas", "FORBIDDEN"), { status: 403 });
    }
    if (!isStorageConfigured()) {
      return NextResponse.json(
        apiError("Armazenamento de fotos não configurado", "STORAGE_NOT_CONFIGURED"),
        { status: 503 },
      );
    }

    const { id } = await params;

    // Ownership: Transfer.dispatch.driverId === driver do motorista
    const driver = await prisma.driver.findFirst({
      where:  { userId: session.userId },
      select: { id: true },
    });
    if (!driver) return NextResponse.json(apiError("Motorista não vinculado"), { status: 403 });

    const transfer = await prisma.transfer.findUnique({
      where:   { id },
      include: { dispatch: { select: { driverId: true } } },
    });
    if (!transfer) return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });
    if (transfer.dispatch?.driverId !== driver.id) {
      return NextResponse.json(apiError("Não é o motorista desta transferência", "FORBIDDEN"), { status: 403 });
    }

    const form = await req.formData();
    const photo = form.get("photo") as File | null;
    const recipientName = String(form.get("recipientName") ?? "").trim();
    const receivedQtyRaw = String(form.get("receivedQty") ?? "");
    const receivedQty = Number(receivedQtyRaw);

    if (!photo) {
      return NextResponse.json(apiError("Foto da entrega é obrigatória", "MISSING_PHOTO"), { status: 400 });
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(apiError("Foto maior que 10 MB", "TOO_LARGE"), { status: 400 });
    }
    if (!photo.type.startsWith("image/")) {
      return NextResponse.json(apiError("Arquivo não é imagem", "INVALID_TYPE"), { status: 400 });
    }
    if (!recipientName) {
      return NextResponse.json(apiError("Informe quem recebeu", "MISSING_RECIPIENT"), { status: 400 });
    }
    if (!Number.isFinite(receivedQty) || receivedQty <= 0) {
      return NextResponse.json(apiError("Quantidade recebida inválida", "INVALID_QTY"), { status: 400 });
    }

    // Upload da foto
    const buf = Buffer.from(await photo.arrayBuffer());
    const ext = photo.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const uploaded = await uploadTransferDeliveryPhoto({
      transferId:  id,
      buffer:      buf,
      contentType: photo.type,
      extension:   ext,
    });

    // Chama o service unificado (reconcileTransfer + cascata DR + divergência)
    const updated = await deliverTransfer(
      id,
      {
        photoUrl:      uploaded.publicUrl,
        photoPath:     uploaded.path,
        recipientName,
        receivedQty,
      },
      session.userId,
    );

    return NextResponse.json(apiSuccess({
      delivered:     true,
      hasDivergence: (updated as any).hasDivergence ?? false,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao registrar entrega";
    console.error("[POST /api/driver/transferencias/[id]/entregar]", err);
    const status = /IN_TRANSIT|item|driver/i.test(msg) ? 422 : 500;
    return NextResponse.json(apiError(msg), { status });
  }
}
