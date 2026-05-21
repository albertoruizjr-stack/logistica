# Coleta de transferência na roteirização (com foto) — Design v2

**Data:** 2026-05-21
**Status:** Design refinado pelo Alberto — para aprovação final antes do plano detalhado
**Parte 1 (foto ao iniciar rota):** entregue e em produção.

---

## 1. Fluxo NOVO de transferência (redesenhado pelo Alberto)

**Simplificação do ciclo** (remove etapas):
1. Alguém solicita a transferência (PENDING).
2. A **loja de origem AUTORIZA** → ao clicar "Autorizar", **informa o documento da transferência: TE OU NF** + número. Na Citel a transferência pode sair como **TE** (comprovante, NÃO fiscal) ou como **NF** (documento fiscal, com número de NF). Campo obrigatório (tipo + número).
3. **Eliminadas as etapas `PREPARING` ("iniciar preparação") e `PREPARED` ("separada")** + o botão **"Despachar"** do operador. Ao autorizar (+TE), a transferência **já fica disponível para coleta**.
4. A coleta **aparece na página de Roteirização** junto das entregas elegíveis — mas renderizada como **"TE/NF {numero} · loja {origem} → loja {destino}"** (em vez de "NF xxxxx").
5. Botão **"Incluir na rota"** (ao lado de "Criar wave e otimizar") → seleciona a(s) coleta(s) → escolhe a **rota**; o sistema **recomenda o motorista mais próximo** (override por Jane/admin) → a rota do motorista é **atualizada com a parada de coleta**.
6. O motorista, ao chegar na loja de coleta, **seleciona via checkbox quais transferências está levando** (várias por loja) + tira **foto** → as selecionadas viram **IN_TRANSIT**.
7. Recebimento na loja de destino segue como hoje (→ RECEIVED).

**Ciclo resultante:** `PENDING → APPROVED(+TE) → IN_TRANSIT (motorista coleta + foto) → RECEIVED`.

---

## 2. Mudanças na state machine de Transfer
- `VALID_TRANSITIONS` (em `services/transferencia.service.ts`): `APPROVED → [IN_TRANSIT, CANCELLED]` (hoje é `APPROVED → [PREPARING, CANCELLED]`). PREPARING/PREPARED saem do caminho ativo.
- Manter os enums `PREPARING`/`PREPARED` no schema por compatibilidade, mas **não usar** no fluxo novo. **Dados existentes** nesses estados: migrar para `APPROVED` (disponível pra coleta) na migration consolidada.
- A validação atual exige `nfCitelNumero` para ir a `IN_TRANSIT`. Ajustar: IN_TRANSIT exige que a transferência tenha **um documento (TE OU NF)** informado na autorização — `teNumber || nfCitelNumero` — não mais a NF especificamente.

## 3. Aprovar com documento (TE ou NF)
- A ação "Autorizar/Aprovar" (`/transferencias`) passa a pedir **o tipo do documento (TE ou NF) + o número** (obrigatório).
- Armazenar em `Transfer`:
  - **TE** (comprovante, não fiscal) → campo novo **`teNumber String?`**.
  - **NF** (fiscal) → reusar o campo existente **`nfCitelNumero`** (já é a NF da Citel).
  - (Opcional, pra clareza: `transferDocType "TE" | "NF"` derivado de qual campo está preenchido.)
- Nota fiscal-vs-comprovante afeta estoque: hoje `nfCitelNumero` dispara `citelTakesOver()` (libera `qtdComprometida`). Para **TE (não fiscal)** isso pode não se aplicar — revisar o tratamento de estoque pra TE no plano detalhado.
- Endpoint de aprovação atualizado para receber `{ docType: "TE"|"NF", docNumber }` e gravar no campo certo.

## 4. Coleta aparece na Roteirização (como item elegível)
- A página `/roteirizacao` hoje lista entregas `PRONTO_ROTEIRIZACAO`. Passa a listar **também** as transferências `APPROVED` (disponíveis pra coleta), renderizadas como **"TE/NF {número} · {lojaOrigem} → {lojaDestino} · N itens"**.
- Tecnicamente: a lista de elegíveis vira uma união de `{ tipo: "ENTREGA", deliveryRequest }` e `{ tipo: "COLETA", transfer }`. A UI distingue NF vs TE.
- **Botão "Incluir na rota"** (ao lado de "Criar wave e otimizar"), habilitado quando há coleta(s) selecionada(s):
  - abre seletor de **rota** (rotas ACTIVE/DISPATCHED do dia);
  - **recomenda o motorista mais próximo** da loja de origem da coleta (heurística inicial: motorista cuja rota tem parada mais próxima da loja de origem, ou que está geograficamente mais perto) — **Jane/admin podem escolher outro**;
  - ao confirmar, adiciona uma parada de coleta no `sequenceJson` da rota escolhida (ver §5).

