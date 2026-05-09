# Domain Model — Sistema Logístico Mestre da Pintura

## Visão Geral

O sistema gerencia o ciclo de vida completo de uma entrega, desde a solicitação do vendedor até a confirmação ao cliente. Os conceitos centrais são interligados mas com semânticas distintas — este documento esclarece cada um.

---

## DeliveryRequestStatus

O **estado operacional** da solicitação. Controla em qual fase do pipeline a entrega se encontra.

| Status                | Semântica                                                              | Responsável         |
|-----------------------|------------------------------------------------------------------------|---------------------|
| `PENDING`             | Criada, aguardando análise do operador logístico                      | Operador            |
| `AWAITING_ITEMS`      | Operador confirmou — itens sendo separados na loja de origem          | Estoquista          |
| `AWAITING_TRANSFER`   | Um ou mais itens precisam vir de outra loja (transferência em curso)  | Sistema/Operador    |
| `SEPARADO`            | Todos os itens separados fisicamente e conferidos pelo estoquista     | Estoquista (Jhonatas)|
| `AGUARDANDO_NF`       | Separação concluída, aguardando o CD emitir a NF no Citel             | CD 132              |
| `NF_EMITIDA`          | NF emitida no Citel, aguardando vinculação automática ao sistema      | Sistema (cron)      |
| `NF_VINCULADA`        | NF vinculada à solicitação — dados fiscais completos                  | Sistema (cron/job)  |
| `PRONTO_ROTEIRIZACAO` | Endereço geocodificado, NF pronta — pode entrar em rota              | Operador logístico  |
| `ROTEIRIZADO`         | Incluído em uma rota pelo operador — aguardando despacho              | Operador logístico  |
| `DISPATCHED`          | Motorista ou Lalamove acionado — produto saiu da loja                 | Sistema             |
| `IN_TRANSIT`          | Motorista em trajeto até o cliente                                    | Sistema/Motorista   |
| `DELIVERED`           | Entregue ao cliente — **TERMINAL**                                   | Sistema/Motorista   |
| `OCORRENCIA`          | Problema registrado — fluxo suspenso aguardando resolução            | Operador            |
| `CANCELLED`           | Cancelada — **TERMINAL**                                             | Operador/Admin      |
| `READY`               | *(legado)* Equivale a SEPARADO+NF_VINCULADA no fluxo antigo          | Legado              |

**Regra central:** `DeliveryRequestStatus` muda exclusivamente pela state machine (`services/state-machine.service.ts`). Nunca atualize diretamente via `prisma.deliveryRequest.update({ data: { status } })` de fora da state machine.

---

## DeliveryType

O **tipo de entrega prometido pelo vendedor ao cliente**. Define a expectativa de prazo e o custo.

| Tipo        | Semântica                                                             |
|-------------|-----------------------------------------------------------------------|
| `STANDARD`  | Entrega D+1 — rota interna padrão                                   |
| `URGENT`    | Entrega D+0 — mesmo dia, pode usar frota interna (antes das 12h)    |
| `EXCEPTION` | Fora das regras normais — requer aprovação operacional explícita     |

**Diferença de `SLAType`:** `DeliveryType` é o que o vendedor prometeu ao cliente. `SLAType` é como o sistema classifica internamente o compromisso de entrega (mais granular).

---

## SLAType

O **nível de SLA interno** da entrega. Complementa `DeliveryType` com distinções operacionais que o vendedor não precisa conhecer.

| Tipo        | Semântica                                                             |
|-------------|-----------------------------------------------------------------------|
| `STANDARD`  | D+1 — rota interna padrão sem restrições de horário                 |
| `URGENT`    | D+0 via frota interna — sujeito ao corte das 12h00                  |
| `EXPRESS`   | D+0 via Lalamove/parceiro — ignora corte horário, custo diferenciado|
| `SCHEDULED` | Data específica informada pelo operador — fora do fluxo automático  |

**Derivação:** quando `deliveryType=URGENT` e a entrega é criada antes das 12h → `slaType=URGENT`. Se criada após 12h com Lalamove → `slaType=EXPRESS`.

