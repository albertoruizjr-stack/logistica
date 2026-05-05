// app/api/torre/alertas/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiError } from "@/types";
import { AlertResolutionType } from "@prisma/client";

const ResolveSchema = z.object({
  status: z.enum(["RESOLVED", "CANCELLED", "IN_PROGRESS", "SNOOZED"]),
  resolutionType: z.nativeEnum(AlertResolutionType).optional(),
  resolutionNotes: z.string().max(1000).optional(),
  snoozedUntil: z.string().datetime({ message: "snoozedUntil deve ser ISO 8601" }).optional(),
}).refine(
  (data) => data.status !== "SNOOZED" || data.snoozedUntil !== undefined,
  { message: "snoozedUntil é obrigatório quando status = SNOOZED", path: ["snoozedUntil"] }
).refine(
  (data) => !["RESOLVED", "CANCELLED"].includes(data.status) || data.resolutionType !== undefined,
  { message: "resolutionType é obrigatório ao resolver ou cancelar", path: ["resolutionType"] }
);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const alert = await prisma.controlTowerAlert.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });

    if (!alert) {
      return NextResponse.json(apiError("Alerta não encontrado"), { status: 404 });
    }

    if (["RESOLVED", "CANCELLED"].includes(alert.status)) {
      return NextResponse.json(
        apiError("Alerta já foi resolvido ou cancelado"),
        { status: 409 }
      );
    }

    const body = await req.json();
    const parsed = ResolveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", undefined, parsed.error.flatten()),
        { status: 400 }
      );
    }

    const { status, resolutionType, resolutionNotes, snoozedUntil } = parsed.data;
    const isClosing = status === "RESOLVED" || status === "CANCELLED";

    const updated = await prisma.controlTowerAlert.update({
      where: { id: params.id },
      data: {
        status,
        ...(isClosing ? {
          resolutionType,
          resolutionNotes,
          resolvedById: session.userId,
          resolvedAt: new Date(),
        } : {}),
        ...(status === "SNOOZED" && snoozedUntil ? {
          snoozedUntil: new Date(snoozedUntil),
        } : {}),
      },
      select: {
        id: true,
        status: true,
        resolutionType: true,
        resolutionNotes: true,
        resolvedAt: true,
        snoozedUntil: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/torre/alertas/:id]", err);
    return NextResponse.json(apiError("Erro interno"), { status: 500 });
  }
}
