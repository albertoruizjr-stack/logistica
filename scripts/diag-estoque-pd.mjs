// Diagnóstico end-to-end: PD → itens → estoque
// Uso: node scripts/diag-estoque-pd.mjs <numeroPD> <codigoLoja>
// Ex:  node scripts/diag-estoque-pd.mjs 5884 173

import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const PD_URL  = process.env.CITEL_PD_URL  ?? "http://159.112.189.1:25049";
const API_URL = process.env.CITEL_API_URL ?? "http://159.112.189.1:25046";
const LOGIN   = process.env.CITEL_LOGIN;
const SENHA   = process.env.CITEL_SENHA;

const [, , numero, lojaCode] = process.argv;
if (!numero || !lojaCode) {
  console.log("Uso: node scripts/diag-estoque-pd.mjs <numeroPD> <codigoLoja>");
  process.exit(1);
}

function basicAuth() {
  return "Basic " + Buffer.from(`${LOGIN}:${SENHA}`).toString("base64");
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.get({
      hostname: u.hostname, port: u.port, path: u.pathname,
      headers, timeout: 15000,
    }, r => {
      let data = "";
      r.on("data", c => data += c);
      r.on("end", () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: r.statusCode, body: data }); }
      });
    }).on("error", reject).on("timeout", () => reject(new Error("timeout")));
  });
}

// ─── 1. Loja: tenta achar codigoEmpresaCitel no Supabase ──────────────────
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const loja = await prisma.store.findFirst({
  where: { code: lojaCode },
  select: { code: true, name: true, codigoEmpresaCitel: true },
});
await prisma.$disconnect();

if (!loja) { console.error(`Loja ${lojaCode} não cadastrada no Supabase`); process.exit(1); }
console.log(`\n=== LOJA ===`);
console.log(`code=${loja.code} · name=${loja.name} · codigoEmpresaCitel=${loja.codigoEmpresaCitel ?? "❌ NÃO CADASTRADO"}\n`);

if (!loja.codigoEmpresaCitel) {
  console.error("❌ Loja sem codigoEmpresaCitel — consulta de estoque sempre vai falhar.");
  process.exit(1);
}

// ─── 2. Pedido (porta 25049, Basic Auth) ──────────────────────────────────
const numPad = String(numero).padStart(12, "0");
console.log(`=== PEDIDO ${numPad} ===`);
const pedRes = await get(`${PD_URL}/consultapedidovenda/${numPad}/PD/${lojaCode}`, { Authorization: basicAuth() });
console.log(`HTTP ${pedRes.status}`);
if (pedRes.status !== 200 || !pedRes.body?.pedido) {
  console.error("Pedido não encontrado ou inválido");
  process.exit(1);
}
const itens = pedRes.body.pedido.itens ?? [];
console.log(`${itens.length} itens:\n`);
for (const item of itens) {
  console.log(`  - ${item.codigoProduto} · qtd=${item.quantidade} ${item.unidadeProduto} · peso=${item.pesoBruto}kg · ${item.descricaoProduto.slice(0, 50)}`);
}

// ─── 3. Auth para porta 25046 (token via OperadorLogar) ───────────────────
console.log(`\n=== AUTH PORTA 25046 ===`);
const authUrl = `${API_URL}/OperadorLogar/${encodeURIComponent(LOGIN)}/${encodeURIComponent(SENHA)}/1`;
console.log(`GET ${authUrl.replace(SENHA, "****")}`);
const authRes = await get(authUrl);
console.log(`HTTP ${authRes.status}`);
if (authRes.status !== 200) {
  console.error("Falha no login da porta 25046 — body:", JSON.stringify(authRes.body).slice(0, 200));
  process.exit(1);
}
const token = authRes.body?.token ?? authRes.body?.codigoSessao ?? authRes.body?.sessao;
console.log(`token=${token ? token.slice(0, 24) + "..." : "❌ NÃO RETORNOU TOKEN"} (campos: ${Object.keys(authRes.body).join(", ")})`);

if (!token) {
  console.error("❌ Login bem-sucedido mas sem token — verifique o nome do campo na resposta:");
  console.error(JSON.stringify(authRes.body, null, 2));
  process.exit(1);
}

// ─── 4. Estoque de cada produto ───────────────────────────────────────────
console.log(`\n=== ESTOQUE NA EMPRESA ${loja.codigoEmpresaCitel} ===`);
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
for (const item of itens) {
  const sku = item.codigoProduto;
  const url = `${API_URL}/produtoEstoqueCodigo/${encodeURIComponent(sku)}/${encodeURIComponent(loja.codigoEmpresaCitel)}`;
  console.log(`\n  produto ${sku} → GET ${url}`);
  try {
    const r = await get(url, headers);
    console.log(`  HTTP ${r.status}`);
    if (r.status !== 200) {
      console.log(`  body: ${typeof r.body === "string" ? r.body.slice(0, 200) : JSON.stringify(r.body).slice(0, 200)}`);
      continue;
    }
    const arr = Array.isArray(r.body) ? r.body : [r.body];
    for (const p of arr) {
      const saldos = p.saldoEmpresas ?? [];
      console.log(`  ${saldos.length} saldo(s) retornado(s):`);
      for (const s of saldos) {
        console.log(`    empresa=${s.codigoEmpresa} · fisico=${s.saldoFisico} · disponivel=${s.saldoDisponivel} · reservado=${s.saldoReservadoPedido}`);
      }
    }
  } catch (e) {
    console.log(`  ❌ erro: ${e.message}`);
  }
}

// ─── 5. Detalhe do produto ────────────────────────────────────────────────
console.log(`\n=== DETALHE DE CADA PRODUTO ===`);
for (const item of itens) {
  const sku = item.codigoProduto;
  const url = `${API_URL}/produto/${encodeURIComponent(sku)}`;
  try {
    const r = await get(url, headers);
    if (r.status !== 200) { console.log(`  ${sku} → HTTP ${r.status}`); continue; }
    const det = r.body;
    console.log(`  ${sku} → peso=${det.pesoBruto}kg unidade=${det.unidade} descr="${(det.descricao ?? "").slice(0, 40)}"`);
  } catch (e) {
    console.log(`  ${sku} → erro: ${e.message}`);
  }
}
