# Torre de Controle — Design Spec

**Status:** Aprovado para implementação  
**Data:** 2026-05-03  
**Projeto:** sistema_logistica — Mestre da Pintura (5 lojas + CD)

---

## Objetivo

Criar uma camada de auditoria e monitoramento sobre o Citel para controlar:
estoque, transferências, vendas sem estoque, compras e abastecimento.

O sistema_logistica **não substitui o Citel**. O Citel continua sendo a fonte de
verdade para estoque físico, NF, transferências e pedidos. A Torre de Controle lê
do Citel, constrói histórico próprio e gera alertas acionáveis para a equipe.

---

## 1. Arquitetura Geral

```
Citel/Autcom ERP
      ↓ cron por tier (5min / 15min / 1h / 02h00)
Sync Layer → CitelSyncJob + snapshots na DB
      ↓
Audit Engine (14 regras, função pura)
      ↓
Alert Engine (cria, deduplica, agrupa, suprime, escala)
      ↓ revalidação em tempo real antes de ação crítica
  In-app Dashboard + Donna (WhatsApp, críticos only, a partir da Fase 2)
```

### Princípios

| Princípio | Decisão |
|---|---|
| Citel é fonte de verdade | Nunca escrevemos no Citel |
| Nossa DB é fonte de auditoria | Todo histórico de alertas e resoluções fica conosco |
| Revalidação antes de ação crítica | Nenhum alerta crítico vira ação sem confirmar no Citel |
| Anti-spam de WhatsApp | Mesmo alerta não repete antes de 30 min |
| Alertas agrupados com detalhe por SKU | 1 alerta por (loja + tipo + janela), N itens dentro |

---

## 2. Estratégia de Sync (Sync-First)

### Tiers de frequência

| Tier | Frequência | Dados |
|---|---|---|
| **FAST_CRITICAL** | 5 min | Entregas D+1 pendentes; vendas sem estoque CRITICAL/HIGH; transferências com prazo vencendo |
| **FAST_STANDARD** | 15 min | Saldo físico + disponível geral; status de todas as transferências ativas |
| **MEDIUM** | 1 hora | Vendas sem estoque novas; pedidos de compra (status + faturamento); follow-ups vencidos |
| **SLOW** | Diário 02h00 | Histórico de movimentação; recálculo de `avgDailySales`; recálculo ABC (Fase 4) |

### Três camadas de captura

Para cada endpoint ainda não mapeado, o sistema suporta fallback em ordem:

1. **CAMADA 1 — API ideal:** `GET /endpoint-citel` → parse → snapshot. Marcado como `dataConfidence = HIGH`.
2. **CAMADA 2 — CSV/exportação:** upload manual ou FTP de relatório Citel. Mesmo modelo de dados. `dataConfidence = MEDIUM`.
3. **CAMADA 3 — Input manual:** formulário no sistema. Aviso visual "dado inserido manualmente". `dataConfidence = LOW`. Donna **não** dispara automaticamente com `LOW`.

### Status atual dos endpoints Citel

| Prioridade | Dado | Endpoint | Tier | Status |
|---|---|---|---|---|
| P1 | Saldo físico + disponível | `/produtoEstoqueCodigo/{code}` | FAST_STANDARD | ✅ Confirmado |
| P1 | Vendas sem estoque | `/pedidoVenda?semEstoque=true` (a validar) | MEDIUM | A mapear |
| P1 | Transferências entre filiais | `/transferencia` ou `/movimentacaoFilial` | FAST_CRITICAL | A mapear |
| P2 | NF de transferência emitida | `/notaFiscalSaida?tipo=transferencia` | FAST_CRITICAL | A mapear |
| P2 | Pedidos de compra | `/pedidoCompra` | MEDIUM | A mapear |
| P2 | Itens não faturados | `/pedidoCompra/{id}/itens?status=pendente` | MEDIUM | A mapear |
| P3 | Histórico de movimentação | `/movimentacaoEstoque?periodo=` | SLOW | A mapear |
| P3 | Estoque mínimo/máximo | Verificar se `/produtoEstoqueCodigo` já retorna | SLOW | A verificar |

