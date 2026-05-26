# Transferência em 5 etapas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o fluxo atual de Transferência (PENDING → APPROVED → IN_TRANSIT → RECEIVED) por um modelo de 5 etapas (PENDING → AWAITING_APPROVAL → READY_TO_COLLECT → IN_TRANSIT → DELIVERED) eliminando o bug estrutural "fromStoreId = toStoreId placeholder".

**Architecture:** Refator profundo do modelo. `Transfer.fromStoreId` vira nullable, TE/NF migram para TransferItem (1 por item, exigência do Autcom), auto-split na criação (1 solicitação com N items → N Transfers), `commitStock` migra de `createTransfer` para nova função `indicateOrigin`. Migration consolidada idempotente, defesa em profundidade via CHECK constraint.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma 5, PostgreSQL (Supabase), Tailwind, shadcn/ui. Vitest para testes. Deploy via Vercel (push main → deploy automático).

**Spec:** `docs/superpowers/specs/2026-05-26-transferencia-5-etapas-design.md`

---

## File Structure

### Files to Create

| Path | Responsabilidade |
|---|---|
| `prisma/migration_5_etapas_transfer.sql` | SQL idempotente da migration (enum, colunas, FK, índices, CHECK, migração de dados) |
| `scripts/apply-migration-5-etapas.mjs` | Runner Node + pg client com DIRECT_URL |
| `app/api/transferencias/[id]/indicate-origin/route.ts` | POST: PENDING → AWAITING_APPROVAL |
| `app/api/transferencias/[id]/approve/route.ts` | POST: AWAITING_APPROVAL → READY_TO_COLLECT |
| `app/api/transferencias/[id]/reject-at-origin/route.ts` | POST: AWAITING_APPROVAL → PENDING |
| `app/api/transferencias/[id]/collect/route.ts` | POST: READY_TO_COLLECT → IN_TRANSIT (driver) |
| `app/api/transferencias/[id]/deliver/route.ts` | POST: IN_TRANSIT → DELIVERED (driver) |
| `app/api/transferencias/[id]/cancel/route.ts` | POST: cancela em qualquer status não-terminal |
| `__tests__/services/transferencia-5-etapas.test.ts` | Unit tests das 6 novas funções de service |
| `app/(app)/transferencias/_components/transfer-card.tsx` | Card único com switch por status (5 visualizações) |
| `app/(app)/transferencias/_components/indicate-origin-dialog.tsx` | Dialog para escolher fromStore |
| `app/(app)/transferencias/_components/approve-dialog.tsx` | Dialog para digitar TE ou NF |

### Files to Modify

| Path | Mudança |
|---|---|
| `prisma/schema.prisma` | enum TransferStatus (+ 3 valores), Transfer (fromStoreId nullable + 7 campos novos + 2 relations + 2 índices), TransferItem (+ 5 campos) |
| `services/transferencia.service.ts` | Reescrita: createTransfer (auto-split), nova `indicateOrigin`, `approveTransfer`, `rejectTransferAtOrigin`, `collectTransfer`, `deliverTransfer`, `cancelTransfer` refatorada, VALID_TRANSITIONS atualizado, `handleTransferReceivedOnRequest` → `handleTransferDeliveredOnRequest` |
| `app/api/transferencias/route.ts` | POST aceita lista de items → cria N Transfers |
| `app/api/solicitacoes/route.ts:359-426` | Remove placeholder; cria N Transfers PENDING (fromStoreId=null); mantém auto-link Citel como hint |
| `lib/constants.ts:27-53` | TRANSFER_STATUS_LABELS + COLORS para AWAITING_APPROVAL, READY_TO_COLLECT, DELIVERED |
| `components/ui/status-badge.tsx` | Adicionar 3 variants |
| `components/transferencias/transfer-actions.tsx` | NEXT_ACTIONS atualizado pra 5 etapas |
| `app/(app)/transferencias/page.tsx` | 6 abas: Pendente / Aguard. aprovação / Para coletar / Em rota / Entregues / Canceladas |
| `app/(app)/transferencias/_components/transferencias-filters.tsx` | Renomear views, adicionar novas |
| `app/(app)/transferencias/[id]/page.tsx` | TIMELINE_CONFIG com 5 etapas |
| `__tests__/services/pilar1-stock-lock.test.ts` | commitStock agora roda em indicateOrigin, não em createTransfer |
| `__tests__/e2e/pilar1-staging.e2e.test.ts` | Fluxo completo 5 etapas + cascata DR |

---

## Fase A — Schema & Migration (Tasks 1-3)

### Task 1: SQL da migration idempotente

**Files:**
- Create: `prisma/migration_5_etapas_transfer.sql`

- [ ] **Step 1: Criar o arquivo SQL**

```sql
-- ──────────────────────────────────────────────────────────────────────
-- Transferência em 5 etapas — migration consolidada idempotente
-- Spec: docs/superpowers/specs/2026-05-26-transferencia-5-etapas-design.md
-- ──────────────────────────────────────────────────────────────────────

-- 1. enum TransferStatus: adiciona valores novos
DO $$ BEGIN
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'AWAITING_APPROVAL';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'READY_TO_COLLECT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. transfers: relaxa fromStoreId, adiciona novos campos
ALTER TABLE transfers ALTER COLUMN "fromStoreId" DROP NOT NULL;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "originIndicatedAt"   TIMESTAMP(3);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "originIndicatedById" TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveredAt"         TIMESTAMP(3);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveredById"       TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveryPhotoUrl"    TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveryPhotoPath"   TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "recipientName"       TEXT;

-- 3. transfer_items: TE/NF por item + rastreio de coleta
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "teNumber"         TEXT;
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "nfCitelNumero"    TEXT;
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "nfCitelEmitidaAt" TIMESTAMP(3);
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "collectedAt"      TIMESTAMP(3);
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "collectConfirmed" BOOLEAN DEFAULT false;

-- 4. FKs novos (ON DELETE SET NULL)
DO $$ BEGIN
  ALTER TABLE transfers ADD CONSTRAINT "transfers_originIndicatedById_fkey"
    FOREIGN KEY ("originIndicatedById") REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE transfers ADD CONSTRAINT "transfers_deliveredById_fkey"
    FOREIGN KEY ("deliveredById") REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Índices novos
CREATE INDEX IF NOT EXISTS "transfers_status_toStoreId_idx"   ON transfers(status, "toStoreId");
CREATE INDEX IF NOT EXISTS "transfers_status_fromStoreId_idx" ON transfers(status, "fromStoreId");

-- 6. Migração de dados — copia TE/NF da Transfer para o(s) item(s)
UPDATE transfer_items ti
   SET "teNumber"         = t."teNumber",
       "nfCitelNumero"    = t."nfCitelNumero",
       "nfCitelEmitidaAt" = t."nfCitelEmitidaAt"
  FROM transfers t
 WHERE ti."transferId" = t.id
   AND ti."teNumber" IS NULL AND ti."nfCitelNumero" IS NULL
   AND (t."teNumber" IS NOT NULL OR t."nfCitelNumero" IS NOT NULL);

-- 7. Migração de status em flight (transfers ainda processando)
UPDATE transfers SET status = 'READY_TO_COLLECT'
 WHERE status IN ('APPROVED', 'PREPARING', 'PREPARED');

UPDATE transfers SET status        = 'DELIVERED',
                     "deliveredAt" = COALESCE("deliveredAt", "receivedAt")
 WHERE status = 'RECEIVED';

-- 8. CHECK constraint — defesa em profundidade (rodada DEPOIS da migração de dados)
DO $$ BEGIN
  ALTER TABLE transfers ADD CONSTRAINT transfer_origin_required
    CHECK (status IN ('PENDING','CANCELLED') OR "fromStoreId" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Validar o SQL com psql --dry-run** (opcional — não roda no DB ainda)

Vai ser exercido pelo script da Task 2.

- [ ] **Step 3: Commit**

```bash
git add prisma/migration_5_etapas_transfer.sql
git commit -m "feat(transfers): SQL idempotente da migration 5 etapas"
```

---

### Task 2: Script de aplicação da migration

**Files:**
- Create: `scripts/apply-migration-5-etapas.mjs`

- [ ] **Step 1: Criar o script seguindo o padrão de `scripts/apply-migration.mjs`**

```js
// Aplica prisma/migration_5_etapas_transfer.sql no Supabase via DIRECT_URL
// Uso:
//   node scripts/apply-migration-5-etapas.mjs           # dry-run (lista seções)
//   node scripts/apply-migration-5-etapas.mjs --execute # aplica de fato
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const EXECUTE = process.argv.includes("--execute");
const SQL_PATH = path.resolve("prisma/migration_5_etapas_transfer.sql");
const sql = fs.readFileSync(SQL_PATH, "utf8");

// Divide o SQL em blocos por comentário "-- N." pra log progressivo
const blocks = sql.split(/^-- \d+\./m).slice(1);
console.log(`\n${EXECUTE ? "EXECUTANDO" : "DRY-RUN"} | ${blocks.length} seções\n`);

if (!EXECUTE) {
  blocks.forEach((b, i) => {
    const firstLine = b.trim().split("\n")[0];
    console.log(`  [${i + 1}] ${firstLine.slice(0, 80)}`);
  });
  console.log("\nUse --execute para aplicar no banco.");
  process.exit(0);
}

const { Client } = await import("pg");
const url = process.env.DIRECT_URL;
if (!url) throw new Error("DIRECT_URL não encontrada em .env.local");

const client = new Client({ connectionString: url });
await client.connect();

