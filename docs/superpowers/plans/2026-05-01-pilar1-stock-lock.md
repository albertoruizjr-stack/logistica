# Pilar 1 — Estoque Comprometido (Stock Lock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar controle de estoque comprometido no sistema_logistica para que nenhuma transferência possa ser criada sem validar e travar o estoque físico na loja de origem, e expor esses dados para o sistema_compras via API.

**Architecture:** Adicionamos um `StockLedger` (razão de estoque) por `(store, productCode)` que mantém `qtdFisica`, `qtdComprometida` e `qtdEmTransito` como colunas persistidas. Toda criação/cancelamento/recebimento de transferência passa por este ledger em transação atômica. O lock usa `UPDATE ... WHERE qtd_fisica - qtd_comprometida >= qty RETURNING *` — o Postgres garante atomicidade sem locks explícitos. O divergência de recebimento bloqueia o avanço automático de status e abre um processo de reconciliação.

**Tech Stack:** TypeScript, Next.js 14, Prisma, PostgreSQL, Jest (testes)

---

## Mapa de Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `prisma/schema.prisma` | Modificar | Adicionar `StockLedger`, `StockLedgerEntry`, `TransferDivergence`; atualizar `TransferStatus`, `Transfer`, `TransferItem` |
| `types/stock.ts` | Criar | Tipos TypeScript para ledger e operações de estoque |
| `services/stock-ledger.service.ts` | Criar | Todas as operações atômicas no ledger (commit, release, reconcile, sync) |
| `services/transferencia.service.ts` | Modificar | Integrar validação + lock na criação; release no cancelamento; reconciliação no recebimento |
| `app/api/estoque/snapshot/route.ts` | Criar | Endpoint GET que expõe estoque comprometido como JSON/CSV para sistema_compras |
| `__tests__/stock-ledger.test.ts` | Criar | Testes de unidade do ledger (mock Prisma) |
| `__tests__/transferencia-stock.test.ts` | Criar | Testes de integração do fluxo de transferência com stock lock |

---

## Task 1: Schema — StockLedger e TransferDivergence

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Adicionar enums e modelos ao schema**

Abrir `prisma/schema.prisma` e adicionar APÓS o enum `RouteSource` existente:

```prisma
enum StockLedgerEntryType {
  SYNC_ERP        // sincronização inicial ou periódica do ERP
  COMMIT          // estoque comprometido ao criar/aprovar transfer saindo
  RELEASE         // commit desfeito ao cancelar transfer
  TRANSIT_IN      // transfer entrando nesta loja (em trânsito)
  TRANSIT_CANCEL  // transfer de entrada cancelada
  RECONCILE_SEND  // baixa física ao despachar (PREPARING → IN_TRANSIT)
  RECONCILE_RECV  // entrada física ao receber (IN_TRANSIT → RECEIVED)
  DIVERGENCE_ADJ  // ajuste após reconciliação de divergência
  MANUAL          // ajuste manual com justificativa
}

enum DivergenceStatus {
  PENDING    // divergência registrada, aguardando resolução
  RESOLVED   // resolvida — estoque ajustado e justificado
  VOIDED     // anulada (erro de registro)
}
```

Ainda em `prisma/schema.prisma`, adicionar APÓS o modelo `SystemConfig` existente:

```prisma
// ──────────────────────────────────────────────
// RAZÃO DE ESTOQUE (STOCK LEDGER)
// Mantém qtdFisica, qtdComprometida e qtdEmTransito
// por loja + produto. Atualizado transacionalmente
// a cada evento de transferência.
// ──────────────────────────────────────────────

model StockLedger {
  id              String   @id @default(cuid())
  storeId         String
  productCode     String
  productName     String
  qtdFisica       Float    @default(0)  // estoque físico (sincronizado do ERP)
  qtdComprometida Float    @default(0)  // saídas aprovadas ainda não despachadas
  qtdEmTransito   Float    @default(0)  // entradas a caminho desta loja
  version         Int      @default(0)  // controle de concorrência otimista
  syncedAt        DateTime?             // última vez que qtdFisica foi sincronizado do ERP
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  store   Store              @relation(fields: [storeId], references: [id])
  entries StockLedgerEntry[]
  divergences TransferDivergence[]

  @@unique([storeId, productCode])
  @@index([storeId])
  @@index([productCode])
  @@map("stock_ledgers")
}

model StockLedgerEntry {
  id           String                 @id @default(cuid())
  ledgerId     String
  type         StockLedgerEntryType
  qty          Float                  // positivo = entrada, negativo = saída
  field        String                 // qual campo foi alterado: "qtdFisica" | "qtdComprometida" | "qtdEmTransito"
  referenceId  String?               // ID da transferência ou despacho que gerou o movimento
  referenceType String?              // "transfer" | "dispatch" | "manual"
  notes        String?
  createdById  String?
  createdAt    DateTime               @default(now())

  ledger      StockLedger @relation(fields: [ledgerId], references: [id])

  @@index([ledgerId, createdAt])
  @@index([referenceId])
  @@map("stock_ledger_entries")
}

// ──────────────────────────────────────────────
// DIVERGÊNCIA DE TRANSFERÊNCIA
// Criada quando sentQty != receivedQty.
// Bloqueia o avanço automático da solicitação
// para READY até ser resolvida.
// ──────────────────────────────────────────────

model TransferDivergence {
  id               String           @id @default(cuid())
  transferId       String
  transferItemId   String
  ledgerId         String           // ledger da loja destino
  productCode      String
  productName      String
  sentQty          Float
  receivedQty      Float
  divergenceQty    Float            // sentQty - receivedQty
  status           DivergenceStatus @default(PENDING)
  resolution       String?          // descrição da resolução
  resolvedById     String?
  resolvedAt       DateTime?
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  transfer     Transfer     @relation(fields: [transferId], references: [id])
  transferItem TransferItem @relation(fields: [transferItemId], references: [id])
  ledger       StockLedger  @relation(fields: [ledgerId], references: [id])
  resolvedBy   User?        @relation("DivergenceResolvedBy", fields: [resolvedById], references: [id])

  @@map("transfer_divergences")
}
```

