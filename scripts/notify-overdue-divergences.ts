// scripts/notify-overdue-divergences.ts
//
// Alerta divergências com prazo vencido (deadline < agora, status PENDING_RESOLUTION).
// NÃO altera estoque nem resolve divergências automaticamente.
//
// Uso: npm run cron:divergencias
// Configurar no servidor como cron diário (ex: 08:00 todos os dias).
// Exit code 1 quando há pendências — pode ser capturado por alertas de infra.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();

  const overdue = await prisma.transferDivergence.findMany({
    where: {
      status: "PENDING_RESOLUTION",
      deadline: { lt: now },
    },
    include: {
      transfer:        { select: { id: true } },
      responsibleStore: { select: { code: true, name: true } },
      transferItem:    { select: { productCode: true, productName: true } },
    },
    orderBy: { deadline: "asc" },
  });

  if (overdue.length === 0) {
    console.log(`[${now.toISOString()}] Nenhuma divergência vencida. Tudo em dia.`);
    return;
  }

  console.warn(`[${now.toISOString()}] ALERTA: ${overdue.length} divergência(s) com prazo vencido:\n`);

  for (const div of overdue) {
    const horasVencida = Math.floor((now.getTime() - div.deadline.getTime()) / (1000 * 60 * 60));
    const tipo = div.divergenceQty > 0 ? "FALTOU" : "SOBROU";
    const qtd  = Math.abs(div.divergenceQty);

    console.warn(
      `  · Transferência ${div.transfer.id.slice(0, 8)}` +
      ` | Loja: ${div.responsibleStore.code} (${div.responsibleStore.name})` +
      ` | Produto: ${div.transferItem.productCode} — ${div.transferItem.productName}` +
      ` | ${tipo} ${qtd} un.` +
      ` | Vencida há ${horasVencida}h` +
      ` | ID: ${div.id}`
    );
  }

  console.warn(`\nAção necessária: resolver cada divergência em /transferencias/<id>.`);
  console.warn("Nenhum ajuste automático foi feito.");

  // Exit code 1 para o cron capturar e disparar alerta
  process.exit(1);
}

main()
  .catch((err) => {
    console.error("Erro ao verificar divergências:", err);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
