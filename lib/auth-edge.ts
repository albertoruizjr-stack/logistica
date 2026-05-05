// Versão edge-safe de auth — apenas jose, sem prisma/cookies/crypto.
// Usado exclusivamente pelo middleware.ts (Edge Runtime).
import { jwtVerify } from "jose";

export interface JWTPayload {
  userId: string;
  email:  string;
  role:   string;
  storeId: string;
  name:   string;
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "mestre-da-pintura-logistica-secret-2024"
);

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
