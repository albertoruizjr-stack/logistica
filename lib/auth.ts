import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "mestre-da-pintura-logistica-secret-2024"
);

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  storeId: string;
  name: string;
}

// Sessão de 7 dias com refresh sliding: enquanto o usuário está ativo,
// o middleware re-emite o token. Um turno (8h) era curto demais quando o operador
// deixava a aba aberta entre uma operação e outra (ex: roteirizar de manhã,
// despachar no almoço).
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 dias

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function getSessionFromRequest(req: NextRequest): Promise<JWTPayload | null> {
  const token = req.cookies.get("auth_token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email, active: true },
    include: { store: true },
  });

  if (!user) return null;

  const hashedPassword = await hashPassword(password);
  if (user.password !== hashedPassword) return null;

  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    storeId: user.storeId,
    name: user.name,
  };

  const token = await createToken(payload);
  return { user, token };
}
