# Pilar 1 — Plano de Produção Staging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar e validar o Pilar 1 (Estoque Comprometido) em staging antes de qualquer deploy em produção.

**Architecture:** O StockLedger cobre apenas o gap PENDING→NF emitida, período em que o sistema_logistica aprovou uma transferência mas o Citel ainda não enxerga via `saldoReservadoPedidoFilial`. O Citel é sempre a fonte de verdade para `qtdFisica`; o ledger só controla `qtdComprometida` e `qtdEmTransito`.

**Tech Stack:** Next.js 14, Prisma 5 + PostgreSQL (Supabase), tsx (scripts), Vitest

---

## Mapa de arquivos

| Ação | Arquivo | Responsabilidade |
|---|---|---|
| Criar | `docs/pilar1/deploy-checklist.md` | Checklist operacional de deploy staging |
| Criar | `scripts/seed-stock-ledger.ts` | Popula StockLedger com saldo atual do Citel |
| Criar | `scripts/notify-overdue-divergences.ts` | Cron: alerta divergências com prazo vencido |
| Criar | `__tests__/e2e/pilar1-staging.e2e.test.ts` | Teste E2E full-flow contra banco real |
| Modificar | `package.json` | Adicionar scripts `db:seed-ledger` e `cron:divergencias` |
| Nenhuma | `services/transferencia.service.ts` | `citelTakesOver` + `nfCitelNumero` já implementados (linhas 161-165 e 244-255) |

---

## Task 1: Criar o checklist de deploy e preparar migrations

**Files:**
- Create: `docs/pilar1/deploy-checklist.md`

- [ ] **Step 1.1: Criar o arquivo de checklist**

```markdown
# Checklist de Deploy Staging — Pilar 1

## Pré-requisitos

- [ ] `.env.local` de staging configurado com `DATABASE_URL` (pooler) e `DIRECT_URL` (conexão direta)
- [ ] Acesso VPN/rede ao Citel confirmado: `curl -s $CITEL_API_URL` retorna resposta
- [ ] Backup do banco staging tirado antes de qualquer migrate

## 1. Gerar o baseline de migrations (executar uma única vez)

O projeto usava `prisma db push` sem migrations. Antes de `migrate deploy`, é preciso
criar o baseline para que o Prisma saiba que as tabelas já existem.

```bash
# Na máquina local com DIRECT_URL apontando para staging:
npx prisma migrate dev --name baseline_pilar1
```

> O Prisma vai detectar que o banco já tem as tabelas e perguntará se quer
> criar um drift. Responda `y` — ele gera a migration SQL do estado atual.

Resultado esperado: pasta `prisma/migrations/YYYYMMDDHHMMSS_baseline_pilar1/` criada.

## 2. Aplicar em staging

```bash
npx prisma migrate deploy
```

Resultado esperado:
```
1 migration found in prisma/migrations
Applying migration `YYYYMMDDHHMMSS_baseline_pilar1`
The following migration(s) have been applied:
  migrations/YYYYMMDDHHMMSS_baseline_pilar1/migration.sql
```

## 3. Gerar cliente Prisma

```bash
npx prisma generate
```

Resultado esperado: `✔ Generated Prisma Client`

## 4. Validar tabelas criadas

Conectar no Supabase Studio (ou psql) e verificar:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('stock_ledgers','stock_ledger_entries','transfer_divergences');
```

Resultado esperado: 3 linhas retornadas.

Verificar colunas do StockLedger:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'stock_ledgers'
ORDER BY ordinal_position;
```

Resultado esperado: `id, store_id, product_code, product_name, qtd_fisica,
qtd_comprometida, qtd_em_transito, version, synced_at, created_at, updated_at`

## 5. Smoke test da API

```bash
curl -s http://localhost:3000/api/health | jq .
```

Resultado esperado: `{"status":"ok"}`

## Plano de rollback

Se qualquer etapa falhar, o rollback é seguro porque:
- As novas tabelas (`stock_ledgers`, `stock_ledger_entries`, `transfer_divergences`) são
  aditivas — não alteram nenhuma tabela existente.
- Nenhuma coluna de tabela existente foi removida ou alterada neste ciclo.

**Para reverter:**

```sql
-- Executar no banco staging via Supabase SQL Editor
DROP TABLE IF EXISTS transfer_divergences;
DROP TABLE IF EXISTS stock_ledger_entries;
DROP TABLE IF EXISTS stock_ledgers;
```

Depois remover a pasta `prisma/migrations/` para voltar ao fluxo `db push`.

> Importante: o rollback não afeta dados de transferências existentes porque
> `qtdComprometida` e `qtdEmTransito` não existiam antes — o Citel continua
> como fonte de verdade para estoque físico sem interrupção.
```

