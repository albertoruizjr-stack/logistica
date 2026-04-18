import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const result = await login(parsed.data.email, parsed.data.password);

    if (!result) {
      return NextResponse.json(
        apiError("E-mail ou senha incorretos", "INVALID_CREDENTIALS"),
        { status: 401 }
      );
    }

    const response = NextResponse.json(
      apiSuccess({
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
          storeId: result.user.storeId,
          store: result.user.store,
        },
      })
    );

    // define cookie HTTP-only para segurança
    response.cookies.set("auth_token", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 8, // 8 horas
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[POST /api/auth/login]", error);
    return NextResponse.json(apiError("Erro no servidor"), { status: 500 });
  }
}
