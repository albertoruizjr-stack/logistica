import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { uploadTransferCollectPhoto, isStorageConfigured } from "@/lib/supabase-storage";
import { updateTransferStatus, collectTransfer } from "@/services/transferencia.service";
import { TransferStatus } from "@prisma/client";
import { isTransferCollectPhotoRequired } from "@/services/system-config.service";
import { extractTransferIds, type RouteSequenceEntry } from "@/lib/route-sequence";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

// POST /api/driver/coletas
// multipart/form-data:
//   - transferIds: JSON array (["id1","id2"]) OU campos repetidos "transferIds"
//   - photo:       image/* (uma foto cobre todas as transferências selecionadas)
//
// Marca cada transferência selecionada APPROVED/PREPARED → IN_TRANSIT (via
// updateTransferStatus, que valida o documento TE/NF + escreve history + ledger)
// e grava o comprovante de coleta (collectPhotoUrl/Path/collectedAt).
//
// Ownership: as transferências precisam pertencer a uma parada TRANSFER_PICKUP de
// alguma rota ACTIVE/DISPATCHED do motorista logado. Qualquer ID fora desse conjunto → 403.
//
// Falhas são por-transferência: se uma não tiver documento, updateTransferStatus
// lança e a coleta dela falha — devolvemos resultado parcial (collected + failed).
export async function POST(req: NextRequest) {
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

    const form = await req.formData();

    // transferIds pode chegar como JSON array num único campo OU como campos repetidos.
    const requestedIds = parseTransferIds(form);
    if (requestedIds.length === 0) {
      return NextResponse.json(apiError("Nenhuma transferência selecionada", "NO_TRANSFERS"), { status: 400 });
    }

    // Ownership: junta os transferIds de todas as paradas TRANSFER_PICKUP das rotas
    // ACTIVE/DISPATCHED do motorista. Cada ID pedido precisa estar nesse conjunto.
    const routes = await prisma.route.findMany({
      where:  { driverId: driver.id, status: { in: ["ACTIVE", "DISPATCHED"] } },
      select: { sequenceJson: true },
    });
    const ownedIds = new Set(
      routes.flatMap((r) => extractTransferIds((r.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [])),
    );
    const notMine = requestedIds.filter((id) => !ownedIds.has(id));
    if (notMine.length > 0) {
      return NextResponse.json(
        apiError("Uma ou mais transferências não estão nas suas rotas.", "FORBIDDEN", { notMine }),
        { status: 403 },
      );
    }

    // Foto: obrigatória por padrão (interruptor REQUIRE_TRANSFER_COLLECT_PHOTO).
    const requirePhoto = await isTransferCollectPhotoRequired();
    const photo = form.get("photo") as File | null;

    if (requirePhoto && !photo) {
      return NextResponse.json(apiError("Foto da coleta é obrigatória", "MISSING_PHOTO"), { status: 400 });
    }
    if (photo) {
      if (photo.size > MAX_PHOTO_BYTES) {
        return NextResponse.json(apiError(`Foto ${photo.name} maior que 10 MB`, "TOO_LARGE"), { status: 400 });
      }
      if (!photo.type.startsWith("image/")) {
        return NextResponse.json(apiError(`Arquivo ${photo.name} não é imagem`, "INVALID_TYPE"), { status: 400 });
      }
    }

    // Sobe a foto UMA vez (uma foto cobre a parada inteira). Usa o 1º transferId no path.
    let collectPhotoUrl:  string | undefined;
    let collectPhotoPath: string | undefined;
    if (photo) {
      const buf = Buffer.from(await photo.arrayBuffer());
      const ext = photo.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const r = await uploadTransferCollectPhoto({
        transferId:  requestedIds[0],
        buffer:      buf,
        contentType: photo.type,
        extension:   ext,
      });
      collectPhotoUrl  = r.publicUrl;
      collectPhotoPath = r.path;
    }

    // Por transferência: transita pra IN_TRANSIT (valida doc + history + ledger) e
    // grava o comprovante de coleta. Falha em uma não impede as demais.
    const collected: string[] = [];
    const failed:    { id: string; reason: string }[] = [];

    // Para fluxo novo (READY_TO_COLLECT) usa collectTransfer (transação completa
    // com item.collectConfirmed). Para legados (APPROVED/PREPARED) usa o caminho
    // antigo (updateTransferStatus + manual update) pra preservar compat.
    const currentStatuses = await prisma.transfer.findMany({
      where:  { id: { in: requestedIds } },
      select: { id: true, status: true },
    });
    const statusMap = new Map(currentStatuses.map((t) => [t.id, t.status]));

    for (const id of requestedIds) {
      try {
        const current = statusMap.get(id);
        if (current === TransferStatus.READY_TO_COLLECT && collectPhotoUrl && collectPhotoPath) {
          // Caminho novo — service unificado com history + item.collectConfirmed
          await collectTransfer(
            id,
            { photoUrl: collectPhotoUrl, photoPath: collectPhotoPath },
            session.userId,
          );
        } else {
          // Caminho legado — APPROVED/PREPARED via updateTransferStatus
          await updateTransferStatus(id, {
            status:      "IN_TRANSIT",
            changedById: session.userId,
            notes:       "Coleta confirmada pelo motorista no app",
          });
          await prisma.transfer.update({
            where: { id },
            data: {
              collectPhotoUrl,
              collectPhotoPath,
              collectedAt: new Date(),
            },
          });
        }
        collected.push(id);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro ao coletar";
        console.error(`[POST /api/driver/coletas] transfer ${id} falhou`, err);
        failed.push({ id, reason });
      }
    }

    return NextResponse.json(apiSuccess({ collected, failed }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao registrar coleta";
    console.error("[POST /api/driver/coletas]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}

// transferIds: aceita um campo JSON ('["a","b"]') OU campos repetidos.
function parseTransferIds(form: FormData): string[] {
  const raw = form.getAll("transferIds");
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          for (const v of arr) if (typeof v === "string" && v.trim()) ids.push(v.trim());
        }
      } catch {
        // não era JSON válido — ignora
      }
    } else {
      ids.push(trimmed);
    }
  }
  return Array.from(new Set(ids));
}
