import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { geocodeAddress } from "@/lib/google-maps";
import { apiSuccess, apiError } from "@/types";

const schema = z.object({
  address: z.string().min(5, "Endereço muito curto"),
});

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(apiError("Não autenticado"), { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      apiError("Endereço inválido", "VALIDATION_ERROR"),
      { status: 400 }
    );
  }

  const result = await geocodeAddress(parsed.data.address);

  if (!result) {
    return NextResponse.json(
      apiError(
        "Não foi possível localizar o endereço. Verifique o endereço ou informe as coordenadas manualmente.",
        "NOT_FOUND"
      ),
      { status: 404 }
    );
  }

  return NextResponse.json(apiSuccess(result));
}