try {
  await client.query(sql);
  console.log("✓ Migration aplicada com sucesso");

  // Verificações pós-migration
  const checks = [
    `SELECT unnest(enum_range(NULL::"TransferStatus")) AS v WHERE unnest(enum_range(NULL::"TransferStatus"))::text IN ('AWAITING_APPROVAL','READY_TO_COLLECT','DELIVERED')`,
    `SELECT column_name FROM information_schema.columns WHERE table_name='transfers' AND column_name IN ('originIndicatedAt','deliveredAt','deliveryPhotoUrl')`,
    `SELECT column_name FROM information_schema.columns WHERE table_name='transfer_items' AND column_name IN ('teNumber','nfCitelNumero','collectConfirmed')`,
    `SELECT indexname FROM pg_indexes WHERE tablename='transfers' AND indexname IN ('transfers_status_toStoreId_idx','transfers_status_fromStoreId_idx')`,
    `SELECT conname FROM pg_constraint WHERE conname = 'transfer_origin_required'`,
  ];
  for (const q of checks) {
    const r = await client.query(q);
    console.log(`✓ ${r.rowCount} resultado(s) para: ${q.slice(0, 80)}...`);
  }
} catch (err) {
  console.error("✗ Falha:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
```

- [ ] **Step 2: Rodar em dry-run para validar parsing**

Run: `node scripts/apply-migration-5-etapas.mjs`
Expected: lista 8 seções, mensagem "Use --execute para aplicar"

- [ ] **Step 3: NÃO rodar com --execute ainda** (vai na Task 26, depois do código pronto)

- [ ] **Step 4: Commit**

```bash
git add scripts/apply-migration-5-etapas.mjs
git commit -m "feat(transfers): script de aplicação da migration 5 etapas"
```

---

### Task 3: Atualizar schema.prisma + gerar client

**Files:**
- Modify: `prisma/schema.prisma` (enum TransferStatus, Transfer, TransferItem)

- [ ] **Step 1: Editar enum TransferStatus** (linha ~82)

```prisma
enum TransferStatus {
  PENDING              // 1ª etapa - aguarda loja destino indicar origem
  AWAITING_APPROVAL    // 2ª etapa - aguarda loja origem digitar TE/NF
  READY_TO_COLLECT     // 3ª etapa - aprovada, aguarda coleta pelo motorista
  IN_TRANSIT           // 4ª etapa - motorista coletou, a caminho
  DELIVERED            // 5ª etapa - entregue no destino
  CANCELLED            // cancelada em qualquer ponto
  // legados — preservados para histórico (TransferHistory aponta pra eles)
  APPROVED
  PREPARING
  PREPARED
  RECEIVED
}
```

- [ ] **Step 2: Editar model Transfer** (linha ~661)

Substituir o bloco inteiro do `model Transfer { ... @@map("transfers") }` por:

```prisma
model Transfer {
  id                  String           @id @default(cuid())
  deliveryRequestId   String?
  fromStoreId         String?
  toStoreId           String
  priority            TransferPriority
  status              TransferStatus   @default(PENDING)
  requestedById       String?
  approvedById        String?

  requestedAt         DateTime         @default(now())
  originIndicatedAt   DateTime?
  originIndicatedById String?
  approvedAt          DateTime?
  preparingAt         DateTime?
  preparedAt          DateTime?
  dispatchedAt        DateTime?
  collectedAt         DateTime?
  receivedAt          DateTime?
  deliveredAt         DateTime?
  cancelledAt         DateTime?
  updatedAt           DateTime         @updatedAt

  notes               String?
  internalNotes       String?
  estimatedArrival    DateTime?

  nfCitelNumero       String?
  nfCitelEmitidaAt    DateTime?
  teNumber            String?

  collectPhotoUrl     String?
  collectPhotoPath    String?
  deliveryPhotoUrl    String?
  deliveryPhotoPath   String?
  deliveredById       String?
  recipientName       String?

  hasDivergence       Boolean  @default(false)
  divergenceCount     Int      @default(0)

  deliveryRequest     DeliveryRequest?    @relation(fields: [deliveryRequestId], references: [id])
  fromStore           Store?              @relation("TransferFrom", fields: [fromStoreId], references: [id])
  toStore             Store               @relation("TransferTo",   fields: [toStoreId],   references: [id])
  requestedBy         User?               @relation("TransferRequestedBy",       fields: [requestedById],       references: [id])
  approvedBy          User?               @relation("TransferApprovedBy",        fields: [approvedById],        references: [id])
  originIndicatedBy   User?               @relation("TransferOriginIndicatedBy", fields: [originIndicatedById], references: [id])
  deliveredBy         User?               @relation("TransferDeliveredBy",       fields: [deliveredById],       references: [id])
  items               TransferItem[]
  dispatch            Dispatch?           @relation("TransferDispatch")
  history             TransferHistory[]
  divergences         TransferDivergence[]

  @@index([status, toStoreId])
  @@index([status, fromStoreId])
  @@map("transfers")
}
```

> Mantemos `teNumber/nfCitelNumero/nfCitelEmitidaAt` na Transfer também (em paralelo ao item) por compatibilidade com código legado que ainda lê desses campos — vão sendo descontinuados ao longo das tasks. Mais seguro que dropar de uma vez.

- [ ] **Step 3: Editar model TransferItem** (linha ~731)

Substituir por:

```prisma
model TransferItem {
  id                   String   @id @default(cuid())
  transferId           String
  productCode          String
  productName          String
  quantity             Float
  unit                 String   @default("UN")
  sentQty              Float?
  receivedQty          Float?

  teNumber             String?
  nfCitelNumero        String?
  nfCitelEmitidaAt     DateTime?
  collectedAt          DateTime?
  collectConfirmed     Boolean  @default(false)

  linkedCitelPD        String?
  linkedCitelStoreCode String?
  linkedAt             DateTime?
  linkedById           String?

  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  transfer             Transfer             @relation(fields: [transferId], references: [id], onDelete: Cascade)
  divergences          TransferDivergence[]

  @@index([linkedCitelPD])
  @@map("transfer_items")
}
```

- [ ] **Step 4: Adicionar back-relations em `model User`**

Localizar `model User { ... }` e adicionar (junto às relations existentes de Transfer):

```prisma
  transfersOriginIndicated Transfer[] @relation("TransferOriginIndicatedBy")
  transfersDelivered       Transfer[] @relation("TransferDeliveredBy")
```

- [ ] **Step 5: Rodar prisma generate**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" sem erros de schema

- [ ] **Step 6: Verificar que tsc ainda passa**

Run: `npx tsc --noEmit`
Expected: 0 erros (pode haver warnings sobre campos não usados, ignorar)

> **Importante:** se aparecer erro de tipo em código que referencia `transfer.teNumber` ou `.nfCitelNumero`, é esperado — vai ser corrigido nas tasks de service/UI. Por ora, anota os arquivos e segue. Os campos legados ainda existem no modelo, então o compilador não deve quebrar.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(transfers): schema 5 etapas (enum, Transfer, TransferItem)"
```

---

## Fase B — Refator do core service (Tasks 4-10) — TDD

> **Setup:** todas as tasks dessa fase trabalham em `services/transferencia.service.ts` e em `__tests__/services/transferencia-5-etapas.test.ts` (novo).
>
> Antes de começar, criar o arquivo de tests vazio:
>
> ```ts
> // __tests__/services/transferencia-5-etapas.test.ts
> import { describe, it, expect, beforeEach } from "vitest";
> import { prisma } from "@/lib/prisma";
>
> describe("Transferência 5 etapas", () => {
>   // tasks 4-10 adicionam describes filhos aqui
> });
> ```

### Task 4: Função `indicateOrigin` (PENDING → AWAITING_APPROVAL)

**Files:**
- Modify: `services/transferencia.service.ts`
- Modify: `__tests__/services/transferencia-5-etapas.test.ts`

- [ ] **Step 1: Escrever test que falha**

Adicionar em `__tests__/services/transferencia-5-etapas.test.ts`:

```ts
import { indicateOrigin, createTransfer } from "@/services/transferencia.service";
import { TransferStatus, TransferPriority } from "@prisma/client";

describe("indicateOrigin", () => {
  it("PENDING → AWAITING_APPROVAL preenche fromStoreId e commita estoque", async () => {
    // Setup: cria uma Transfer PENDING (fromStoreId=null)
    const userTo  = await prisma.user.findFirstOrThrow({ where: { storeId: "store-132-id" } });
    const userFrom = await prisma.user.findFirstOrThrow({ where: { storeId: "store-067-id" } });
    const [t] = await createTransfer({
      toStoreId:     "store-132-id",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: userTo.id,
      items: [{ productCode: "TEST-001", productName: "Teste", quantity: 2, unit: "UN" }],
    });
    expect(t.status).toBe(TransferStatus.PENDING);
    expect(t.fromStoreId).toBeNull();

    // Act
    const updated = await indicateOrigin(t.id, "store-067-id", userTo.id);

    // Assert: status, origem, ledger
    expect(updated.status).toBe(TransferStatus.AWAITING_APPROVAL);
    expect(updated.fromStoreId).toBe("store-067-id");
    expect(updated.originIndicatedAt).toBeInstanceOf(Date);

    const ledger = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: "store-067-id", productCode: "TEST-001" } },
    });
    expect(ledger.qtdComprometida).toBeGreaterThanOrEqual(2);

    const history = await prisma.transferHistory.findFirst({
      where: { transferId: t.id, toStatus: TransferStatus.AWAITING_APPROVAL },
    });
    expect(history).not.toBeNull();
  });

  it("rejeita se estoque insuficiente na origem", async () => {
    // (criar Transfer e tentar indicar loja sem estoque suficiente — espera throw)
    // ... assemelhado ao pattern em pilar1-stock-lock.test.ts
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "indicateOrigin"`
Expected: FAIL com "indicateOrigin is not a function"

- [ ] **Step 3: Implementar `indicateOrigin` em `services/transferencia.service.ts`**

Adicionar após a função `createTransfer`:

```ts
// ──────────────────────────────────────────────
// indicateOrigin — etapa 1 → 2
// Loja destino indica qual loja vai fornecer. commita estoque na origem.
// ──────────────────────────────────────────────
export async function indicateOrigin(
  transferId: string,
  fromStoreId: string,
  indicatedById: string,
) {
  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true },
  });

  if (current.status !== TransferStatus.PENDING) {
    throw new Error(`Só é possível indicar origem em status PENDING (atual: ${current.status})`);
  }
  if (fromStoreId === current.toStoreId) {
    throw new Error("Loja origem não pode ser igual à loja destino");
  }

  // Pré-check de estoque na origem indicada
  for (const item of current.items) {
    const check = await preCheckStock({
      storeId:     fromStoreId,
      productCode: item.productCode,
      productName: item.productName,
      qty:         item.quantity,
    });
    if (!check.ok) {
      throw new Error(
        `Estoque insuficiente em ${fromStoreId} para ${item.productName} (${item.productCode})`,
      );
    }
  }

  // Atualiza Transfer + histórico na mesma transação
  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.transfer.update({
      where: { id: transferId },
      data: {
        fromStoreId,
        status:              TransferStatus.AWAITING_APPROVAL,
        originIndicatedAt:   new Date(),
        originIndicatedById: indicatedById,
      },
      include: { items: true, fromStore: true, toStore: true },
    });
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus:  TransferStatus.PENDING,
        toStatus:    TransferStatus.AWAITING_APPROVAL,
        changedById: indicatedById,
        notes:       `Origem indicada: ${t.fromStore?.code ?? fromStoreId}`,
      },
    });
    return t;
  });

  // Commita estoque na origem (transação própria em commitStock)
  for (const item of current.items) {
    const result = await commitStock({
      storeId:     fromStoreId,
      productCode: item.productCode,
      productName: item.productName,
      qty:         item.quantity,
      transferId,
      operatorId:  indicatedById,
    });
    if (!result.success) {
      throw new Error(`commitStock falhou para ${item.productCode}: ${result.error}`);
    }
  }

  return updated;
}
```

- [ ] **Step 4: Rodar test e ver passar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "indicateOrigin"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/transferencia.service.ts __tests__/services/transferencia-5-etapas.test.ts
git commit -m "feat(transfers): indicateOrigin (PENDING → AWAITING_APPROVAL)"
```

---

### Task 5: Função `approveTransfer` (AWAITING_APPROVAL → READY_TO_COLLECT)

**Files:**
- Modify: `services/transferencia.service.ts`
- Modify: `__tests__/services/transferencia-5-etapas.test.ts`

- [ ] **Step 1: Escrever test que falha**

```ts
describe("approveTransfer", () => {
  it("AWAITING_APPROVAL → READY_TO_COLLECT persiste TE no item único", async () => {
    // Setup: Transfer já em AWAITING_APPROVAL (usa indicateOrigin)
    const t = await setupTransferInAwaitingApproval(); // helper a criar
    const approverId = "user-067-leader";

    const updated = await approveTransfer(t.id, { teNumber: "TE-12345" }, approverId);

    expect(updated.status).toBe(TransferStatus.READY_TO_COLLECT);
    expect(updated.approvedAt).toBeInstanceOf(Date);
    expect(updated.approvedById).toBe(approverId);
    expect(updated.items[0].teNumber).toBe("TE-12345");
    expect(updated.items[0].nfCitelNumero).toBeNull();

    // qtdEmTransito incrementada no destino
    const dest = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: t.toStoreId, productCode: t.items[0].productCode } },
    });
    expect(dest.qtdEmTransito).toBeGreaterThanOrEqual(t.items[0].quantity);
  });

  it("com NF, dispara citelTakesOver (libera qtdComprometida)", async () => {
    const t = await setupTransferInAwaitingApproval();
    const before = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: t.fromStoreId!, productCode: t.items[0].productCode } },
    });
    const beforeComprometida = before.qtdComprometida;

    await approveTransfer(t.id, { nfCitelNumero: "000000099999" }, "user-id");

    const after = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: t.fromStoreId!, productCode: t.items[0].productCode } },
    });
    expect(after.qtdComprometida).toBeLessThan(beforeComprometida);
  });

  it("rejeita quando nenhum (ou ambos) TE/NF é informado", async () => {
    const t = await setupTransferInAwaitingApproval();
    await expect(approveTransfer(t.id, {}, "u")).rejects.toThrow(/TE ou NF/);
    await expect(approveTransfer(t.id, { teNumber: "X", nfCitelNumero: "Y" }, "u")).rejects.toThrow(/TE ou NF/);
  });
});

