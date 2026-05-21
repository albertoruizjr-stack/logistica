import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { transitionDeliveryRequest } from "@/services/state-machine.service";
import { uploadProofPhoto, isStorageConfigured } from "@/lib/supabase-storage";
import { checkAndCompleteRouteFromDeliveryRequest, ensureDeliveryInTransit, completeDispatchForDelivery } from "@/services/route-dispatch.service";
import { isDeliveryAssignedToDriver } from "@/lib/driver-ownership";
import { isDeliveryPhotoRequired, isRouteStartPhotoRequired } from "@/services/system-config.service";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

// POST /api/driver/entregas/[id]/concluir
// multipart/form-data com 2 arquivos: "receipt" e "material" (image/*)
// Faz upload pro Supabase Storage, salva DeliveryProof, transita DR pra DELIVERED.
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

    const dr = await prisma.deliveryRequest.findUnique({
      where:   { id: params.id },
      include: { proofs: { select: { type: true } } },
    });
    if (!dr) return NextResponse.json(apiError("Entrega não encontrada", "NOT_FOUND"), { status: 404 });

    const isMine = await isDeliveryAssignedToDriver(dr.id, driver.id);
    if (!isMine) {
      return NextResponse.json(apiError("Entrega não é sua", "FORBIDDEN"), { status: 403 });
    }

    // Gate dormente: quando REQUIRE_ROUTE_START_PHOTO == "true", exige que a rota
    // da entrega tenha sido iniciada (foto de saída) antes de finalizar.
    // DEFAULT FALSE → não bloqueia nada hoje. Se não der pra resolver a rota, não bloqueia.
    const requireRouteStart = await isRouteStartPhotoRequired();
    if (requireRouteStart) {
      try {
        // 1) Rota via dispatch direto da DR (fase pós-despacho).
        const dispatch = await prisma.dispatch.findUnique({
          where:  { deliveryRequestId: dr.id },
          select: { routeId: true },
        });
        let routeStartedAt: Date | null | undefined;
        if (dispatch?.routeId) {
          const route = await prisma.route.findUnique({
            where:  { id: dispatch.routeId },
            select: { startedAt: true },
          });
          routeStartedAt = route?.startedAt;
        } else {
          // 2) Fase pré-despacho: rota cujo sequenceJson contém esta DR.
          const rows = await prisma.$queryRaw<{ startedAt: Date | null }[]>`
            SELECT "startedAt" FROM routes
            WHERE status IN ('ACTIVE', 'DISPATCHED')
              AND "sequenceJson" @> ${JSON.stringify([{ deliveryRequestId: dr.id }])}::jsonb
            LIMIT 1
          `;
          if (rows.length > 0) routeStartedAt = rows[0].startedAt;
        }

        // Só bloqueia se conseguimos resolver a rota E ela não foi iniciada.
        if (routeStartedAt !== undefined && !routeStartedAt) {
          return NextResponse.json(
            apiError("Inicie a rota (com foto de saída) antes de finalizar entregas.", "ROUTE_NOT_STARTED"),
            { status: 400 },
          );
        }
      } catch (err) {
        // Falha ao resolver a rota não deve travar a entrega (gate robusto).
        console.error(`[concluir] gate ROUTE_NOT_STARTED falhou pra DR ${dr.id}`, err);
      }
    }

    const form = await req.formData();
    const receipt  = form.get("receipt")  as File | null;
    const material = form.get("material") as File | null;

    // Toggle de runtime: quando REQUIRE_DELIVERY_PHOTO == "false", a foto vira opcional.
    const requirePhoto = await isDeliveryPhotoRequired();

    // Verifica se há proof existente (motorista pode anexar fotos em partes)
    const existingByType = new Set(dr.proofs.map((p) => p.type));
    const needsReceipt  = !existingByType.has("RECEIPT");
    const needsMaterial = !existingByType.has("MATERIAL");

    if (requirePhoto) {
      if (needsReceipt && !receipt) {
        return NextResponse.json(apiError("Foto do canhoto é obrigatória", "MISSING_RECEIPT"), { status: 400 });
      }
      if (needsMaterial && !material) {
        return NextResponse.json(apiError("Foto do material é obrigatória", "MISSING_MATERIAL"), { status: 400 });
      }
    }

    // Validação básica de tamanho/tipo
    for (const f of [receipt, material]) {
      if (!f) continue;
      if (f.size > MAX_PHOTO_BYTES) {
        return NextResponse.json(apiError(`Foto ${f.name} maior que 10 MB`, "TOO_LARGE"), { status: 400 });
      }
      if (!f.type.startsWith("image/")) {
        return NextResponse.json(apiError(`Arquivo ${f.name} não é imagem`, "INVALID_TYPE"), { status: 400 });
      }
    }

    // Upload + persist proof
    if (receipt) {
      const buf = Buffer.from(await receipt.arrayBuffer());
      const ext = receipt.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const r = await uploadProofPhoto({
        deliveryRequestId: dr.id,
        type:              "RECEIPT",
        buffer:            buf,
        contentType:       receipt.type,
        extension:         ext,
      });
      await prisma.deliveryProof.create({
        data: {
          deliveryRequestId: dr.id,
          type:              "RECEIPT",
          photoUrl:          r.publicUrl,
          photoPath:         r.path,
          uploadedById:      session.userId,
        },
      });
    }

    if (material) {
      const buf = Buffer.from(await material.arrayBuffer());
      const ext = material.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const r = await uploadProofPhoto({
        deliveryRequestId: dr.id,
        type:              "MATERIAL",
        buffer:            buf,
        contentType:       material.type,
        extension:         ext,
      });
      await prisma.deliveryProof.create({
        data: {
          deliveryRequestId: dr.id,
          type:              "MATERIAL",
          photoUrl:          r.publicUrl,
          photoPath:         r.path,
          uploadedById:      session.userId,
        },
      });
    }

    // Garante que a entrega chegou a IN_TRANSIT antes de marcar DELIVERED.
    // O app mostra a entrega já em ROTEIRIZADO (rota ainda não despachada); sem isto,
    // o motorista travava com "Transição inválida: ROTEIRIZADO → DELIVERED".
    await ensureDeliveryInTransit(dr.id, session.userId, "DRIVER");

    // Transita pra DELIVERED via state machine
    await transitionDeliveryRequest({
      requestId: dr.id,
      actorId:   session.userId,
      actorRole: "DRIVER",
      toStatus:  "DELIVERED",
      metadata:  { reason: "Entrega confirmada pelo motorista com fotos" },
    });

    // Fecha o despacho (senão fica IN_TRANSIT e a entrega entregue continua aparecendo em "Em rota agora").
    await completeDispatchForDelivery(dr.id);

    // Se foi a última DR da rota, fecha a rota e libera o motorista.
    // Erro aqui não invalida a entrega — apenas loga.
    try {
      await checkAndCompleteRouteFromDeliveryRequest(dr.id);
    } catch (err) {
      console.error(`[concluir] checkAndCompleteRoute falhou pra DR ${dr.id}`, err);
    }

    return NextResponse.json(apiSuccess({ deliveryRequestId: dr.id, status: "DELIVERED" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao confirmar entrega";
    console.error(`[POST /api/driver/entregas/${params.id}/concluir]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