> **Sprint de mapeamento:** 2 dias dedicados a validar todos os endpoints P1 e P2 em
> ambiente real antes da Fase 2. Resultado desbloqueia Fases 2 e 3 integralmente.

### Revalidation Hook

Antes de qualquer ação crítica (criar alerta + disparar Donna), o motor faz um
GET em tempo real no Citel:

```
GET Citel (timeout 5s)
  CONFIRMED  → criar alerta + disparar Donna
  CANCELLED  → registrar como auto-resolvido, não disparar
  ERROR      → marcar NEEDS_MANUAL_CONFIRMATION
                re-tentar em 3 min (máx. 2x)
                se persistir: alerta in-app com badge ⚠️, Donna NÃO dispara
```

Alertas que exigem revalidação: R01b, R03 (curva A), R05 (CRITICAL/HIGH), R06, R07.
Alertas que não exigem: R02, R04, R08, R09, R10, R11–R14.

---

## 3. Modelo de Dados

Seis novos modelos. Os modelos existentes (`Transfer`, `StockLedger`, `DeliveryRequest`)
são apenas lidos pela Torre — nunca escritos por ela.

### `AbcClassification`

| Campo | Tipo | Notas |
|---|---|---|
| `storeId` | String | |
| `productCode` | String | |
| `classification` | `A \| B \| C` | |
| `source` | `MANUAL \| CALCULATED` | |
| `isManualOverride` | Boolean | Sobrescreve cálculo automático |
| `minStock` | Float? | |
| `maxStock` | Float? | |
| `coverageDaysTarget` | Int | A=30, B=15, C=7 (defaults, configurável) |
| `avgDailySales` | Float? | Média de vendas diárias |
| `coverageDaysActual` | Float? | `qtdDisponivel ÷ avgDailySales` |
| `coverageUpdatedAt` | DateTime? | |
| `calculatedAt` | DateTime? | Quando foi calculada automaticamente |

Chave única: `(storeId, productCode)`

### `SaleWithoutStock`

| Campo | Tipo | Notas |
|---|---|---|
| `citelSaleId` | String | ID do pedido no Citel |
| `storeId` | String | |
| `productCode` | String | |
| `qty` | Float | |
| `customerName` | String? | |
| `deliveryDate` | DateTime? | |
| `approvedBy` | String? | Quem liberou no Citel |
| `urgency` | `CRITICAL \| HIGH \| NORMAL` | Calculado de `deliveryDate` |
| `linkedTransferId` | String? | |
| `linkedPurchaseOrderId` | String? | |
| `coverageIsValid` | Boolean? | Cobertura vinculada atende o prazo? |
| `coverageValidatedAt` | DateTime? | |
| `status` | `OPEN \| COVERED \| DELIVERED \| EXPIRED` | |
| `detectedAt` | DateTime | |
| `resolvedAt` | DateTime? | |

**Regra de urgência:**
- `deliveryDate` = hoje ou amanhã → `CRITICAL`
- `deliveryDate` = em 2–3 dias → `HIGH`
- `deliveryDate` > 3 dias ou ausente → `NORMAL`

Recalculada a cada sync (uma venda `NORMAL` pode virar `CRITICAL` sem ação do operador).

### `PurchaseOrder`

| Campo | Tipo | Notas |
|---|---|---|
| `citelOrderId` | String | |
| `storeId` | String | Loja destino |
| `supplierId` | String | |
| `supplierName` | String | |
| `status` | `PLACED \| PARTIALLY_INVOICED \| INVOICED \| OVERDUE \| CANCELLED` | |
| `placedAt` | DateTime | |
| `expectedDeliveryAt` | DateTime? | |
| `deliveredAt` | DateTime? | |
| `lastFollowUpAt` | DateTime? | |
| `followUpStatus` | `NO_ACTION \| CONTACTED \| CONFIRMED \| ESCALATED` | |
| `followUpNotes` | String? | |
| `source` | `API \| CSV \| MANUAL` | |

