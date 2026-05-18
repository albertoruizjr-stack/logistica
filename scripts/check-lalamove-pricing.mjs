// Puxa o catálogo de serviços disponíveis para São Paulo com descrições e dimensões.
// Sem alterar nada no projeto — só investigação.

import { readFileSync } from "fs";
import crypto from "crypto";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const API_KEY    = process.env.LALAMOVE_API_KEY;
const API_SECRET = process.env.LALAMOVE_API_SECRET;
const MARKET     = process.env.LALAMOVE_MARKET ?? "BR";
const BASE_URL   = "https://rest.lalamove.com";

function buildHeaders(method, path, body) {
  const ts = Date.now().toString();
  const raw = `${ts}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  const sig = crypto.createHmac("sha256", API_SECRET).update(raw).digest("hex");
  return {
    "Content-Type": "application/json",
    Authorization:  `hmac ${API_KEY}:${ts}:${sig}`,
    Market:         MARKET,
    "Request-ID":   crypto.randomUUID(),
  };
}

// 1) Lista de cidades + serviços
const res = await fetch(`${BASE_URL}/v3/cities`, { headers: buildHeaders("GET", "/v3/cities", "") });
const { data } = await res.json();

const sp = data.find((c) => c.locode?.includes("SAO") || c.name?.includes("Paulo"));
if (!sp) {
  console.log("Cidades disponíveis:", data.map((c) => `${c.locode} (${c.name})`).join(", "));
  process.exit(0);
}

console.log(`\n══ Serviços disponíveis em ${sp.name} (${sp.locode}) ══\n`);
for (const svc of sp.services) {
  console.log(`▸ ${svc.key}`);
  console.log(`  ${svc.description ?? "(sem descrição)"}`);
  if (svc.dimensions) {
    const { length, width, height } = svc.dimensions;
    console.log(`  Dimensões: ${length?.value}×${width?.value}×${height?.value} ${length?.unit}`);
  }
  if (svc.load) {
    console.log(`  Carga máx: ${svc.load.value} ${svc.load.unit}`);
  }
  console.log("");
}

// 2) Testa cotação real com LALAPRO em SP pra ver o preço
console.log("\n══ Cotação LALAPRO — Morumbi → Vila Andrade (~3.7 km) ══");
const origin = { lat: "-23.6219", lng: "-46.7064" };
const dest   = { lat: "-23.6010", lng: "-46.7110" };
const qBody = JSON.stringify({
  data: {
    language: "pt_BR",
    serviceType: "LALAPRO",
    specialRequests: [],
    stops: [
      { coordinates: origin, address: "Av. Giovanni Gronchi, 5930 - Morumbi" },
      { coordinates: dest,   address: "Vila Andrade, São Paulo" },
    ],
    item: { quantity: "1", weight: "LESS_THAN_3_KG", categories: ["OFFICE_SUPPLY"], handlingInstructions: [] },
  },
});
const qRes = await fetch(`${BASE_URL}/v3/quotations`, {
  method: "POST",
  headers: buildHeaders("POST", "/v3/quotations", qBody),
  body: qBody,
});
const qJson = await qRes.json();
if (qJson.data?.priceBreakdown) {
  console.log(`  Total: R$ ${qJson.data.priceBreakdown.total}`);
  console.log(`  Base:  R$ ${qJson.data.priceBreakdown.base}`);
  console.log(`  Antes otimização: R$ ${qJson.data.priceBreakdown.totalBeforeOptimization}`);
  console.log(`  quotationId: ${qJson.data.quotationId}`);
} else {
  console.log("  Erro:", JSON.stringify(qJson).slice(0, 300));
}