- [ ] **Step 1.2: Salvar o arquivo**

Escrever o conteúdo acima em `docs/pilar1/deploy-checklist.md`.

- [ ] **Step 1.3: Commit**

```bash
git add docs/pilar1/deploy-checklist.md
git commit -m "docs: checklist de deploy staging do Pilar 1"
```

---

## Task 2: Script de seed do StockLedger

**Files:**
- Create: `scripts/seed-stock-ledger.ts`
- Modify: `package.json`

- [ ] **Step 2.1: Escrever o script**

```typescript
// scripts/seed-stock-ledger.ts
//
// Popula StockLedger com saldo físico atual do Citel.
// Executar UMA VEZ antes de ativar o Pilar 1 em staging.
//
// Uso: npx tsx scripts/seed-stock-ledger.ts
// Variáveis obrigatórias: DATABASE_URL, DIRECT_URL, CITEL_API_URL, CITEL_LOGIN, CITEL_SENHA

import { PrismaClient } from "@prisma/client";
import { syncFromCitel } from "../services/stock-ledger.service";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Seed StockLedger — Pilar 1 ===");
  console.log("Fonte: Citel/Autcom | Destino: stock_ledgers\n");

  const stores = await prisma.store.findMany({
    where: { active: true, codigoEmpresaCitel: { not: null } },
    select: { id: true, code: true, name: true, codigoEmpresaCitel: true },
  });

  if (stores.length === 0) {
    console.error("Nenhuma loja ativa com codigoEmpresaCitel encontrada.");
    console.error("Verifique se o seed de lojas foi executado antes deste script.");
    process.exit(1);
  }

  console.log(`Lojas encontradas: ${stores.length}`);
  stores.forEach((s) => console.log(`  · ${s.code} — ${s.name} (empresa Citel: ${s.codigoEmpresaCitel})`));
  console.log();

  let totalSynced = 0;
  let totalErrors = 0;

  for (const store of stores) {
    process.stdout.write(`Sincronizando loja ${store.code} (${store.name})... `);

    try {
      const result = await syncFromCitel(store.id, store.codigoEmpresaCitel!);
      totalSynced += result.synced;
      totalErrors += result.errors;
      console.log(`OK — ${result.synced} produtos sincronizados, ${result.errors} erros`);
    } catch (err) {
      totalErrors++;
      console.log(`FALHOU — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n=== Resultado ===");
  console.log(`Produtos sincronizados: ${totalSynced}`);
  console.log(`Erros:                  ${totalErrors}`);

  if (totalErrors > 0) {
    console.warn("\nATENÇÃO: houve erros. Verifique se o Citel está acessível e");
    console.warn("se CITEL_API_URL, CITEL_LOGIN, CITEL_SENHA estão configurados.");
    process.exit(1);
  }

  console.log("\nSeed concluído. qtdComprometida=0 e qtdEmTransito=0 para todos os produtos.");
  console.log("O Pilar 1 está pronto para receber transferências.");
}

