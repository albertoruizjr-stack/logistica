# Correção do número do pedido (PD) — Design

**Data:** 2026-05-25
**Tela:** card de solicitação em `/operacao` (workqueue)
**Tipo:** nova funcionalidade (edição de dados + re-sincronização com o ERP)

## Problema

Ao criar uma solicitação de entrega, o vendedor informa o número do **pedido (PD)**, e o
sistema consulta o Citel para puxar cliente, itens, peso e endereço. Quando o vendedor
digita por engano o número da **NF** no lugar do PD, a consulta traz os dados de outro
pedido — frequentemente um pedido de balcão, cujo cliente é **"CONSUMIDOR"**. A solicitação
fica com cliente, itens e endereço errados, e hoje **não há como corrigir** o número — só
cancelar e recriar.

## Objetivo

Permitir corrigir o número do pedido de uma solicitação **PENDENTE**, re-buscando todos os
dados do pedido correto no Citel e substituindo-os na solicitação existente, com uma tela de
conferência antes de aplicar e registro de auditoria.

## Decisões (validadas com o Alberto)

1. **Comportamento:** re-busca tudo do Citel (cliente, documento, endereço, itens, peso,
   entrega-CD) e mostra um **preview** para o operador confirmar antes de aplicar.
2. **Localização:** ícone de lápis (✏️) ao lado do número do PD no cabeçalho do card.
3. **Quando:** apenas no status `PENDING`.
4. **Quem:** operadores (`ADMIN`, `OPERATOR`, `LOGISTICS_OPERATOR`, `STOCK_OPERATOR`,
   `STORE_LEADER`) **e** o vendedor que criou a solicitação (`sellerId === session.userId`).

## Fonte de verdade / reúso

- O **preview** e a **aplicação** usam o MESMO endpoint de correção (`PATCH .../corrigir-pedido`),
  diferenciados por um parâmetro `dryRun`. Isso evita o frontend precisar descobrir o código da
  loja do pedido — o backend já conhece a `orderStore` da solicitação e re-valida tudo (fonte
  única de verdade). Em `dryRun`, o service re-busca e retorna o preview sem persistir nada.
- `fetchPedidoCabecalho(orderNumber, storeCode)` (`services/citel.service.ts`) — cabeçalho:
  `nomeCliente`, `documento`, endereços, `status`, `entregaPeloCD`, `codigoEmpresaCD`.
- `enrichDeliveryRequestStock(orderNumber, storeCode, codigoEmpresaCitel)`
  (`services/citel-stock.service.ts`) — itens com estoque, `isEntregaCD`, totais.
- `classifyOrderStatus` + `BLOCKED_MESSAGES` estão hoje **dentro** de
  `app/api/erp/pedido/route.ts`. Serão **extraídos** para um módulo compartilhado
  (`lib/erp-order-status.ts`) para que o route handler e o novo service usem a mesma
  classificação (DRY) — sem duplicar regra de negócio.

## Fluxo

1. No card **PENDENTE**, quem tem permissão vê o ✏️ ao lado de "PD 11633".
2. Clica → abre o modal **"Corrigir número do pedido"** (campo com o número + botão Buscar).
3. Buscar → `PATCH .../corrigir-pedido` com `dryRun: true` → o service re-busca e valida, e
   retorna o **preview** (cliente, documento, endereço, itens, peso, entrega-CD) sem persistir.
   Erros bloqueiam a confirmação com mensagem clara:
   - pedido inexistente / cancelado / bloqueado / já faturado;
   - já existe outra solicitação **ativa** (status ≠ CANCELLED) com esse número/loja.
4. Operador confere e clica **Confirmar correção**.
5. `PATCH .../corrigir-pedido` com `dryRun: false` → o service re-busca, valida de novo e
   atualiza tudo numa **transação**.

## Componentes

- **`lib/erp-order-status.ts`** (novo): `classifyOrderStatus(rawStatus)` e `BLOCKED_MESSAGES`,
  movidos de `app/api/erp/pedido/route.ts` (que passa a importar daqui).
- **`services/corrigir-pedido.service.ts`** (novo): `corrigirPedido({ requestId,
  newOrderNumber, actorId, actorRole, dryRun })`. Lógica testável; re-busca + validação;
  quando `dryRun` retorna só o preview, senão aplica a atualização transacional.
