# Transferência em 5 etapas — Spec de design

**Data:** 2026-05-26
**Autor:** Alberto (brainstorm com Claude)
**Contexto:** [[sistema-de-gest-o-log-stica]]

---

## 1. Motivação

O fluxo atual de transferência tem um bug estrutural: ao criar uma solicitação com item faltando, o sistema cria a Transfer com `fromStoreId = toStoreId = loja do vendedor` como placeholder (comentário explícito em `app/api/solicitacoes/route.ts:362-374`). Isso aparece nas telas como "132 ↔ 132". O fluxo de "vincular PD" (Jhow) só preenche `linkedCitelStoreCode` no item, **nunca atualiza** `Transfer.fromStoreId`. Resultado: as Transfers ficam visualmente erradas e operacionalmente confusas durante todo seu ciclo de vida.

Além disso, o fluxo de status atual (PENDING → APPROVED → IN_TRANSIT → RECEIVED) não reflete a realidade do trabalho. Cada Transfer envolve quatro atores diferentes em momentos distintos, mas o sistema trata como se fosse um pipeline opaco.

## 2. Objetivo

Substituir o fluxo atual por um modelo de 5 etapas que mapeia cada momento real do processo a um status distinto, com origem definida apenas quando faz sentido, com TE/NF por item (limitação do Autcom: 1 produto por TE/NF) e com rastreio fotográfico em coleta e entrega.

## 3. Fora de escopo

- Migração retroativa de Transfers terminais antigas (RECEIVED, CANCELLED) — ficam como histórico.
- Mudança no fluxo de DeliveryRequest do cliente final (só ajusta o gatilho `handleTransferDeliveredOnRequest`).
- Integração com Citel/Autcom além da já existente (sugestão de PD candidato).
- Decisões de roteirização — Transfer em READY_TO_COLLECT é elegível para wave igual hoje.

## 4. Arquitetura

```
[Vendedor da loja destino]
       │ cria solicitação com item faltando
       ▼
┌─────────────────────────┐
│ Transfer (1 item)       │  status = PENDING
│ toStoreId: 132          │  fromStoreId: null
│ item: { código, qtd }   │  teNumber: null
└──────────┬──────────────┘
           │ vendedor escolhe loja origem (UI)
           ▼
       PENDING → AWAITING_APPROVAL
           │ líder da fromStore digita TE/NF
           ▼
       AWAITING_APPROVAL → READY_TO_COLLECT
           │ motorista atribuído na rota
           ▼
       READY_TO_COLLECT → IN_TRANSIT
           │ motorista entrega no destino
           ▼
       IN_TRANSIT → DELIVERED
```

### 4.1 Camadas afetadas

| Camada | Mudança |
|---|---|
| `prisma/schema.prisma` | enum TransferStatus + Transfer + TransferItem |
| `services/transferencia.service.ts` | createTransfer (auto-split), nova `indicateOrigin`, `approveTransfer`, `rejectTransferAtOrigin`, `collectTransfer`, `deliverTransfer`; cancelamento refatorado |
| `services/stock-ledger.service.ts` | commitStock deixa de rodar na criação; passa a rodar em `indicateOrigin` |
| `app/api/transferencias/route.ts` | POST gera N Transfers (uma por item) — auto-split |
| Novas rotas | `POST .../indicate-origin`, `POST .../approve`, `POST .../reject-at-origin`, `POST .../collect`, `POST .../deliver`, `POST .../cancel` |
| `app/(app)/transferencias/page.tsx` | 5 abas; cards condicionais por etapa |
| `app/(app)/transferencias/[id]/page.tsx` | timeline atualizada com 5 fases |
| `app/api/solicitacoes/route.ts` | remove placeholder (linhas 359-426); cria N Transfers PENDING; mantém sugestão Citel como hint visual |
| App do motorista (`app/motorista/...`) | ações Coletar/Entregar para Transfer no manifest |

### 4.2 O que NÃO muda