## 5. Parada de coleta na rota (várias transferências por loja)
- Estender `RouteSequenceEntry`: tipo `TRANSFER_PICKUP` com **`storeId` (loja de origem)** e **`transferIds: string[]`** (várias transferências da mesma loja numa parada só) — NÃO `transferId` único.
- `isManualStop` continua true (sem `deliveryRequestId`) → não vira Dispatch, não entra em `extractDeliveryRequestIds`.
- Helper `extractTransferIds(seq)` em `lib/route-sequence.ts`.
- Agrupar por loja: ao "incluir na rota", se já existir uma parada `TRANSFER_PICKUP` da mesma loja, **acrescenta o transferId** nela em vez de criar outra.

## 6. App do motorista — coletar com checkbox + foto
- A rota mostra a parada **"Coleta · loja X · N transferências"**.
- Tela de coleta: lista as transferências daquela parada com **checkbox** (motorista marca as que está levando) + **uma foto** (ou foto por transferência — ver decisão) → `POST /api/driver/coletas/...`:
  - sobe a foto; marca as transferências selecionadas `APPROVED → IN_TRANSIT`; grava o comprovante.
- Foto obrigatória (interruptor `REQUIRE_TRANSFER_COLLECT_PHOTO`, default true).

## 7. Remoções (limpeza)
- Botão **"Despachar"** de transferência (operador) — remover.
- Ações **"Iniciar preparação"** (PREPARING) e **"Marcar como separada"** (PREPARED) — remover do fluxo de transferência.
- Revisar a tela `/transferencias` (abas "Para coletar" hoje agrupa APPROVED+PREPARING+PREPARED → passa a ser só APPROVED).

---

## 8. Mudanças de schema (UMA migration consolidada)
- `Transfer`: `teNumber String?` (NF reusa o `nfCitelNumero` existente), `collectPhotoUrl String?`, `collectPhotoPath String?`, `collectedAt DateTime?`.
- Data: transferências em PREPARING/PREPARED → APPROVED.
- `RouteSequenceEntry` é JSON (sem schema).
- Aplicar via SQL idempotente + `scripts/apply-migration.mjs` (regra: nada de `prisma migrate` parcial).

## 9. Decisões — TODAS CONFIRMADAS pelo Alberto (2026-05-21)
1. ✅ **Documento = TE OU NF.** A Citel emite a transferência como TE (comprovante, não fiscal) OU NF (fiscal). A autorização captura tipo + número; TE→`teNumber` (novo), NF→`nfCitelNumero` (existente). IN_TRANSIT exige `teNumber || nfCitelNumero`.
2. ✅ **Recomendação de motorista:** heurística simples no v1 (parada mais próxima da loja de origem), override por Jane/admin.
3. ✅ **Foto na coleta:** uma foto por parada (cobre as transferências marcadas).
4. ✅ **Migrar** transferências PREPARING/PREPARED → APPROVED.
5. ✅ **Autorizar com documento (TE/NF):** na tela web `/transferencias` (loja de origem).

---

## 10. Esboço de implementação (vira plano detalhado após §9)
1. Schema `Transfer` (teNumber + coleta) + migração de dados PREPARING/PREPARED→APPROVED → **uma migration consolidada**.
2. State machine Transfer: APPROVED→IN_TRANSIT; ajuste da regra de TE.
3. Aprovação com TE (endpoint + UI).
4. `lib/route-sequence.ts`: tipo `TRANSFER_PICKUP` (storeId + transferIds[]) + helpers.
5. Roteirização: lista unificada (entregas + coletas TE) + botão "Incluir na rota" + recomendação de motorista + append no sequenceJson (agrupando por loja).
6. App motorista: parada de coleta + checkbox + foto + endpoint que marca IN_TRANSIT.
7. Storage `uploadTransferCollectPhoto` + flag `REQUIRE_TRANSFER_COLLECT_PHOTO`.
8. Remoções: botão Despachar + etapas PREPARING/PREPARED na UI.

## 11. Riscos
- **Mexer na state machine de Transfer + remover estados** afeta fluxos existentes (notificações, StockLedger, `handleTransferReceivedOnRequest`). Mapear todos os usos de PREPARING/PREPARED antes.
- **`nfCitelNumero` exigido para IN_TRANSIT** (`updateTransferStatus`) — reconciliar com o TE.
- **Lista unificada na roteirização** (entregas + coletas) mexe em `nova-wave-form.tsx` e na query de elegíveis — cuidar pra coletas NÃO entrarem na "Criar wave" (wave é só entregas via Spoke).
- **Recomendação de motorista** depende de geo (loja de origem × paradas da rota). Heurística simples no v1.
- Tamanho: feature grande, multi-subsistema. Executar como plano próprio (provável sessão dedicada).