### `PurchaseOrderItem`

| Campo | Tipo | Notas |
|---|---|---|
| `purchaseOrderId` | String | |
| `productCode` | String | |
| `productName` | String | |
| `orderedQty` | Float | |
| `invoicedQty` | Float | |
| `receivedQty` | Float | |
| `abcClassification` | `A \| B \| C \| null` | |
| `isOverdue` | Boolean | Calculado |

### `CitelSyncJob`

| Campo | Tipo | Notas |
|---|---|---|
| `type` | `STOCK \| TRANSFERS \| SALES \| PURCHASES \| HISTORY \| ABC` | |
| `tier` | `FAST_CRITICAL \| FAST_STANDARD \| MEDIUM \| SLOW` | |
| `status` | `RUNNING \| SUCCESS \| PARTIAL \| FAILED` | |
| `source` | `API \| CSV \| MANUAL` | |
| `dataConfidence` | `HIGH \| MEDIUM \| LOW` | Propagado para alertas gerados |
| `recordsProcessed` | Int | |
| `errors` | Int | |
| `startedAt` | DateTime | |
| `finishedAt` | DateTime? | |
| `errorDetail` | String? | |

### `ControlTowerAlert`

| Campo | Tipo | Notas |
|---|---|---|
| `type` | Enum (14 tipos) | Ver seção de regras |
| `severity` | `CRITICAL \| WARNING \| INFO` | |
| `storeId` | String | |
| `ownerId` | String | Responsável pela resolução |
| `notifiedUserIds` | String[] | Notificados além do owner |
| `actionType` | `AlertActionType` | Ver enum abaixo |
| `slaDeadline` | DateTime | |
| `status` | `PENDING \| IN_PROGRESS \| RESOLVED \| CANCELLED \| SNOOZED \| NEEDS_MANUAL_CONFIRMATION \| CRITICAL_UNRESOLVED` | |
| `escalationLevel` | `L1 \| L2 \| L3 \| null` | |
| `escalatedAt` | DateTime? | |
| `escalatedToId` | String? | |
| `groupKey` | String | `{storeId}_{ruleId}_{janelaTempo}` |
| `suppressedBy` | String? | ID do alerta dominante |
| `suppressedAt` | DateTime? | |
| `resolvedById` | String? | |
| `resolvedAt` | DateTime? | |
| `resolution` | String? | |
| `revalidatedAt` | DateTime? | |
| `revalidationResult` | `CONFIRMED \| CANCELLED \| ERROR \| null` | |
| `dataConfidence` | `HIGH \| MEDIUM \| LOW` | Herdado do sync job |
| `whatsappSentAt` | DateTime? | |
| `snoozedUntil` | DateTime? | |

**Enum `AlertActionType`:**
`CREATE_TRANSFER | PLACE_PURCHASE_ORDER | CONFIRM_RECEIPT | RESOLVE_DIVERGENCE | CONTACT_SUPPLIER | LINK_COVERAGE | REVIEW_STOCK | INFO_ONLY`

### `ControlTowerAlertItem`

| Campo | Tipo | Notas |
|---|---|---|
| `alertId` | String | FK → ControlTowerAlert |
| `productCode` | String | |
| `productName` | String | |
| `abcClassification` | `A \| B \| C \| null` | |
| `metricValue` | Float | Número que gerou o alerta |
| `metricUnit` | String | `"dias"`, `"unidades"`, `"%"` |
| `suggestedSourceStoreId` | String? | Para R01a: loja com excesso disponível |
| `suggestedSourceQty` | Float? | Qty disponível nessa loja |
| `detail` | Json | Campos extras por tipo de regra |

---

## 4. Motor de Auditoria — 14 Regras

### Hierarquia de supressão por SKU

Quando múltiplas regras disparam para `(storeId, productCode)`, apenas a de
maior prioridade gera alerta ativo. As demais ficam `SUPPRESSED_BY`.

