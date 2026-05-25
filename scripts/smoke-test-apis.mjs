// Smoke test das integrações externas — usa as chaves do .env.local.
// Roda direto via node (não precisa do Next.js de pé).
// Cada teste reporta: ✅ conectado / ⚠ atingiu mas falhou semanticamente / ❌ erro de rede ou auth.
import { readFileSync } from "fs";
import crypto from "crypto";

// ── Carrega .env.local manualmente ───────────────────────────────
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const results = [];
function log(name, status, detail) {
  const icon = status === "ok" ? "✅" : status === "warn" ? "⚠" : "❌";
  console.log(`${icon} ${name.padEnd(28)} ${detail}`);
  results.push({ name, status, detail });
}

// ── 1) GOOGLE GEOCODING ────────────────────────────────────────────
async function testGoogleGeocoding() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return log("Google Geocoding", "fail", "GOOGLE_MAPS_API_KEY ausente");
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent("Avenida Paulista, 1000, São Paulo")}&key=${key}&language=pt-BR`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.status === "OK" && j.results?.[0]) {
      const loc = j.results[0].geometry.location;
      log("Google Geocoding", "ok", `${j.results[0].formatted_address} → ${loc.lat},${loc.lng}`);
    } else {
      log("Google Geocoding", "warn", `status=${j.status} error=${j.error_message ?? "—"}`);
    }
  } catch (e) {
    log("Google Geocoding", "fail", e.message);
  }
}

// ── 2) GOOGLE ROUTES (Compute Routes) ──────────────────────────────
async function testGoogleRoutes() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return log("Google Routes", "fail", "GOOGLE_MAPS_API_KEY ausente");
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin:      { location: { latLng: { latitude: -23.561, longitude: -46.656 } } }, // Paulista
        destination: { location: { latLng: { latitude: -23.534, longitude: -46.624 } } }, // Centro SP
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (r.ok && j.routes?.[0]) {
      const km = (j.routes[0].distanceMeters / 1000).toFixed(2);
      log("Google Routes", "ok", `${km} km Paulista→Centro`);
    } else {
      log("Google Routes", "warn", `http=${r.status} ${JSON.stringify(j).slice(0, 120)}`);
    }
  } catch (e) {
    log("Google Routes", "fail", e.message);
  }
}

// ── 3) CITEL — produtoEstoqueCodigo ────────────────────────────────
async function testCitelEstoque() {
  const url = process.env.CITEL_API_URL;
  const login = process.env.CITEL_LOGIN;
  const senha = process.env.CITEL_SENHA;
  if (!url || !login || !senha) return log("Citel Estoque", "fail", "vars ausentes");
  try {
    const basic = Buffer.from(`${login}:${senha}`).toString("base64");
    const r = await fetch(`${url}/produtoEstoqueCodigo/1`, {
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    if (r.ok) {
      log("Citel Estoque", "ok", `HTTP 200 — body ${text.length} bytes`);
    } else if (r.status === 401 || r.status === 403) {
      log("Citel Estoque", "fail", `auth recusada (HTTP ${r.status})`);
    } else {
      // 404, 500 etc. — conectou e auth passou, só não tem o SKU "1"
      log("Citel Estoque", "warn", `HTTP ${r.status} (provavelmente SKU 1 inexistente — conectou e autenticou)`);
    }
  } catch (e) {
    log("Citel Estoque", "fail", e.message);
  }
}

// ── 4) CITEL PD — consulta de pedido ──────────────────────────────
async function testCitelPD() {
  const url = process.env.CITEL_PD_URL;
  const login = process.env.CITEL_LOGIN;
  const senha = process.env.CITEL_SENHA;
  if (!url || !login || !senha) return log("Citel PD", "fail", "vars ausentes");
  try {
    const basic = Buffer.from(`${login}:${senha}`).toString("base64");
    const r = await fetch(`${url}/consultapedidovenda/1/PD/1`, {
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    if (r.ok) {
      log("Citel PD", "ok", `HTTP 200 — body ${text.length} bytes`);
    } else if (r.status === 401 || r.status === 403) {
      log("Citel PD", "fail", `auth recusada (HTTP ${r.status})`);
    } else {
      log("Citel PD", "warn", `HTTP ${r.status} (provavelmente pedido 1 inexistente — conectou e autenticou)`);
    }
  } catch (e) {
    log("Citel PD", "fail", e.message);
  }
}

// ── 5) LALAMOVE — cotação ──────────────────────────────────────────
async function testLalamove() {
  const key = process.env.LALAMOVE_API_KEY;
  const secret = process.env.LALAMOVE_API_SECRET;
  const market = process.env.LALAMOVE_MARKET || "BR";
  const sandbox = process.env.LALAMOVE_SANDBOX === "true";
  if (!key || !secret) return log("Lalamove", "fail", "API_KEY/SECRET ausentes");
  const base = sandbox ? "https://rest.sandbox.lalamove.com" : "https://rest.lalamove.com";
  try {
    const path = "/v3/quotations";
    const body = JSON.stringify({
      data: {
        serviceType: "LALAPRO",
        language: "pt_BR",
        stops: [
          { coordinates: { lat: "-23.561", lng: "-46.656" }, address: "Avenida Paulista, 1000, SP" },
          { coordinates: { lat: "-23.534", lng: "-46.624" }, address: "Praça da Sé, SP" },
        ],
      },
    });
    const ts = Date.now().toString();
    const raw = `${ts}\r\nPOST\r\n${path}\r\n\r\n${body}`;
    const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Formato OFICIAL Lalamove v3: hmac <KEY>:<TS>:<SIGN> (separador ":").
        // O formato antigo `hmac id="x", ts="y", sign="z"` é rejeitado pelo gateway (502).
        Authorization: `hmac ${key}:${ts}:${sig}`,
        Market: market,
        "Request-ID": crypto.randomUUID(),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.data?.priceBreakdown) {
      log("Lalamove", "ok", `${sandbox ? "sandbox" : "PROD"} — R$ ${j.data.priceBreakdown.total} ${market}`);
    } else if (r.status === 401 || r.status === 403) {
      log("Lalamove", "fail", `auth recusada (HTTP ${r.status}): ${JSON.stringify(j).slice(0, 100)}`);
    } else {
      log("Lalamove", "warn", `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 120)}`);
    }
  } catch (e) {
    log("Lalamove", "fail", e.message);
  }
}

// ── 6) SPOKE (Circuit) — lista drivers ─────────────────────────────
async function testSpoke() {
  const url = process.env.SPOKE_API_URL;
  const apiKey = process.env.SPOKE_API_KEY;
  if (!url || !apiKey) return log("Spoke (Circuit)", "fail", "URL/KEY ausentes");
  try {
    const auth = Buffer.from(`${apiKey}:`).toString("base64");
    const r = await fetch(`${url}/drivers`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const count = j.drivers?.length ?? 0;
      log("Spoke (Circuit)", "ok", `${count} motoristas no plano da conta`);
    } else if (r.status === 401 || r.status === 403) {
      log("Spoke (Circuit)", "fail", `auth recusada (HTTP ${r.status})`);
    } else {
      log("Spoke (Circuit)", "warn", `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 120)}`);
    }
  } catch (e) {
    log("Spoke (Circuit)", "fail", e.message);
  }
}

// ── 7) SUPABASE STORAGE — list bucket ──────────────────────────────
async function testStorage() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_PROOFS_BUCKET || "delivery-proofs";
  if (!url || !key) return log("Supabase Storage", "fail", "URL/SERVICE_ROLE ausentes");
  try {
    // Lista objetos do bucket (max 1) — testa auth e existência do bucket
    const r = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: "", limit: 1, offset: 0 }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      log("Supabase Storage", "ok", `bucket "${bucket}" acessível — ${Array.isArray(j) ? j.length : 0} objetos`);
    } else if (r.status === 401 || r.status === 403) {
      log("Supabase Storage", "fail", `auth recusada (HTTP ${r.status})`);
    } else if (r.status === 404 || (j.error && /not.found/i.test(j.error))) {
      log("Supabase Storage", "warn", `bucket "${bucket}" não existe (criar pelo painel)`);
    } else {
      log("Supabase Storage", "warn", `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 120)}`);
    }
  } catch (e) {
    log("Supabase Storage", "fail", e.message);
  }
}

// ── EXEC ───────────────────────────────────────────────────────────
console.log("\n🧪 Smoke test das integrações externas\n");
await Promise.all([
  testGoogleGeocoding(),
  testGoogleRoutes(),
  testCitelEstoque(),
  testCitelPD(),
  testLalamove(),
  testSpoke(),
  testStorage(),
]);

const ok = results.filter(r => r.status === "ok").length;
const warn = results.filter(r => r.status === "warn").length;
const fail = results.filter(r => r.status === "fail").length;
console.log(`\nResumo: ${ok} ok / ${warn} warn / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
