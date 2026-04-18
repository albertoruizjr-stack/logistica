import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { createTransfer, listTransfers } from "@/services/transferencia.service";
import { TransferPriority, TransferStatus } from "@prisma/client";

const createSchema = z.object({
  deliveryRequestId: z.string().optional(),
  fromStoreId: z.string(),
  toStoreId: z.string(),
  priority: z.nativeEnum(TransferPriority),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      productCode: z.string(),
      productName: z.string(),
      quantity: z.number().positive(),
      unit: z.string().default("UN"),
    })
  ).min(1, "Informe ao menos um item"),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as TransferStatus | null;
    const priority = searchParams.get("priority") as TransferPriority | null;
    const fromStoreId = searchParams.get("fromStoreId") ?? undefined;
    const toStoreId = searchParams.get("toStoreId") ?? undefined;
    const limit = parseInt(searchParams.get("limit") ?? "50");
    const offset = parseInt(searchParams.get("offset") ?? "0");

    const result = await listTransfers({
      status: status ?? undefined,
      priority: priority ?? undefined,
      fromStoreId,
      toStoreId,
      limit,
      offset,
    });

    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    console.error("[GET /api/transferencias]", error);
    return NextResponse.json(apiError("Erro ao listar transferências"), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    if (parsed.data.fromStoreId === parsed.data.toStoreId) {
      return NextResponse.json(
        apiError("Loja de origem e destino não podem ser iguais", "INVALID_STORES"),
        { status: 400 }
      );
    }

    const transfer = await createTransfer({
      ...parsed.data,
      requestedById: session.userId,
    });

    return NextResponse.json(apiSuccess(transfer), { status: 201 });
  } catch (error) {
    console.error("[POST /api/transferencias]", error);
    return NextResponse.json(apiError("Erro ao criar transferência"), { status: 500 });
  }
}
