import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { uploadProofPhoto, isStorageConfigured } from "@/lib/supabase-storage";
import { markDeliveredByOperator, checkAndCompleteRouteFromDeliveryRequest } from "@/services/route-dispatch.service";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

// POST /api/operacao/entregas/[id]/concluir
// Versão de OPERADOR do "concluir": finaliza manualmente pela fila operacional
// (retirada na loja, entrega fora do app). Exige as 2 fotos (canhoto + material),
// igual ao motorista, e auto-avança a entrega até DELIVERED.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ALLOWED_ROLES.includes(session.role)) {
      return NextResponse.json(apiError("Acesso restrito", "FORBIDDEN"), { status: 403 });
    }

    if (!isStorageConfigured()) {
      return NextResponse.json(
        apiError("Armazenamento de fotos não configurado.", "STORAGE_NOT_CONFIGURED"),
        { status: 503 },
      );
    }

    const dr = await prisma.deliveryRequest.findUnique({
      where:   { id: params.id },
      include: { proofs: { select: { type: true } } },
    });
    if (!dr) return NextResponse.json(apiError("Entrega não encontrada", "NOT_FOUND"), { status: 404 });

    const form = await req.formData();
    const receipt  = form.get("receipt")  as File | null;
    const material = form.get("material") as File | null;

    // Fotos podem já existir (anexadas em partes); só exige o que falta.
    const existingByType = new Set(dr.proofs.map((p) => p.type));
    const needsReceipt  = !existingByType.has("RECEIPT");
    const needsMaterial = !existingByType.has("MATERIAL");

    if (needsReceipt && !receipt) {
      return NextResponse.json(apiError("Foto do canhoto é obrigatória", "MISSING_RECEIPT"), { status: 400 });
    }
    if (needsMaterial && !material) {
      return NextResponse.json(apiError("Foto do material é obrigatória", "MISSING_MATERIAL"), { status: 400 });
    }

    for (const f of [receipt, material]) {
      if (!f) continue;
      if (f.size > MAX_PHOTO_BYTES) {
        return NextResponse.json(apiError(`Foto ${f.name} maior que 10 MB`, "TOO_LARGE"), { status: 400 });
      }
      if (!f.type.startsWith("image/")) {
        return NextResponse.json(apiError(`Arquivo ${f.name} não é imagem`, "INVALID_TYPE"), { status: 400 });
      }
    }

    if (receipt) {
      const buf = Buffer.from(await receipt.arrayBuffer());
      const ext = receipt.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const r = await uploadProofPhoto({
        deliveryRequestId: dr.id, type: "RECEIPT", buffer: buf, contentType: receipt.type, extension: ext,
      });
      await prisma.deliveryProof.create({
        data: { deliveryRequestId: dr.id, type: "RECEIPT", photoUrl: r.publicUrl, photoPath: r.path, uploadedById: session.userId },
      });
    }

    if (material) {
      const buf = Buffer.from(await material.arrayBuffer());
      const ext = material.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const r = await uploadProofPhoto({
        deliveryRequestId: dr.id, type: "MATERIAL", buffer: buf, contentType: material.type, extension: ext,
      });
      await prisma.deliveryProof.create({
        data: { deliveryRequestId: dr.id, type: "MATERIAL", photoUrl: r.publicUrl, photoPath: r.path, uploadedById: session.userId },
      });
    }

    // Auto-avança até DELIVERED (cria Dispatch EXCEPTION se for entrega manual sem rota).
    await markDeliveredByOperator(dr.id, session.userId, session.role);

    // Se a entrega pertencia a uma rota e foi a última, fecha a rota. Erro não invalida a entrega.
    try {
      await checkAndCompleteRouteFromDeliveryRequest(dr.id);
    } catch (err) {
      console.error(`[operacao/concluir] checkAndCompleteRoute falhou pra DR ${dr.id}`, err);
    }

    return NextResponse.json(apiSuccess({ deliveryRequestId: dr.id, status: "DELIVERED" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao concluir entrega";
    console.error(`[POST /api/operacao/entregas/${params.id}/concluir]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
