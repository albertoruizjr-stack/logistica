// Adiciona STORE_LEADER em todos os checks ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR"]
import fs from "node:fs/promises";
import path from "node:path";

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = await walk(path.resolve("."));
let count = 0;
for (const f of files) {
  let src = await fs.readFile(f, "utf8");
  const orig = src;
  // Caso 1: array literal completo dos 4 roles → adiciona STORE_LEADER
  src = src.replace(
    /\["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR"\]/g,
    '["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"]',
  );
  // Caso 2: array com SELLER no fim
  src = src.replace(
    /\["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "SELLER"\]/g,
    '["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER", "SELLER"]',
  );
  // Caso 3: array com SELLER + DRIVER (sidebar)
  src = src.replace(
    /\["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "SELLER", "DRIVER"\]/g,
    '["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER", "SELLER", "DRIVER"]',
  );
  if (src !== orig) {
    await fs.writeFile(f, src, "utf8");
    console.log("  ✓ " + path.relative(".", f));
    count++;
  }
}
console.log(`\n${count} arquivos atualizados.`);
