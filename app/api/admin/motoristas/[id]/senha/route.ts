import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest, hashPassword } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

const setPasswordSchema = z.object({
  password: z.string().min(4, "Senha precisa de pelo menos 4 caracteres").max(120),
});

// PUT /api/admin/motoristas/[id]/senha
// Cria User (role=DRIVER) caso não exista, ou apenas atualiza a senha.
export async function PUT(
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
    const parsed = setPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    const driver = await prisma.driver.findUnique({
      where:   { id: params.id },
      include: { user: true },
    });
    if (!driver) {
      return NextResponse.json(apiError("Motorista não encontrado", "NOT_FOUND"), { status: 404 });
    }

    const email = driver.email ?? driver.user?.email;
    if (!email) {
      return NextResponse.json(
        apiError("Motorista sem email cadastrado — não é possível criar login.", "NO_EMAIL"),
        { status: 400 },
      );
    }

    const hashed = await hashPassword(parsed.data.password);

    if (driver.user) {
      // Atualiza senha do User existente
      await prisma.user.update({
        where: { id: driver.user.id },
        data:  { password: hashed, active: true },
      });
    } else {
      // Cria User + linka via driver.userId
      const existingUserSameEmail = await prisma.user.findUnique({ where: { email } });
      const user = existingUserSameEmail
        ? await prisma.user.update({
            where: { id: existingUserSameEmail.id },
            data:  { password: hashed, role: "DRIVER", active: true },
          })
        : await prisma.user.create({
            data: {
              name:     driver.name,
              email,
              password: hashed,
              role:     "DRIVER",
              storeId:  driver.storeId,
              active:   true,
            },
          });
      await prisma.driver.update({
        where: { id: driver.id },
        data:  { userId: user.id },
      });
    }

    return NextResponse.json(apiSuccess({ driverId: driver.id, email }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao definir senha";
    console.error(`[PUT /api/admin/motoristas/${params.id}/senha]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