main()
  .catch((err) => {
    console.error("Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2.2: Adicionar script ao package.json**

Em `package.json`, dentro de `"scripts"`, adicionar após `"db:seed"`:

```json
"db:seed-ledger": "tsx scripts/seed-stock-ledger.ts"
```

- [ ] **Step 2.3: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 2.4: Commit**

```bash
git add scripts/seed-stock-ledger.ts package.json
git commit -m "feat: script de seed inicial do StockLedger via Citel"
```

---

## Task 3: Verificar wiring do citelTakesOver (sem alteração de código)

**Files:**
- Nenhum arquivo a criar ou modificar (já implementado)

O input manual de `nfCitelNumero` ao avançar para `IN_TRANSIT` já está implementado em
`services/transferencia.service.ts`:
- Linha 161-165: validação antecipada — rejeita `IN_TRANSIT` sem `nfCitelNumero`
- Linha 175-178: detecta `isNewNf` (primeira vez que a NF é definida)
- Linha 244-255: chama `citelTakesOver()` por item quando `isNewNf = true`

- [ ] **Step 3.1: Confirmar as linhas no arquivo**

```bash
sed -n '158,256p' services/transferencia.service.ts
```

Resultado esperado: ver `if (input.status === TransferStatus.IN_TRANSIT && !input.nfCitelNumero)`
na linha 161 e `if (isNewNf)` na linha 245.

- [ ] **Step 3.2: Documentar a decisão**

Adicionar ao `docs/pilar1/deploy-checklist.md` a seção:

```markdown
## Nota: citelTakesOver — entrada manual de NF

O webhook de NF do Citel NÃO está ativo neste ciclo.
O operador deve informar manualmente o número da NF no campo "NF Citel" ao
avançar a transferência para IN_TRANSIT na interface.

O sistema rejeita a transição se o campo estiver vazio (erro claro ao operador).
O webhook é a evolução futura — quando implementado, substituirá o campo manual.
```

- [ ] **Step 3.3: Commit**

```bash
git add docs/pilar1/deploy-checklist.md
git commit -m "docs: documenta decisão de NF manual (sem webhook Citel)"
```

---

## Task 4: Script de cron para divergências vencidas

**Files:**
- Create: `scripts/notify-overdue-divergences.ts`
- Modify: `package.json`

- [ ] **Step 4.1: Escrever o script**

```typescript
// scripts/notify-overdue-divergences.ts
//
// Alerta divergências com prazo vencido (deadline < agora, status PENDING_RESOLUTION).
// NÃO altera estoque nem resolve divergências automaticamente.
//
// Uso: npx tsx scripts/notify-overdue-divergences.ts
// Em staging: executar via cron diariamente ou chamar pela API interna.

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
      transfer: { select: { id: true } },
      responsibleStore: { select: { code: true, name: true } },
      transferItem: { select: { productCode: true, productName: true } },
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
    const qtd = Math.abs(div.divergenceQty);

    console.warn(
      `  · Transferência ${div.transfer.id.slice(0, 8)}` +
      ` | Loja responsável: ${div.responsibleStore.code} (${div.responsibleStore.name})` +
      ` | Produto: ${div.transferItem.productCode} — ${div.transferItem.productName}` +
      ` | ${tipo} ${qtd} unidade(s)` +
      ` | Vencida há ${horasVencida}h` +
      ` | ID divergência: ${div.id}`
    );
  }

  console.warn(`\nAção necessária: resolver cada divergência em /transferencias/<id> antes do próximo sync.`);
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
```

- [ ] **Step 4.2: Adicionar script ao package.json**

Em `package.json`, dentro de `"scripts"`, adicionar:

```json
"cron:divergencias": "tsx scripts/notify-overdue-divergences.ts"
```

- [ ] **Step 4.3: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 4.4: Testar saída com banco vazio (sem divergências vencidas)**

```bash
npx tsx scripts/notify-overdue-divergences.ts
```

Resultado esperado (sem dados de staging): `Nenhuma divergência vencida. Tudo em dia.`
Exit code: `0`

- [ ] **Step 4.5: Commit**

```bash
git add scripts/notify-overdue-divergences.ts package.json
git commit -m "feat: script de cron para alertar divergências com prazo vencido"
```

---

## Task 5: Teste E2E de staging

**Files:**
- Create: `__tests__/e2e/pilar1-staging.e2e.test.ts`

O teste é guardado por `E2E_STAGING=true` para não rodar no CI padrão.
Usa o banco real de staging (via `DATABASE_URL` e `DIRECT_URL` no `.env.local`).

- [ ] **Step 5.1: Escrever o teste E2E**

```typescript
// __tests__/e2e/pilar1-staging.e2e.test.ts
//
// Teste E2E full-flow do Pilar 1 contra o banco real de staging.
// NÃO roda no CI padrão — requer E2E_STAGING=true.
//
// Uso: E2E_STAGING=true npx vitest run __tests__/e2e/pilar1-staging.e2e.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, TransferStatus, TransferPriority, ResolutionType } from "@prisma/client";
import { commitStock, releaseStock, citelTakesOver, markInTransit, reconcileTransfer, resolveDivergence } from "../../services/stock-ledger.service";

const SKIP = !process.env.E2E_STAGING;

const prisma = new PrismaClient();

// IDs de staging — ajustar para IDs reais do banco de staging
// (obter via: SELECT id, code FROM stores LIMIT 5)
const STORE_A_ID = process.env.E2E_STORE_A_ID ?? "";
const STORE_B_ID = process.env.E2E_STORE_B_ID ?? "";
const OPERATOR_ID = process.env.E2E_OPERATOR_ID ?? "";
const PRODUCT_CODE = process.env.E2E_PRODUCT_CODE ?? "TINT-001";
const PRODUCT_NAME = process.env.E2E_PRODUCT_NAME ?? "Tinta Branca 18L (E2E)";

// Registro dos IDs criados neste teste para limpeza no afterAll
const createdIds: { transfers: string[]; ledgers: string[] } = { transfers: [], ledgers: [] };

beforeAll(async () => {
  if (SKIP) return;
  if (!STORE_A_ID || !STORE_B_ID || !OPERATOR_ID) {
    throw new Error(
      "Defina E2E_STORE_A_ID, E2E_STORE_B_ID e E2E_OPERATOR_ID no ambiente."
    );
  }
});

afterAll(async () => {
  if (SKIP) return;
  // Limpeza: remove dados criados pelo teste (divergências, entradas, ledgers, transferências)
  for (const transferId of createdIds.transfers) {
    await prisma.transferDivergence.deleteMany({ where: { transferId } });
    await prisma.transferHistory.deleteMany({ where: { transferId } });
    await prisma.transferItem.deleteMany({ where: { transferId } });
    await prisma.transfer.deleteMany({ where: { id: transferId } });
  }
  for (const ledgerId of createdIds.ledgers) {
    await prisma.stockLedgerEntry.deleteMany({ where: { ledgerId } });
    await prisma.stockLedger.deleteMany({ where: { id: ledgerId } });
  }
  await prisma.$disconnect();
});

describe.skipIf(SKIP)("E2E — Pilar 1: Estoque Comprometido (staging)", () => {

  it("1. commitStock trava qtdComprometida na loja de origem", async () => {
    const transfer = await prisma.transfer.create({
      data: {
        fromStoreId: STORE_A_ID,
        toStoreId:   STORE_B_ID,
        priority:    TransferPriority.ANTICIPATED,
        items: { create: [{ productCode: PRODUCT_CODE, productName: PRODUCT_NAME, quantity: 2 }] },
      },
      include: { items: true },
    });
    createdIds.transfers.push(transfer.id);

    const result = await commitStock({
      storeId:     STORE_A_ID,
      productCode: PRODUCT_CODE,
      productName: PRODUCT_NAME,
      qty:         2,
      transferId:  transfer.id,
      operatorId:  OPERATOR_ID,
    });

    expect(result.success).toBe(true);

    const ledger = await prisma.stockLedger.findUnique({
      where: { storeId_productCode: { storeId: STORE_A_ID, productCode: PRODUCT_CODE } },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.qtdComprometida).toBeGreaterThanOrEqual(2);
    if (ledger) createdIds.ledgers.push(ledger.id);
  });

  it("2. markInTransit registra qtdEmTransito na loja destino", async () => {
    const transfer = await prisma.transfer.create({
      data: {
        fromStoreId: STORE_A_ID,
        toStoreId:   STORE_B_ID,
        priority:    TransferPriority.ANTICIPATED,
        items: { create: [{ productCode: PRODUCT_CODE, productName: PRODUCT_NAME, quantity: 3 }] },
      },
    });
    createdIds.transfers.push(transfer.id);

    await markInTransit({
      toStoreId:   STORE_B_ID,
      productCode: PRODUCT_CODE,
      productName: PRODUCT_NAME,
      qty:         3,
      transferId:  transfer.id,
    });

    const ledger = await prisma.stockLedger.findUnique({
      where: { storeId_productCode: { storeId: STORE_B_ID, productCode: PRODUCT_CODE } },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.qtdEmTransito).toBeGreaterThanOrEqual(3);
    if (ledger) createdIds.ledgers.push(ledger.id);
  });

  it("3. citelTakesOver libera qtdComprometida quando NF é informada", async () => {
    const transfer = await prisma.transfer.create({
      data: {
        fromStoreId: STORE_A_ID,
        toStoreId:   STORE_B_ID,
        priority:    TransferPriority.ANTICIPATED,
        items: { create: [{ productCode: PRODUCT_CODE, productName: PRODUCT_NAME, quantity: 4 }] },
      },
    });
    createdIds.transfers.push(transfer.id);

    await commitStock({ storeId: STORE_A_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qty: 4, transferId: transfer.id });
    const before = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: STORE_A_ID, productCode: PRODUCT_CODE } },
    });

    await citelTakesOver({ storeId: STORE_A_ID, productCode: PRODUCT_CODE, qty: 4, transferId: transfer.id, operatorId: OPERATOR_ID });

    const after = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: STORE_A_ID, productCode: PRODUCT_CODE } },
    });
    expect(after.qtdComprometida).toBe(Math.max(0, before.qtdComprometida - 4));
    if (!createdIds.ledgers.includes(before.id)) createdIds.ledgers.push(before.id);
  });

  it("4. reconcileTransfer sem divergência não cria TransferDivergence", async () => {
    const transfer = await prisma.transfer.create({
      data: {
        fromStoreId: STORE_A_ID,
        toStoreId:   STORE_B_ID,
        priority:    TransferPriority.ANTICIPATED,
        items: { create: [{ productCode: PRODUCT_CODE, productName: PRODUCT_NAME, quantity: 5, sentQty: 5 }] },
      },
      include: { items: true },
    });
    createdIds.transfers.push(transfer.id);

    const result = await reconcileTransfer({
      transferId:       transfer.id,
      sendingStoreId:   STORE_A_ID,
      receivingStoreId: STORE_B_ID,
      operatorId:       OPERATOR_ID,
      items: [{ transferItemId: transfer.items[0].id, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, sentQty: 5, receivedQty: 5 }],
    });

    expect(result.hasDivergence).toBe(false);
    const divCount = await prisma.transferDivergence.count({ where: { transferId: transfer.id } });
    expect(divCount).toBe(0);
  });

  it("5. reconcileTransfer com divergência cria TransferDivergence e bloqueia READY", async () => {
    const transfer = await prisma.transfer.create({
      data: {
        fromStoreId: STORE_A_ID,
        toStoreId:   STORE_B_ID,
        priority:    TransferPriority.ANTICIPATED,
        items: { create: [{ productCode: PRODUCT_CODE, productName: PRODUCT_NAME, quantity: 6, sentQty: 6 }] },
      },
      include: { items: true },
    });
    createdIds.transfers.push(transfer.id);

    // Garante ledger destino para receber a divergência
    await markInTransit({ toStoreId: STORE_B_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qty: 6, transferId: transfer.id });
    const destLedger = await prisma.stockLedger.findUnique({ where: { storeId_productCode: { storeId: STORE_B_ID, productCode: PRODUCT_CODE } } });
    if (destLedger) createdIds.ledgers.push(destLedger.id);

    const result = await reconcileTransfer({
      transferId:       transfer.id,
      sendingStoreId:   STORE_A_ID,
      receivingStoreId: STORE_B_ID,
      operatorId:       OPERATOR_ID,
      items: [{ transferItemId: transfer.items[0].id, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, sentQty: 6, receivedQty: 4 }],
    });

    expect(result.hasDivergence).toBe(true);
    expect(result.divergences[0].divergenceQty).toBe(2);

    const divCount = await prisma.transferDivergence.count({ where: { transferId: transfer.id } });
    expect(divCount).toBe(1);
  });

  it("6. resolveDivergence MISSING_PRODUCT ajusta qtdFisica e libera para READY quando não há mais pendências", async () => {
    // Setup: cria transferência com divergência já existente no banco
    const transfer = await prisma.transfer.create({
      data: {
        fromStoreId:  STORE_A_ID,
        toStoreId:    STORE_B_ID,
        priority:     TransferPriority.ANTICIPATED,
        hasDivergence: true,
        items: { create: [{ productCode: PRODUCT_CODE, productName: PRODUCT_NAME, quantity: 3, sentQty: 3 }] },
      },
      include: { items: true },
    });
    createdIds.transfers.push(transfer.id);

    await markInTransit({ toStoreId: STORE_B_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qty: 3, transferId: transfer.id });
    const destLedger = await prisma.stockLedger.findUniqueOrThrow({ where: { storeId_productCode: { storeId: STORE_B_ID, productCode: PRODUCT_CODE } } });
    if (!createdIds.ledgers.includes(destLedger.id)) createdIds.ledgers.push(destLedger.id);

    const div = await prisma.transferDivergence.create({
      data: {
        transferId:        transfer.id,
        transferItemId:    transfer.items[0].id,
        ledgerId:          destLedger.id,
        productCode:       PRODUCT_CODE,
        productName:       PRODUCT_NAME,
        sentQty:           3,
        receivedQty:       2,
        divergenceQty:     1,  // positivo = faltou — MISSING_PRODUCT válido
        responsibleStoreId: STORE_B_ID,
        deadline:          new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const qtdFisicaAntes = destLedger.qtdFisica;

    await resolveDivergence({
      divergenceId:   div.id,
      resolutionType: ResolutionType.MISSING_PRODUCT,
      resolution:     "Produto não localizado no recebimento — E2E test",
      resolvedById:   OPERATOR_ID,
    });

    const ledgerDepois = await prisma.stockLedger.findUniqueOrThrow({ where: { id: destLedger.id } });
    expect(ledgerDepois.qtdFisica).toBe(qtdFisicaAntes - 1);

    const divDepois = await prisma.transferDivergence.findUniqueOrThrow({ where: { id: div.id } });
    expect(divDepois.status).toBe("RESOLVED");
  });

  it("7. resolveDivergence MISSING_PRODUCT com divergenceQty <= 0 lança erro operacional", async () => {
    const transfer = await prisma.transfer.create({
      data: {
        fromStoreId: STORE_A_ID,
        toStoreId:   STORE_B_ID,
        priority:    TransferPriority.ANTICIPATED,
        items: { create: [{ productCode: PRODUCT_CODE, productName: PRODUCT_NAME, quantity: 2, sentQty: 2 }] },
      },
      include: { items: true },
    });
    createdIds.transfers.push(transfer.id);

    await markInTransit({ toStoreId: STORE_B_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qty: 2, transferId: transfer.id });
    const destLedger = await prisma.stockLedger.findUniqueOrThrow({ where: { storeId_productCode: { storeId: STORE_B_ID, productCode: PRODUCT_CODE } } });
    if (!createdIds.ledgers.includes(destLedger.id)) createdIds.ledgers.push(destLedger.id);

    const div = await prisma.transferDivergence.create({
      data: {
        transferId:        transfer.id,
        transferItemId:    transfer.items[0].id,
        ledgerId:          destLedger.id,
        productCode:       PRODUCT_CODE,
        productName:       PRODUCT_NAME,
        sentQty:           2,
        receivedQty:       3,
        divergenceQty:     -1,  // negativo = sobrou — MISSING_PRODUCT inválido
        responsibleStoreId: STORE_B_ID,
        deadline:          new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await expect(
      resolveDivergence({
        divergenceId:   div.id,
        resolutionType: ResolutionType.MISSING_PRODUCT,
        resolution:     "teste de validação",
        resolvedById:   OPERATOR_ID,
      })
    ).rejects.toThrow("Esta divergência indica que chegou produto a mais");

    // Confirma que o ledger NÃO foi alterado
    const ledgerDepois = await prisma.stockLedger.findUniqueOrThrow({ where: { id: destLedger.id } });
    expect(ledgerDepois.qtdFisica).toBe(destLedger.qtdFisica);
  });
});
```

- [ ] **Step 5.2: Verificar tipos**

```bash
npx tsc --noEmit
```

Resultado esperado: nenhum erro.

- [ ] **Step 5.3: Confirmar que o teste É IGNORADO sem a variável de ambiente**

```bash
npx vitest run __tests__/e2e/pilar1-staging.e2e.test.ts
```

Resultado esperado: `7 tests skipped` — nenhum teste roda no CI padrão.

- [ ] **Step 5.4: Commit**

```bash
git add __tests__/e2e/pilar1-staging.e2e.test.ts
git commit -m "test: E2E full-flow do Pilar 1 para staging"
```

---

## Ordem de execução em staging

```
1. git pull (garantir versão mais recente)
2. npx prisma migrate dev --name baseline_pilar1   ← gera a migration SQL
3. npx prisma migrate deploy                        ← aplica no banco staging
4. npx prisma generate                              ← regenera cliente
5. Validar tabelas no Supabase Studio (SQL da Task 1)
6. npx run db:seed-ledger                           ← popula StockLedger com saldo Citel
7. Smoke test: curl http://localhost:3000/api/health
8. E2E_STAGING=true E2E_STORE_A_ID=... npx vitest run __tests__/e2e/pilar1-staging.e2e.test.ts
9. npx run cron:divergencias                        ← deve retornar "nenhuma vencida"
10. Deploy do Next.js no Vercel (staging branch)
```

## Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| `migrate dev` falha por drift entre `db push` e schema | Média | Baixo | Usar `--create-only` para revisar SQL antes de aplicar |
| Citel indisponível durante seed | Média | Médio | Script reporta erros por loja — re-executar por loja com `--store <code>` |
| E2E cria dados que sujam staging | Baixa | Baixo | `afterAll` limpa todos os registros criados pelo teste |
| `qtdFisica` zero após seed (Citel sem dados para o produto) | Alta para produtos novos | Baixo | Seed reporta `errors` — revisar manualmente após execução |

---

*Plano gerado em 2026-05-03. Não aplicar em produção antes de validar todos os steps em staging.*