```
P1 — Entrega/Venda:    R07, R06, R05 (urgency CRITICAL)
P2 — Ruptura:          R01, R03 (curva A)
P3 — Estoque geral:    R02, R03 (B/C), R05 (urgency NORMAL), R08, R09, R10
P4 — Otimização:       R04, R13, R14
```

Quando o alerta dominante é resolvido, os suprimidos são reavaliados no próximo ciclo.

### Grupo 1 — Estoque e Ruptura

**R01a — Ruptura iminente: transferência interna disponível**
- Condição: `coverageDaysActual < coverageDaysTarget` (curva A) E outra loja tem `qtdDisponivel > minStock + qtdNecessária`
- Severidade: `WARNING`
- ActionType: `CREATE_TRANSFER`
- Owner: líder loja origem (sistema indica qual loja)
- SLA: 8h · Revalidação: não

**R01b — Ruptura iminente: sem estoque em rede**
- Condição: `coverageDaysActual < coverageDaysTarget` (curva A) E nenhuma loja tem saldo suficiente
- Severidade: `CRITICAL`
- ActionType: `PLACE_PURCHASE_ORDER`
- Owner: Fernanda
- SLA: 4h · Revalidação: sim

**R02 — Alerta preventivo: SKU curva B**
- Condição: `coverageDaysActual < coverageDaysTarget × 1.5` (curva B)
- Severidade: `WARNING`
- ActionType: `CREATE_TRANSFER` ou `PLACE_PURCHASE_ORDER`
- Owner: Fernanda
- SLA: 24h · Revalidação: não

**R03 — Estoque abaixo do mínimo**
- Condição: `qtdDisponivel < minStock` E `minStock != null` (só dispara quando mínimo está cadastrado)
- Severidade: `CRITICAL` (curva A) / `WARNING` (B/C)
- ActionType: `CREATE_TRANSFER` ou `PLACE_PURCHASE_ORDER`
- Owner: Fernanda
- SLA: 4h (A) / 24h (B/C) · Revalidação: sim (A), não (B/C)

**R04 — Excesso → sugestão de transferência**
- Condição: loja X tem `qtdDisponivel > maxStock × 1.2` E loja Y tem cobertura baixa
- Severidade: `INFO`
- ActionType: `CREATE_TRANSFER`
- Owner: líder loja origem
- SLA: 48h · Revalidação: não

### Grupo 2 — Venda sem Estoque

**R05 — Venda sem estoque sem cobertura válida**
- Condição: `SaleWithoutStock.status = OPEN` E (`linkedTransferId = null` E `linkedPurchaseOrderId = null`) OU `coverageIsValid = false`
- Severidade: `CRITICAL` (urgency CRITICAL/HIGH) / `WARNING` (NORMAL)
- ActionType: `LINK_COVERAGE`
- Owner: líder loja destino
- SLA: 2h (CRITICAL) / 8h (HIGH) / 24h (NORMAL) · Revalidação: sim (CRITICAL/HIGH)

**R06 — Cobertura vinculada em risco de prazo**
- Condição: `SaleWithoutStock` com transferência vinculada E `Transfer.status ≠ RECEIVED` E entrega amanhã E `estimatedArrival > deliveryDate − 2h`
- Severidade: `CRITICAL`
- ActionType: `CONFIRM_RECEIPT`
- Owner: Jane
- SLA: até 8h do dia da entrega · Revalidação: sim

### Grupo 3 — Transferências

**R07 — Entrega D+1: item não coberto**
- Condição: `DeliveryRequest.scheduledFor = amanhã` E item sem estoque disponível E sem transferência `RECEIVED` válida
- Severidade: `CRITICAL` · Estado: `DELIVERY_AT_RISK`
- ActionType: `CONFIRM_RECEIPT`
- Owner: Jane
- SLA e escalonamento:
  - L1 às 20h D-1 → Donna para Jane + grupo logística
  - L2 às 22h D-1 → Donna para Alberto
  - L3 às 06h D-day → Donna para todo grupo + Alberto · status `CRITICAL_UNRESOLVED`