- Integração com Citel/Autcom (`linkedCitelPD` por item continua igual).
- Ciclo de despacho/rota (Transfer em READY_TO_COLLECT é elegível para wave igual hoje).
- Reconciliação no recebimento (mantém `reconcileTransfer`).
- Bucket `delivery-proofs` no Supabase Storage — reaproveitado pelas fotos de coleta e entrega de Transfer.
- Notificações existentes (apenas adiciona gatilhos para os novos status).

## 5. Schema

### 5.1 Enum

```prisma
enum TransferStatus {
  PENDING              // 1ª etapa — aguarda loja destino indicar origem
  AWAITING_APPROVAL    // 2ª etapa — aguarda loja origem digitar TE/NF
  READY_TO_COLLECT     // 3ª etapa — aprovada, aguarda coleta pelo motorista
  IN_TRANSIT           // 4ª etapa — motorista coletou, a caminho
  DELIVERED            // 5ª etapa — entregue no destino
  CANCELLED            // cancelada em qualquer ponto
  // legados — só pra preservar histórico antigo (TransferHistory aponta pra eles)
  APPROVED   // mantém no enum, fora do caminho ativo
  PREPARING  // idem
  PREPARED   // idem
  RECEIVED   // idem
}
```

Postgres enum values em uso ativo não podem ser removidos sem reescrever toda a coluna. Mais barato manter os legados e migrar dados via UPDATE.

### 5.2 `model Transfer`

```prisma
model Transfer {
  id                  String           @id @default(cuid())
  deliveryRequestId   String?
  fromStoreId         String?          // MUDOU: nullable (preenchido na etapa 2)
  toStoreId           String           // obrigatório (loja que precisa)
  priority            TransferPriority
  status              TransferStatus   @default(PENDING)
  requestedById       String?
  approvedById        String?          // líder da fromStore que aprovou (TE/NF)

  // datas do ciclo de vida
  requestedAt         DateTime         @default(now())
  originIndicatedAt   DateTime?        // NOVO: quando fromStoreId foi definido
  originIndicatedById String?          // NOVO: quem indicou (vendedor destino)
  approvedAt          DateTime?        // quando virou READY_TO_COLLECT
  collectedAt         DateTime?        // quando virou IN_TRANSIT
  deliveredAt         DateTime?        // NOVO: quando virou DELIVERED
  cancelledAt         DateTime?
  updatedAt           DateTime         @updatedAt

  notes               String?
  internalNotes       String?
  estimatedArrival    DateTime?

  // REMOVIDO daqui (movido para TransferItem):
  //   teNumber, nfCitelNumero, nfCitelEmitidaAt

  // foto da coleta (mantém na Transfer — 1 foto da pilha)
  collectPhotoUrl     String?
  collectPhotoPath    String?

  // NOVO: foto da entrega no destino
  deliveryPhotoUrl    String?
  deliveryPhotoPath   String?
  deliveredById       String?
  recipientName       String?

  hasDivergence       Boolean  @default(false)
  divergenceCount     Int      @default(0)

  deliveryRequest     DeliveryRequest?  @relation(fields: [deliveryRequestId], references: [id])
  fromStore           Store?            @relation("TransferFrom", fields: [fromStoreId], references: [id])
  toStore             Store             @relation("TransferTo", fields: [toStoreId], references: [id])
  requestedBy         User?             @relation("TransferRequestedBy",        fields: [requestedById],       references: [id])
  approvedBy          User?             @relation("TransferApprovedBy",         fields: [approvedById],        references: [id])
  originIndicatedBy   User?             @relation("TransferOriginIndicatedBy",  fields: [originIndicatedById], references: [id])
  deliveredBy         User?             @relation("TransferDeliveredBy",        fields: [deliveredById],       references: [id])
  items               TransferItem[]    // cardinalidade real = 1 (forçado via service)
  dispatch            Dispatch?         @relation("TransferDispatch")
  history             TransferHistory[]
  divergences         TransferDivergence[]

  @@index([status, toStoreId])    // lista pendentes por loja destino
  @@index([status, fromStoreId])  // lista aguardando aprovação por loja origem
  @@map("transfers")
}
```

