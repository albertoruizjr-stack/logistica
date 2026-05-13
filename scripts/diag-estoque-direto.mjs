// Testa consulta de estoque direto na Citel pra confirmar o codigoEmpresaCitel.
// Uso: node scripts/diag-estoque-direto.mjs <sku> <empresaCitel>
// Ex:  node scripts/diag-estoque-direto.mjs 5884 173

import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const API_URL = process.env.CITEL_API_URL ?? "http://159.112.189.1:25046";
const LOGIN   = process.env.CITEL_LOGIN;
const SENHA   = process.env.CITEL_SENHA;

const [, , sku, empresa] = process.argv;
if (!sku || !empresa) { console.log("Uso: node scripts/diag-estoque-direto.mjs <sku> <empresaCitel>"); process.exit(1); }

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers, timeout: 10000 }, r => {
      let data = "";
      r.on("data", c => data += c);
      r.on("end", () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: r.statusCode, body: data }); }
      });
    }).on("error", reject).on("timeout", () => reject(new Error("timeout")));
  });
}

// 1. Auth
console.log(`\n=== AUTH ===`);
const authRes = await get(`${API_URL}/OperadorLogar/${encodeURIComponent(LOGIN)}/${encodeURIComponent(SENHA)}/1`);
console.log(`HTTP ${authRes.status}`);
console.log(`fields: ${Object.keys(authRes.body ?? {}).join(", ")}`);
console.log(`body sample:`, JSON.stringify(authRes.body).slice(0, 250));
const token = authRes.body?.token ?? authRes.body?.codigoSessao ?? authRes.body?.sessao;
if (!token) { console.error("\n❌ sem token. Saindo."); process.exit(1); }
console.log(`token=${token.slice(0, 24)}...`);

// 2. Estoque com Authorization
console.log(`\n=== ESTOQUE sku=${sku} empresa=${empresa} ===`);
const r = await get(`${API_URL}/produtoEstoqueCodigo/${encodeURIComponent(sku)}/${encodeURIComponent(empresa)}`, {
  Authorization: `Bearer ${token}`, Accept: "application/json",
});
console.log(`HTTP ${r.status}`);
console.log(typeof r.body === "string" ? r.body.slice(0, 500) : JSON.stringify(r.body, null, 2).slice(0, 1500));

// 3. Sem empresa (todas as filiais)
console.log(`\n=== ESTOQUE sku=${sku} (sem filtro de empresa) ===`);
const r2 = await get(`${API_URL}/produtoEstoqueCodigo/${encodeURIComponent(sku)}`, {
  Authorization: `Bearer ${token}`, Accept: "application/json",
});
console.log(`HTTP ${r2.status}`);
if (r2.status === 200) {
  const arr = Array.isArray(r2.body) ? r2.body : [r2.body];
  for (const p of arr) {
    console.log(`produto ${p.codigoProduto ?? sku}:`);
    const saldos = p.saldoEmpresas ?? [];
    for (const s of saldos) {
      console.log(`  empresa=${s.codigoEmpresa} · fisico=${s.saldoFisico} · disponivel=${s.saldoDisponivel}`);
    }
  }
} else {
  console.log(typeof r2.body === "string" ? r2.body.slice(0, 500) : JSON.stringify(r2.body).slice(0, 500));
}