- **`app/api/solicitacoes/[id]/corrigir-pedido/route.ts`** (novo, PATCH): valida sessão,
  permissão e status `PENDING`; delega ao service (repassa `dryRun` do body); traduz erros em HTTP.
- **`components/operacao/CorrigirPedidoModal.tsx`** (novo): modal de busca + preview +
  confirmação (segue o padrão de `MarkDeliveredModal.tsx`). Usa o endpoint de correção com
  `dryRun: true` para o preview e `dryRun: false` para aplicar.
- **`components/operacao/DeliveryCard.tsx`** (modifica): adiciona o ✏️ no cabeçalho, visível
  só quando `status === PENDING` e o usuário tem permissão; abre o modal.

## O que o service atualiza (transação única)

A partir do pedido correto re-buscado:
- `orderNumber` (novo);
- `customerName`, `customerPhone`, `customerDoc`;
- endereço de entrega: `deliveryAddress` (texto) + `deliveryCity`/`deliveryState` do pedido
  correto, e **geocodificação** do novo endereço via `geocodeAddress` (`lib/google-maps.ts`)
  para preencher `deliveryLat`/`deliveryLng`. Se o geocoding falhar, salva o endereço sem
  coordenadas — o pipeline de roteirização já lida com DRs sem coords (geocoda depois);
- `entregaPeloCD` e `dispatchStoreId` (recalculados);
- **itens**: apaga os `DeliveryItem` antigos e cria os do pedido correto;
- totais: `totalWeightKg`, `totalLatas`, `volumeBreakdown`, `hasMissingWeights`,
  `stockValidationStatus`, `stockFetchedAt`;
- marcador de auditoria em `DeliveryStatusHistory`: `fromStatus = toStatus = PENDING`,
  `metadata.event = "ORDER_NUMBER_CORRECTED"` com `oldOrderNumber`, `newOrderNumber`,
  `correctedBy`.

O status **permanece PENDING** (correção não é transição de fase).

## Validações e erros

| Situação | Resultado |
|----------|-----------|
| Solicitação não está em `PENDING` | 409 — "Só é possível corrigir pedidos pendentes." |
| Sem permissão (não-operador e não é o vendedor dono) | 403 |
| Pedido novo não encontrado no Citel | 404 — mensagem clara |
| Pedido novo cancelado/bloqueado/já faturado | 422 — mensagem de `BLOCKED_MESSAGES` |
| Já existe solicitação ativa com o novo número/loja | 409 — "Já existe solicitação para este pedido." |
| Citel fora do ar (sem como validar) | 503 — não aplica; orienta tentar depois |
| Novo número igual ao atual | 400 — "O número informado é o mesmo já cadastrado." |

## Não-objetivos (YAGNI)

- Não corrigir a **loja do pedido** (`orderStoreId`) — só o número. (Se a loja também
  estiver errada, o caminho continua sendo cancelar e recriar.)
- Não permitir correção fora de `PENDING` (transferências/separação/NF já envolvidas).
- Não editar manualmente campos do cliente — a fonte é sempre o Citel.
- Não tocar no fluxo de criação (`POST /api/solicitacoes`) além da extração do helper de status.

## Casos de borda

- **Pedido correto sem itens no Citel:** `enrichDeliveryRequestStock` retorna `null` →
  trata como Citel indisponível/sem itens; não aplica e avisa (evita zerar os itens).
- **Citel devolve cabeçalho mas falha nos itens:** mesma proteção — não aplica correção
  parcial.
- **Concorrência:** se a solicitação saiu de `PENDING` entre o preview e o confirmar, o
  service revalida o status e recusa (409).

## Testes

`services/corrigir-pedido.service.ts` isolado (mock do Citel e do Prisma):
- re-busca OK → substitui dados e itens, recalcula totais, grava marcador de auditoria;
- pedido cancelado → bloqueia (não altera nada);
- pedido inexistente / sem itens → bloqueia;
- duplicata ativa com o novo número → bloqueia;
- status ≠ PENDING → bloqueia;
- novo número == atual → bloqueia.

`lib/erp-order-status.ts`: testes de `classifyOrderStatus` (CANCEL/BLOQ/aprovação/faturado/VALID).

## Verificação

- `npx tsc --noEmit` limpo.
- `npx vitest run` dos arquivos novos verde.
- Conferência visual em `/operacao`: ✏️ aparece só em PENDENTE e com permissão; modal busca,
  faz preview, bloqueia pedido inválido, e ao confirmar a solicitação passa a mostrar o
  cliente/itens corretos.