### 5.3 `model TransferItem`

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

  // NOVO: documentos por item (1 TE ou 1 NF por item, exigência do Autcom)
  teNumber             String?
  nfCitelNumero        String?
  nfCitelEmitidaAt     DateTime?

  // NOVO: rastreabilidade da coleta item-a-item
  collectedAt          DateTime?
  collectConfirmed     Boolean  @default(false)

  // Citel link (mantém igual)
  linkedCitelPD        String?
  linkedCitelStoreCode String?
  linkedAt             DateTime?
  linkedById           String?

  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  transfer             Transfer @relation(fields: [transferId], references: [id], onDelete: Cascade)
  divergences          TransferDivergence[]

  @@index([linkedCitelPD])
  @@map("transfer_items")
}
```

### 5.4 Invariantes

- **Service-level:** `Transfer.items.length === 1` sempre (createTransfer faz auto-split).
- **DB-level (CHECK constraint na migration):**
  ```sql
  ALTER TABLE transfers ADD CONSTRAINT transfer_origin_required
    CHECK (status IN ('PENDING','CANCELLED') OR "fromStoreId" IS NOT NULL);
  ```
  Defesa em profundidade contra scripts futuros que escrevam direto no banco.

## 6. Máquina de estados

### 6.1 Transições válidas

```ts
const VALID_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  PENDING:           [AWAITING_APPROVAL, CANCELLED],
  AWAITING_APPROVAL: [READY_TO_COLLECT,  CANCELLED, PENDING], // volta se origem recusa
  READY_TO_COLLECT:  [IN_TRANSIT,        CANCELLED],
  IN_TRANSIT:        [DELIVERED,         CANCELLED],
  DELIVERED:         [],  // terminal
  CANCELLED:         [],  // terminal
  APPROVED: [], PREPARING: [], PREPARED: [], RECEIVED: [],  // legados, leitura apenas
};
```

A transição `AWAITING_APPROVAL → PENDING` cobre o caso do líder da origem responder "não tenho esse produto" — a loja destino indica outra.

### 6.2 Side effects no ledger por transição

| Transição | Ledger origem | Ledger destino | Outros campos |
|---|---|---|---|
| PENDING criado | nada | nada | — |
| PENDING → AWAITING_APPROVAL | `commitStock` (qtdComprometida ++) | nada | `originIndicatedAt/ById`, `fromStoreId` |
| AWAITING_APPROVAL → PENDING (rejeitada) | `releaseStock` (qtdComprometida --) | nada | `fromStoreId = null` |
| AWAITING_APPROVAL → READY_TO_COLLECT | se NF: `citelTakesOver` (qtdComprometida --) | `markInTransit` (qtdEmTransito ++) | `approvedAt/ById`, `item.teNumber` OU `item.nfCitelNumero` |
| READY_TO_COLLECT → IN_TRANSIT | nada | nada | `collectedAt`, `collectPhotoUrl`, `item.collectConfirmed = true` |
| IN_TRANSIT → DELIVERED | nada | `reconcileTransfer` (qtdEmTransito --) | `deliveredAt`, `deliveryPhotoUrl`, `deliveredById`, `recipientName`, `item.receivedQty` |

### 6.3 Matriz de cancelamento

| Status na hora do cancel | Origem (fromStore) | Destino (toStore) |
|---|---|---|
| PENDING | nada (não houve commit) | nada |
| AWAITING_APPROVAL | `releaseStock` | nada |
| READY_TO_COLLECT | se TE (sem NF): `releaseStock` | `cancelTransit` |
| IN_TRANSIT | se TE: `releaseStock` | `cancelTransit` |
| DELIVERED | terminal — não cancela | — |

### 6.4 Mudança crítica: `commitStock`

**Hoje:** roda na criação da Transfer (`createTransfer`, linha 111-130 de `transferencia.service.ts`), assumindo `fromStoreId` já válido.

**Novo:** move para PENDING → AWAITING_APPROVAL (`indicateOrigin`), porque na criação ainda não existe origem. Durante PENDING, o estoque **não está comprometido em nenhuma loja**.

### 6.5 Funções de service

| Função | O que faz |
|---|---|
| `createTransfer(input)` | Reescrita. Aceita lista de items, faz auto-split: retorna N Transfers (1 por item), todas em PENDING, fromStoreId=null, sem commit. |
| `indicateOrigin(transferId, fromStoreId, by)` | Nova. PENDING → AWAITING_APPROVAL. Pré-check de estoque na origem + commitStock. |
| `approveTransfer(transferId, { teNumber? \| nfNumber }, by)` | Nova. AWAITING_APPROVAL → READY_TO_COLLECT. Persiste TE/NF no item, markInTransit, citelTakesOver se NF. |
| `rejectTransferAtOrigin(transferId, reason, by)` | Nova. AWAITING_APPROVAL → PENDING. releaseStock, limpa fromStoreId. |
| `collectTransfer(transferId, photoUrl, by)` | Nova. READY_TO_COLLECT → IN_TRANSIT. Marca `item.collectConfirmed`, salva foto. |
| `deliverTransfer(transferId, { photoUrl, recipientName, receivedQty }, by)` | Nova. IN_TRANSIT → DELIVERED. reconcileTransfer, dispara `handleTransferDeliveredOnRequest`. |
| `cancelTransfer(transferId, reason, by)` | Refatorada (mesma assinatura, lógica nova baseada na matriz 6.3). |

## 7. APIs

### 7.1 Novas rotas

| Método | Rota | Quem chama | Permissões |
|---|---|---|---|
| `POST` | `/api/transferencias` | vendedor cria (manual ou via /solicitacoes) | qualquer logado |
| `POST` | `/api/transferencias/[id]/indicate-origin` | vendedor da loja destino indica origem | usuário da `toStore` ou PRIVILEGED |
| `POST` | `/api/transferencias/[id]/approve` | líder/vendedor da origem digita TE/NF | usuário da `fromStore` ou PRIVILEGED |
| `POST` | `/api/transferencias/[id]/reject-at-origin` | origem recusa | usuário da `fromStore` ou PRIVILEGED |
| `POST` | `/api/transferencias/[id]/collect` | motorista coleta com foto | DRIVER atribuído ao dispatch |
| `POST` | `/api/transferencias/[id]/deliver` | motorista entrega no destino | DRIVER atribuído ao dispatch |
| `POST` | `/api/transferencias/[id]/cancel` | operador/líder cancela | ADMIN/OPERATOR/STORE_LEADER |
| `GET`  | `/api/transferencias` (existente) | listagem com filtros | igual hoje |

### 7.2 Payloads-chave

```ts
// POST /api/transferencias
{
  deliveryRequestId?: string,
  toStoreId: string,
  priority: TransferPriority,
  notes?: string,
  items: [{ productCode, productName, quantity, unit? }, ...]  // N items → N Transfers
}
// Resposta: { transfers: Transfer[] }

