// Diagnóstico: simula fetchConsultaPedidoRaw com loop de candidates (sem importar .ts)
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const PD_URL = process.env.CITEL_PD_URL!;
const basic = Buffer.from(process.env.CITEL_LOGIN + ":" + process.env.CITEL_SENHA).toString("base64");

// Reproduz normalizeCitelDocumentNumber: padding com 12 dígitos
function candidates(orderNumber: string): string[] {
  const clean = orderNumber.replace(/\D/g, "");
  const result = new Set<string>([clean]);
  if (clean.length < 12) result.add(clean.padStart(12, "0"));
  return Array.from(result);
}

(async () => {
  for (const num of candidates("3418")) {
    const url = `${PD_URL}/consultapedidovenda/${encodeURIComponent(num)}/PD/191`;
    const r = await fetch(url, { headers: { Authorization: "Basic " + basic, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    const json: any = await r.json();
    const found = !!json?.pedido;
    const cancelReal = json?.cancelado && json?.dadosCancelamento;
    console.log(`candidate=${num.padEnd(15)} http=${r.status} pedido=${found ? "SIM" : "null"} cancelReal=${cancelReal ? "SIM" : "não"}`);
    if (found) {
      const p = json.pedido;
      console.log(`  ✅ ENCONTROU — cliente=${p.cliente?.nome ?? "?"} valor=${p.valorContabil ?? "?"} status=${p.statusPedido ?? "?"} entregaPeloCD=${p.entregaPeloCD} codigoEmpresaCD=${p.codigoEmpresaCD ?? "?"}`);
      console.log(`  itens=${(p.itens || []).length}`);
      break;
    }
  }
})();