// Helper local
async function setupTransferInAwaitingApproval() {
  // Cria Transfer + indica origem (reusa indicateOrigin)
  const [t] = await createTransfer({ /* ... */ });
  return indicateOrigin(t.id, "store-067-id", "user-132");
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "approveTransfer"`
Expected: FAIL com "approveTransfer is not a function"

- [ ] **Step 3: Implementar `approveTransfer`**

```ts
// ──────────────────────────────────────────────
// approveTransfer — etapa 2 → 3
// Líder da loja origem digita TE OU NF. markInTransit no destino.
// Se NF: citelTakesOver libera qtdComprometida na origem.
// ──────────────────────────────────────────────
export async function approveTransfer(
  transferId: string,
  input: { teNumber?: string; nfCitelNumero?: string },
  approverId: string,
) {
  const hasTE = !!input.teNumber;
  const hasNF = !!input.nfCitelNumero;
  if (hasTE === hasNF) {
    throw new Error("Informe exatamente um documento: TE ou NF");
  }

  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true },
  });
  if (current.status !== TransferStatus.AWAITING_APPROVAL) {
    throw new Error(`Aprovação só é válida em AWAITING_APPROVAL (atual: ${current.status})`);
  }
  if (!current.fromStoreId) {
    throw new Error("Transfer sem fromStoreId — estado inconsistente");
  }
  if (current.items.length !== 1) {
    throw new Error(`Transfer deve ter 1 item (encontrados ${current.items.length})`);
  }
  const item = current.items[0];

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    // Atualiza item com TE ou NF
    await tx.transferItem.update({
      where: { id: item.id },
      data: {
        teNumber:         hasTE ? input.teNumber : null,
        nfCitelNumero:    hasNF ? input.nfCitelNumero : null,
        nfCitelEmitidaAt: hasNF ? now : null,
      },
    });
    // Atualiza Transfer
    const t = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status:           TransferStatus.READY_TO_COLLECT,
        approvedAt:       now,
        approvedById:     approverId,
        // mantém duplicado na Transfer pra compat (telas legadas)
        teNumber:         hasTE ? input.teNumber : undefined,
        nfCitelNumero:    hasNF ? input.nfCitelNumero : undefined,
        nfCitelEmitidaAt: hasNF ? now : undefined,
      },
      include: { items: true, fromStore: true, toStore: true },
    });
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus:  TransferStatus.AWAITING_APPROVAL,
        toStatus:    TransferStatus.READY_TO_COLLECT,
        changedById: approverId,
        notes:       hasTE ? `Aprovada com TE ${input.teNumber}` : `Aprovada com NF ${input.nfCitelNumero}`,
      },
    });
    return t;
  });

  // markInTransit no destino (qtdEmTransito ++)
  await markInTransit({
    toStoreId:   current.toStoreId,
    productCode: item.productCode,
    productName: item.productName,
    qty:         item.quantity,
    transferId,
  });

  // Se NF, citelTakesOver (libera qtdComprometida na origem)
  if (hasNF) {
    await citelTakesOver({
      storeId:     current.fromStoreId,
      productCode: item.productCode,
      qty:         item.quantity,
      transferId,
      operatorId:  approverId,
    });
  }

  return updated;
}
```

- [ ] **Step 4: Rodar test e ver passar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "approveTransfer"`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add services/transferencia.service.ts __tests__/services/transferencia-5-etapas.test.ts
git commit -m "feat(transfers): approveTransfer (AWAITING_APPROVAL → READY_TO_COLLECT)"
```

---

### Task 6: Função `rejectTransferAtOrigin` (AWAITING_APPROVAL → PENDING)

**Files:**
- Modify: `services/transferencia.service.ts`
- Modify: `__tests__/services/transferencia-5-etapas.test.ts`

- [ ] **Step 1: Escrever test que falha**

```ts
describe("rejectTransferAtOrigin", () => {
  it("AWAITING_APPROVAL → PENDING libera commitStock e limpa fromStoreId", async () => {
    const t = await setupTransferInAwaitingApproval();
    const fromStoreId = t.fromStoreId!;
    const before = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: fromStoreId, productCode: t.items[0].productCode } },
    });

    const updated = await rejectTransferAtOrigin(t.id, "Sem estoque físico real", "user-067");

    expect(updated.status).toBe(TransferStatus.PENDING);
    expect(updated.fromStoreId).toBeNull();
    expect(updated.originIndicatedAt).toBeNull();

    const after = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: fromStoreId, productCode: t.items[0].productCode } },
    });
    expect(after.qtdComprometida).toBeLessThan(before.qtdComprometida);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "rejectTransferAtOrigin"`
Expected: FAIL com "rejectTransferAtOrigin is not a function"

- [ ] **Step 3: Implementar**

```ts
// ──────────────────────────────────────────────
// rejectTransferAtOrigin — etapa 2 → 1
// Líder da origem recusa. Libera commitStock, volta para PENDING.
// ──────────────────────────────────────────────
export async function rejectTransferAtOrigin(
  transferId: string,
  reason: string,
  rejectedById: string,
) {
  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true },
  });
  if (current.status !== TransferStatus.AWAITING_APPROVAL) {
    throw new Error(`Rejeição só é válida em AWAITING_APPROVAL (atual: ${current.status})`);
  }
  if (!current.fromStoreId) {
    throw new Error("Transfer sem fromStoreId — estado inconsistente");
  }

  const previousFromStoreId = current.fromStoreId;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status:              TransferStatus.PENDING,
        fromStoreId:         null,
        originIndicatedAt:   null,
        originIndicatedById: null,
      },
      include: { items: true, toStore: true },
    });
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus:  TransferStatus.AWAITING_APPROVAL,
        toStatus:    TransferStatus.PENDING,
        changedById: rejectedById,
        notes:       `Recusada pela origem: ${reason}`,
      },
    });
    return t;
  });

  // Libera commitStock na origem que foi indicada
  for (const item of current.items) {
    await releaseStock({
      storeId:     previousFromStoreId,
      productCode: item.productCode,
      qty:         item.quantity,
      transferId,
      operatorId:  rejectedById,
    });
  }

  return updated;
}
```

- [ ] **Step 4: Rodar test e ver passar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "rejectTransferAtOrigin"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/transferencia.service.ts __tests__/services/transferencia-5-etapas.test.ts
git commit -m "feat(transfers): rejectTransferAtOrigin (AWAITING_APPROVAL → PENDING)"
```

---

### Task 7: Função `collectTransfer` (READY_TO_COLLECT → IN_TRANSIT)

**Files:**
- Modify: `services/transferencia.service.ts`
- Modify: `__tests__/services/transferencia-5-etapas.test.ts`

- [ ] **Step 1: Escrever test que falha**

```ts
describe("collectTransfer", () => {
  it("READY_TO_COLLECT → IN_TRANSIT marca item.collectConfirmed e salva foto", async () => {
    const t = await setupTransferInReadyToCollect();
    const updated = await collectTransfer(t.id, {
      photoUrl:  "https://supa.../coleta.jpg",
      photoPath: "transfers/x/coleta.jpg",
    }, "driver-1");

    expect(updated.status).toBe(TransferStatus.IN_TRANSIT);
    expect(updated.collectPhotoUrl).toBe("https://supa.../coleta.jpg");
    expect(updated.collectedAt).toBeInstanceOf(Date);

    const item = await prisma.transferItem.findFirstOrThrow({ where: { transferId: t.id } });
    expect(item.collectConfirmed).toBe(true);
    expect(item.collectedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "collectTransfer"`
