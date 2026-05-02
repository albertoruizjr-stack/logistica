// ──────────────────────────────────────────────
// INTEGRAÇÃO COM O CITEL/AUTCOM
//
// Responsável por autenticar e consultar estoque
// via API do Citel (GET /produtoEstoqueCodigo).
//
// Autenticação: GET /OperadorLogar/{login}/{senha}/{empresa}
// O token é cacheado em memória e renovado ao expirar.
//
// IMPORTANTE: credenciais não são logadas — a URL de
// autenticação contém senha em plaintext (protocolo legado).
// ──────────────────────────────────────────────

import type { CitelEstoqueProduto, CitelEstoqueEmpresa } from "@/types/stock";

const BASE_URL = process.env.CITEL_API_URL ?? "";
const CITEL_LOGIN = process.env.CITEL_LOGIN ?? "";
const CITEL_SENHA = process.env.CITEL_SENHA ?? "";
const CITEL_EMPRESA_BASE = process.env.CITEL_EMPRESA_BASE ?? "1"; // empresa padrão para auth

// Cache de token em memória — válido por 50 min (Citel expira em ~60 min)
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// ──────────────────────────────────────────────
// AUTENTICAÇÃO
// ──────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (!BASE_URL || !CITEL_LOGIN || !CITEL_SENHA) return null;

  try {
    // Credenciais na URL — protocolo legado do Citel/Autcom
    const url = `${BASE_URL}/OperadorLogar/${encodeURIComponent(CITEL_LOGIN)}/${encodeURIComponent(CITEL_SENHA)}/${CITEL_EMPRESA_BASE}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) return null;

    const data = await res.json();
    // O Citel retorna o token no campo "token" ou "codigoSessao" dependendo da versão
    const token: string | null = data?.token ?? data?.codigoSessao ?? data?.sessao ?? null;

    if (token) {
      cachedToken = token;
      tokenExpiresAt = Date.now() + 50 * 60 * 1000; // 50 minutos
    }

    return token;
  } catch {
    return null;
  }
}

function authHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

// ──────────────────────────────────────────────
// CONSULTA DE ESTOQUE — produto único
// GET /produtoEstoqueCodigo/{codigoProduto}
// Retorna saldos para todas as empresas
// ──────────────────────────────────────────────

export async function fetchEstoqueCitel(
  codigoProduto: string
): Promise<CitelEstoqueProduto | null> {
  if (!BASE_URL) return null;

  const token = await getToken();

  try {
    const res = await fetch(
      `${BASE_URL}/produtoEstoqueCodigo/${encodeURIComponent(codigoProduto)}`,
      {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) return null;
    return res.json() as Promise<CitelEstoqueProduto>;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// CONSULTA DE ESTOQUE — múltiplos produtos/empresas (batch)
// GET /produtoEstoqueCodigo/{codigoProdutos}/{codigoEmpresas}
// codigoProdutos e codigoEmpresas são separados por vírgula
// ──────────────────────────────────────────────

export async function fetchEstoqueCitelBatch(
  codigosProdutos: string[],
  codigosEmpresas: string[]
): Promise<CitelEstoqueProduto[]> {
  if (!BASE_URL || codigosProdutos.length === 0) return [];

  const token = await getToken();

  try {
    const produtos = codigosProdutos.join(",");
    const empresas = codigosEmpresas.join(",");

    const res = await fetch(
      `${BASE_URL}/produtoEstoqueCodigo/${encodeURIComponent(produtos)}/${encodeURIComponent(empresas)}`,
      {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// HELPER — extrai saldo de uma empresa específica
// ──────────────────────────────────────────────

export function getSaldoForEmpresa(
  produto: CitelEstoqueProduto,
  codigoEmpresaCitel: string
): CitelEstoqueEmpresa | null {
  return (
    produto.saldoEmpresas?.find((e) => e.codigoEmpresa === codigoEmpresaCitel) ??
    null
  );
}

// ──────────────────────────────────────────────
// CONSULTA DIRETA — saldo disponível de um SKU em uma loja
// Retorna null se Citel indisponível (não bloqueia operação)
// ──────────────────────────────────────────────

export async function getSaldoDisponivel(
  codigoProduto: string,
  codigoEmpresaCitel: string
): Promise<{ saldoDisponivel: number; saldoFisico: number } | null> {
  const produto = await fetchEstoqueCitel(codigoProduto);
  if (!produto) return null;

  const saldo = getSaldoForEmpresa(produto, codigoEmpresaCitel);
  if (!saldo) return null;

  return {
    saldoDisponivel: saldo.saldoDisponivel,
    saldoFisico: saldo.saldoFisico,
  };
}

export function isCitelConfigured(): boolean {
  return Boolean(BASE_URL && CITEL_LOGIN && CITEL_SENHA);
}