- [ ] **Step 2: Atualizar o model Transfer — adicionar hasDivergence e relação com divergências**

Localizar o model `Transfer` e adicionar os campos após `internalNotes`:

```prisma
  // controle de divergência de recebimento
  hasDivergence     Boolean  @default(false)
  divergenceCount   Int      @default(0)
```

Adicionar relação no final do bloco de relações do Transfer (antes de `@@map`):

```prisma
  divergences TransferDivergence[]
```

- [ ] **Step 3: Atualizar o model TransferItem — adicionar relação com divergências**

Adicionar no final do bloco de relações do TransferItem:

```prisma
  divergences TransferDivergence[]
```

- [ ] **Step 4: Atualizar o model Store — adicionar relação com StockLedger**

Adicionar no bloco de relações do model `Store`:

```prisma
  stockLedgers StockLedger[]
```

- [ ] **Step 5: Atualizar o model User — adicionar relação com divergências resolvidas**

Adicionar no bloco de relações do model `User`:

```prisma
  divergencesResolved TransferDivergence[] @relation("DivergenceResolvedBy")
```

- [ ] **Step 6: Gerar e aplicar a migration**

```bash
cd "Projects/sistema-logistica"
npx prisma migrate dev --name pilar1_stock_lock
```

Resultado esperado: `Your database is now in sync with your schema.` e arquivo de migration gerado em `prisma/migrations/`.

- [ ] **Step 7: Gerar o Prisma Client atualizado**

```bash
npx prisma generate
```

Resultado esperado: `✔ Generated Prisma Client`

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add StockLedger, StockLedgerEntry, TransferDivergence for stock lock"
```

---

## Task 2: Tipos TypeScript para o Ledger

**Files:**
- Create: `types/stock.ts`

- [ ] **Step 1: Criar o arquivo de tipos**

Criar `types/stock.ts`:

```typescript
// Tipos para operações de stock lock (Pilar 1)

export interface StockSnapshot {
  storeId: string;
  storeCode: string;
  storeName: string;
  productCode: string;
  productName: string;
  qtdFisica: number;
  qtdComprometida: number;
  qtdEmTransito: number;
  qtdDisponivel: number; // qtdFisica - qtdComprometida
}

export interface StockCommitInput {
  storeId: string;
  productCode: string;
  productName: string;
  qty: number;
  transferId: string;
  operatorId?: string;
}

export interface StockCommitResult {
  success: boolean;
  ledger?: {
    qtdFisica: number;
    qtdComprometida: number;
    qtdDisponivel: number;
  };
  error?: "INSUFFICIENT_STOCK" | "LEDGER_NOT_FOUND" | "CONCURRENT_CONFLICT";
}

export interface StockReconcileInput {
  transferId: string;
  items: {
    transferItemId: string;
    productCode: string;
    productName: string;
    sentQty: number;
    receivedQty: number;
  }[];
  receivingStoreId: string;
  sendingStoreId: string;
  operatorId?: string;
}

export interface StockReconcileResult {
  hasDivergence: boolean;
  divergences: {
    transferItemId: string;
    productCode: string;
    sentQty: number;
    receivedQty: number;
    divergenceQty: number;
  }[];
}

export interface DivergenceResolveInput {
  divergenceId: string;
  resolution: string;
  resolvedById: string;
  adjustLedger: boolean; // true = ajusta qtdFisica pelo divergenceQty
}
```

- [ ] **Step 2: Commit**

```bash
git add types/stock.ts
git commit -m "feat(types): add StockSnapshot and stock lock operation types"
```

---

## Task 3: StockLedgerService — Operações Atômicas

**Files:**
- Create: `services/stock-ledger.service.ts`

`★ Insight ─────────────────────────────────────`
O padrão `UPDATE ... WHERE qtd_fisica - qtd_comprometida >= qty RETURNING *` é a forma mais eficiente de implementar um check-and-increment atômico no Postgres. Se o UPDATE retornar 0 linhas, o estoque era insuficiente — não precisa de SELECT separado nem de locks manuais.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Criar o serviço**

Criar `services/stock-ledger.service.ts`:

```typescript
import { prisma } from "@/lib/prisma";
import type {
  StockCommitInput,
  StockCommitResult,
  StockReconcileInput,
  StockReconcileResult,
  StockSnapshot,
  DivergenceResolveInput,
} from "@/types/stock";
import { StockLedgerEntryType, DivergenceStatus } from "@prisma/client";

// ──────────────────────────────────────────────
// COMMIT — trava estoque ao criar transferência
// Usa UPDATE atômico: só desconta se houver saldo.
// Retorna INSUFFICIENT_STOCK sem lançar exceção.
// ──────────────────────────────────────────────