Expected: FAIL com "collectTransfer is not a function"

- [ ] **Step 3: Implementar**

```ts
// ──────────────────────────────────────────────
// collectTransfer — etapa 3 → 4
// Motorista coleta na origem com foto. Marca item.collectConfirmed.
// ──────────────────────────────────────────────
export async function collectTransfer(
  transferId: string,
  input: { photoUrl: string; photoPath: string },
  driverId: string,
) {
  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true },
  });
  if (current.status !== TransferStatus.READY_TO_COLLECT) {
    throw new Error(`Coleta só é válida em READY_TO_COLLECT (atual: ${current.status})`);
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const t = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status:          TransferStatus.IN_TRANSIT,
        collectedAt:     now,
        collectPhotoUrl:  input.photoUrl,
        collectPhotoPath: input.photoPath,
      },
      include: { items: true, fromStore: true, toStore: true },
    });
    // Único item (auto-split garante)
    await tx.transferItem.update({
      where: { id: current.items[0].id },
      data:  { collectedAt: now, collectConfirmed: true },
    });
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus:  TransferStatus.READY_TO_COLLECT,
        toStatus:    TransferStatus.IN_TRANSIT,
        changedById: driverId,
        notes:       "Coletada pelo motorista",
      },
    });
    return t;
  });
}
```

- [ ] **Step 4: Rodar test e ver passar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "collectTransfer"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/transferencia.service.ts __tests__/services/transferencia-5-etapas.test.ts
git commit -m "feat(transfers): collectTransfer (READY_TO_COLLECT → IN_TRANSIT)"
```

---

### Task 8: Função `deliverTransfer` (IN_TRANSIT → DELIVERED)

**Files:**
- Modify: `services/transferencia.service.ts`
- Modify: `__tests__/services/transferencia-5-etapas.test.ts`

- [ ] **Step 1: Escrever test que falha**

```ts
describe("deliverTransfer", () => {
  it("IN_TRANSIT → DELIVERED reconcilia ledger e dispara handleTransferDeliveredOnRequest", async () => {
    const t = await setupTransferInTransit({ deliveryRequestId: "dr-123" });

    const updated = await deliverTransfer(t.id, {
      photoUrl:      "https://.../entrega.jpg",
      photoPath:     "transfers/x/entrega.jpg",
      recipientName: "Maria Silva",
      receivedQty:   t.items[0].quantity,
    }, "driver-1");

    expect(updated.status).toBe(TransferStatus.DELIVERED);
    expect(updated.deliveredAt).toBeInstanceOf(Date);
    expect(updated.recipientName).toBe("Maria Silva");

    // qtdEmTransito decrementada no destino
    const dest = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: t.toStoreId, productCode: t.items[0].productCode } },
    });
    expect(dest.qtdEmTransito).toBe(0);

    // DR avançada (ou marker no histórico)
    const drHistory = await prisma.deliveryStatusHistory.findFirst({
      where: { deliveryRequestId: "dr-123" },
      orderBy: { createdAt: "desc" },
    });
    expect(drHistory?.metadata).toMatchObject({ event: "TRANSFER_DELIVERED" });
  });

  it("registra divergência se receivedQty < quantity", async () => {
    const t = await setupTransferInTransit();
    const updated = await deliverTransfer(t.id, {
      photoUrl:      "https://.../entrega.jpg",
      photoPath:     "p",
      recipientName: "X",
      receivedQty:   t.items[0].quantity - 1,
    }, "driver");

    expect(updated.hasDivergence).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "deliverTransfer"`
Expected: FAIL com "deliverTransfer is not a function"

- [ ] **Step 3: Implementar**

```ts
// ──────────────────────────────────────────────
// deliverTransfer — etapa 4 → 5
// Motorista entrega no destino. reconcileTransfer + cascata em DR.
// ──────────────────────────────────────────────
export async function deliverTransfer(
  transferId: string,
  input: {
    photoUrl: string;
    photoPath: string;
    recipientName: string;
    receivedQty: number;
  },
  driverId: string,
) {
  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true, deliveryRequest: true },
  });
  if (current.status !== TransferStatus.IN_TRANSIT) {
    throw new Error(`Entrega só é válida em IN_TRANSIT (atual: ${current.status})`);
  }
  if (current.items.length !== 1) {
    throw new Error(`Transfer deve ter 1 item (encontrados ${current.items.length})`);
  }
  const item = current.items[0];

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.transferItem.update({
      where: { id: item.id },
      data:  { receivedQty: input.receivedQty },
    });
    const t = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status:            TransferStatus.DELIVERED,
        deliveredAt:       now,
        deliveredById:     driverId,
        deliveryPhotoUrl:  input.photoUrl,
        deliveryPhotoPath: input.photoPath,
        recipientName:     input.recipientName,
        receivedAt:        now,  // legado, mantém pra compat
      },
      include: { items: true, fromStore: true, toStore: true },
    });
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus:  TransferStatus.IN_TRANSIT,
        toStatus:    TransferStatus.DELIVERED,
        changedById: driverId,
        notes:       `Entregue para ${input.recipientName}`,
      },
    });
    return t;
  });

  // Reconcilia ledger (baixa qtdEmTransito + cria divergence se receivedQty < sentQty)
  const { hasDivergence, divergences } = await reconcileTransfer({
    transferId,
    sendingStoreId:   current.fromStoreId!,
    receivingStoreId: current.toStoreId,
    operatorId:       driverId,
    items: [{
      transferItemId: item.id,
      productCode:    item.productCode,
      productName:    item.productName,
      sentQty:        item.sentQty ?? item.quantity,
      receivedQty:    input.receivedQty,
    }],
  });

  if (hasDivergence) {
    await prisma.transfer.update({
      where: { id: transferId },
      data:  { hasDivergence: true, divergenceCount: divergences.length },
    });
  }

  // Cascata na DR vinculada
  if (current.deliveryRequestId) {
    await handleTransferDeliveredOnRequest(transferId, current.deliveryRequestId);
  }

  return { ...updated, hasDivergence };
}
```

- [ ] **Step 4: Renomear `handleTransferReceivedOnRequest` para `handleTransferDeliveredOnRequest`**

Localizar a função em `services/transferencia.service.ts:~360` e:
1. Renomear assinatura e todos os call sites no arquivo.
2. Trocar o filtro interno `t.status === TransferStatus.RECEIVED` para `t.status === TransferStatus.DELIVERED`.
3. Trocar a string `event: "TRANSFER_RECEIVED"` no metadata para `event: "TRANSFER_DELIVERED"`.
4. Mensagens de log/notes do tipo "Transferência recebida" viram "Transferência entregue".
5. Também atualizar o caller em `updateTransferStatus` (linha ~339) — substituir `if (input.status === TransferStatus.RECEIVED && current.deliveryRequestId)` por `if (input.status === TransferStatus.DELIVERED && current.deliveryRequestId)`. A função `updateTransferStatus` antiga continua viva pra compat com legados, mas seu uso novo deve preferir as funções específicas (`deliverTransfer`, etc.).

- [ ] **Step 5: Rodar test e ver passar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "deliverTransfer"`
Expected: PASS (2 testes)

- [ ] **Step 6: Commit**

```bash
git add services/transferencia.service.ts __tests__/services/transferencia-5-etapas.test.ts
git commit -m "feat(transfers): deliverTransfer (IN_TRANSIT → DELIVERED) + rename handler"
```

---

### Task 9: Refator `cancelTransfer` (matriz por status)

**Files:**
- Modify: `services/transferencia.service.ts`
- Modify: `__tests__/services/transferencia-5-etapas.test.ts`

- [ ] **Step 1: Escrever tests da matriz**

```ts
describe("cancelTransfer", () => {
  it("PENDING: cancela sem mexer no ledger", async () => {
    const [t] = await createTransfer({ /* PENDING */ });
    const updated = await cancelTransfer(t.id, "teste", "u");
    expect(updated.status).toBe(TransferStatus.CANCELLED);
    // ledger não muda
  });

  it("AWAITING_APPROVAL: releaseStock na origem", async () => {
    const t = await setupTransferInAwaitingApproval();
    const before = await getComprometida(t.fromStoreId!, t.items[0].productCode);
    await cancelTransfer(t.id, "teste", "u");
    const after = await getComprometida(t.fromStoreId!, t.items[0].productCode);
    expect(after).toBeLessThan(before);
  });

  it("READY_TO_COLLECT com TE: releaseStock + cancelTransit", async () => { /* ... */ });
  it("READY_TO_COLLECT com NF: só cancelTransit (citel já liberou)", async () => { /* ... */ });
  it("IN_TRANSIT com TE: releaseStock + cancelTransit", async () => { /* ... */ });
  it("DELIVERED: rejeita (terminal)", async () => {
    const t = await setupTransferDelivered();
    await expect(cancelTransfer(t.id, "x", "u")).rejects.toThrow(/terminal/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "cancelTransfer"`
Expected: FAIL (cobre a função refatorada que ainda não existe)

- [ ] **Step 3: Implementar `cancelTransfer`**

Substituir o bloco antigo de cancelamento em `updateTransferStatus` por:

