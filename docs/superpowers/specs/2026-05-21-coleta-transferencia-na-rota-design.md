# Coleta de transferência como parada do roteiro (com foto) — Design

**Data:** 2026-05-21
**Status:** Design para aprovação (Parte 2 do pedido "foto ao iniciar rota / coletar transferência")
**Parte 1 (foto ao iniciar rota):** já entregue e em produção.

---

## 1. Fluxo desejado (descrito pelo Alberto)

1. Operador solicita a transferência, vincula o pedido, a loja separa.
2. **A Jane (logística) inclui a coleta na rota de um motorista.**
3. Isso vira uma parada no roteiro do motorista: **"coleta loja X"**.
4. O motorista, ao coletar, **tira uma foto pra comprovar a coleta** — exatamente como a foto que comprova a entrega.

Ou seja: a coleta passa a ser uma **parada da rota** com **prova por foto**, e marca a transferência como coletada (PREPARED → IN_TRANSIT).

---

## 2. O que já existe (base)

- **Rotas** têm `sequenceJson` com paradas: `DELIVERY` (`deliveryRequestId`) e paradas manuais `STORE_VISIT` / `EXTRA_STOP` (sem `deliveryRequestId`). Helpers em `lib/route-sequence.ts` (`isManualStop`, `extractDeliveryRequestIds`).
- **Não há** vínculo de `transferId` em paradas, nem prova de coleta.
- **Transfer** state machine: PENDING→APPROVED→PREPARING→**PREPARED**→**IN_TRANSIT**→RECEIVED (`services/transferencia.service.ts`, `updateTransferStatus`). Coleta = PREPARED→IN_TRANSIT.
- App do motorista (`app/(driver)/motorista/page.tsx`) já renderiza paradas e lida com `STORE_VISIT`. Upload de foto via `lib/supabase-storage.ts` + `compressImage`. Padrão de prova: `DeliveryProof` + `uploadProofPhoto`.
- Já existe `addExtraStopToRoute` (`app/(app)/roteirizacao/[id]/_components/add-extra-stop-button.tsx`) que adiciona paradas manuais — base pro fluxo da Jane.

---

## 3. Design proposto

### 3.1 Parada de coleta na rota (novo tipo)
Estender `RouteSequenceEntry` com um tipo `TRANSFER_PICKUP`:
```
{ stopPosition?, type: "TRANSFER_PICKUP", transferId: string, storeId: string /* loja de origem (coleta) */, label? }
```
- `isManualStop` continua true (sem `deliveryRequestId`), então **não gera Dispatch nem entra em `extractDeliveryRequestIds`** — não quebra despacho/roteirização.
- Adicionar helper `extractTransferPickupIds(seq)` em `lib/route-sequence.ts`.

### 3.2 Jane inclui a coleta numa rota (fluxo novo)
UI pra Jane escolher uma transferência **PREPARED** (separada, aguardando coleta) e atribuí-la à rota de um motorista.
- Local sugerido: na tela `/transferencias` (aba "Para coletar"), botão **"Incluir na rota de…"** → escolhe o motorista (com rota ACTIVE/DISPATCHED do dia) → adiciona um stop `TRANSFER_PICKUP` no `sequenceJson` da rota.
- Endpoint: `POST /api/transferencias/[id]/incluir-na-rota` `{ routeId }` → valida transfer PREPARED + rota do motorista → faz push do stop no `sequenceJson`.
- (Reusar a mecânica de `addExtraStopToRoute`.)

### 3.3 Motorista coleta com foto (app do motorista)
- A rota do motorista passa a mostrar as paradas `TRANSFER_PICKUP` ("Coleta · Loja X · N itens").
- Tela/ação de coleta: botão **"Coletar (com foto)"** → câmera → foto → `POST /api/driver/transferencias/[id]/coletar` (multipart).
- O endpoint: valida que a transfer está numa rota do motorista logado; sobe a foto; marca a transferência **PREPARED → IN_TRANSIT** via `updateTransferStatus`; grava a foto de coleta.

### 3.4 Prova de coleta (onde guardar)
Opção recomendada: **campos na `Transfer`** — `collectPhotoUrl String?`, `collectPhotoPath String?`, `collectedAt DateTime?`. (Simples; uma coleta = uma foto.)
- Storage: `uploadTransferCollectPhoto(transferId, …)` (mirror de `uploadRouteStartPhoto`), path `transfer_{id}/COLLECT_{ts}.{ext}`.

### 3.5 Foto obrigatória? (interruptor)
`REQUIRE_TRANSFER_COLLECT_PHOTO` no `SystemConfig` (mesmo padrão dos outros). Começar **obrigatória** (a coleta precisa da foto pra avançar) — confirmar com o Alberto.

---

## 4. Mudanças de schema (UMA migration consolidada, ao final)
- `Transfer`: `collectPhotoUrl String?`, `collectPhotoPath String?`, `collectedAt DateTime?`.
- (RouteSequenceEntry é JSON — sem schema.)
- Aplicar via SQL idempotente + `scripts/apply-migration.mjs` (regra de dev: nada de `prisma migrate` parcial).

---

## 5. Decisões em aberto (precisam do Alberto antes do plano detalhado)
1. **Onde a Jane inclui a coleta:** na `/transferencias` (aba Para coletar) — confirmar, ou prefere em outro lugar (ex.: dentro da tela da rota em `/roteirizacao/[id]`)?
2. **Foto da coleta obrigatória** desde já (bloqueia PREPARED→IN_TRANSIT sem foto)? (Recomendado sim.)
3. **Granularidade:** uma transferência por parada de coleta (recomendado), ou agrupar várias coletas da mesma loja numa parada só?
4. **Quem mais pode coletar:** só o motorista no app, ou o operador também (fallback)?

---

## 6. Esboço de implementação (vira plano detalhado após as decisões)
1. Schema `Transfer` (3 campos) + migration consolidada.
2. `lib/route-sequence.ts`: tipo `TRANSFER_PICKUP` + `extractTransferPickupIds`.
3. `lib/supabase-storage.ts`: `uploadTransferCollectPhoto`.
4. `services/system-config.service.ts`: `isTransferCollectPhotoRequired`.
5. Jane: endpoint `incluir-na-rota` + botão na `/transferencias`.
6. Motorista: render do stop `TRANSFER_PICKUP` na rota + endpoint `coletar` + UI de câmera.
7. (Opcional) refletir a coleta no manifest/contagem da rota.

---

## 7. Riscos
- Mexer no `sequenceJson` exige cuidado pra não quebrar despacho/roteirização (paradas de coleta NÃO podem virar Dispatch nem entrar em `extractDeliveryRequestIds`). Coberto por `isManualStop`.
- `updateTransferStatus(PREPARED→IN_TRANSIT)` exige `nfCitelNumero`? Verificar (a validação atual exige nfCitelNumero pra IN_TRANSIT) — pode precisar de ajuste pro fluxo de coleta do motorista.
