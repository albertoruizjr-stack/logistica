import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";

// GET /api/notifications
// Lista notificações do usuário logado. Não-lidas primeiro, depois por createdAt desc.
// Query params:
//   ?limit=20  (padrão 20, máx 50)
//   ?unread=1  (apenas não-lidas)

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit  = Math.min(Number(searchParams.get("limit") ?? 20), 50);
    const onlyUnread = searchParams.get("unread") === "1";

    const where = {
      userId: session.userId,
      ...(onlyUnread ? { readAt: null } : {}),
    };

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
        take: limit,
        select: {
          id: true, type: true, title: true, body: true,
          link: true, metadata: true, readAt: true, createdAt: true,
        },
      }),
      prisma.notification.count({ where: { userId: session.userId, readAt: null } }),
    ]);

    return NextResponse.json(apiSuccess({
      items: items.map(n => ({
        ...n,
        readAt:    n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        metadata:  n.metadata ? safeParse(n.metadata) : null,
      })),
      unreadCount,
    }));
  } catch (error) {
    console.error("[GET /api/notifications]", error);
    return NextResponse.json(apiError("Erro ao listar notificações"), { status: 500 });
  }
}

// PATCH /api/notifications
// Marca uma ou várias como lidas.
// body: { ids: string[] } ou { markAllRead: true }

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const body = await req.json().catch(() => ({}));
    const now = new Date();

    if (body.markAllRead) {
      const r = await prisma.notification.updateMany({
        where: { userId: session.userId, readAt: null },
        data:  { readAt: now },
      });
      return NextResponse.json(apiSuccess({ marked: r.count }));
    }

    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
    if (ids.length === 0) {
      return NextResponse.json(apiError("Informe ids ou markAllRead", "VALIDATION_ERROR"), { status: 400 });
    }

    const r = await prisma.notification.updateMany({
      where: { id: { in: ids }, userId: session.userId, readAt: null },
      data:  { readAt: now },
    });
    return NextResponse.json(apiSuccess({ marked: r.count }));
  } catch (error) {
    console.error("[PATCH /api/notifications]", error);
    return NextResponse.json(apiError("Erro ao marcar notificações"), { status: 500 });
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