```ts
// ──────────────────────────────────────────────
// cancelTransfer — qualquer status não-terminal → CANCELLED
// Libera ledger conforme matriz:
//
// PENDING:           nada
// AWAITING_APPROVAL: releaseStock na origem
// READY_TO_COLLECT:  se TE: releaseStock + cancelTransit; se NF: só cancelTransit
// IN_TRANSIT:        se TE: releaseStock + cancelTransit; se NF: só cancelTransit
// DELIVERED:         erro (terminal)
// CANCELLED:         erro (já terminal)
// ──────────────────────────────────────────────
export async function cancelTransfer(
  transferId: string,
  reason: string,
  cancelledById: string,
) {
  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true },
  });

  if (current.status === TransferStatus.DELIVERED || current.status === TransferStatus.CANCELLED) {
    throw new Error(`Não é possível cancelar transfer em status terminal: ${current.status}`);
  }

  const hadCommit  = (
    [TransferStatus.AWAITING_APPROVAL, TransferStatus.READY_TO_COLLECT, TransferStatus.IN_TRANSIT] as TransferStatus[]
  ).includes(current.status);

  const hadTransit = (
    [TransferStatus.READY_TO_COLLECT, TransferStatus.IN_TRANSIT] as TransferStatus[]
  ).includes(current.status);

  // Verifica se algum item teve NF emitida (Citel já controla — não libera ledger)
  const anyItemHasNf = current.items.some((i) => !!i.nfCitelNumero);

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status:      TransferStatus.CANCELLED,
        cancelledAt: new Date(),
      },
      include: { items: true, fromStore: true, toStore: true },
    });
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus:  current.status,
        toStatus:    TransferStatus.CANCELLED,
        changedById: cancelledById,
        notes:       reason,
      },
    });
    return t;
  });

  // Side effects no ledger
  if (hadCommit && !anyItemHasNf && current.fromStoreId) {
    for (const item of current.items) {
      await releaseStock({
        storeId:     current.fromStoreId,
        productCode: item.productCode,
        qty:         item.quantity,
        transferId,
        operatorId:  cancelledById,
      });
    }
  }

  if (hadTransit) {
    for (const item of current.items) {
      await cancelTransit({
        toStoreId:   current.toStoreId,
        productCode: item.productCode,
        qty:         item.quantity,
        transferId,
        operatorId:  cancelledById,
      });
    }
  }

  return updated;
}
```

- [ ] **Step 4: Rodar tests e ver passar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "cancelTransfer"`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add services/transferencia.service.ts __tests__/services/transferencia-5-etapas.test.ts
git commit -m "feat(transfers): cancelTransfer com matriz de ledger por status"
```

---

### Task 10: Refator `createTransfer` (auto-split) + atualizar VALID_TRANSITIONS

**Files:**
- Modify: `services/transferencia.service.ts`
- Modify: `__tests__/services/transferencia-5-etapas.test.ts`

- [ ] **Step 1: Escrever test que falha**

```ts
describe("createTransfer (auto-split)", () => {
  it("input com 3 items → cria 3 Transfers separadas, todas PENDING, fromStoreId=null", async () => {
    const transfers = await createTransfer({
      toStoreId: "store-132-id",
      priority:  TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [
        { productCode: "A", productName: "A", quantity: 1, unit: "UN" },
        { productCode: "B", productName: "B", quantity: 2, unit: "UN" },
        { productCode: "C", productName: "C", quantity: 3, unit: "UN" },
      ],
    });

    expect(transfers).toHaveLength(3);
    for (const t of transfers) {
      expect(t.status).toBe(TransferStatus.PENDING);
      expect(t.fromStoreId).toBeNull();
      expect(t.items).toHaveLength(1);
    }
    expect(transfers.map(t => t.items[0].productCode).sort()).toEqual(["A","B","C"]);
  });

  it("NÃO comita estoque na criação (fromStoreId ainda desconhecido)", async () => {
    const productCode = "TEST-NOCOMMIT";
    const before = await prisma.stockLedgerEntry.count({
      where: { type: "COMMIT", notes: { contains: productCode } },
    });

    await createTransfer({
      toStoreId: "store-132-id",
      priority:  TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [{ productCode, productName: "x", quantity: 1, unit: "UN" }],
    });

    const after = await prisma.stockLedgerEntry.count({
      where: { type: "COMMIT", notes: { contains: productCode } },
    });
    expect(after).toBe(before); // sem nenhum COMMIT novo
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts -t "createTransfer"`
Expected: FAIL (cria 1 só ou comita estoque)

- [ ] **Step 3: Substituir `createTransfer` em `services/transferencia.service.ts`**

```ts
// ──────────────────────────────────────────────
// createTransfer — etapa 0 → 1
// Auto-split: N items → N Transfers (1 item cada). Sem commitStock
// (fromStoreId ainda nulo). Status PENDING.
// ──────────────────────────────────────────────
export async function createTransfer(input: CreateTransferInput): Promise<Transfer[]> {
  if (input.items.length === 0) {
    throw new Error("Informe ao menos um item");
  }

  const created: Transfer[] = [];

  for (const item of input.items) {
    const t = await prisma.$transaction(async (tx) => {
      const created = await tx.transfer.create({
        data: {
          deliveryRequestId: input.deliveryRequestId,
          fromStoreId:       null,                      // só preenchido em indicateOrigin
          toStoreId:         input.toStoreId,
          priority:          input.priority,
          status:            TransferStatus.PENDING,
          requestedById:     input.requestedById,
          notes:             input.notes,
          items: {
            create: [{
              productCode: item.productCode,
              productName: item.productName,
              quantity:    item.quantity,
              unit:        item.unit ?? "UN",
            }],
          },
        },
        include: { items: true, toStore: true },
      });
      await tx.transferHistory.create({
        data: {
          transferId:  created.id,
          toStatus:    TransferStatus.PENDING,
          changedById: input.requestedById,
          notes:       "Transferência criada (aguardando indicação de origem)",
        },
      });
      return created;
    });
    created.push(t);
  }

  return created;
}
```

> Atualize `CreateTransferInput` em `types/index.ts` para remover `fromStoreId` (que era obrigatório) — passou a ser implícito (não existe na criação).

- [ ] **Step 4: Atualizar `VALID_TRANSITIONS`** (linha ~600)

```ts
const VALID_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  PENDING:           [TransferStatus.AWAITING_APPROVAL, TransferStatus.CANCELLED],
  AWAITING_APPROVAL: [TransferStatus.READY_TO_COLLECT,  TransferStatus.CANCELLED, TransferStatus.PENDING],
  READY_TO_COLLECT:  [TransferStatus.IN_TRANSIT,        TransferStatus.CANCELLED],
  IN_TRANSIT:        [TransferStatus.DELIVERED,         TransferStatus.CANCELLED],
  DELIVERED:         [],
  CANCELLED:         [],
  APPROVED:          [], // legado
  PREPARING:         [], // legado
  PREPARED:          [], // legado
  RECEIVED:          [], // legado
};
```

- [ ] **Step 5: Rodar tests + tsc**

Run: `npx vitest run __tests__/services/transferencia-5-etapas.test.ts`
Expected: todos os testes PASS

Run: `npx tsc --noEmit`
Expected: erros podem aparecer em callers de `createTransfer` que esperam single Transfer ou passam `fromStoreId` — anote os locais (vão ser corrigidos nas tasks 17/18)

- [ ] **Step 6: Commit**

```bash
git add services/transferencia.service.ts types/index.ts __tests__/services/transferencia-5-etapas.test.ts
git commit -m "feat(transfers): createTransfer com auto-split N→N + VALID_TRANSITIONS"
```

---

## Fase C — APIs novas (Tasks 11-17)

> **Padrão de RBAC:** todas as rotas seguem o template:
> ```ts
> const session = await getSessionFromRequest(req);
> if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
> // ... checks específicos
> ```
> Permissões usam `PRIVILEGED_ROLES` de `lib/permissions.ts`.

### Task 11: Rota `POST /api/transferencias/[id]/indicate-origin`

**Files:**
- Create: `app/api/transferencias/[id]/indicate-origin/route.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { indicateOrigin } from "@/services/transferencia.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";

const schema = z.object({ fromStoreId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id } = await params;
    const transfer = await prisma.transfer.findUnique({
      where: { id },
      select: { toStoreId: true, status: true },
    });
    if (!transfer) return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });

    // Permissão: usuário da loja destino OU PRIVILEGED
    const isToStoreUser = (session as any).storeId === transfer.toStoreId;
    if (!isToStoreUser && !PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    const updated = await indicateOrigin(id, parsed.data.fromStoreId, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../indicate-origin]", error);
    const msg = error instanceof Error ? error.message : "Erro ao indicar origem";
    const status = /insuficiente|inválid/i.test(msg) ? 422 : 500;
    return NextResponse.json(apiError(msg), { status });
  }
}
```

- [ ] **Step 2: Verificar com tsc**

Run: `npx tsc --noEmit`
Expected: 0 erros nesse arquivo

- [ ] **Step 3: Commit**

```bash
git add app/api/transferencias/[id]/indicate-origin/route.ts
git commit -m "feat(transfers): rota POST .../indicate-origin"
```

---

### Task 12: Rota `POST /api/transferencias/[id]/approve`

**Files:**
- Create: `app/api/transferencias/[id]/approve/route.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { approveTransfer } from "@/services/transferencia.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";

const schema = z.object({
  teNumber:      z.string().min(1).optional(),
  nfCitelNumero: z.string().min(1).optional(),
}).refine(
  (v) => Boolean(v.teNumber) !== Boolean(v.nfCitelNumero),
  { message: "Informe exatamente um: teNumber OU nfCitelNumero" },
);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id } = await params;
    const transfer = await prisma.transfer.findUnique({
      where: { id },
      select: { fromStoreId: true, status: true },
    });
    if (!transfer) return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });

    const isFromStoreUser = (session as any).storeId === transfer.fromStoreId;
    if (!isFromStoreUser && !PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    const updated = await approveTransfer(id, parsed.data, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../approve]", error);
    const msg = error instanceof Error ? error.message : "Erro ao aprovar";
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar com tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/transferencias/[id]/approve/route.ts
git commit -m "feat(transfers): rota POST .../approve"
```

---

### Task 13: Rota `POST /api/transferencias/[id]/reject-at-origin`

**Files:**
- Create: `app/api/transferencias/[id]/reject-at-origin/route.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { rejectTransferAtOrigin } from "@/services/transferencia.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";

const schema = z.object({ reason: z.string().min(3) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id } = await params;
    const transfer = await prisma.transfer.findUnique({
      where: { id },
      select: { fromStoreId: true, status: true },
    });
    if (!transfer) return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });

    const isFromStoreUser = (session as any).storeId === transfer.fromStoreId;
    if (!isFromStoreUser && !PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    const updated = await rejectTransferAtOrigin(id, parsed.data.reason, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../reject-at-origin]", error);
    const msg = error instanceof Error ? error.message : "Erro ao recusar";
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar com tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/transferencias/[id]/reject-at-origin/route.ts
git commit -m "feat(transfers): rota POST .../reject-at-origin"
```

---

### Task 14: Rota `POST /api/transferencias/[id]/collect`