- Revalidação: sim

**R08 — Transferência não efetivada no prazo**
- Condição: `Transfer.status ∈ {PENDING, APPROVED, PREPARING}` E `estimatedArrival < now()`
- Severidade: `WARNING`
- ActionType: `REVIEW_STOCK`
- Owner: loja origem
- SLA: 2h · Revalidação: não

**R09 — NF emitida sem recebimento confirmado**
- Condição: `Transfer.nfCitelNumero ≠ null` E `status ≠ RECEIVED` E `nfCitelEmitidaAt < now() − 24h`
- Severidade: `WARNING`
- ActionType: `CONFIRM_RECEIPT`
- Owner: loja destino
- SLA: 24h · Revalidação: não

**R10 — Divergência de transferência em aberto**
- Condição: `TransferDivergence.status = PENDING_RESOLUTION` E `deadline < now()`
- Severidade: `WARNING`
- ActionType: `RESOLVE_DIVERGENCE`
- Owner: loja destino
- SLA: 24h · Revalidação: não

### Grupo 4 — Compras

**R11 — Pedido de compra vencido: severidade por cobertura**

| Curva + cobertura | Severidade | SLA |
|---|---|---|
| A + < 3 dias | CRITICAL | 2h |
| A + 3–7 dias | CRITICAL | 4h |
| A + > 7 dias | WARNING | 8h |
| B + < 5 dias | WARNING | 8h |
| B/C + > 5 dias | INFO | 24h |

- ActionType: `CONTACT_SUPPLIER`
- Owner: Fernanda · Revalidação: não

**R12 — Item curva A não faturado com cobertura em risco**
- Condição: `PurchaseOrderItem.abcClassification = A` E `invoicedQty < orderedQty` E `coverageDaysActual < coverageDaysTarget`
- ActionType: `CONTACT_SUPPLIER` (ação primária)
- Se outra loja tem saldo: preencher `suggestedSourceStoreId` no `ControlTowerAlertItem` sinalizando transferência paliativa possível — não cria um segundo alerta
- Severidade: `CRITICAL`
- Owner: Fernanda
- SLA: 4h · Escalonamento: Alberto se `followUpStatus = NO_ACTION` após 4h · Revalidação: não

**R13 — Follow-up vencido sem ação**
- Condição: `PurchaseOrder.followUpStatus = NO_ACTION` E pedido vencido há > 24h
- Severidade: `WARNING`
- ActionType: `CONTACT_SUPPLIER`
- Owner: Fernanda
- SLA: 8h · Revalidação: não

**R14 — Divergência na entrada de compra**
- Condição: `PurchaseOrderItem.receivedQty ≠ invoicedQty`
- Severidade: `WARNING`
- ActionType: `RESOLVE_DIVERGENCE`
- Owner: Fernanda
- SLA: 48h · Revalidação: não

### Deduplicação e agrupamento

```
groupKey = "{storeId}_{ruleId}_{janela}"

Janela por severidade:
  CRITICAL → 30 min
  WARNING  → 2 horas
  INFO     → 24 horas
```

Dentro de cada alerta: `ControlTowerAlertItem` lista SKUs individualmente, curva A sempre no topo.

---

## 5. SLAs e Responsáveis

