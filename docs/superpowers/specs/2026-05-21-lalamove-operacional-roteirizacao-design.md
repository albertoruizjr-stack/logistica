# Lalamove operacional — botão na roteirização, rastreamento e custo no dashboard

**Data:** 2026-05-21
**Status:** Aprovado (design) — pronto para plano de implementação
**Escopo:** Fase 1 (este spec). Multi-parada e WhatsApp automático ficam para a Fase 2.

---

## 1. Contexto e motivação

O app de logística (`sistema-logistica`, Next.js 14 / Prisma / Supabase) já tem
**toda a integração de baixo nível com o Lalamove** construída:

- `services/lalamove.service.ts` — cotar, criar pedido, status, cancelar, verificar webhook (HMAC-SHA256).
- `lib/lalamove-dispatch.ts` — orquestra cotação → criação de pedido; retorna `shareLink`.
- `services/despacho.service.ts` `createDispatch` — quando o modal decidido é `LALAMOVE`,
  chama `dispatchViaLalamove` **fora da transação** e persiste `LalamoveOrder` + atualiza `Dispatch`.
- Banco: `Dispatch` (modal `LALAMOVE`, `estimatedCost`/`actualCost`), `LalamoveOrder`
  (`shareLink`, motorista, preços, status), `LalamoveEvent` (webhooks).
- `app/api/lalamove/webhook` — recebe eventos, persiste status/motorista/custo e propaga
  via `updateDispatchStatus`.
- Tipos de veículo já definidos (`types/index.ts` `LalamoveServiceType`).

**O que falta** é o lado **operacional e de UI**, em três pedidos do Alberto:

1. Um **botão na `/roteirização`** para chamar o Lalamove escolhendo o tipo de veículo
   (hoje a chamada existente crava `LALAPRO`).
2. **Acompanhar as corridas** na `/rastreamento` e **enviar o link de acompanhamento ao cliente**.
3. Ver no **dashboard** o gasto de Lalamove, separado do volume da frota própria.

---

## 2. Decisões tomadas (com o Alberto)

| Tema | Decisão |
|---|---|
| Granularidade da corrida | Operador decide na hora. **Fase 1: só corridas separadas** (uma corrida por entrega). Multi-parada → Fase 2. |
| Fluxo de cotação | Escolhe o veículo → sistema cota **aquele** → mostra o preço → operador confirma. |
| Envio do link ao cliente | **WhatsApp** (via `wa.me` deep link) **+ Copiar link**. |
| Card de custo | Frota própria = **nº de entregas** (custo fixo afundado, ~R$0 marginal); Lalamove = **R$ gasto**. Headline em R$ de Lalamove. |
| Multi-parada | **Fase 2** (exige relaxar schema 1:1 → 1:N). |
| WhatsApp automático/silencioso | **Fase 2** (depende da stack de mensageria da Donna). |

### Tipos de veículo (já existentes em `LalamoveServiceType`)

| Código | Rótulo na UI | Uso |
|---|---|---|
| `LALAPRO` | LalaPro (moto com baú) | leve |
| `UV_FIORINO` | Utilitário (Fiorino) | ideal pra tinta |
| `VAN` | Van | média |
| `TRUCK330` | Carreto | caminhão pequeno |
| `TRUCK3_5T` | Caminhão 2,5t | pesado |

---

## 3. Arquitetura — Fase 1

Princípio: **reaproveitar tudo**. Sem mudança de schema na Fase 1.

### Frente 0 — Passar o `serviceType` pela cadeia

O serviço HTTP já aceita o parâmetro; falta apenas propagar de cima.

- `getLalamoveQuote(origin, dest, isUrgent, serviceType)` — **já aceita** `serviceType` ✅.
- `lib/lalamove-dispatch.ts` `dispatchViaLalamove(store, dr, opts?)` ganha
  `opts: { serviceType?: LalamoveServiceType; quotationId?: string }`:
  - se `quotationId` vier → **pula a cotação** e chama `createLalamoveOrder` direto
    (o preço cobrado = o que o operador viu);
  - senão → cota com `serviceType` (default `LALAPRO`, preserva compatibilidade).
