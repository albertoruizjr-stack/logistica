import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { createWave, getWaveDetail } from "@/services/routing-wave.service";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

const schema = z.object({
  driverIds:          z.array(z.string()).min(1, "Selecione pelo menos 1 motorista"),
  deliveryRequestIds: z.array(z.string()).optional(),  // se omitido, usa órfãs da wave original
});

// POST /api/roteirizacao/waves/[id]/re-roteirizar
// Cria uma NOVA wave com as DRs órfãs (ou as informadas) da wave original.
// Útil quando o Spoke não consegue encaixar todas as DRs na primeira tentativa.
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
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    const original = await getWaveDetail(params.id);
    if (!original) {
      return NextResponse.json(apiError("Wave original não encontrada", "NOT_FOUND"), { status: 404 });
    }

    // Decide quais DRs entram na nova wave:
    //  - usa as informadas pelo cliente, se enviou
    //  - senão usa as órfãs (DRs que estavam na wave original mas não couberam em nenhuma rota)
    const drIds = parsed.data.deliveryRequestIds && parsed.data.deliveryRequestIds.length > 0
      ? parsed.data.deliveryRequestIds
      : original.orphans.map((d) => d.id);

    if (drIds.length === 0) {
      return NextResponse.json(
        apiError("Nenhuma entrega órfã pra re-roteirizar nesta wave", "NO_ORPHANS"),
        { status: 400 },
      );
    }

    // Valida que as DRs estão em status compatível com roteirização.
    // ROTEIRIZADO → primeiro voltam pra PRONTO_ROTEIRIZACAO (são órfãs sem rota real).
    const validation = await prisma.deliveryRequest.findMany({
      where:  { id: { in: drIds } },
      select: { id: true, status: true },
    });
    const invalid = validation.filter((d) => d.status !== "PRONTO_ROTEIRIZACAO" && d.status !== "ROTEIRIZADO");
    if (invalid.length > 0) {
      return NextResponse.json(
        apiError(
          `${invalid.length} entrega(s) em status incompatível com roteirização`,
          "INVALID_STATUS",
          { invalid: invalid.map((d) => d.id) },
        ),
        { status: 422 },
      );
    }

    // Volta órfãs ROTEIRIZADO → PRONTO_ROTEIRIZACAO pra createWave aceitar.
    const stillRoteirizado = validation.filter((d) => d.status === "ROTEIRIZADO").map((d) => d.id);
    if (stillRoteirizado.length > 0) {
      await prisma.deliveryRequest.updateMany({
        where: { id: { in: stillRoteirizado } },
        data:  { status: "PRONTO_ROTEIRIZACAO" },
      });
    }

    const name = `Re-roteirização de ${original.name}`;
    const newWave = await createWave({
      name,
      date:               original.date,
      createdById:        session.userId,
      deliveryRequestIds: drIds,
      driverIds:          parsed.data.driverIds,
    });

    return NextResponse.json(apiSuccess({ waveId: newWave.id, deliveryCount: drIds.length }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao re-roteirizar";
    console.error(`[POST /api/roteirizacao/waves/${params.id}/re-roteirizar]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