// POST .../indicate-origin
{ fromStoreId: string }
// 422 se estoque indisponível na origem

// POST .../approve
{ teNumber?: string, nfCitelNumero?: string }
// validação: exatamente um dos dois

// POST .../collect
{ photoUrl: string, photoPath: string }

// POST .../deliver
{ photoUrl: string, photoPath: string, recipientName: string, receivedQty: number }
```

### 7.3 Mudança em `app/api/solicitacoes/route.ts:359-426`

Remove o bloco que cria 1 Transfer com fromStoreId placeholder. Substitui por:

```ts
// Para cada missing item, cria 1 Transfer:
//   { toStoreId: data.storeId, fromStoreId: null, status: PENDING, items: [item] }
// Sem commitStock (origem ainda desconhecida).
//
// Mantém o auto-link Citel: se findAutoLinkCandidatesWithProbe encontra PD,
// guarda em linkedCitelStoreCode no item — vira HINT visível na UI da etapa 1
// (não indica automaticamente).
```

### 7.4 Integração com DeliveryRequest

`handleTransferReceivedOnRequest` vira `handleTransferDeliveredOnRequest`. Mesma lógica:
- Marker informativo em DeliveryStatusHistory para cada Transfer ligada que conclui.
- Quando TODAS as Transfers ligadas à DR estão em DELIVERED ou CANCELLED, tenta avançar DR para SEPARADO via state machine.
- Fallback READY preservado (quando o gate falha).
- `notifyOrderSeparated` mantida.

## 8. UI

### 8.1 Abas da tela `/transferencias`

```
[Pendente] [Aguard. aprovação] [Para coletar] [Em rota] [Entregues] [Canceladas]
```

### 8.2 Cards por etapa

**1ª PENDING:** mostra só `toStore` (sem seta). Sugestão Citel visível. Ação primária: "Indicar loja origem".

**2ª AWAITING_APPROVAL:** mostra "Solicitado por: X" + `toStore`. Form de TE/NF. Ações: "Aprovar com TE/NF" / "Recusar".

**3ª READY_TO_COLLECT:** mostra `fromStore` ⇄ `toStore` com ícone. TE/NF exibida. Sem ações operacionais (apenas Cancelar).

**4ª IN_TRANSIT:** `fromStore` ⇄ `toStore`. TE/NF + timestamp da coleta + motorista. Sem ações.

**5ª DELIVERED:** `fromStore` ⇄ `toStore`. TE/NF + recipientName + ambas as fotos.

### 8.3 Auto-filtros por papel (padrão atual)

- STORE_LEADER / SELLER: vê só Transfers onde sua loja é origem OU destino.
- ADMIN / OPERATOR / LOGISTICS_OPERATOR / STOCK_OPERATOR: visão global.

### 8.4 Drawer `/transferencias/[id]`

Timeline visual das 5 etapas com check verde nas concluídas, destaque na atual, datas/usuários em cada transição, fotos de coleta e entrega quando existirem.

### 8.5 App do motorista

Card de Transfer no manifest com ações:
- **Coletar:** foto + 1 toque para confirmar item.
- **Entregar:** foto + nome do recebedor + qty recebida.

Reusa o componente de upload de prova já existente (`delivery-proofs` bucket).

## 9. Migration

Arquivo: `prisma/migration_5_etapas_transfer.sql`. Aplicado via `scripts/apply-migration-5-etapas.mjs` (mesmo padrão dos anteriores).

```sql
-- 1. enum: adiciona valores novos
DO $$ BEGIN
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'AWAITING_APPROVAL';
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'READY_TO_COLLECT';
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 2. transfers: relaxa fromStoreId, novos campos
ALTER TABLE transfers ALTER COLUMN "fromStoreId" DROP NOT NULL;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "originIndicatedAt"   TIMESTAMP(3);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "originIndicatedById" TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveredAt"         TIMESTAMP(3);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveredById"       TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveryPhotoUrl"    TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveryPhotoPath"   TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "recipientName"       TEXT;

