# State Machine — DeliveryRequest

## Fluxo Oficial

```
PENDING
  └─► AWAITING_ITEMS       ← itens em separação na loja
  └─► AWAITING_TRANSFER    ← aguardando transferência de outra loja
  └─► SEPARADO             ← separação direta (sem transferência)
  └─► CANCELLED

AWAITING_ITEMS
  └─► PENDING              ← volta para análise
  └─► AWAITING_TRANSFER
  └─► SEPARADO
  └─► OCORRENCIA
  └─► CANCELLED

AWAITING_TRANSFER
  └─► SEPARADO             ← automático quando todas as transferências chegam
  └─► AWAITING_ITEMS
  └─► OCORRENCIA
  └─► CANCELLED

SEPARADO                   ← estoquista conferiu e separou fisicamente
  └─► AGUARDANDO_NF
  └─► OCORRENCIA
  └─► CANCELLED

AGUARDANDO_NF              ← aguardando CD emitir NF no Citel
  └─► NF_EMITIDA
  └─► OCORRENCIA
  └─► CANCELLED

NF_EMITIDA                 ← NF emitida no Citel, aguardando vinculação automática
  └─► NF_VINCULADA         ← vinculação automática pelo cron/job
  └─► AGUARDANDO_NF        ← reprocessamento
  └─► OCORRENCIA
  └─► CANCELLED

NF_VINCULADA               ← NF vinculada à solicitação no sistema
  └─► PRONTO_ROTEIRIZACAO
  └─► OCORRENCIA
  └─► CANCELLED

PRONTO_ROTEIRIZACAO        ← endereço + geocode + NF validados
  └─► ROTEIRIZADO
  └─► OCORRENCIA
  └─► CANCELLED

ROTEIRIZADO                ← incluído em rota pelo operador logístico
  └─► DISPATCHED
  └─► PRONTO_ROTEIRIZACAO  ← retirada da rota
  └─► OCORRENCIA
  └─► CANCELLED

DISPATCHED                 ← motorista/Lalamove acionado
  └─► IN_TRANSIT
  └─► OCORRENCIA

IN_TRANSIT                 ← motorista em trajeto
  └─► DELIVERED
  └─► OCORRENCIA
  └─► CANCELLED (somente ADMIN + forceCancel)

DELIVERED                  ← TERMINAL
CANCELLED                  ← TERMINAL

OCORRENCIA                 ← suspende o fluxo para resolução operacional
  └─► PENDING | AWAITING_ITEMS | AWAITING_TRANSFER | SEPARADO
      AGUARDANDO_NF | NF_EMITIDA | NF_VINCULADA
      PRONTO_ROTEIRIZACAO | ROTEIRIZADO
  └─► CANCELLED

READY (legado)             ← compatibilidade com fluxo antigo
  └─► SEPARADO | PRONTO_ROTEIRIZACAO | DISPATCHED
  └─► OCORRENCIA | CANCELLED
```

---

## Gates Operacionais

Cada estado crítico tem pré-condições que são validadas antes da transição.
Gates são verificados **dentro da transaction** pela state machine.

| Estado destino       | Gate obrigatório                                                                 |
|----------------------|----------------------------------------------------------------------------------|
| `SEPARADO`           | `separatedBy` (userId) obrigatório. Nenhum item com `availableAtStore=false`.   |
| `NF_VINCULADA`       | `invoiceNumber` preenchido no registro.                                          |
| `PRONTO_ROTEIRIZACAO`| `deliveryAddress`, `deliveryLat` e `deliveryLng` preenchidos.                   |
| `ROTEIRIZADO`        | `routeId` fornecido nos metadados.                                               |
| `DISPATCHED`         | Registro `Dispatch` existente para a solicitação.                                |
| `OCORRENCIA`         | `occurrenceType` e `occurrenceNotes` (mín. 10 chars) obrigatórios.              |
| `CANCELLED` (transit)| `actorRole === "ADMIN"`, `forceCancel=true`, `cancellationReason` obrigatório.  |

---

## Estados Terminais

| Estado      | Significado                                    |
|-------------|------------------------------------------------|
| `DELIVERED` | Entrega confirmada. Nenhuma transição possível.|
| `CANCELLED` | Cancelada. Nenhuma transição possível.         |

---

## Auditoria — DeliveryStatusHistory

**Toda transição** registra uma entrada em `delivery_status_history`:

```
{
  deliveryRequestId: string
  fromStatus:        DeliveryRequestStatus | null  (null = criação inicial)
  toStatus:          DeliveryRequestStatus
  changedById:       string | null                 (null = automação/SYSTEM)
  reason:            string | null
  metadata:          JSON | null                   (campos extras da transição)
  createdAt:         DateTime
}
```

O histórico é **imutável** — gerado exclusivamente pela state machine, nunca manualmente.

---

## Implementação

**Arquivo central:** `services/state-machine.service.ts`

### Funções públicas

| Função                                   | Uso                                           |
|------------------------------------------|-----------------------------------------------|
| `transitionDeliveryRequest(ctx)`         | Cria sua própria transaction. Para chamadas standalone (ex: rota HTTP). |
| `transitionDeliveryRequestWithTx(tx, id, ctx)` | Usa transaction existente. Para serviços que já estão em `$transaction`. |
| `validateTransition(from, to, role, meta)` | Valida estruturalmente (sem DB). Para pre-checks em UI.             |
| `stateMachineErrorToHttp(err)`          | Converte `StateMachineError` em `{ status, code, message }` HTTP.   |

### Pontos de integração

| Arquivo                                      | Transição gerada            |
|----------------------------------------------|-----------------------------|
| `app/api/solicitacoes/[id]/status/route.ts`  | Manual (operador/vendedor)  |
| `services/despacho.service.ts::createDispatch`     | READY/ROTEIRIZADO → DISPATCHED |
| `services/despacho.service.ts::updateDispatchStatus` | DISPATCHED → IN_TRANSIT → DELIVERED |
| `services/transferencia.service.ts::checkAndAdvanceDeliveryRequest` | AWAITING_TRANSFER → SEPARADO |

---

## Regras Invioláveis

1. `PENDING → DELIVERED` — **nunca permitido** (precisa passar por todas as fases)
2. `AWAITING_TRANSFER → DISPATCHED` — **nunca permitido** (transferência não chegou)
3. `DISPATCHED → PENDING` — **nunca permitido** (use OCORRENCIA)
4. `DELIVERED → qualquer` — **estado terminal, imutável**
5. `CANCELLED → qualquer` — **estado terminal, imutável**
6. `OCORRENCIA` — **exige tipo e notas** (10+ chars)
7. Cancelamento em `IN_TRANSIT` — **somente ADMIN + forceCancel explícito**

---

## Tipos de Ocorrência (sugeridos)

```
AVARIA              — produto danificado em trânsito ou no armazém
RECUSA_ENTREGA      — cliente recusou receber
ENDERECO_ERRADO     — endereço inválido ou inacessível
AUSENTE             — cliente ausente no momento da entrega
DIVERGENCIA_ITEMS   — itens enviados não batem com o pedido
ATRASO              — entrega fora do prazo prometido
SINISTRO            — perda total ou roubo
OUTRO               — outro motivo (detalhar em occurrenceNotes)
```
