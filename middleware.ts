import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth-edge";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  try {
    // libera rotas públicas e assets
    if (
      PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon")
    ) {
      return NextResponse.next();
    }

    // libera webhook do Lalamove (sem auth, verificação é por assinatura HMAC)
    if (pathname === "/api/lalamove/webhook") {
      return NextResponse.next();
    }

    // verifica token JWT
    const token = req.cookies.get("auth_token")?.value;
    if (!token) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Não autenticado", success: false }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const payload = await verifyToken(token);
    if (!payload) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Token inválido ou expirado", success: false }, { status: 401 });
      }
      const response = NextResponse.redirect(new URL("/login", req.url));
      response.cookies.delete("auth_token");
      return response;
    }

    // Driver é restrito ao app do motorista — bloqueia todas as outras rotas.
    if (payload.role === "DRIVER") {
      const isDriverPath = pathname.startsWith("/motorista") || pathname.startsWith("/api/driver");
      const isUniversal  = pathname.startsWith("/api/auth") || pathname.startsWith("/api/notifications");
      if (!isDriverPath && !isUniversal) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json({ error: "Acesso restrito ao app do motorista", success: false }, { status: 403 });
        }
        return NextResponse.redirect(new URL("/motorista", req.url));
      }
    }

    return NextResponse.next();
  } catch {
    // falha inesperada no Edge Runtime — redireciona para login em vez de expor erro bruto
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Erro interno", success: false }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