---

## DispatchWindow

A **janela de despacho** calculada no momento da criação da solicitação, baseada no horário de Brasília.

| Janela            | Regra de criação                                    | Despacho previsto              |
|-------------------|-----------------------------------------------------|--------------------------------|
| `FIRST_DISPATCH`  | Criada até 17h30 (seg–sex)                         | Manhã do dia seguinte (D+1)   |
| `SECOND_DISPATCH` | Criada após 17h30 até fim do dia útil              | Tarde do dia seguinte (D+1)   |
| `NEXT_DAY`        | Criada após 12h para entrega urgente (D+0)         | D+2 (não garante D+0)         |
| `EXPRESS`         | Lalamove ou urgente — ignora qualquer janela de corte | Hoje, sem janela fixa       |

**Calculada em:** `lib/cutoff.ts::getDispatchWindow()`  
**Imutável após criação:** a janela é calculada uma vez e não muda (exceto se aprovação excepcional alterar para EXPRESS).

---

## Regras de Corte Horário

Dois cortes operacionais, ambos em horário de Brasília:

| Corte    | Horário | Impacto                                                                     |
|----------|---------|-----------------------------------------------------------------------------|
| **12h00**| Meio-dia | Entregas URGENT D+0 via frota interna não são mais garantidas              |
| **17h30**| Tarde   | Novas solicitações padrão entram no 2º despacho (tarde D+1) em vez do 1º  |

Após o corte de 12h00, o vendedor deve escolher:
1. **EXPRESS** — Lalamove (garante hoje, custo adicional)
2. **NEXT_DAY** — reagendar para amanhã (1º despacho D+1)
3. **EXCEPTION** — solicitar exceção operacional (aprovação da logística)

---

## DispatchModal

O **modal de transporte** usado para executar o despacho. Definido pelo motor de decisão automático (`services/despacho.service.ts::decideModal()`).

| Modal             | Quando é usado                                                        |
|-------------------|-----------------------------------------------------------------------|
| `INTERNAL_ROUTE`  | Padrão — distância ≤ 20km e tempo de rota ≤ 45min                  |
| `LALAMOVE`        | Urgente, ou rota muito longa/lenta para frota interna                |
| `PARTNER`         | Parceiro externo (99, etc.) — via DispatchProvider abstraction       |
| `EXCEPTION`       | Distância > 20km ou situação fora das regras — operador decide manualmente |

---

## Relação entre os conceitos

```
Vendedor cria solicitação
    │
    ├─ informa: DeliveryType (STANDARD | URGENT | EXCEPTION)
    │
    └─ sistema calcula:
         ├─ DispatchWindow  (quando vai despachar)
         ├─ SLAType         (como classificar internamente)
         └─ DeliveryRequestStatus = PENDING (estado inicial)


Operador gerencia via state machine:
    PENDING → AWAITING_ITEMS → AWAITING_TRANSFER → SEPARADO → ...
    
    
Despacho acontece:
    └─ motor decide: DispatchModal (INTERNAL_ROUTE | LALAMOVE | ...)
    └─ DeliveryRequestStatus → DISPATCHED → IN_TRANSIT → DELIVERED
```

---

## Invariantes do Domínio

1. `DeliveryRequestStatus` nunca retroage além do estado imediatamente anterior (exceto via OCORRENCIA).
2. `DispatchWindow` é imutável após a criação da solicitação.
3. `SLAType=EXPRESS` implica `deliveryType=URGENT` e `DispatchWindow=EXPRESS`.
4. `DELIVERED` e `CANCELLED` são estados terminais — nunca transitam.
5. Toda mudança de `DeliveryRequestStatus` gera uma entrada em `DeliveryStatusHistory`.
6. `OCORRENCIA` sempre exige `occurrenceType` + `occurrenceNotes` (≥10 chars).
7. Cancelar `IN_TRANSIT` requer `role=ADMIN` + `forceCancel=true`.