export async function commitStock(
  input: StockCommitInput
): Promise<StockCommitResult> {
  return prisma.$transaction(async (tx) => {
    // upsert garante que o ledger existe antes de tentar atualizar
    await tx.stockLedger.upsert({
      where: {
        storeId_productCode: {
          storeId: input.storeId,
          productCode: input.productCode,
        },
      },
      create: {
        storeId: input.storeId,
        productCode: input.productCode,
        productName: input.productName,
        qtdFisica: 0,
        qtdComprometida: 0,
        qtdEmTransito: 0,
      },
      update: {},
    });

    // UPDATE atômico: só incrementa qtdComprometida se qtdDisponivel >= qty
    const result = await tx.$queryRaw<{ id: string; qtd_fisica: number; qtd_comprometida: number }[]>`
      UPDATE stock_ledgers
      SET qtd_comprometida = qtd_comprometida + ${input.qty},
          version = version + 1,
          updated_at = NOW()
      WHERE store_id = ${input.storeId}
        AND product_code = ${input.productCode}
        AND qtd_fisica - qtd_comprometida >= ${input.qty}
      RETURNING id, qtd_fisica, qtd_comprometida
    `;

    if (result.length === 0) {
      // Buscar o ledger para retornar os valores atuais no erro
      const current = await tx.stockLedger.findUnique({
        where: {
          storeId_productCode: {
            storeId: input.storeId,
            productCode: input.productCode,
          },
        },
      });
      return {
        success: false,
        error: "INSUFFICIENT_STOCK" as const,
        ledger: current
          ? {
              qtdFisica: current.qtdFisica,
              qtdComprometida: current.qtdComprometida,
              qtdDisponivel: current.qtdFisica - current.qtdComprometida,
            }
          : undefined,
      };
    }

    const ledger = result[0];

    // registra entrada no audit log
    await tx.stockLedgerEntry.create({
      data: {
        ledger: {
          connect: { id: ledger.id },
        },
        type: StockLedgerEntryType.COMMIT,
        qty: -input.qty,
        field: "qtdComprometida",
        referenceId: input.transferId,
        referenceType: "transfer",
        createdById: input.operatorId,
      },
    });

    return {
      success: true,
      ledger: {
        qtdFisica: ledger.qtd_fisica,
        qtdComprometida: ledger.qtd_comprometida,
        qtdDisponivel: ledger.qtd_fisica - ledger.qtd_comprometida,
      },
    };
  });
}

// ──────────────────────────────────────────────
// RELEASE — libera estoque ao cancelar
// ──────────────────────────────────────────────

export async function releaseStock(input: {
  storeId: string;
  productCode: string;
  qty: number;
  transferId: string;
  operatorId?: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ledger = await tx.stockLedger.update({
      where: {
        storeId_productCode: {
          storeId: input.storeId,
          productCode: input.productCode,
        },
      },
      data: {
        qtdComprometida: { decrement: input.qty },
        version: { increment: 1 },
      },
    });

    await tx.stockLedgerEntry.create({
      data: {
        ledgerId: ledger.id,
        type: StockLedgerEntryType.RELEASE,
        qty: input.qty,
        field: "qtdComprometida",
        referenceId: input.transferId,
        referenceType: "transfer",
        createdById: input.operatorId,
      },
    });
  });
}

// ──────────────────────────────────────────────
// MARK TRANSIT — ao aprovar: registra emTransito
// na loja destino (estoque a receber)
// ──────────────────────────────────────────────

export async function markInTransit(input: {
  toStoreId: string;
  productCode: string;
  productName: string;
  qty: number;
  transferId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ledger = await tx.stockLedger.upsert({
      where: {
        storeId_productCode: {
          storeId: input.toStoreId,
          productCode: input.productCode,
        },
      },
      create: {
        storeId: input.toStoreId,
        productCode: input.productCode,
        productName: input.productName,
        qtdFisica: 0,
        qtdComprometida: 0,
        qtdEmTransito: input.qty,
      },
      update: {
        qtdEmTransito: { increment: input.qty },
        version: { increment: 1 },
      },
    });

    await tx.stockLedgerEntry.create({
      data: {
        ledgerId: ledger.id,
        type: StockLedgerEntryType.TRANSIT_IN,
        qty: input.qty,
        field: "qtdEmTransito",
        referenceId: input.transferId,
        referenceType: "transfer",
      },
    });
  });
}

// ──────────────────────────────────────────────
// RECONCILE — ao receber:
//  - Baixa qtdFisica + qtdComprometida na origem (sentQty)
//  - Baixa qtdEmTransito + incrementa qtdFisica no destino (receivedQty)
//  - Se sentQty != receivedQty → cria TransferDivergence, retorna hasDivergence=true
// ──────────────────────────────────────────────

export async function reconcileTransfer(
  input: StockReconcileInput
): Promise<StockReconcileResult> {
  const result: StockReconcileResult = {
    hasDivergence: false,
    divergences: [],
  };

  await prisma.$transaction(async (tx) => {
    for (const item of input.items) {
      // 1. Baixa na loja de origem: reduz física + remove compromissado
      const originLedger = await tx.stockLedger.findUnique({
        where: {
          storeId_productCode: {
            storeId: input.sendingStoreId,
            productCode: item.productCode,
          },
        },
      });

      if (originLedger) {
        await tx.stockLedger.update({
          where: { id: originLedger.id },
          data: {
            qtdFisica: { decrement: item.sentQty },
            qtdComprometida: { decrement: item.sentQty },
            version: { increment: 1 },
          },
        });

        await tx.stockLedgerEntry.create({
          data: {
            ledgerId: originLedger.id,
            type: StockLedgerEntryType.RECONCILE_SEND,
            qty: -item.sentQty,
            field: "qtdFisica",
            referenceId: input.transferId,
            referenceType: "transfer",
            createdById: input.operatorId,
          },
        });
      }

      // 2. Entrada na loja destino
      const destLedger = await tx.stockLedger.upsert({
        where: {
          storeId_productCode: {
            storeId: input.receivingStoreId,
            productCode: item.productCode,
          },
        },
        create: {
          storeId: input.receivingStoreId,
          productCode: item.productCode,
          productName: item.productName,
          qtdFisica: item.receivedQty,
          qtdComprometida: 0,
          qtdEmTransito: 0,
        },
        update: {
          qtdFisica: { increment: item.receivedQty },
          qtdEmTransito: { decrement: item.sentQty }, // remove o que estava previsto
          version: { increment: 1 },
        },
      });

      await tx.stockLedgerEntry.create({
        data: {
          ledgerId: destLedger.id,
          type: StockLedgerEntryType.RECONCILE_RECV,
          qty: item.receivedQty,
          field: "qtdFisica",
          referenceId: input.transferId,
          referenceType: "transfer",
          createdById: input.operatorId,
        },
      });

      // 3. Detecta divergência
      if (Math.abs(item.sentQty - item.receivedQty) > 0.001) {
        const divergenceQty = item.sentQty - item.receivedQty;

        await tx.transferDivergence.create({
          data: {
            transferId: input.transferId,
            transferItemId: item.transferItemId,
            ledgerId: destLedger.id,
            productCode: item.productCode,
            productName: item.productName,
            sentQty: item.sentQty,
            receivedQty: item.receivedQty,
            divergenceQty,
            status: DivergenceStatus.PENDING,
          },
        });

        result.hasDivergence = true;
        result.divergences.push({
          transferItemId: item.transferItemId,
          productCode: item.productCode,
          sentQty: item.sentQty,
          receivedQty: item.receivedQty,
          divergenceQty,
        });
      }
    }
  });

  return result;
}