**Files:**
- Create: `app/api/transferencias/[id]/collect/route.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { collectTransfer } from "@/services/transferencia.service";

const schema = z.object({
  photoUrl:  z.string().url(),
  photoPath: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id } = await params;
    // Check: DRIVER atribuído ao dispatch da Transfer
    const transfer = await prisma.transfer.findUnique({
      where: { id },
      include: { dispatch: { select: { driverId: true } } },
    });
    if (!transfer) return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });

    const driverProfile = await prisma.driver.findFirst({
      where: { userId: session.userId },
      select: { id: true },
    });
    if (!driverProfile || transfer.dispatch?.driverId !== driverProfile.id) {
      return NextResponse.json(apiError("Não é o motorista atribuído", "FORBIDDEN"), { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    const updated = await collectTransfer(id, parsed.data, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../collect]", error);
    const msg = error instanceof Error ? error.message : "Erro ao registrar coleta";
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar com tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/transferencias/[id]/collect/route.ts
git commit -m "feat(transfers): rota POST .../collect (motorista)"
```

---

### Task 15: Rota `POST /api/transferencias/[id]/deliver`

**Files:**
- Create: `app/api/transferencias/[id]/deliver/route.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { deliverTransfer } from "@/services/transferencia.service";

const schema = z.object({
  photoUrl:      z.string().url(),
  photoPath:     z.string().min(1),
  recipientName: z.string().min(1),
  receivedQty:   z.number().positive(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id } = await params;
    const transfer = await prisma.transfer.findUnique({
      where: { id },
      include: { dispatch: { select: { driverId: true } } },
    });
    if (!transfer) return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });

    const driverProfile = await prisma.driver.findFirst({
      where: { userId: session.userId },
      select: { id: true },
    });
    if (!driverProfile || transfer.dispatch?.driverId !== driverProfile.id) {
      return NextResponse.json(apiError("Não é o motorista atribuído", "FORBIDDEN"), { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    const updated = await deliverTransfer(id, parsed.data, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../deliver]", error);
    const msg = error instanceof Error ? error.message : "Erro ao registrar entrega";
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar com tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/transferencias/[id]/deliver/route.ts
git commit -m "feat(transfers): rota POST .../deliver (motorista)"
```

---

### Task 16: Rota `POST /api/transferencias/[id]/cancel`

**Files:**
- Create: `app/api/transferencias/[id]/cancel/route.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { cancelTransfer } from "@/services/transferencia.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";

const schema = z.object({ reason: z.string().min(3) });

const ALLOWED_ROLES = [...PRIVILEGED_ROLES, "STORE_LEADER"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!ALLOWED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    const updated = await cancelTransfer(id, parsed.data.reason, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../cancel]", error);
    const msg = error instanceof Error ? error.message : "Erro ao cancelar";
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar com tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/transferencias/[id]/cancel/route.ts
git commit -m "feat(transfers): rota POST .../cancel"
```

---

### Task 17: Refator `POST /api/transferencias` (auto-split na entrada)

**Files:**
- Modify: `app/api/transferencias/route.ts`

- [ ] **Step 1: Substituir o handler POST**

Localizar `export async function POST(req: NextRequest)` no arquivo e substituir o conteúdo dentro do `try {}` por:

```ts
const session = await getSessionFromRequest(req);
if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

const body = await req.json();
const parsed = createSchema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json(
    apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
    { status: 400 },
  );
}

// fromStoreId não é mais aceito na criação — origem é definida só em indicate-origin
const transfers = await createTransfer({
  deliveryRequestId: parsed.data.deliveryRequestId,
  toStoreId:         parsed.data.toStoreId,
  priority:          parsed.data.priority,
  notes:             parsed.data.notes,
  items:             parsed.data.items,
  requestedById:     session.userId,
});

return NextResponse.json(apiSuccess({ transfers }), { status: 201 });
```

E ajustar o `createSchema` (no topo do arquivo) para:

```ts
const createSchema = z.object({
  deliveryRequestId: z.string().optional(),
  toStoreId: z.string(),
  priority: z.nativeEnum(TransferPriority),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      productCode: z.string(),
      productName: z.string(),
      quantity: z.number().positive(),
      unit: z.string().default("UN"),
    })
  ).min(1, "Informe ao menos um item"),
});
```

Remover o bloco `if (parsed.data.fromStoreId === parsed.data.toStoreId)` que validava origem != destino — não se aplica mais.

- [ ] **Step 2: Verificar com tsc**

Run: `npx tsc --noEmit`
Expected: arquivo compila

- [ ] **Step 3: Commit**

```bash
git add app/api/transferencias/route.ts
git commit -m "feat(transfers): POST /api/transferencias aceita N items (auto-split)"
```

---

## Fase D — Remoção do placeholder bug (Task 18)

### Task 18: Remover placeholder em `/api/solicitacoes`

**Files:**
- Modify: `app/api/solicitacoes/route.ts:357-426`

- [ ] **Step 1: Substituir o bloco de criação de Transfer placeholder**

Localizar (linha ~357):
```ts
const missingItems = itemsWithAvailability.filter((i) => !i.availableAtStore);
if (missingItems.length > 0 && !citelDown) {
  // ... (cria 1 Transfer com fromStoreId = toStoreId placeholder)
}
```

Substituir todo o bloco (linhas ~357 até ~426, mantendo a chamada de `notifyTransferCreated` no final) por:

```ts
const missingItems = itemsWithAvailability.filter((i) => !i.availableAtStore);
if (missingItems.length > 0 && !citelDown) {
  let transferIds: string[] = [];
  try {
    const priority = data.deliveryType === DeliveryType.URGENT
      ? TransferPriority.URGENT
      : TransferPriority.ANTICIPATED;

    // Auto-split: 1 Transfer por item faltante, todas PENDING, fromStoreId=null
    const transfers = await createTransfer({
      deliveryRequestId: deliveryRequest.id,
      toStoreId:         data.storeId,
      priority,
      requestedById:     session.userId,
      notes:             `Transferência automática para PD ${data.orderNumber}`,
      items: missingItems.map((i) => ({
        productCode: i.productCode,
        productName: i.productName,
        quantity:    i.quantity,
        unit:        i.unit,
      })),
    });
    transferIds = transfers.map((t) => t.id);

    // Auto-link Citel: para cada item, sugere PD candidato (hint para a etapa 1,
    // não indica origem automaticamente)
    await Promise.all(transfers.map(async (t) => {
      const item = t.items[0];
      try {
        const cands = await findAutoLinkCandidatesWithProbe(item.productCode, item.quantity);
        if (cands.length === 0) return;
        const best = cands[0];
        await prisma.transferItem.update({
          where: { id: item.id },
          data: {
            linkedCitelPD:        best.numeroDocumento,
            linkedCitelStoreCode: best.codigoEmpresa,
            linkedAt:             new Date(),
            linkedById:           session.userId,
          },
        });
      } catch (e) {
        console.warn(`[POST solicitacoes] auto-link falhou pra ${item.productCode}:`,
                     e instanceof Error ? e.message : e);
      }
    }));
  } catch (err) {
    console.warn(
      `[POST /api/solicitacoes] falha ao criar Transfers para PD ${data.orderNumber}: ` +
      (err instanceof Error ? err.message : String(err)),
    );
  }

  // Notifica Jhow + Jane (gatilho #1) — independente de Transfers terem sido criadas
  void notifyTransferCreated({
    /* mesmo payload de hoje, ajustar transferId(s) se a função aceita */
  });
}
```

- [ ] **Step 2: Adicionar import de `createTransfer` no topo do arquivo se ainda não tiver**

```ts
import { createTransfer } from "@/services/transferencia.service";
```

- [ ] **Step 3: Verificar com tsc**

Run: `npx tsc --noEmit`
Expected: 0 erros nesse arquivo

- [ ] **Step 4: Commit**

```bash
git add app/api/solicitacoes/route.ts
git commit -m "fix(solicitacoes): remove placeholder fromStore=toStore — usa createTransfer auto-split"
```

---

## Fase E — UI (Tasks 19-23)

### Task 19: Atualizar `lib/constants.ts` + `status-badge` para 5 etapas

**Files:**
- Modify: `lib/constants.ts:27-53`
- Modify: `components/ui/status-badge.tsx`

- [ ] **Step 1: Atualizar `TRANSFER_STATUS_LABELS` em `lib/constants.ts`**

Substituir o objeto (linha 27-35):

```ts
export const TRANSFER_STATUS_LABELS: Record<string, string> = {
  PENDING:           "Pendente",
  AWAITING_APPROVAL: "Aguard. aprovação",
  READY_TO_COLLECT:  "Pronta p/ coleta",
  IN_TRANSIT:        "Em rota",
  DELIVERED:         "Entregue",
  CANCELLED:         "Cancelada",
  // legados
  APPROVED:          "Aprovada (legado)",
  PREPARING:         "Em preparação (legado)",
  PREPARED:          "Separada (legado)",
  RECEIVED:          "Recebida (legado)",
};
```

- [ ] **Step 2: Atualizar `TRANSFER_STATUS_COLORS` (linha 45-53)**

```ts
export const TRANSFER_STATUS_COLORS: Record<string, string> = {
  PENDING:           "bg-yellow-100 text-yellow-800 border-yellow-200",
  AWAITING_APPROVAL: "bg-amber-100 text-amber-900 border-amber-200",
  READY_TO_COLLECT:  "bg-teal-100 text-teal-800 border-teal-200",
  IN_TRANSIT:        "bg-orange-100 text-orange-800 border-orange-200",
  DELIVERED:         "bg-green-100 text-green-800 border-green-200",
  CANCELLED:         "bg-gray-100 text-gray-600 border-gray-200",
  // legados
  APPROVED:          "bg-blue-100 text-blue-800 border-blue-200",
  PREPARING:         "bg-purple-100 text-purple-800 border-purple-200",
  PREPARED:          "bg-teal-100 text-teal-800 border-teal-200",
  RECEIVED:          "bg-green-100 text-green-800 border-green-200",
};
```

- [ ] **Step 3: Atualizar `components/ui/status-badge.tsx`**

Procurar o switch/map de transferStatus no arquivo e garantir que os 3 novos valores são reconhecidos (devem cair automaticamente nos labels/colors acima). Se há um type union literal, adicionar:

```ts
| "AWAITING_APPROVAL"
| "READY_TO_COLLECT"
| "DELIVERED"
```

- [ ] **Step 4: Commit**

```bash
git add lib/constants.ts components/ui/status-badge.tsx
git commit -m "feat(transfers): labels + cores dos 3 novos status"
```

