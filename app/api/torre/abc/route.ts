// app/api/torre/abc/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiError } from "@/types";
import { AbcClassificationValue } from "@prisma/client";

const AbcItemSchema = z
  .object({
    storeId: z.string().min(1, "storeId obrigatório"),
    productCode: z.string().min(1, "productCode obrigatório"),
    productName: z.string().min(1, "productName obrigatório"),
    classification: z.nativeEnum(AbcClassificationValue, {
      errorMap: () => ({ message: "classification obrigatória (A, B ou C)" }),
    }),
    minStock: z.number().min(0, "minStock não pode ser negativo").optional(),
    maxStock: z.number().min(0, "maxStock não pode ser negativo").optional(),
    coverageDaysTarget: z
      .number()
      .int()
      .positive("coverageDaysTarget obrigatório e positivo"),
    avgDailySales: z.number().min(0).optional(),
    isManualOverride: z.boolean().default(true),
  })
  .refine(
    (data) =>
      data.maxStock === undefined ||
      data.minStock === undefined ||
      data.maxStock >= data.minStock,
    { message: "maxStock deve ser maior ou igual ao minStock", path: ["maxStock"] }
  );

const AbcBatchSchema = z.array(AbcItemSchema).min(1, "Envie ao menos um item");

// GET /api/torre/abc?storeId=xxx[&classification=A]
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session)
      return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");
    const classification = searchParams.get(
      "classification"
    ) as AbcClassificationValue | null;

    if (!storeId) {
      return NextResponse.json(apiError("storeId é obrigatório"), {
        status: 400,
      });
    }

    const items = await prisma.abcClassification.findMany({
      where: {
        storeId,
        ...(classification ? { classification } : {}),
      },
      include: {
        store: { select: { code: true, name: true } },
      },
      orderBy: [{ classification: "asc" }, { productCode: "asc" }],
    });

    return NextResponse.json({ data: items, total: items.length });
  } catch (err) {
    console.error("[GET /api/torre/abc]", err);
    return NextResponse.json(apiError("Erro interno"), { status: 500 });
  }
}

// POST /api/torre/abc — upsert de um ou mais itens
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session)
      return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!["ADMIN", "OPERATOR"].includes(session.role)) {
      return NextResponse.json(apiError("Permissão insuficiente"), {
        status: 403,
      });
    }

    const body = await req.json();
    // Aceitar objeto único ou array
    const raw = Array.isArray(body) ? body : [body];

    const parsed = AbcBatchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", undefined, parsed.error.flatten()),
        { status: 400 }
      );
    }

    const upserted = await Promise.all(
      parsed.data.map((item) =>
        prisma.abcClassification.upsert({
          where: {
            storeId_productCode: {
              storeId: item.storeId,
              productCode: item.productCode,
            },
          },
          create: {
            storeId: item.storeId,
            productCode: item.productCode,
            productName: item.productName,
            classification: item.classification,
            source: "MANUAL",
            isManualOverride: item.isManualOverride,
            minStock: item.minStock,
            maxStock: item.maxStock,
            coverageDaysTarget: item.coverageDaysTarget,
            avgDailySales: item.avgDailySales,
          },
          update: {
            productName: item.productName,
            classification: item.classification,
            isManualOverride: item.isManualOverride,
            minStock: item.minStock,
            maxStock: item.maxStock,
            coverageDaysTarget: item.coverageDaysTarget,
            avgDailySales: item.avgDailySales,
          },
        })
      )
    );

    return NextResponse.json(
      { upserted: upserted.length, data: upserted },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/torre/abc]", err);
    return NextResponse.json(apiError("Erro interno"), { status: 500 });
  }
}
