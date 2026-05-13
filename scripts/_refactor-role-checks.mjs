// One-shot: substitui ["ADMIN", "OPERATOR"] por ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR"]
// nos arquivos de código (rotas, components). Idempotente — não dobra se já tiver os novos roles.
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(".");
const TARGETS = [
  "app/api/workqueue/route.ts",
  "app/(app)/despacho/page.tsx",
  "app/(app)/rastreamento/page.tsx",
  "app/(app)/transferencias/[id]/page.tsx",
  "app/(app)/transferencias/page.tsx",
  "app/(app)/operacao/page.tsx",
  "app/(app)/admin/maps-usage/page.tsx",
  "app/api/transferencias/[id]/route.ts",
  "app/(app)/cotacoes/page.tsx",
  "app/(app)/operacao/mapa/page.tsx",
  "app/(app)/torre/page.tsx",
  "app/(app)/operacao/analytics/page.tsx",
  "app/(app)/torre/ruptura/page.tsx",
  "app/api/geocode/route.ts",
  "app/api/torre/abc/route.ts",
  "app/api/despacho/[id]/lalamove/route.ts",
  "app/api/despacho/route.ts",
  "app/api/frete/cotacoes/route.ts",
  "app/api/erp/watcher/route.ts",
  "app/api/solicitacoes/route.ts",
  "app/api/solicitacoes/[id]/nf-review/route.ts",
  "app/api/map-view/route.ts",
  "components/header.tsx",
  "components/sidebar.tsx",
  "app/api/operacao/analytics/route.ts",
  "app/api/operacao/queue/route.ts",
  "app/api/operacao/claim/route.ts",
  "app/api/analytics/eta-modal/route.ts",
  "app/api/operacao/action/route.ts",
];

// Substituições. Ordem importa: padrões mais específicos primeiro.
const SUBS = [
  // already-migrated: skip
  { from: /\["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR"\]/g, to: '["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR"]' },
  // padrão mais comum
  { from: /\["ADMIN", "OPERATOR"\]/g, to: '["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR"]' },
  // pattern com "SELLER" no meio
  { from: /\["ADMIN", "OPERATOR", "SELLER"\]/g, to: '["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "SELLER"]' },
  { from: /\["ADMIN", "OPERATOR", "SELLER", "DRIVER"\]/g, to: '["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "SELLER", "DRIVER"]' },
  // === or || single-check
  { from: /session\.role === "ADMIN" \|\| session\.role === "OPERATOR"/g,
    to:   'session.role === "ADMIN" || session.role === "OPERATOR" || session.role === "STOCK_OPERATOR" || session.role === "LOGISTICS_OPERATOR"' },
  { from: /role === "ADMIN" \|\| role === "OPERATOR"/g,
    to:   'role === "ADMIN" || role === "OPERATOR" || role === "STOCK_OPERATOR" || role === "LOGISTICS_OPERATOR"' },
];

let totalChanged = 0;
for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  try {
    let src = await fs.readFile(file, "utf8");
    const orig = src;
    // Aplica todas as substituições — a primeira é "no-op idempotente" pra detectar já migrado
    for (const { from, to } of SUBS) src = src.replace(from, to);
    if (src !== orig) {
      await fs.writeFile(file, src, "utf8");
      console.log(`  ✓ ${rel}`);
      totalChanged++;
    } else {
      console.log(`  - ${rel} (sem mudança)`);
    }
  } catch (e) {
    console.warn(`  ! ${rel}: ${e.message}`);
  }
}
console.log(`\n${totalChanged} arquivo(s) atualizados.`);
