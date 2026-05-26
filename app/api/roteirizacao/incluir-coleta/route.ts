import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { prisma } from "@/lib/prisma";
import { type RouteSequenceEntry, isTransferPickupStop } from "@/lib/route-sequence";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

const postSchema = z.object({
  transferIds: z.array(z.string().min(1)).min(1),
  routeId:     z.string().min(1),
});

// POST /api/roteirizacao/incluir-coleta
// Anexa parada(s) TRANSFER_PICKUP à rota escolhida — agrupando por loja de origem.
// A parada de coleta é manual (sem deliveryRequestId): não vira Dispatch nem entra
// em extractDeliveryRequestIds. O motorista, na loja, marca quais transferências leva.
export async function POST(req: NextRequest) {
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
    const { transferIds, routeId } = parsed.data;

    // 1. Valida a rota (precisa estar ACTIVE/DISPATCHED).
    const route = await prisma.route.findUnique({
      where:  { id: routeId },
      select: { id: true, status: true, sequenceJson: true },
    });
    if (!route) {
      return NextResponse.json(apiError("Rota não encontrada", "NOT_FOUND"), { status: 404 });
    }
    if (route.status !== "ACTIVE" && route.status !== "DISPATCHED") {
      return NextResponse.json(
        apiError(`Não é possível incluir coleta em rota ${route.status}`, "INVALID_STATE"),
        { status: 400 },
      );
    }

    // 2. Valida as transferências (existem e estão disponíveis para coleta).
    const transfers = await prisma.transfer.findMany({
      where:  { id: { in: transferIds } },
      select: { id: true, status: true, fromStoreId: true },
    });
    if (transfers.length !== transferIds.length) {
      return NextResponse.json(
        apiError("Uma ou mais transferências não foram encontradas", "NOT_FOUND"),
        { status: 404 },
      );
    }
    const notCollectable = transfers.filter(
      (t) => t.status !== "APPROVED" && t.status !== "PREPARED",
    );
    if (notCollectable.length > 0) {
      return NextResponse.json(
        apiError("Uma ou mais transferências não estão disponíveis para coleta", "INVALID_STATE"),
        { status: 400 },
      );
    }

    // 3. Agrupa por loja de origem. Transfers em fluxo de coleta sempre têm
    //    fromStoreId (READY_TO_COLLECT ou legados); filtra defensivamente.
    const byStore = new Map<string, string[]>();
    for (const t of transfers) {
      if (!t.fromStoreId) continue;
      const list = byStore.get(t.fromStoreId) ?? [];
      list.push(t.id);
      byStore.set(t.fromStoreId, list);
    }

    // 4. Funde no sequenceJson: por loja, ou acrescenta numa parada TRANSFER_PICKUP
    //    existente (dedup), ou cria uma nova parada ao final.
    const seq = (route.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
    const updated: RouteSequenceEntry[] = seq.map((s) => ({ ...s }));
    let maxPos = updated.reduce((m, s) => Math.max(m, Number(s.stopPosition ?? 0)), 0);

    for (const [storeId, ids] of byStore) {
      const existing = updated.find(
        (s) => isTransferPickupStop(s) && s.storeId === storeId,
      );
      if (existing) {
        const merged = new Set([...(existing.transferIds ?? []), ...ids]);
        existing.transferIds = Array.from(merged);
      } else {
        maxPos += 1;
        updated.push({
          type:         "TRANSFER_PICKUP",
          storeId,
          transferIds:  Array.from(new Set(ids)),
          stopPosition: maxPos,
        });
      }
    }

    // 5. Persiste.
    await prisma.route.update({
      where: { id: routeId },
      data:  {
        sequenceJson: updated as unknown as Prisma.InputJsonValue,
        stopCount:    updated.length,
      },
    });

    return NextResponse.json(apiSuccess({ routeId, added: transferIds.length }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao incluir coleta na rota";
    console.error("[POST /api/roteirizacao/incluir-coleta]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