- `services/despacho.service.ts` `createDispatch` / `CreateDispatchInput` ganham
  `serviceType?` e `quotationId?`, repassados ao `dispatchViaLalamove`.

> Compatibilidade: todos os parâmetros são opcionais com default `LALAPRO`, então o fluxo
> automático atual de `/despacho` continua intacto.

### Frente 1 — Botão na `/roteirização` (cotar → confirmar)

**Endpoints:**

- `POST /api/lalamove/cotacao`
  - body: `{ deliveryRequestId: string, serviceType: LalamoveServiceType }`
  - retorna: `{ quotationId: string, price: number, currency: "BRL", expiresAt: string }`
  - monta os stops a partir da loja de despacho + coordenadas da entrega; reusa
    `buildLalamoveStops` + `getLalamoveQuote`.
- `POST /api/roteirizacao/lalamove`
  - body: `{ deliveryRequestIds: string[], serviceType, quotationId?, mode: "SEPARATE" }`
  - para cada entrega: chama `createDispatch({ modal: LALAMOVE, serviceType, quotationId, ... })`.
  - Fase 1 aceita apenas `mode: "SEPARATE"`. (`MULTISTOP` retorna 400 "em breve".)
  - Roles: `ADMIN` / `OPERATOR` / `LOGISTICS_OPERATOR` (mesmas da roteirização).

**UI** (`app/(app)/roteirizacao/_components/`):

- Cada linha de "Entregas elegíveis" ganha uma ação **"Lalamove"** (ícone + botão discreto).
- Modal de chamada:
  - mostra a entrega (NF, cliente, peso);
  - dropdown de veículo (5 tipos, com rótulos amigáveis);
  - botão **[Cotar]** → chama `/api/lalamove/cotacao` → exibe `R$ price`;
  - botão **[Confirmar]** → chama `/api/roteirizacao/lalamove` com o `quotationId` da cotação.
- Pós-confirmar: a entrega vira `DISPATCHED` (já é o comportamento de `createDispatch`) e
  **some da lista de elegíveis** (a lista filtra `PRONTO_ROTEIRIZACAO`) — sai do pool da wave interna naturalmente.
- Tratamento de `quotationId` expirado: se `/confirmar` falhar por expiração, re-cotar
  automaticamente e pedir nova confirmação.

### Frente 2 — `/rastreamento`: seção "Corridas Lalamove"

- **Query nova** (server component da página): `LalamoveOrder` com `internalStatus` ativo
  (`PENDING` / `ASSIGNED` / `IN_TRANSIT`), incluindo `dispatch.deliveryRequest`
  (cliente, telefone, endereço) e `dispatch.store`.
- **Componente** `components/rastreamento/lalamove-tracking-cards.tsx` (espelha o
  `driver-cards.tsx` existente). Cada card mostra:
  - tipo de veículo, badge de status, motorista (nome/placa/telefone quando atribuído), preço estimado/real;
  - ações:
    - **Acompanhar** → abre `shareLink` em nova aba (`target="_blank" rel="noopener"`);
    - **WhatsApp** → `https://wa.me/55<fone-cliente-normalizado>?text=<msg-encodada-com-shareLink>`
      (abre o WhatsApp do operador com a mensagem pronta — zero backend, zero custo de API);
    - **Copiar link** → `navigator.clipboard.writeText(shareLink)`.
- **Atualização**: o webhook já persiste status/motorista/custo no banco; a seção recarrega
  no mesmo ciclo de 30s que a página já usa para os motoristas internos.
- Helper de normalização de telefone BR (`lib/phone.ts` ou util existente) para montar o `wa.me`.

### Frente 3 — Dashboard: card de custo dividido

Substituir o KPI único "Custo Logístico Hoje" por um card composto:

