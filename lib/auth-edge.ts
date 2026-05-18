// Versão edge-safe de auth — apenas jose, sem prisma/cookies/crypto.
// Usado exclusivamente pelo middleware.ts (Edge Runtime).
import { jwtVerify, SignJWT } from "jose";

export interface JWTPayload {
  userId: string;
  email:  string;
  role:   string;
  storeId: string;
  name:   string;
  exp?:   number;  // populado pelo jose; usado pelo middleware pra detectar refresh
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "mestre-da-pintura-logistica-secret-2024"
);

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;          // 7 dias
export const REFRESH_THRESHOLD_SECONDS = 60 * 60 * 24;         // re-emite se faltar < 1 dia

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// Re-emite o token com TTL renovado. Usado pelo middleware quando o usuário
// está ativo e o token está perto de expirar.
export async function reissueToken(payload: JWTPayload): Promise<string> {
  // tira `exp` e `iat` da cópia pra deixar o jose preencher os novos
  const { exp: _exp, iat: _iat, ...clean } = payload as JWTPayload & { iat?: number };
  return new SignJWT({ ...clean })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(JWT_SECRET);
}

export function shouldRefresh(payload: JWTPayload): boolean {
  if (!payload.exp) return false;
  const secondsUntilExpiry = payload.exp - Math.floor(Date.now() / 1000);
  return secondsUntilExpiry < REFRESH_THRESHOLD_SECONDS;
}
