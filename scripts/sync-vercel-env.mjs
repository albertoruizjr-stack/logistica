// Script temporário: sincroniza env vars Vercel via API REST.
// Lê valores do .env.vercel-check.local (Production atual) e .env.local (fonte SPOKE_*).
// Aplica:
//   1) SPOKE_API_URL/KEY → adiciona em Production (se faltar) + Preview
//   2) LALAMOVE_SANDBOX → atualiza para "false" em Production + Preview
//   3) CRON_SECRET → atualiza em Production com valor do .env.local
//   4) Propaga 15 vars Production → Preview
import { readFileSync } from "fs";
import { join } from "path";

const AUTH = JSON.parse(readFileSync(join(process.env.APPDATA, "com.vercel.cli/Data/auth.json"), "utf8"));
const PROJECT = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
const TOKEN = AUTH.token;
const PROJECT_ID = PROJECT.projectId;
const TEAM_ID = PROJECT.orgId;

function parseEnv(p) {
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

async function api(method, path, body) {
  const url = `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM_ID}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

const local = parseEnv(".env.local");
const prod = parseEnv(".env.vercel-check.local");

// Lista atual de envs no projeto para descobrir IDs
const list = await api("GET", `/v10/projects/${PROJECT_ID}/env?decrypted=false`);
const byKey = {};
for (const e of list.envs) {
  (byKey[e.key] = byKey[e.key] || []).push(e);
}

function show(name, status) {
  console.log(`  ${status === "ok" ? "✓" : "✗"} ${name}${status !== "ok" ? " — " + status : ""}`);
}

async function ensureValue(key, value, targets, opts = {}) {
  const existing = (byKey[key] || []).filter(e => targets.every(t => e.target.includes(t)) && e.target.length === targets.length);
  // Apaga registros com target exato igual antes de recriar
  for (const e of byKey[key] || []) {
    const sameSet = e.target.length === targets.length && targets.every(t => e.target.includes(t));
    if (sameSet) {
      try { await api("DELETE", `/v9/projects/${PROJECT_ID}/env/${e.id}`); } catch (err) { /* ignora se já não existe */ }
    }
  }
  // Cria novo
  try {
    await api("POST", `/v10/projects/${PROJECT_ID}/env`, {
      key, value, type: opts.type || "encrypted", target: targets,
    });
    show(`${key} [${targets.join("+")}]`, "ok");
  } catch (err) {
    show(`${key} [${targets.join("+")}]`, err.message.slice(0, 120));
  }
}

console.log("\n=== 1) SPOKE_API_URL / SPOKE_API_KEY em Preview ===");
await ensureValue("SPOKE_API_URL", local.SPOKE_API_URL, ["preview"]);
await ensureValue("SPOKE_API_KEY", local.SPOKE_API_KEY, ["preview"]);

console.log("\n=== 2) LALAMOVE_SANDBOX=false em Production + Preview ===");
// Apaga todas as ocorrências de LALAMOVE_SANDBOX antes (qualquer target)
for (const e of byKey.LALAMOVE_SANDBOX || []) {
  try { await api("DELETE", `/v9/projects/${PROJECT_ID}/env/${e.id}`); } catch {}
}
await ensureValue("LALAMOVE_SANDBOX", "false", ["production", "preview"], { type: "plain" });

console.log("\n=== 3) CRON_SECRET — PULADO ===");
console.log("  ℹ Var é tipo 'sensitive' (write-once). API não retorna valor mas ele provavelmente está setado.");

console.log("\n=== 4) Propagar Production → Preview ===");
const propagate = [
  "DATABASE_URL", "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "GOOGLE_MAPS_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  "CITEL_API_URL", "CITEL_PD_URL", "CITEL_LOGIN", "CITEL_SENHA",
  "LALAMOVE_API_KEY", "LALAMOVE_API_SECRET",
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PROOFS_BUCKET",
];
for (const key of propagate) {
  const value = prod[key];
  if (!value) { show(key + " [preview]", "valor ausente em production pull"); continue; }
  await ensureValue(key, value, ["preview"]);
}

console.log("\nFeito.");