---

### Task 20: Atualizar `components/transferencias/transfer-actions.tsx`

**Files:**
- Modify: `components/transferencias/transfer-actions.tsx`

- [ ] **Step 1: Substituir `NEXT_ACTIONS` (ou estrutura equivalente)**

Procurar a const que mapeia status → próxima ação e substituir por:

```ts
const NEXT_ACTIONS: Record<string, { label: string; endpoint: string; needsForm?: string }> = {
  PENDING:           { label: "Indicar loja origem",   endpoint: "indicate-origin",   needsForm: "indicate-origin" },
  AWAITING_APPROVAL: { label: "Aprovar com TE/NF",     endpoint: "approve",           needsForm: "approve" },
  READY_TO_COLLECT:  { label: "(aguarda motorista)",   endpoint: "",                  /* sem ação manual */ },
  IN_TRANSIT:        { label: "(em movimento)",        endpoint: "",                  /* sem ação manual */ },
  DELIVERED:         { label: "Ver detalhes",          endpoint: "",                  /* só link */ },
  CANCELLED:         { label: "(cancelada)",           endpoint: "",                  /* só leitura */ },
};
```

Adicionar lógica que renderiza os dialogs `IndicateOriginDialog` e `ApproveDialog` (criados nas tasks 20a e 20b abaixo) quando `needsForm` for definido.