| Regra | Severidade | Owner | Notificados | SLA | Escalonamento |
|---|---|---|---|---|---|
| R01a Ruptura → transferência | WARNING | Líder loja origem | Líder destino | 8h | Fernanda após 8h |
| R01b Ruptura → compra | CRITICAL | Fernanda | Gerente da loja | 4h | Alberto após 4h |
| R02 Alerta SKU B | WARNING | Fernanda | — | 24h | — |
| R03 Abaixo mínimo (A) | CRITICAL | Fernanda | Gerente da loja | 4h | Alberto após 4h |
| R03 Abaixo mínimo (B/C) | WARNING | Fernanda | — | 24h | — |
| R04 Excesso → sugestão | INFO | Líder origem | Líder destino | 48h | — |
| R05 Venda s/ cobertura CRITICAL | CRITICAL | Líder destino | Grupo logística | 2h | Jane após 2h |
| R05 Venda s/ cobertura HIGH | WARNING | Líder destino | Grupo logística | 8h | — |
| R06 Cobertura em risco | CRITICAL | Jane | Grupo logística | até 8h entrega | Alberto se não resolvido |
| R07 Entrega D+1 (L1) | CRITICAL | Jane | Grupo logística | 20h D-1 | L2 às 22h · L3 às 6h |
| R08 Transfer vencida | WARNING | Loja origem | Líder destino | 2h | — |
| R09 NF sem recebimento | WARNING | Loja destino | Loja origem | 24h | — |
| R10 Divergência transfer | WARNING | Loja destino | Loja origem | 24h | — |
| R11 Pedido vencido (A<3d) | CRITICAL | Fernanda | — | 2h | Alberto após 2h |
| R12 Item A sem faturar | CRITICAL | Fernanda | — | 4h | Alberto após 4h |
| R13 Follow-up vencido | WARNING | Fernanda | — | 8h | — |
| R14 Divergência compra | WARNING | Fernanda | — | 48h | — |

**Regra geral:** qualquer alerta CRITICAL que atinge 100% do SLA sem resolução
notifica Alberto via Donna com resumo do impacto operacional.

---

## 6. Telas

| Tela | Foco | Fase |
|---|---|---|
| T1 — Dashboard Torre de Controle | Visão geral: contadores por severidade, mapa de saúde por loja, últimos críticos | 1A |
| T2 — Ruptura e Risco de Ruptura | SKUs com cobertura abaixo do alvo, agrupados por loja e curva ABC | 1B |
| T3 — Vendas sem Estoque | Lista de SaleWithoutStock com urgência, cobertura e validade da cobertura | 3 |
| T4 — Transferências Pendentes | Todas as transferências ativas com prazo, divergência e flag de entrega vinculada | 2 |
| T5 — Entregas D+1 com Pendência | DeliveryRequests de amanhã com itens DELIVERY_AT_RISK e nível de escalonamento | 2 |
| T6 — Compras: Pedidos Realizados | PurchaseOrders com status, fornecedor, prazo e followUpStatus | 3 |
| T7 — Compras: Não Faturadas | PurchaseOrderItems onde invoicedQty < orderedQty e prazo vencido | 3 |
| T8 — Ranking de Disciplina | % alertas resolvidos no SLA, tempo médio, divergências abertas por loja | 4 |

---

## 7. Backend — Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Sync Orchestrator | `services/torre/sync-orchestrator.service.ts` | Agenda e executa jobs por tier. Registra CitelSyncJob. |
| Citel Adapters | `services/torre/citel-adapters/` | Um adapter por tipo de dado. Implementa as 3 camadas (API → CSV → manual). |
| Audit Engine | `services/torre/audit-engine.service.ts` | Avalia as 14 regras. Função pura — sem efeitos colaterais. |
| Alert Engine | `services/torre/alert-engine.service.ts` | Cria, deduplica, agrupa, suprime e escala alertas. |
| Revalidation Service | `services/torre/revalidation.service.ts` | Hook de revalidação em tempo real com retry e NEEDS_MANUAL_CONFIRMATION. |
| Notification Dispatcher | `services/torre/notification-dispatcher.service.ts` | Decide canal, aplica anti-spam, agrupa por loja. Donna apenas a partir da Fase 2. |

**API Routes:**

```
GET   /api/torre/dashboard
GET   /api/torre/alertas               (paginado, filtros)
PATCH /api/torre/alertas/[id]          (status, resolução)
POST  /api/torre/alertas/[id]/revalidar
GET   /api/torre/ruptura               (T2)
GET   /api/torre/vendas-sem-estoque    (T3)
GET   /api/torre/transferencias        (T4)
GET   /api/torre/entregas-risco        (T5)
GET   /api/torre/compras               (T6 e T7)
GET   /api/torre/ranking               (T8)
POST  /api/torre/abc                   (cadastro ABC manual)
POST  /api/torre/sync/upload-csv       (upload exportação Citel)
```

