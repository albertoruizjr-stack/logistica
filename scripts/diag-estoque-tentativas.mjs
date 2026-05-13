// Testa várias estratégias de autenticação para consultar estoque do SKU 10723 na empresa 173.
// Objetivo: descobrir qual endpoint/auth funciona.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const LOGIN = process.env.CITEL_LOGIN;
const SENHA = process.env.CITEL_SENHA;
const SKU = "10723";
const EMPRESA = "173";

function basic() { return "Basic " + Buffer.from(`${LOGIN}:${SENHA}`).toString("base64"); }

function get(host, port, p, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: host, port, path: p, headers, timeout: 8000 }, r => {
      let data = "";
      r.on("data", c => data += c);
      r.on("end", () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: r.statusCode, body: data.slice(0, 200) }); }
      });
    });
    req.on("error", e => resolve({ status: 0, body: `ERR: ${e.message}` }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "TIMEOUT" }); });
  });
}

const tests = [
  // Porta 25049 (a que funciona pra pedido) com Basic Auth
  { label: "25049 · Basic Auth · /produtoEstoqueCodigo/{sku}/{empresa}",
    host: "159.112.189.1", port: 25049, path: `/produtoEstoqueCodigo/${SKU}/${EMPRESA}`, headers: { Authorization: basic() } },
  { label: "25049 · Basic Auth · /produtoEstoqueCodigo/{sku}",
    host: "159.112.189.1", port: 25049, path: `/produtoEstoqueCodigo/${SKU}`, headers: { Authorization: basic() } },
  { label: "25049 · Basic Auth · /produto/{sku}",
    host: "159.112.189.1", port: 25049, path: `/produto/${SKU}`, headers: { Authorization: basic() } },
  // Porta 25046 (a que está no env) com Basic
  { label: "25046 · Basic Auth · /produtoEstoqueCodigo/{sku}/{empresa}",
    host: "159.112.189.1", port: 25046, path: `/produtoEstoqueCodigo/${SKU}/${EMPRESA}`, headers: { Authorization: basic() } },
  { label: "25046 · Sem auth · /produtoEstoqueCodigo",
    host: "159.112.189.1", port: 25046, path: `/produtoEstoqueCodigo/${SKU}/${EMPRESA}` },
  // OperadorLogar com empresas diferentes
  { label: "25046 · /OperadorLogar/TESTE/123/1",
    host: "159.112.189.1", port: 25046, path: `/OperadorLogar/${LOGIN}/${SENHA}/1` },
  { label: "25046 · /OperadorLogar/TESTE/123/067",
    host: "159.112.189.1", port: 25046, path: `/OperadorLogar/${LOGIN}/${SENHA}/067` },
  { label: "25046 · /OperadorLogar/TESTE/123/173",
    host: "159.112.189.1", port: 25046, path: `/OperadorLogar/${LOGIN}/${SENHA}/173` },
];

for (const t of tests) {
  const r = await get(t.host, t.port, t.path, t.headers ?? {});
  const preview = typeof r.body === "string" ? r.body.slice(0, 80) : JSON.stringify(r.body).slice(0, 80);
  console.log(`HTTP ${String(r.status).padEnd(3)} · ${t.label}`);
  if (r.status === 200 || (r.status > 0 && r.status < 400)) console.log(`           body: ${preview}`);
  else if (r.status !== 401 && r.status !== 0) console.log(`           body: ${preview}`);
}