-- 3. transfer_items: TE/NF por item, rastreio de coleta
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "teNumber"         TEXT;
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "nfCitelNumero"    TEXT;
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "nfCitelEmitidaAt" TIMESTAMP(3);
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "collectedAt"      TIMESTAMP(3);
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "collectConfirmed" BOOLEAN DEFAULT false;

-- 4. FKs novos (ON DELETE SET NULL)
ALTER TABLE transfers ADD CONSTRAINT IF NOT EXISTS "transfers_originIndicatedById_fkey"
  FOREIGN KEY ("originIndicatedById") REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE transfers ADD CONSTRAINT IF NOT EXISTS "transfers_deliveredById_fkey"
  FOREIGN KEY ("deliveredById") REFERENCES users(id) ON DELETE SET NULL;

-- 5. índices novos
CREATE INDEX IF NOT EXISTS "transfers_status_toStoreId_idx"   ON transfers(status, "toStoreId");
CREATE INDEX IF NOT EXISTS "transfers_status_fromStoreId_idx" ON transfers(status, "fromStoreId");

-- 6. Migração de dados — copia TE/NF da Transfer pro item único
UPDATE transfer_items ti
   SET "teNumber" = t."teNumber",
       "nfCitelNumero" = t."nfCitelNumero",
       "nfCitelEmitidaAt" = t."nfCitelEmitidaAt"
  FROM transfers t
 WHERE ti."transferId" = t.id
   AND ti."teNumber" IS NULL AND ti."nfCitelNumero" IS NULL
   AND (t."teNumber" IS NOT NULL OR t."nfCitelNumero" IS NOT NULL);