// ──────────────────────────────────────────────
// RESOLVE DIVERGENCE — reconcilia manualmente
// ──────────────────────────────────────────────

export async function resolveDivergence(
  input: DivergenceResolveInput
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const div = await tx.transferDivergence.findUniqueOrThrow({
      where: { id: input.divergenceId },
    });

    if (input.adjustLedger && div.divergenceQty !== 0) {
      // divergenceQty = sentQty - receivedQty
      // se positivo: menos foi recebido do que enviado → estoque físico precisa ser ajustado
      await tx.stockLedger.update({
        where: { id: div.ledgerId },
        data: {
          qtdFisica: { decrement: div.divergenceQty },
          version: { increment: 1 },
        },
      });

      await tx.stockLedgerEntry.create({
        data: {
          ledgerId: div.ledgerId,
          type: StockLedgerEntryType.DIVERGENCE_ADJ,
          qty: -div.divergenceQty,
          field: "qtdFisica",
          referenceId: div.transferId,
          referenceType: "transfer",
          notes: input.resolution,
          createdById: input.resolvedById,
        },
      });
    }

    await tx.transferDivergence.update({
      where: { id: input.divergenceId },
      data: {
        status: DivergenceStatus.RESOLVED,
        resolution: input.resolution,
        resolvedById: input.resolvedById,
        resolvedAt: new Date(),
      },
    });
  });
}

// ──────────────────────────────────────────────
// SYNC FROM ERP — atualiza qtdFisica em lote
// Chamado pelo sync_estoque.py via API
// ──────────────────────────────────────────────

export async function syncStockFromERP(
  items: { storeId: string; productCode: string; productName: string; qtdFisica: number }[]
): Promise<{ synced: number; created: number }> {
  let synced = 0;
  let created = 0;

  for (const item of items) {
    const existing = await prisma.stockLedger.findUnique({
      where: {
        storeId_productCode: {
          storeId: item.storeId,
          productCode: item.productCode,
        },
      },
    });

    if (existing) {
      await prisma.stockLedger.update({
        where: { id: existing.id },
        data: {
          qtdFisica: item.qtdFisica,
          productName: item.productName,
          syncedAt: new Date(),
          version: { increment: 1 },
        },
      });

      await prisma.stockLedgerEntry.create({
        data: {
          ledgerId: existing.id,
          type: StockLedgerEntryType.SYNC_ERP,
          qty: item.qtdFisica - existing.qtdFisica,
          field: "qtdFisica",
          referenceType: "manual",
          notes: "sync automático do ERP",
        },
      });
      synced++;
    } else {
      const ledger = await prisma.stockLedger.create({
        data: {
          storeId: item.storeId,
          productCode: item.productCode,
          productName: item.productName,
          qtdFisica: item.qtdFisica,
          qtdComprometida: 0,
          qtdEmTransito: 0,
          syncedAt: new Date(),
        },
      });

      await prisma.stockLedgerEntry.create({
        data: {
          ledgerId: ledger.id,
          type: StockLedgerEntryType.SYNC_ERP,
          qty: item.qtdFisica,
          field: "qtdFisica",
          referenceType: "manual",
          notes: "criação inicial via sync ERP",
        },
      });
      created++;
    }
  }

  return { synced, created };
}

// ──────────────────────────────────────────────
// SNAPSHOT — retorna visão atual do estoque
// para o sistema_compras e para a UI
// ──────────────────────────────────────────────