**Resolução de owners em tempo de execução:**

Os owners nas regras são papéis, não IDs fixos. O Alert Engine resolve o `ownerId` no momento da criação do alerta usando a seguinte precedência:
- "Fernanda (compras)" → `User` com `role = OPERATOR` e tag `compras` (configurável em SystemConfig)
- "Jane (logística)" → `User` com `role = OPERATOR` e tag `logistica`
- "Líder loja X" → `User` com `role = OPERATOR` vinculado à `storeId` do alerta
- "Alberto" → `User` com `role = ADMIN`

Se o owner não for encontrado, o alerta é criado com `ownerId = null` e badge "sem responsável definido" no dashboard.

**Vínculo central entre entidades:**

```
SaleWithoutStock ──→ Transfer (linkedTransferId)
SaleWithoutStock ──→ PurchaseOrder (linkedPurchaseOrderId)
ControlTowerAlert ──→ ControlTowerAlertItem (SKUs afetados)
ControlTowerAlert ──→ ControlTowerAlert (suppressedBy)
PurchaseOrderItem ──→ AbcClassification
DeliveryRequest ──→ Transfer ──→ StockLedger (existente)
```

---

## 8. MVP em Fases

### Fase 1A — Fundação operacional (semana 1–2)
- Modelos no banco: `AbcClassification`, `CitelSyncJob`, `ControlTowerAlert`, `ControlTowerAlertItem`
- ABC manual para curva A (cadastro via formulário)
- Sync FAST_STANDARD de estoque (extensão do `syncFromCitel` existente)
- Regras R03 (abaixo do mínimo) e R10 (divergência de transferência aberta)
- Dashboard T1: contadores + mapa de saúde por loja
- Alertas in-app apenas

**O que isso resolve imediatamente:** visibilidade de quais lojas estão com estoque abaixo
do mínimo e divergências de transferência sem resolução.

### Fase 1B — Ruptura e alertas (semana 3)
- Regra R01b (ruptura → compra, sem estoque em rede)
- Tela T2 (ruptura e risco de ruptura)
- `coverageDaysActual` calculado com `avgDailySales` estimada (manual inicialmente)
- Alertas in-app com `actionType` visível e botão de resolução

### Fase 2 — Operação core de transferências (semana 4–5)
- Sprint de mapeamento Citel (2 dias): endpoints P1 de transferências e vendas
- Sync de transferências entre filiais
- Regras R07 (entrega D+1), R08 (transfer vencida), R09 (NF sem recebimento)
- Telas T4 (transferências pendentes) e T5 (entregas D+1)
- Escalonamento automático de R07 (L1 → L2 → L3)
- **Donna ativa** para alertas CRITICAL (R07, R01b, R03 curva A)

### Fase 3 — Vendas e compras (semana 6–8)
- Sprint de mapeamento Citel: endpoints P2 (pedidos de compra, itens não faturados)
- Modelos `SaleWithoutStock`, `PurchaseOrder`, `PurchaseOrderItem`
- Regras R05, R06, R11, R12, R13, R14
- Telas T3 (vendas sem estoque), T6 (compras realizadas), T7 (não faturadas)
- Vínculo venda ↔ transferência ↔ compra

### Fase 4 — Inteligência (semana 9–10)
- Cálculo automático de `avgDailySales` e `coverageDaysActual` via histórico SLOW
- Recálculo periódico da curva ABC (com override manual preservado)
- Regras R01a (ruptura → verificar rede), R02 (alerta SKU B), R04 (excesso → sugestão)
- Tela T8 (ranking de disciplina por loja)

---

## 9. Fora do Escopo

- Substituição do Citel
- Emissão de NF pelo sistema_logistica
- Integração bidirecional com Citel (escrita)
- App mobile (operação via browser/WhatsApp)
- Integração com fornecedores externos
