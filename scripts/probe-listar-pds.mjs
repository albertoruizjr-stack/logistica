// Sonda: testa se a Citel tem algum endpoint pra listar PDs por cliente
// ou por loja. Objetivo: descobrir se dá pra fazer auto-busca em massa.
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
const CNPJ_ATUAL = "42194537000180";
const PD_URL_PORT  = 25049;
const STK_URL_PORT = 25046;

function basic() { return "Basic " + Buffer.from(`${LOGIN}:${SENHA}`).toString("base64"); }

function get(port, p) {
  return new Promise(res => {
    const req = http.get({ hostname: "159.112.189.1", port, path: p, headers: { Authorization: basic() }, timeout: 5000 }, r => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => res({ status: r.statusCode, body: d.slice(0, 250) }));
    });
    req.on("error", e => res({ status: 0, body: "ERR " + e.message }));
    req.on("timeout", () => { req.destroy(); res({ status: 0, body: "TIMEOUT" }); });
  });
}

const probes = [
  // tentativas com loja 067
  { port: PD_URL_PORT,  path: `/pedidovenda/067` },
  { port: PD_URL_PORT,  path: `/pedidovenda` },
  { port: PD_URL_PORT,  path: `/consultapedidovenda/067` },
  { port: PD_URL_PORT,  path: `/consultapedidovenda` },
  { port: PD_URL_PORT,  path: `/pedidos/067` },
  { port: PD_URL_PORT,  path: `/pedidos` },
  { port: PD_URL_PORT,  path: `/listapedidos/067` },
  { port: PD_URL_PORT,  path: `/pedidosabertos/067` },
  { port: PD_URL_PORT,  path: `/pedidosabertos` },
  { port: PD_URL_PORT,  path: `/cliente/${CNPJ_ATUAL}/pedidos` },
  { port: PD_URL_PORT,  path: `/pedidos/cliente/${CNPJ_ATUAL}` },
  { port: PD_URL_PORT,  path: `/pedidovenda/cliente/${CNPJ_ATUAL}` },
  // Por filtros via query
  { port: PD_URL_PORT,  path: `/pedidovenda?cliente=${CNPJ_ATUAL}` },
  { port: PD_URL_PORT,  path: `/consultapedidovenda?cliente=${CNPJ_ATUAL}&loja=067` },
  // mesma coisa na porta 25046
  { port: STK_URL_PORT, path: `/pedidovenda/067` },
  { port: STK_URL_PORT, path: `/pedidos/067` },
];

for (const t of probes) {
  const r = await get(t.port, t.path);
  const mark = r.status === 200 ? "✅" : r.status === 404 ? "  " : "❓";
  console.log(`${mark} HTTP ${String(r.status).padStart(3)} :${t.port}${t.path}`);
  if (r.status === 200 || r.status === 401 || (r.status > 0 && r.status !== 404)) {
    console.log(`         body: ${r.body}`);
  }
}