export async function getStockSnapshot(filters?: {
  storeId?: string;
  productCode?: string;
}): Promise<StockSnapshot[]> {
  const ledgers = await prisma.stockLedger.findMany({
    where: {
      ...(filters?.storeId ? { storeId: filters.storeId } : {}),
      ...(filters?.productCode ? { productCode: filters.productCode } : {}),
    },
    include: {
      store: { select: { code: true, name: true } },
    },
  });

  return ledgers.map((l) => ({
    storeId: l.storeId,
    storeCode: l.store.code,
    storeName: l.store.name,
    productCode: l.productCode,
    productName: l.productName,
    qtdFisica: l.qtdFisica,
    qtdComprometida: l.qtdComprometida,
    qtdEmTransito: l.qtdEmTransito,
    qtdDisponivel: l.qtdFisica - l.qtdComprometida,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add services/stock-ledger.service.ts
git commit -m "feat(service): add StockLedgerService with atomic commit/release/reconcile"
```

---

## Task 4: Testes do StockLedgerService

**Files:**
- Create: `__tests__/stock-ledger.test.ts`

- [ ] **Step 1: Verificar se Jest está configurado**

```bash
cat package.json | grep -E "jest|test"
```

Se não houver Jest configurado, instalar:

```bash
npm install --save-dev jest @types/jest ts-jest jest-mock-extended
```

Criar `jest.config.js` na raiz:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
};
```

- [ ] **Step 2: Criar mock do Prisma**

Criar `__tests__/__mocks__/prisma.ts`:

```typescript
import { mockDeep, mockReset, DeepMockProxy } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

export const prismaMock = mockDeep<PrismaClient>();

jest.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

beforeEach(() => {
  mockReset(prismaMock);
});
```

- [ ] **Step 3: Escrever os testes — commitStock**

Criar `__tests__/stock-ledger.test.ts`:

```typescript
import { prismaMock } from "./__mocks__/prisma";
import { commitStock, releaseStock } from "@/services/stock-ledger.service";

describe("commitStock", () => {
  it("retorna INSUFFICIENT_STOCK quando qtdDisponivel < qty solicitada", async () => {
    // ledger com 5 físico e 3 comprometido = 2 disponível
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));
    prismaMock.stockLedger.upsert.mockResolvedValue({} as any);
    prismaMock.$queryRaw.mockResolvedValue([]); // 0 rows = insuficiente
    prismaMock.stockLedger.findUnique.mockResolvedValue({
      id: "led-1",
      qtdFisica: 5,
      qtdComprometida: 3,
      qtdEmTransito: 0,
    } as any);

    const result = await commitStock({
      storeId: "store-067",
      productCode: "CORAL-TEC-18L",
      productName: "Coral Tinta 18L",
      qty: 4,
      transferId: "tr-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("INSUFFICIENT_STOCK");
    expect(result.ledger?.qtdDisponivel).toBe(2);
  });

  it("retorna success=true e atualiza ledger quando há estoque suficiente", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));
    prismaMock.stockLedger.upsert.mockResolvedValue({} as any);
    prismaMock.$queryRaw.mockResolvedValue([
      { id: "led-1", qtd_fisica: 10, qtd_comprometida: 4 },
    ]); // 1 row = sucesso
    prismaMock.stockLedgerEntry.create.mockResolvedValue({} as any);

    const result = await commitStock({
      storeId: "store-067",
      productCode: "CORAL-TEC-18L",
      productName: "Coral Tinta 18L",
      qty: 3,
      transferId: "tr-2",
    });

    expect(result.success).toBe(true);
    expect(result.ledger?.qtdComprometida).toBe(4);
    expect(result.ledger?.qtdDisponivel).toBe(6);
  });
});

describe("releaseStock", () => {
  it("decrementa qtdComprometida e registra entry tipo RELEASE", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));
    prismaMock.stockLedger.update.mockResolvedValue({ id: "led-1" } as any);
    prismaMock.stockLedgerEntry.create.mockResolvedValue({} as any);

    await releaseStock({
      storeId: "store-067",
      productCode: "CORAL-TEC-18L",
      qty: 3,
      transferId: "tr-2",
    });

    expect(prismaMock.stockLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          qtdComprometida: { decrement: 3 },
        }),
      })
    );
    expect(prismaMock.stockLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "RELEASE",
          qty: 3,
        }),
      })
    );
  });
});
```

- [ ] **Step 4: Rodar os testes**

```bash
npx jest __tests__/stock-ledger.test.ts --verbose
```

Resultado esperado:
```
PASS  __tests__/stock-ledger.test.ts
  commitStock
    ✓ retorna INSUFFICIENT_STOCK quando qtdDisponivel < qty solicitada
    ✓ retorna success=true e atualiza ledger quando há estoque suficiente
  releaseStock
    ✓ decrementa qtdComprometida e registra entry tipo RELEASE
```

- [ ] **Step 5: Commit**

```bash
git add __tests__/ jest.config.js
git commit -m "test: add StockLedgerService unit tests with Prisma mock"
```

---

## Task 5: Refatorar createTransfer — validação + lock

**Files:**
- Modify: `services/transferencia.service.ts`

- [ ] **Step 1: Importar o StockLedgerService**

Adicionar no topo de `services/transferencia.service.ts`:

```typescript
import {
  commitStock,
  releaseStock,
  markInTransit,
  reconcileTransfer,
} from "./stock-ledger.service";
```

- [ ] **Step 2: Refatorar createTransfer para validar e commitar estoque**

Substituir a função `createTransfer` atual por:

```typescript
export async function createTransfer(input: CreateTransferInput) {
  // 1. Valida e trava estoque para todos os itens ANTES de criar a transferência
  const stockResults = await Promise.all(
    input.items.map((item) =>
      commitStock({
        storeId: input.fromStoreId,
        productCode: item.productCode,
        productName: item.productName,
        qty: item.quantity,
        transferId: "pre-check", // placeholder — substituído após criar
        operatorId: input.requestedById,
      })
    )
  );

  const failedItems = stockResults
    .map((r, i) => ({ result: r, item: input.items[i] }))
    .filter(({ result }) => !result.success);

  if (failedItems.length > 0) {
    const details = failedItems
      .map(
        ({ item, result }) =>
          `${item.productName}: disponível=${result.ledger?.qtdDisponivel ?? 0}, solicitado=${item.quantity}`
      )
      .join("; ");
    throw new Error(`Estoque insuficiente na loja de origem — ${details}`);
  }

  // 2. Cria a transferência e re-commita com o ID real
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.create({
      data: {
        deliveryRequestId: input.deliveryRequestId,
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        priority: input.priority,
        requestedById: input.requestedById,
        notes: input.notes,
        items: {
          create: input.items.map((item) => ({
            productCode: item.productCode,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit ?? "UN",
          })),
        },
      },
      include: {
        fromStore: true,
        toStore: true,
        items: true,
      },
    });

    await tx.transferHistory.create({
      data: {
        transferId: transfer.id,
        toStatus: TransferStatus.PENDING,
        changedById: input.requestedById,
        notes: "Transferência criada com estoque validado e comprometido",
      },
    });

    if (input.deliveryRequestId) {
      await tx.deliveryRequest.update({
        where: { id: input.deliveryRequestId },
        data: { status: "AWAITING_TRANSFER" },
      });
    }

    // Nota: o commitStock já foi feito acima com "pre-check".
    // Atualizar as entries do ledger com o transferId real:
    await tx.stockLedgerEntry.updateMany({
      where: {
        referenceId: "pre-check",
        referenceType: "transfer",
      },
      data: { referenceId: transfer.id },
    });

    return transfer;
  });
}
```

- [ ] **Step 3: Rodar os testes existentes para garantir que não quebramos nada**

```bash
npx jest --verbose
```

Resultado esperado: todos os testes passam ou falham apenas os testes relacionados ao que ainda não foi implementado.

- [ ] **Step 4: Commit**

```bash
git add services/transferencia.service.ts
git commit -m "feat(transfer): validate and lock stock on createTransfer"
```

---

## Task 6: Refatorar updateTransferStatus — release, transit e reconciliação

**Files:**
- Modify: `services/transferencia.service.ts`

- [ ] **Step 1: Substituir a função updateTransferStatus**

Substituir a função `updateTransferStatus` por:

```typescript
export async function updateTransferStatus(
  transferId: string,
  input: UpdateTransferStatusInput
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { items: true, deliveryRequest: true },
    });

    validateStatusTransition(current.status, input.status);

    const now = new Date();
    const statusDates: Record<string, Date | undefined> = {
      [TransferStatus.APPROVED]: input.status === TransferStatus.APPROVED ? now : undefined,
      [TransferStatus.PREPARING]: input.status === TransferStatus.PREPARING ? now : undefined,
      [TransferStatus.IN_TRANSIT]: input.status === TransferStatus.IN_TRANSIT ? now : undefined,
      [TransferStatus.RECEIVED]: input.status === TransferStatus.RECEIVED ? now : undefined,
      [TransferStatus.CANCELLED]: input.status === TransferStatus.CANCELLED ? now : undefined,
    };

    const updated = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status: input.status,
        approvedById: input.status === TransferStatus.APPROVED ? input.changedById : undefined,
        approvedAt: statusDates[TransferStatus.APPROVED],
        preparingAt: statusDates[TransferStatus.PREPARING],
        dispatchedAt: statusDates[TransferStatus.IN_TRANSIT],
        receivedAt: statusDates[TransferStatus.RECEIVED],
        cancelledAt: statusDates[TransferStatus.CANCELLED],
        estimatedArrival: input.estimatedArrival,
        items: input.sentItems
          ? {
              updateMany: input.sentItems.map((si) => ({
                where: { id: si.transferItemId },
                data: { sentQty: si.sentQty },
              })),
            }
          : undefined,
      },
      include: { items: true, deliveryRequest: true },
    });

    // atualiza quantidades recebidas
    if (input.receivedItems) {
      for (const ri of input.receivedItems) {
        await tx.transferItem.update({
          where: { id: ri.transferItemId },
          data: { receivedQty: ri.receivedQty },
        });
      }
    }

    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus: current.status,
        toStatus: input.status,
        changedById: input.changedById,
        notes: input.notes,
      },
    });

    // ── EVENTOS DE ESTOQUE ──────────────────────

    // CANCELAMENTO: libera estoque comprometido
    if (input.status === TransferStatus.CANCELLED) {
      for (const item of current.items) {
        const qty = item.sentQty ?? item.quantity;
        await releaseStock({
          storeId: current.fromStoreId,
          productCode: item.productCode,
          qty,
          transferId,
          operatorId: input.changedById,
        });
      }
    }

    // APROVADO: registra em trânsito na loja destino
    if (input.status === TransferStatus.APPROVED) {
      for (const item of current.items) {
        await markInTransit({
          toStoreId: current.toStoreId,
          productCode: item.productCode,
          productName: item.productName,
          qty: item.quantity,
          transferId,
        });
      }
    }

    // RECEBIDO: reconcilia estoque com detecção de divergência
    if (input.status === TransferStatus.RECEIVED) {
      const reconcileItems = current.items.map((item) => {
        const received = input.receivedItems?.find(
          (ri) => ri.transferItemId === item.id
        );
        return {
          transferItemId: item.id,
          productCode: item.productCode,
          productName: item.productName,
          sentQty: item.sentQty ?? item.quantity,
          receivedQty: received?.receivedQty ?? item.sentQty ?? item.quantity,
        };
      });

      const reconcileResult = await reconcileTransfer({
        transferId,
        items: reconcileItems,
        receivingStoreId: current.toStoreId,
        sendingStoreId: current.fromStoreId,
        operatorId: input.changedById,
      });

      if (reconcileResult.hasDivergence) {
        // marca a transferência com divergência — NÃO avança a solicitação
        await tx.transfer.update({
          where: { id: transferId },
          data: {
            hasDivergence: true,
            divergenceCount: reconcileResult.divergences.length,
          },
        });

        // NÃO chamar checkAndAdvanceDeliveryRequest
        return updated;
      }

      // sem divergência → avança a solicitação normalmente
      if (current.deliveryRequestId) {
        await checkAndAdvanceDeliveryRequest(tx, current.deliveryRequestId);
      }
    }

    return updated;
  });
}
```

- [ ] **Step 2: Rodar os testes**

```bash
npx jest --verbose
```

- [ ] **Step 3: Commit**

```bash
git add services/transferencia.service.ts
git commit -m "feat(transfer): integrate stock lock into transfer lifecycle (cancel=release, approve=transit, receive=reconcile)"
```

---

## Task 7: Testes de integração do fluxo de transferência

**Files:**
- Create: `__tests__/transferencia-stock.test.ts`

- [ ] **Step 1: Escrever testes de integração**

Criar `__tests__/transferencia-stock.test.ts`:

```typescript
import { prismaMock } from "./__mocks__/prisma";
import { createTransfer } from "@/services/transferencia.service";
import { commitStock } from "@/services/stock-ledger.service";
import { TransferStatus, TransferPriority } from "@prisma/client";

jest.mock("@/services/stock-ledger.service", () => ({
  commitStock: jest.fn(),
  releaseStock: jest.fn(),
  markInTransit: jest.fn(),
  reconcileTransfer: jest.fn(),
}));

const mockCommitStock = commitStock as jest.MockedFunction<typeof commitStock>;

describe("createTransfer com stock lock", () => {
  const validInput = {
    fromStoreId: "store-067",
    toStoreId: "store-131",
    priority: TransferPriority.ANTICIPATED,
    requestedById: "user-1",
    items: [
      {
        productCode: "CORAL-TEC-18L",
        productName: "Coral Tinta 18L",
        quantity: 5,
      },
    ],
  };

  it("lança erro quando estoque insuficiente", async () => {
    mockCommitStock.mockResolvedValue({
      success: false,
      error: "INSUFFICIENT_STOCK",
      ledger: { qtdFisica: 3, qtdComprometida: 1, qtdDisponivel: 2 },
    });

    await expect(createTransfer(validInput)).rejects.toThrow(
      "Estoque insuficiente na loja de origem"
    );
    expect(prismaMock.transfer.create).not.toHaveBeenCalled();
  });

  it("cria transferência quando estoque é suficiente", async () => {
    mockCommitStock.mockResolvedValue({
      success: true,
      ledger: { qtdFisica: 10, qtdComprometida: 5, qtdDisponivel: 5 },
    });

    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));
    prismaMock.transfer.create.mockResolvedValue({
      id: "tr-1",
      status: TransferStatus.PENDING,
      fromStore: { id: "store-067" },
      toStore: { id: "store-131" },
      items: [],
    } as any);
    prismaMock.transferHistory.create.mockResolvedValue({} as any);
    prismaMock.stockLedgerEntry.updateMany.mockResolvedValue({ count: 1 } as any);

    const result = await createTransfer(validInput);

    expect(result.id).toBe("tr-1");
    expect(mockCommitStock).toHaveBeenCalledWith(
      expect.objectContaining({
        qty: 5,
        productCode: "CORAL-TEC-18L",
      })
    );
  });
});
```

- [ ] **Step 2: Rodar os testes**

```bash
npx jest __tests__/transferencia-stock.test.ts --verbose
```

Resultado esperado:
```
PASS  __tests__/transferencia-stock.test.ts
  createTransfer com stock lock
    ✓ lança erro quando estoque insuficiente
    ✓ cria transferência quando estoque é suficiente
```

- [ ] **Step 3: Commit**

```bash
git add __tests__/transferencia-stock.test.ts
git commit -m "test: add createTransfer integration tests with stock lock"
```

---

## Task 8: Endpoint de Snapshot — integração com sistema_compras

**Files:**
- Create: `app/api/estoque/snapshot/route.ts`
- Create: `app/api/estoque/sync/route.ts`

- [ ] **Step 1: Criar o endpoint de snapshot**

Criar `app/api/estoque/snapshot/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getStockSnapshot } from "@/services/stock-ledger.service";

// GET /api/estoque/snapshot
// Retorna visão atual do estoque (físico + comprometido + em trânsito + disponível)
// Suporta ?format=csv para exportação direta ao sistema_compras
// Suporta ?storeId=xxx e ?productCode=xxx como filtros
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get("storeId") ?? undefined;
  const productCode = searchParams.get("productCode") ?? undefined;
  const format = searchParams.get("format");

  const snapshot = await getStockSnapshot({ storeId, productCode });

  if (format === "csv") {
    const header = "codigo_loja,codigo_produto,nome_produto,qtd_fisica,qtd_comprometida,qtd_em_transito,qtd_disponivel";
    const rows = snapshot.map(
      (s) =>
        `${s.storeCode},${s.productCode},"${s.productName}",${s.qtdFisica},${s.qtdComprometida},${s.qtdEmTransito},${s.qtdDisponivel}`
    );
    const csv = [header, ...rows].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="estoque_snapshot_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ data: snapshot, total: snapshot.length });
}
```

- [ ] **Step 2: Criar o endpoint de sync do ERP**

Criar `app/api/estoque/sync/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { syncStockFromERP } from "@/services/stock-ledger.service";

// POST /api/estoque/sync
// Recebe array de { storeCode, productCode, productName, qtdFisica }
// e atualiza o StockLedger (sync periódico do ERP)
// Body: { items: SyncItem[], apiKey: string }
export async function POST(req: NextRequest) {
  const body = await req.json();

  // autenticação simples por API key (mesma usada pelo sistema_compras)
  const apiKey = req.headers.get("x-api-key") ?? body.apiKey;
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }

  // mapear storeCode → storeId via banco
  const { prisma } = await import("@/lib/prisma");
  const stores = await prisma.store.findMany({ select: { id: true, code: true } });
  const storeMap = new Map(stores.map((s) => [s.code, s.id]));

  const mapped = body.items
    .map((item: { storeCode: string; productCode: string; productName: string; qtdFisica: number }) => {
      const storeId = storeMap.get(item.storeCode);
      if (!storeId) return null;
      return { storeId, productCode: item.productCode, productName: item.productName, qtdFisica: item.qtdFisica };
    })
    .filter(Boolean) as { storeId: string; productCode: string; productName: string; qtdFisica: number }[];

  const result = await syncStockFromERP(mapped);

  return NextResponse.json({ success: true, ...result });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/estoque/
git commit -m "feat(api): add /api/estoque/snapshot (CSV/JSON) and /api/estoque/sync endpoints"
```

---

## Task 9: Integração no sistema_compras — sync_estoque.py

**Files:**
- Modify: `../sistema_compras/sync_estoque.py`

- [ ] **Step 1: Ler o arquivo atual**

Abrir `Projects/sistema_compras/sync_estoque.py` e verificar o que já faz.

- [ ] **Step 2: Adicionar chamada ao endpoint de snapshot**

Adicionar função ao final do `sync_estoque.py`:

```python
import requests
import csv
import io
import os

LOGISTICA_URL = os.environ.get("LOGISTICA_URL", "http://localhost:3000")
LOGISTICA_API_KEY = os.environ.get("INTERNAL_API_KEY", "dev-key")


def baixar_snapshot_comprometido() -> dict[tuple[str, str], dict]:
    """
    Retorna dict {(codigo_loja, codigo_produto): {qtd_fisica, qtd_comprometida,
    qtd_em_transito, qtd_disponivel}} via endpoint do sistema_logistica.
    
    Retorna dict vazio se endpoint indisponível (não bloqueia o engine).
    """
    try:
        resp = requests.get(
            f"{LOGISTICA_URL}/api/estoque/snapshot",
            params={"format": "csv"},
            headers={"x-api-key": LOGISTICA_API_KEY},
            timeout=5,
        )
        resp.raise_for_status()
    except Exception as e:
        print(f"[sync] Aviso: não foi possível buscar snapshot do sistema_logistica: {e}")
        return {}

    reader = csv.DictReader(io.StringIO(resp.text))
    result = {}
    for row in reader:
        key = (row["codigo_loja"], row["codigo_produto"])
        result[key] = {
            "qtd_fisica": float(row["qtd_fisica"]),
            "qtd_comprometida": float(row["qtd_comprometida"]),
            "qtd_em_transito": float(row["qtd_em_transito"]),
            "qtd_disponivel": float(row["qtd_disponivel"]),
        }
    return result


def sincronizar_estoque_com_logistica(data_dir=None):
    """
    Baixa o snapshot do sistema_logistica e atualiza os arquivos
    estoque_XXX.csv com qtd_disponivel (física - comprometida).
    Preserva os valores do ERP para qtd_fisica.
    """
    from pathlib import Path
    import pandas as pd

    if data_dir is None:
        data_dir = Path(__file__).parent / "data"

    snapshot = baixar_snapshot_comprometido()
    if not snapshot:
        return

    lojas_csv = pd.read_csv(data_dir / "lojas.csv", dtype=str)
    for _, loja in lojas_csv.iterrows():
        arq = data_dir / f"estoque_{loja['codigo_loja']}.csv"
        if not arq.exists():
            continue

        df = pd.read_csv(arq, dtype=str)
        df["estoque_atual"] = pd.to_numeric(df["estoque_atual"], errors="coerce").fillna(0.0)

        def ajustar(row):
            key = (loja["codigo_loja"], row["codigo_produto"])
            if key in snapshot:
                s = snapshot[key]
                # usa qtd_disponivel como estoque_atual para o engine
                row["estoque_disponivel"] = s["qtd_disponivel"]
                row["estoque_comprometido"] = s["qtd_comprometida"]
                row["estoque_em_transito"] = s["qtd_em_transito"]
            return row

        df = df.apply(ajustar, axis=1)
        df.to_csv(arq, index=False)

    print(f"[sync] Estoque sincronizado com sistema_logistica: {len(snapshot)} itens")
```

- [ ] **Step 3: Atualizar engine.py para usar estoque_disponivel**

Em `Projects/sistema_compras/engine.py`, localizar onde `estoque_atual` é usado no cálculo de cobertura (por volta da linha 280-320) e ajustar:

```python
# ANTES:
# cobertura_atual = estoque_atual / venda_diaria

# DEPOIS: preferir estoque_disponivel se existir (descontado do comprometido)
estoque_efetivo = row.get("estoque_disponivel", row["estoque_atual"])
cobertura_atual = estoque_efetivo / venda_diaria if venda_diaria > 0 else 999

# incluir estoque_em_transito como "estoque virtual" ao calcular necessidade
em_transito = row.get("estoque_em_transito", 0)
cobertura_com_transito = (estoque_efetivo + em_transito) / venda_diaria if venda_diaria > 0 else 999
```

- [ ] **Step 4: Commit**

```bash
git add ../sistema_compras/sync_estoque.py ../sistema_compras/engine.py
git commit -m "feat(compras): integrate stock snapshot from sistema_logistica into engine"
```

---

## Task 10: Variável de ambiente e documentação

**Files:**
- Modify: `.env.example` (ou `.env.local.example`)

- [ ] **Step 1: Adicionar a variável INTERNAL_API_KEY**

Adicionar em `.env.local.example` (e no `.env.local` real):

```
# Chave compartilhada entre sistema_logistica e sistema_compras para sync de estoque
INTERNAL_API_KEY=gere-uma-chave-segura-aqui
```

Gerar uma chave segura:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 2: Adicionar ao .env do sistema_compras**

No arquivo `Projects/sistema_compras/.env` (criar se não existir):

```
LOGISTICA_URL=http://localhost:3000
INTERNAL_API_KEY=mesma-chave-gerada-acima
```

- [ ] **Step 3: Commit final**

```bash
git add .env.local.example
git commit -m "chore: add INTERNAL_API_KEY for stock sync between systems"
```

---

## Self-Review

### Cobertura de requisitos

| Requisito | Task |
|---|---|
| Modelo de dados: físico, comprometido, disponível, em trânsito | Task 1 (schema) |
| Alterações no Prisma schema | Task 1 |
| createTransfer valida estoque disponível | Task 5 |
| createTransfer incrementa estoque_comprometido | Task 5 |
| Cancel libera estoque | Task 6 |
| Receive reconcilia estoque | Task 6 |
| sentQty != receivedQty → não fecha automaticamente | Task 6 |
| Estado de divergência | Task 1 (TransferDivergence) + Task 6 |
| Integração com sistema_compras | Task 8 + Task 9 |
| Evitar compra duplicada (em trânsito) | Task 9 (engine.py) |
| Código TypeScript + Prisma | Tasks 3-8 |

### Pontos críticos verificados

1. **Atomicidade**: o `UPDATE ... WHERE qtd_fisica - qtd_comprometida >= qty` garante que dois requests concorrentes não possam ambos passar na verificação de estoque
2. **Tipos consistentes**: `StockCommitInput`, `StockCommitResult`, `StockReconcileInput`, `StockReconcileResult`, `DivergenceResolveInput` definidos em `types/stock.ts` e usados em `stock-ledger.service.ts`
3. **TransferDivergence.ledgerId** referencia o ledger da loja DESTINO (onde o produto chegou — é lá que o estoque precisa ser ajustado)
4. **releaseStock** usa `decrement` do Prisma, que é seguro para concorrência (não faz read-modify-write)
5. **getStockSnapshot** está no serviço e também exposto via API — sem duplicação

---

Plano salvo em `docs/superpowers/plans/2026-05-01-pilar1-stock-lock.md`.

**Duas opções de execução:**

**1. Subagent-Driven (recomendado)** — despacho um subagente por task, reviso entre tasks, iteração rápida

**2. Inline** — executamos juntos nesta sessão task por task com checkpoints

Qual prefere?
