// Lista todos os PDs da Atual Tintas (CNPJ 42194537000180) dos últimos 7 dias.
// Mostra número, loja, data, cliente, e itens.

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
const CNPJ = "42194537000180";

function basic() { return "Basic " + Buffer.from(`${LOGIN}:${SENHA}`).toString("base64"); }

function get(path) {
  return new Promise(res => {
    const req = http.get({ hostname: "159.112.189.1", port: 25049, path, headers: { Authorization: basic() }, timeout: 20000 }, r => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => res({ status: r.statusCode, body: d }));
    });
    req.on("error", e => res({ status: 0, body: "ERR " + e.message }));
    req.on("timeout", () => { req.destroy(); res({ status: 0, body: "TIMEOUT" }); });
  });
}

// últimos 7 dias
const d = new Date();
d.setDate(d.getDate() - 7);
d.setHours(0,0,0,0);
const pad = n => String(n).padStart(2,'0');
const dataHora = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T00:00:00`;

console.log(`\nBuscando PDs desde ${dataHora}\n`);

let page = 0;
let totalAtual = [];

while (true) {
  const r = await get(`/consultapedidovenda?data-hora=${encodeURIComponent(dataHora)}&page=${page}&size=500`);
  if (r.status !== 200) {
    console.log(`Erro na página ${page}: HTTP ${r.status}`);
    break;
  }
  const json = JSON.parse(r.body);
  const items = json.content ?? [];
  if (items.length === 0) break;

  const atual = items.filter(i => i.cliente?.numeroDocumento === CNPJ);
  totalAtual.push(...atual);

  console.log(`Página ${page}: ${items.length} pedidos · ${atual.length} da Atual Tintas`);

  if (json.last) break;
  page++;
  if (page > 20) break; // safety
}

console.log(`\n=== ${totalAtual.length} PDs da Atual Tintas nos últimos 7 dias ===\n`);
for (const p of totalAtual) {
  const numero = p.numeroDocumento.replace(/^0+/, "");
  console.log(`PD ${numero.padStart(8)} | Loja ${p.codigoEmpresa} | ${p.especieDocumento} | ${p.dataEntrada} | ${p.itens?.length ?? 0} itens | cancelado=${p.cancelado} faturado=${p.jaFaturado}`);
  for (const it of (p.itens ?? [])) {
    console.log(`     · ${it.codigoProduto?.padEnd(8)} · qtd=${it.quantidade} ${it.unidadeProduto} · ${(it.descricaoProduto ?? '').slice(0,50)}`);
  }
}
