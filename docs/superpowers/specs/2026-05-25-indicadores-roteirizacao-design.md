# Indicadores na lista de roteirização — Design

**Data:** 2026-05-25
**Tela:** `/roteirizacao` (lista "Entregas elegíveis")
**Tipo:** feature de leitura + apresentação (sem migration, sem mudança no Spoke)

## Problema

A lista "Entregas elegíveis" da roteirização hoje mostra todas as solicitações em
`PRONTO_ROTEIRIZACAO` de forma indistinta (NF · cliente / endereço / peso / botão Lalamove).
O operador não consegue ver, batendo o olho:

1. **Quais são urgentes** — em especial quais precisam chamar um app (Lalamove/99) versus
   quais a frota entrega no mesmo dia.
2. **Quais estão agendadas para outra data** — e por isso **não devem ir hoje**. Como a
   query atual não olha a data, uma entrega agendada para o futuro aparece misturada e o
   botão "Selecionar todas" a mandaria junto, por engano.
3. **Quais saem de outra loja** que não o CD (132).

## Objetivo

Adicionar indicadores visuais (selos) a cada linha da lista, ordenar para priorizar o que
exige ação, e proteger o "Selecionar todas" para nunca incluir uma agendada futura — sem
esconder nada do panorama do operador.

## Fonte de verdade (campos já existentes em `DeliveryRequest`)

Nenhum campo novo. Tudo derivado do schema atual:

| Indicador | Selo | Condição |
|-----------|------|----------|
| Express / app | ⚡ **App** | `slaType === "EXPRESS"` (= "Entrega expressa — Lalamove/99") |
| Same-day frota | 🔴 **Hoje** | `slaType === "URGENT"` (= same-day pela frota, corte 12h) |
| Agendada futura | 📅 **dd/mm** | `scheduledFor != null` **e** `scheduledFor` cai depois do fim de hoje |
| Sai de outra loja | 🏪 **067** | loja de despacho resolvida ≠ código `132` (CD) |

Notas:
- `slaType` tem default `STANDARD` (não-nulo), então a classificação de urgência é sempre
  determinística.
- "Agendada futura" usa a **data real** (`scheduledFor > fim de hoje`), não o `slaType ===
  "SCHEDULED"`. É mais robusto: uma agendada para hoje conta como "de hoje"; uma agendada
  para o futuro conta como futura mesmo que algum campo divirja.
- Uma entrega pode ter múltiplos selos (ex.: ⚡App + 🏪067).

### Resolução da loja de origem

`dispatchStoreId` é um campo `String?` **sem relação Prisma** (diferente de `store`,
`orderStore`, `invoiceStore`). Logo, o código da loja é resolvido via mapa:

1. Carregar todas as lojas ativas uma vez: `prisma.store.findMany({ select: { id, code } })`
   → `Map<storeId, code>`.
2. Para cada DR, resolver o id da loja de origem com fallback para DRs antigas sem
   `dispatchStoreId`:
   ```
   originStoreId = dr.dispatchStoreId
                 ?? (dr.entregaPeloCD ? <id da loja code "132"> : dr.storeId)
   ```
3. `originStoreCode = mapa.get(originStoreId)?.code`.
4. Exibe o selo 🏪 apenas quando `originStoreCode` existe e `!== "132"`.

## Comportamento da lista

### Ordenação (rank, calculado no servidor)

1. ⚡ App de hoje (`slaType === "EXPRESS"` e não-futura)
2. 🔴 Hoje (`slaType === "URGENT"` e não-futura)
3. Normais de hoje
4. 📅 Agendadas futuras — por `scheduledFor` crescente, no fim da lista

Dentro do mesmo rank, mantém a ordem atual (`createdAt` asc). Assim o que exige ação sobe
e o que não é pra hoje afunda, sem desaparecer.

### Seleção

- O botão "Selecionar todas" passa a se chamar **"Selecionar de hoje (N)"** e marca apenas
  entregas **não-futuras** (ranks 1-3). N = quantidade de entregas de hoje.
- Agendadas futuras **só são selecionadas com clique manual** na linha. O selo 📅 com a data
  deixa explícito o que está sendo incluído. Não há bloqueio — apenas não entram na seleção
  em massa. Isso resolve o risco central: nunca mandar uma agendada por engano.

### Cabeçalho e legenda