```
┌ CUSTO LOGÍSTICO HOJE ──────────┐
│  R$ 89,40 em Lalamove          │
│  ─────────────────────────     │
│  🚐 Frota própria   12 entregas│
│  🛵 Lalamove   3 · R$ 89,40    │
└────────────────────────────────┘
```

- **Fonte:** `Dispatch` do dia (`dispatchedAt` hoje) agrupado por `modal`:
  - Frota própria → `count` de dispatches `INTERNAL_ROUTE`.
  - Lalamove → `count` + `sum(actualCost ?? estimatedCost)` de dispatches `LALAMOVE`.
  - (`actualCost` é preenchido pelo webhook na conclusão da corrida; até lá usa `estimatedCost`.)
- Mantém o link para `/auditoria`.

---

## 4. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| API Lalamove retornou **502** em prod e sandbox (memória 13/05) | Retestar conectividade antes do deploy. O padrão "cria `Dispatch` primeiro, chama Lalamove fora da transação" já protege: falha não perde o registro e permite retry. |
| `quotationId` **expira em minutos** | Se `/confirmar` falhar por expiração, re-cotar automaticamente e reconfirmar. Exibir `expiresAt` no modal. |
| Telefone do cliente ausente/mal formatado | Botão WhatsApp desabilitado quando não há telefone; normalização defensiva (`55` + DDD). |
| Notificação interna ≠ cliente externo | `notifications.service.ts` é só in-app; por isso o WhatsApp ao cliente é via `wa.me`, não pela infra atual. |

---

## 5. Testes

- **Unitário** (vitest, padrão do projeto):
  - `dispatchViaLalamove` com `quotationId` fornecido → não cota, vai direto pro pedido.
  - `dispatchViaLalamove` sem `quotationId` → cota com o `serviceType` informado.
  - normalização de telefone para o `wa.me`.
  - agregação do card (count por modal, soma de custo Lalamove com `actualCost ?? estimatedCost`).
- **Integração leve:** endpoints `/api/lalamove/cotacao` e `/api/roteirizacao/lalamove`
  com Lalamove mockado (sucesso, `NOT_CONFIGURED`, erro 502).
- **Manual:** smoke em `/roteirizacao` → Lalamove → `/rastreamento` → dashboard,
  após confirmar que a API Lalamove está respondendo.

---

## 6. Fora de escopo (Fase 2)

- **Multi-parada**: 1 corrida cobrindo N entregas. Exige relaxar `LalamoveOrder.dispatchId @unique`
  para 1:N (ou tabela de junção), estender `buildLalamoveStops` para N paradas e ratear o
  custo entre as entregas.
- **WhatsApp automático/silencioso** ao cliente, via stack de mensageria da Donna.
- Comparar preço de todos os veículos de uma vez (hoje cota 1 por vez).
- Integração 99 / Uber Direct (já mapeada em outro roadmap de frete).

---

## 7. Resumo de arquivos tocados (Fase 1)

**Modificados:**
- `lib/lalamove-dispatch.ts` — `opts: { serviceType?, quotationId? }`
- `services/despacho.service.ts` — `createDispatch` aceita `serviceType?`/`quotationId?`
- `types/index.ts` — `CreateDispatchInput` (campos opcionais novos)
- `app/(app)/roteirizacao/page.tsx` + `_components/` — botão + modal Lalamove
- `app/(app)/rastreamento/page.tsx` — query + render da seção Lalamove
- `app/(app)/dashboard/page.tsx` — card de custo dividido

**Novos:**
- `app/api/lalamove/cotacao/route.ts`
- `app/api/roteirizacao/lalamove/route.ts`
- `app/(app)/roteirizacao/_components/lalamove-call-modal.tsx`
- `components/rastreamento/lalamove-tracking-cards.tsx`
- `lib/phone.ts` (se não houver util de telefone)

**Sem mudança de schema na Fase 1.**