-- 7. Migração de status em flight
UPDATE transfers SET status = 'READY_TO_COLLECT'
 WHERE status IN ('APPROVED', 'PREPARING', 'PREPARED');
UPDATE transfers SET status = 'DELIVERED',
                      "deliveredAt" = COALESCE("deliveredAt", "receivedAt")
 WHERE status = 'RECEIVED';

-- 8. CHECK constraint (após migração de dados, pra não bloquear)
ALTER TABLE transfers ADD CONSTRAINT IF NOT EXISTS transfer_origin_required
  CHECK (status IN ('PENDING','CANCELLED') OR "fromStoreId" IS NOT NULL);
```

## 10. Ordem de implementação

| # | Step | Por quê primeiro |
|---|---|---|
| 1 | SQL da migration + script `apply-migration-5-etapas.mjs` | base de tudo |
| 2 | Atualizar `prisma/schema.prisma` + `prisma generate` | tipos pra todo o resto compilar |
| 3 | Refator `services/transferencia.service.ts` | core do domínio |
| 4 | Mover `commitStock` para `indicateOrigin` em stock-ledger | ajuste fundamental do ledger |
| 5 | Criar rotas novas em `app/api/transferencias/[id]/...` | superfície API |
| 6 | Refator `POST /api/transferencias` (auto-split N items) | nova entrada principal |
| 7 | Remover placeholder em `app/api/solicitacoes/route.ts:359-426` | mata a raiz do bug 132→132 |
| 8 | UI `app/(app)/transferencias/page.tsx` — 5 abas, cards condicionais | tela principal |
| 9 | UI drawer `app/(app)/transferencias/[id]/page.tsx` — timeline | detalhe |
| 10 | App do motorista — ações Coletar/Entregar | fechamento operacional |
| 11 | Atualizar tests (pilar1-stock-lock + novos + E2E) | tsc + jest verdes |
| 12 | Aplicar migration no Supabase + push pra main | go-live |

## 11. Testes

| Tipo | Arquivo | O que testa |
|---|---|---|
| Unit | `__tests__/services/transferencia-5-etapas.test.ts` (novo) | cada nova função + matriz de cancelamento |
| Unit | `__tests__/services/pilar1-stock-lock.test.ts` (atualizar) | commitStock agora roda em indicateOrigin |
| Unit | novo | Auto-split: POST com 3 items cria 3 Transfers |
| Unit | novo | CHECK constraint rejeita avanço sem fromStoreId |
| E2E | atualizar `__tests__/e2e/pilar1-staging.e2e.test.ts` | fluxo completo 5 etapas + cascata em DR |

## 12. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Transfers em flight no deploy ficam em status legados sem caminho válido | Migration step 7 move APPROVED/PREPARING/PREPARED → READY_TO_COLLECT e RECEIVED → DELIVERED |
| Transfers RECEIVED antigas com terminal "errado" no histórico | Migration step 7 copia receivedAt → deliveredAt |
| CHECK constraint quebra inserts existentes | Constraint só roda APÓS migração de dados; toda Transfer existente tem fromStoreId (mesmo se placeholder) |
| Code paths que ainda referenciam `RECEIVED` | Greptar antes do step 11; mapear `TransferStatus.RECEIVED`, `APPROVED`, `PREPARING`, `PREPARED`, `transfer.teNumber`, `transfer.nfCitelNumero` |
| Tests E2E que esperam fluxo antigo | Step 11 força atualização; nada vai pra main com tests vermelhos |

## 13. Notas de execução

- Cleanup retroativo de 30 Transfers placeholder >24h já executado em 2026-05-26 via `scripts/cleanup-old-transfers.mjs` + remediation. Base limpa para a migration.
- Convenção do projeto: **UMA migration consolidada** no final, nunca `prisma migrate dev` parcial em DB compartilhado. Ver [[feedback_dev_workflow_logistica]].
- Region `gru1` obrigatório no Vercel (Citel em Oracle SP). Não tocar `vercel.json`.
- Deploy: commit → push main → Vercel deploy automático (projeto `project-skpjf`). Sem build local exigido. Ver [[feedback_deploy_sem_build_local]].