- [ ] **Step 2: Criar `app/(app)/transferencias/_components/indicate-origin-dialog.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  transferId:   string;
  toStoreCode:  string;
  candidateStores: { id: string; code: string; name: string; stockHint?: number }[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}

export function IndicateOriginDialog({ transferId, toStoreCode, candidateStores, open, onOpenChange, onDone }: Props) {
  const [fromStoreId, setFromStoreId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/transferencias/${transferId}/indicate-origin`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fromStoreId }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Falha");
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Indicar loja origem para {toStoreCode}</DialogTitle>
        </DialogHeader>
        <Select value={fromStoreId} onValueChange={setFromStoreId}>
          <SelectTrigger><SelectValue placeholder="Escolha a loja" /></SelectTrigger>
          <SelectContent>
            {candidateStores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.code} — {s.name}{s.stockHint != null ? ` (estoque ${s.stockHint})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!fromStoreId || submitting}>
            {submitting ? "Indicando..." : "Indicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Criar `app/(app)/transferencias/_components/approve-dialog.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface Props {
  transferId: string;
  productName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}

export function ApproveDialog({ transferId, productName, open, onOpenChange, onDone }: Props) {
  const [docType, setDocType] = useState<"TE" | "NF">("TE");
  const [docNumber, setDocNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const body = docType === "TE" ? { teNumber: docNumber } : { nfCitelNumero: docNumber };
      const res = await fetch(`/api/transferencias/${transferId}/approve`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Falha");
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aprovar transferência — {productName}</DialogTitle>
        </DialogHeader>
        <RadioGroup value={docType} onValueChange={(v) => setDocType(v as "TE" | "NF")}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="TE" id="te" />
            <Label htmlFor="te">TE (não fiscal)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="NF" id="nf" />
            <Label htmlFor="nf">NF (fiscal)</Label>
          </div>
        </RadioGroup>
        <Input
          placeholder={docType === "TE" ? "Número da TE" : "Número da NF"}
          value={docNumber}
          onChange={(e) => setDocNumber(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!docNumber || submitting}>
            {submitting ? "Aprovando..." : "Aprovar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verificar com tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add components/transferencias/transfer-actions.tsx app/\(app\)/transferencias/_components/indicate-origin-dialog.tsx app/\(app\)/transferencias/_components/approve-dialog.tsx
git commit -m "feat(transfers): dialogs de indicate-origin e approve + NEXT_ACTIONS atualizado"
```

---

### Task 21: Refator `app/(app)/transferencias/page.tsx` (6 abas)

**Files:**
- Modify: `app/(app)/transferencias/page.tsx`
- Modify: `app/(app)/transferencias/_components/transferencias-filters.tsx`

- [ ] **Step 1: Atualizar a lista de views/abas em `transferencias-filters.tsx`**

Substituir o array de tabs por:

```ts
const TABS = [
  { value: "pendente",            label: "Pendente",          statuses: [TransferStatus.PENDING] },
  { value: "aguard-aprovacao",    label: "Aguard. aprovação", statuses: [TransferStatus.AWAITING_APPROVAL] },
  { value: "para-coletar",        label: "Para coletar",      statuses: [TransferStatus.READY_TO_COLLECT] },
  { value: "em-rota",             label: "Em rota",           statuses: [TransferStatus.IN_TRANSIT] },
  { value: "entregues",           label: "Entregues",         statuses: [TransferStatus.DELIVERED] },
  { value: "canceladas",          label: "Canceladas",        statuses: [TransferStatus.CANCELLED] },
] as const;
```

- [ ] **Step 2: Atualizar `app/(app)/transferencias/page.tsx`**

Na função que mapeia `view` → `statuses` para passar ao `listTransfers`, substituir o switch por:

```ts
const VIEW_TO_STATUSES: Record<string, TransferStatus[]> = {
  "pendente":            [TransferStatus.PENDING],
  "aguard-aprovacao":    [TransferStatus.AWAITING_APPROVAL],
  "para-coletar":        [TransferStatus.READY_TO_COLLECT, TransferStatus.APPROVED, TransferStatus.PREPARING, TransferStatus.PREPARED],
  "em-rota":             [TransferStatus.IN_TRANSIT],
  "entregues":           [TransferStatus.DELIVERED, TransferStatus.RECEIVED],
  "canceladas":          [TransferStatus.CANCELLED],
};
```

Note que `para-coletar` inclui os legados (APPROVED/PREPARING/PREPARED) e `entregues` inclui RECEIVED — pra cobrir transfers que ficaram nesses estados antes da migration ser aplicada.

> Após a migration, esses legados são vazios — mas a UI continua robusta.

- [ ] **Step 3: Atualizar os cards renderizados** para mostrar `fromStore` condicionalmente:

```tsx
{transfer.fromStoreId ? (
  <>
    <StoreBadge code={transfer.fromStore.code} />
    <ArrowLeftRight className="h-4 w-4" />
    <StoreBadge code={transfer.toStore.code} />
  </>
) : (
  <>
    <span className="text-muted-foreground">🏪 {transfer.toStore.code} precisa</span>
  </>
)}
```

- [ ] **Step 4: Verificar com tsc + build local rápido**

Run: `npx tsc --noEmit`
Expected: 0 erros

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/transferencias/page.tsx app/\(app\)/transferencias/_components/transferencias-filters.tsx
git commit -m "feat(transfers): 6 abas + card condicional para PENDING"
```

---

### Task 22: Atualizar timeline em `app/(app)/transferencias/[id]/page.tsx`

**Files:**
- Modify: `app/(app)/transferencias/[id]/page.tsx`

- [ ] **Step 1: Atualizar TIMELINE_CONFIG**

Substituir o objeto por:

```ts
const TIMELINE_CONFIG: Record<TransferStatus, { label: string; icon: string; description: (t: any) => string }> = {
  PENDING: {
    label: "Solicitada",
    icon:  "FileText",
    description: (t) => `Loja ${t.toStore.code} precisa do material`,
  },
  AWAITING_APPROVAL: {
    label: "Aguardando aprovação",
    icon:  "Clock",
    description: (t) => `Origem indicada: ${t.fromStore?.code ?? "?"}`,
  },
  READY_TO_COLLECT: {
    label: "Pronta para coleta",
    icon:  "PackageCheck",
    description: (t) => {
      const item = t.items[0];
      return item.teNumber ? `TE ${item.teNumber}` : item.nfCitelNumero ? `NF ${item.nfCitelNumero}` : "Aprovada";
    },
  },
  IN_TRANSIT: {
    label: "Em rota",
    icon:  "Truck",
    description: (t) => `Coletada às ${t.collectedAt?.toLocaleTimeString("pt-BR") ?? "?"}`,
  },
  DELIVERED: {
    label: "Entregue",
    icon:  "CheckCircle",
    description: (t) => `Recebido por ${t.recipientName ?? "?"}`,
  },
  CANCELLED: {
    label: "Cancelada",
    icon:  "XCircle",
    description: () => "",
  },
  // legados — mostram só pra histórico
  APPROVED:   { label: "Aprovada (legado)",     icon: "Check",     description: () => "" },
  PREPARING:  { label: "Em preparação (legado)", icon: "Package",  description: () => "" },
  PREPARED:   { label: "Separada (legado)",      icon: "Package",  description: () => "" },
  RECEIVED:   { label: "Recebida (legado)",      icon: "Check",    description: () => "" },
};

const ORDER: TransferStatus[] = [
  TransferStatus.PENDING,
  TransferStatus.AWAITING_APPROVAL,
  TransferStatus.READY_TO_COLLECT,
  TransferStatus.IN_TRANSIT,
  TransferStatus.DELIVERED,
];
```

- [ ] **Step 2: Atualizar a seção de fotos para mostrar coleta E entrega lado-a-lado**

```tsx
{(transfer.collectPhotoUrl || transfer.deliveryPhotoUrl) && (
  <div className="grid grid-cols-2 gap-4 mt-4">
    {transfer.collectPhotoUrl && (
      <div>
        <h4 className="text-sm font-medium mb-1">📸 Coleta</h4>
        <img src={transfer.collectPhotoUrl} alt="Coleta" className="rounded border" />
        <p className="text-xs text-muted-foreground mt-1">
          {transfer.collectedAt?.toLocaleString("pt-BR")}
        </p>
      </div>
    )}
    {transfer.deliveryPhotoUrl && (
      <div>
        <h4 className="text-sm font-medium mb-1">📸 Entrega</h4>
        <img src={transfer.deliveryPhotoUrl} alt="Entrega" className="rounded border" />
        <p className="text-xs text-muted-foreground mt-1">
          {transfer.deliveredAt?.toLocaleString("pt-BR")}
          {transfer.recipientName && ` — ${transfer.recipientName}`}
        </p>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Verificar com tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/transferencias/\[id\]/page.tsx
git commit -m "feat(transfers): timeline e fotos com 5 etapas no detalhe"
```

---

### Task 23: App do motorista — cards de Transfer com Coletar/Entregar

**Files:**
- Explorar: `app/motorista/...` (estrutura)
- Modify: arquivo do manifest do motorista (provavelmente `app/motorista/rotas/[id]/page.tsx` ou similar)
- Possivelmente criar: `app/motorista/_components/transfer-card-driver.tsx`

- [ ] **Step 1: Explorar a estrutura atual do app motorista**

Run: `ls app/motorista/`
Listar os arquivos e identificar:
1. Onde os deliveries da rota são listados (manifest do motorista)
2. Onde estão as ações de coleta/entrega de DeliveryRequest atuais

Daí inferir onde inserir os cards de Transfer.

- [ ] **Step 2: Criar componente `app/motorista/_components/transfer-card-driver.tsx`**

Estrutura:
- Botão **Coletar** abre um dialog com câmera (reusar lib/image-compress.ts) + upload pro Supabase Storage (bucket `delivery-proofs` ou subpasta `transfers/`)
- Botão **Entregar** abre dialog com câmera + input de nome do recebedor + input numérico de qty recebida

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CollectTransferDialog } from "./collect-transfer-dialog";
import { DeliverTransferDialog } from "./deliver-transfer-dialog";

interface Props {
  transfer: {
    id: string;
    status: string;
    fromStore: { code: string };
    toStore:   { code: string };
    items: { productCode: string; productName: string; quantity: number; teNumber?: string | null; nfCitelNumero?: string | null }[];
  };
  onDone: () => void;
}

export function TransferCardDriver({ transfer, onDone }: Props) {
  const [openCollect, setOpenCollect] = useState(false);
  const [openDeliver, setOpenDeliver] = useState(false);
  const item = transfer.items[0];

  return (
    <div className="border rounded p-3 bg-white">
      <div className="flex justify-between items-center">
        <span className="font-medium">{transfer.fromStore.code} → {transfer.toStore.code}</span>
        <span className="text-xs text-muted-foreground">
          {item.teNumber ? `TE ${item.teNumber}` : `NF ${item.nfCitelNumero ?? "?"}`}
        </span>
      </div>
      <p className="text-sm mt-1">{item.quantity}× {item.productName}</p>

      <div className="flex gap-2 mt-3">
        {transfer.status === "READY_TO_COLLECT" && (
          <Button size="sm" onClick={() => setOpenCollect(true)}>Coletar</Button>
        )}
        {transfer.status === "IN_TRANSIT" && (
          <Button size="sm" onClick={() => setOpenDeliver(true)}>Entregar</Button>
        )}
      </div>

      <CollectTransferDialog
        transferId={transfer.id}
        open={openCollect}
        onOpenChange={setOpenCollect}
        onDone={onDone}
      />
      <DeliverTransferDialog
        transferId={transfer.id}
        defaultQty={item.quantity}
        open={openDeliver}
        onOpenChange={setOpenDeliver}
        onDone={onDone}
      />
    </div>
  );
}
```

- [ ] **Step 3: Criar `CollectTransferDialog` e `DeliverTransferDialog`**

Seguir o padrão dos dialogs existentes que fazem upload pra `delivery-proofs` (busca-se um na codebase: `grep -r "delivery-proofs" app/motorista/`). Copia a estrutura e adapta:

`CollectTransferDialog`: upload de foto → chama `POST /api/transferencias/[id]/collect` com `{ photoUrl, photoPath }`.

`DeliverTransferDialog`: upload de foto + input recipient + input receivedQty → chama `POST /api/transferencias/[id]/deliver` com `{ photoUrl, photoPath, recipientName, receivedQty }`.

- [ ] **Step 4: Integrar no manifest do motorista**

No arquivo principal do manifest (identificado no Step 1), adicionar uma seção "Transferências" que lista as Transfers cujo `dispatch.driverId === driverDoMotorista`, em status READY_TO_COLLECT ou IN_TRANSIT, renderizando `<TransferCardDriver>` para cada.

- [ ] **Step 5: Verificar com tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add app/motorista/
git commit -m "feat(transfers): app motorista com cards Coletar e Entregar"
```

---

## Fase F — Validação, migration aplicada, deploy (Tasks 24-26)

### Task 24: Atualizar tests existentes

**Files:**
- Modify: `__tests__/services/pilar1-stock-lock.test.ts`
- Modify: `__tests__/e2e/pilar1-staging.e2e.test.ts`

- [ ] **Step 1: Em `pilar1-stock-lock.test.ts`, ajustar testes que esperam commitStock no createTransfer**

Procurar testes que verificam `qtdComprometida` aumentou após `createTransfer`. Reformular para:
1. Chamar `createTransfer` → verificar que ledger NÃO mudou
2. Chamar `indicateOrigin` → verificar que ledger mudou

```ts
it("indicateOrigin (não createTransfer) faz o commit", async () => {
  const [t] = await createTransfer({ /* ... */ });
  const before = await getComprometida(/* ... */);
  await indicateOrigin(t.id, "store-067", "user-1");
  const after = await getComprometida(/* ... */);
  expect(after).toBeGreaterThan(before);
});
```

- [ ] **Step 2: Em `pilar1-staging.e2e.test.ts`, atualizar fluxo E2E**

Substituir o trecho que faz:
```ts
const t = await createTransfer({ fromStoreId, toStoreId, ... });
await updateTransferStatus(t.id, { status: APPROVED, ... });
await updateTransferStatus(t.id, { status: IN_TRANSIT, ... });
await updateTransferStatus(t.id, { status: RECEIVED, ... });
```
por:
```ts
const [t] = await createTransfer({ toStoreId, items: [...], requestedById });
await indicateOrigin(t.id, fromStoreId, requestedById);
await approveTransfer(t.id, { teNumber: "TE-X" }, fromUserId);
await collectTransfer(t.id, { photoUrl: "x", photoPath: "y" }, driverId);
await deliverTransfer(t.id, { photoUrl: "x", photoPath: "y", recipientName: "X", receivedQty: 1 }, driverId);
```

- [ ] **Step 3: Rodar suite completa**

Run: `npx vitest run`
Expected: todos os testes passam

- [ ] **Step 4: Rodar tsc final**

Run: `npx tsc --noEmit`
Expected: 0 erros

- [ ] **Step 5: Commit**

```bash
git add __tests__/
git commit -m "test(transfers): atualiza pilar1 e E2E para fluxo 5 etapas"
```

---

### Task 25: Greptar referências aos status antigos

**Files:**
- Read-only varredura + correções pontuais

- [ ] **Step 1: Greptar `TransferStatus.RECEIVED` em todo o código**

```bash
grep -rn "TransferStatus.RECEIVED" --include='*.ts' --include='*.tsx' app/ services/ components/ lib/
```

Para cada hit:
- Se for em código de UI de listagem (ex: `entregues`), substituir por `DELIVERED` mantendo `RECEIVED` no array (compat com transfers antigas).
- Se for em lógica de negócio nova, trocar por `DELIVERED`.

- [ ] **Step 2: Greptar `TransferStatus.APPROVED`, `.PREPARING`, `.PREPARED`**

```bash
grep -rn "TransferStatus\.\(APPROVED\|PREPARING\|PREPARED\)" --include='*.ts' --include='*.tsx' app/ services/ components/ lib/
```

Cada hit deve ser analisado: se é caminho ativo, trocar por `READY_TO_COLLECT`; se é só leitura/histórico, manter.

- [ ] **Step 3: Greptar `transfer.teNumber` e `transfer.nfCitelNumero`** (acesso direto)

```bash
grep -rn "transfer\.\(teNumber\|nfCitelNumero\)" --include='*.tsx' app/ components/
```

Trocar por `transfer.items[0].teNumber` / `transfer.items[0].nfCitelNumero` em componentes novos, mantendo o acesso direto em rotas de compat se necessário.

- [ ] **Step 4: Rodar tsc + tests novamente**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tudo passa

- [ ] **Step 5: Commit (se houver mudanças)**

```bash
git add -A  # apenas se mudanças foram só nesses paths
git commit -m "refactor(transfers): atualiza referências aos status antigos"
```

---

### Task 26: Aplicar migration + push para deploy

**Files:**
- Execução no banco + git push

- [ ] **Step 1: Dry-run final**

Run: `node scripts/apply-migration-5-etapas.mjs`
Expected: lista 8 seções

- [ ] **Step 2: Aplicar no Supabase**

Run: `node scripts/apply-migration-5-etapas.mjs --execute`
Expected: "✓ Migration aplicada com sucesso" + verificações OK

- [ ] **Step 3: Validar manualmente no Supabase**

```sql
-- Cole no SQL editor do Supabase pra confirmar:
SELECT unnest(enum_range(NULL::"TransferStatus"));
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'transfers' AND column_name LIKE 'delivery%' OR column_name LIKE 'originIndic%';
SELECT conname FROM pg_constraint WHERE conname = 'transfer_origin_required';
```

- [ ] **Step 4: Confirmar git status limpo**

Run: `git status`
Expected: nothing to commit

- [ ] **Step 5: Push para main**

Run: `git push origin main`
Expected: Vercel deploy disparado automaticamente

- [ ] **Step 6: Smoke test em produção** (manual)

1. Abrir `/transferencias` — vê 6 abas, transfers antigas em "Para coletar" (legados) ou "Entregues" (RECEIVED migrado)
2. Criar uma solicitação com item faltando — gera Transfer em PENDING com `fromStoreId=null` e badge "🏪 X precisa"
3. Como vendedor da loja destino, clicar "Indicar loja origem" — escolher loja → status muda pra AWAITING_APPROVAL
4. Como líder da origem (login diferente), aprovar com TE → status muda pra READY_TO_COLLECT
5. Adicionar à wave, despachar, app motorista, coleta, entrega — verificar timeline completa

- [ ] **Step 7: Sucesso? Atualizar memória do projeto**

Criar/atualizar memory `project_transferencia_5_etapas.md` documentando o que foi deployado, datas, e qualquer ajuste pós-deploy.

---

## Apêndice: Padrões do projeto

- **Sem prisma migrate dev.** Use sempre script `apply-migration-*.mjs` (DIRECT_URL via pg client). Ver [[feedback_dev_workflow_logistica]].
- **Deploy automático no push main.** Não roda build local. Ver [[feedback_deploy_sem_build_local]].
- **Vercel region gru1 obrigatório.** Não tocar `vercel.json`.
- **TE/NF não tem unique constraint** no banco — Autcom permite reuso. Validação só no service.
- **Paginação Spoke/Circuit** limitada a 10 por página. Ver [[reference_circuit_paginacao]].