- Contadores no rótulo da seção: `Entregas elegíveis (X) · Y urgentes · Z agendadas`,
  onde Y = ⚡App + 🔴Hoje (de hoje) e Z = futuras.
- Legenda discreta no rodapé da lista: `⚡ App (Lalamove/99) · 🔴 Hoje (frota) · 📅 agendada · 🏪 outra loja`.

## Mudanças técnicas

### Novo: `lib/eligible-delivery.ts` (lógica pura, testável)

Isola a regra de negócio fora do React e do servidor, seguindo o padrão dos demais helpers
de `lib/` (ex.: `route-sequence.ts`, `cutoff.ts`).

- Tipo `EligibleDeliveryInput` (campos crus relevantes da DR + contexto: `cdCode`,
  `storeCodeById`, `now`).
- Tipo `EligibleDeliveryFlags`: `{ appUrgent: boolean; todayUrgent: boolean;
  scheduledDateLabel: string | null; isFutureScheduled: boolean; originStoreCode: string |
  null; sortRank: number }`.
- `classifyEligibleDelivery(input): EligibleDeliveryFlags` — calcula selos e rank.
- `sortEligibleDeliveries(list)` — ordena por `sortRank` e depois `scheduledFor`/`createdAt`.

### `app/(app)/roteirizacao/page.tsx` (servidor)

- Ampliar o `select` de `eligibleRequests` com: `slaType`, `scheduledFor`,
  `dispatchStoreId`, `entregaPeloCD`, `storeId`, `createdAt`.
- Carregar o mapa de lojas (id→code) e identificar o id do CD (code "132").
- Mapear cada DR por `classifyEligibleDelivery`, ordenar por `sortEligibleDeliveries`, e
  passar a lista enriquecida (campos atuais + flags) para `NovaWaveForm`.

### `app/(app)/roteirizacao/_components/nova-wave-form.tsx` (cliente)

- Estender a interface `EligibleRequest` com as flags.
- Renderizar os selos na linha (entre a NF·cliente e o cliente, conforme mockup aprovado),
  usando os ícones do `lucide-react` já presentes (Zap, etc.) ou os emojis definidos.
- "Selecionar de hoje (N)": opera só sobre `!isFutureScheduled`.
- Contadores no rótulo e legenda no rodapé.
- A lista já chega ordenada do servidor; o componente só renderiza na ordem recebida.

### Novo: `tests/lib/eligible-delivery.test.ts`

Cobre `classifyEligibleDelivery` e `sortEligibleDeliveries`:
- EXPRESS → appUrgent, rank 1.
- URGENT → todayUrgent, rank 2.
- STANDARD sem data → rank 3.
- `scheduledFor` futura → isFutureScheduled, selo de data, rank 4 (independe do slaType).
- `scheduledFor` = hoje → não-futura.
- loja de despacho ≠ 132 → originStoreCode preenchido; = 132 → null.
- fallback de origem quando `dispatchStoreId` é null (usa entregaPeloCD/storeId).
- ordenação geral mistura os casos e confere a sequência.

## Não-objetivos (YAGNI)

- Não filtrar/esconder agendadas da query (decisão: mostrar todas com selo).
- Não bloquear seleção manual de uma agendada futura.
- Não alterar a roteirização, o pipeline Spoke ou a distribuição.
- Não tocar nas "Coletas de transferência" (seção separada da tela).
- Sem migration: nenhum campo novo no banco.

## Casos de borda

- DR antiga sem `dispatchStoreId`: usa o fallback `entregaPeloCD ? CD : storeId`.
- DR com `scheduledFor` no passado: tratada como "de hoje" (não-futura) — não esconde nem
  rotula como agendada; entra normalmente na seleção de hoje.
- Loja de origem cujo código não está no mapa (dado inconsistente): não exibe selo 🏪
  (degrada silenciosamente, sem quebrar a linha).
- EXPRESS + `scheduledFor` futura (conflito improvável): a data futura prevalece para
  efeito de "não ir hoje" (rank 4, fora do "Selecionar de hoje"); o selo ⚡App ainda
  aparece para sinalizar o tipo.

## Verificação

- `npx tsc --noEmit` sem erros.
- `npx vitest run tests/lib/eligible-delivery.test.ts` verde.
- Conferência visual em `/roteirizacao`: selos corretos, ordem, "Selecionar de hoje"
  ignorando futuras, contadores e legenda.
