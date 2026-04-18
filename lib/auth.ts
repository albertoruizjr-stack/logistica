import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { createHash } from "crypto";

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

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")  // sessão de 8 horas (turno de trabalho)
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

export function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email, active: true },
    include: { store: true },
  });

  if (!user) return null;

  const hashedPassword = hashPassword(password);
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
