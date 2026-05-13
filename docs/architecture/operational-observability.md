# Observabilidade Operacional — Sistema Logístico Mestre da Pintura

## Visão Geral

A camada de observabilidade transforma a fila operacional em um sistema **mensurável e auditável**. Cada transição de status gera dados estruturados que alimentam métricas, alertas e o painel de analytics — sem overhead em tempo real.

---

## Modelo de Dados: `OperationalMetricsSnapshot`

### O que é

Um registro por **etapa que cada solicitação atravessa**. Aberto na entrada de um status, fechado na saída.

```
Solicitação criada (PENDING)
    │
    ├── snapshot aberto: status=PENDING, enteredAt=09:00
    │
    ▼ operador transiciona para AWAITING_ITEMS (09:15)
    │
    ├── snapshot fechado: exitedAt=09:15, durationSeconds=900
    ├── snapshot aberto: status=AWAITING_ITEMS, enteredAt=09:15
    │
    ▼ operador transiciona para SEPARADO (09:45)
    │
    └── snapshot fechado: exitedAt=09:45, durationSeconds=1800
        snapshot aberto: status=SEPARADO, enteredAt=09:45
```

### Campos

| Campo             | Tipo             | Descrição                                               |
|-------------------|------------------|---------------------------------------------------------|
| `deliveryRequestId` | String         | Chave estrangeira para a solicitação                    |
| `status`          | DeliveryRequestStatus | Status sendo medido                               |
| `enteredAt`       | DateTime         | Quando entrou neste status (BRT)                        |
| `exitedAt`        | DateTime?        | Quando saiu (`null` = ainda neste status)               |
| `durationSeconds` | Int?             | Duração calculada ao fechar (exitedAt - enteredAt)      |
| `operatorId`      | String?          | userId de quem acionou a transição (`null` = sistema)   |
| `operatorName`    | String?          | Nome denormalizado para evitar JOIN na leitura          |
| `storeId`         | String           | Loja de origem da solicitação                           |
| `slaType`         | SLAType          | Classificação SLA (STANDARD, URGENT, EXPRESS, SCHEDULED)|
| `deliveryType`    | DeliveryType     | Tipo de entrega prometido ao cliente                    |
| `dispatchWindow`  | DispatchWindow?  | Janela de despacho calculada na criação                 |

### Invariantes

1. Apenas **um snapshot aberto** por `deliveryRequestId` a qualquer momento.
2. `durationSeconds` nunca é negativo.
3. Snapshots são **imutáveis após o fechamento** — nunca editados manualmente.
4. Falha no snapshot **não bloqueia a transição** (best-effort, logado).
5. Estados terminais (`DELIVERED`, `CANCELLED`) fecham o snapshot sem abrir novo.

### Índices

```sql
-- Analytics por status (maior frequência de query)
CREATE INDEX ON operational_metrics_snapshots (status, "enteredAt");
-- Analytics por loja
CREATE INDEX ON operational_metrics_snapshots ("storeId", "enteredAt");
-- Analytics por operador
CREATE INDEX ON operational_metrics_snapshots ("operatorId", "enteredAt");
-- Cleanup de snapshots abertos
CREATE INDEX ON operational_metrics_snapshots ("exitedAt");
```

---

## KPIs e Métricas

### Tempo por Etapa

Calculado como `AVG(durationSeconds)` agrupado por `status`, filtrado por período e com `exitedAt IS NOT NULL`.

| Etapa               | Threshold "stuck" | Risco de gargalo                          |
|---------------------|-------------------|--------------------------------------------|
| PENDING             | 30 min            | Falta de atenção do operador               |
| AWAITING_ITEMS      | 45 min            | Separação lenta / falta de estoque         |
| AWAITING_TRANSFER   | 120 min           | Transferência atrasada                     |
| SEPARADO            | 30 min            | CD lento para emitir NF                    |
| AGUARDANDO_NF       | 60 min            | Gargalo fiscal no CD 132                   |
| NF_EMITIDA          | 30 min            | Falha na vinculação automática             |
| NF_VINCULADA        | 15 min            | Geocodificação/validação de endereço       |
| PRONTO_ROTEIRIZACAO | 45 min            | Operador não roteirizou                    |
| ROTEIRIZADO         | 30 min            | Motorista não despachado                   |
| DISPATCHED          | 60 min            | Motorista não iniciou trânsito             |
| IN_TRANSIT          | 180 min           | Entrega não confirmada                     |
| OCORRENCIA          | 120 min           | Ocorrência não resolvida                   |

### SLA de Entrega

Medido do `createdAt` da solicitação até o `updatedAt` do status `DELIVERED`.

| SLAType   | Threshold | Compromisso                              |
|-----------|-----------|------------------------------------------|
| STANDARD  | 36h       | D+1 — rota interna padrão               |
| URGENT    | 8h        | D+0 — frota interna (antes das 12h)     |
| EXPRESS   | 4h        | D+0 — Lalamove (ignora corte horário)   |
| SCHEDULED | 48h       | Data definida pelo operador              |

**Compliance %** = (entregas dentro do SLA / total entregues) × 100

### Métricas por Operador

- **Total de ações**: transições executadas pelo operador no período
- **Tempo médio**: `AVG(durationSeconds)` dos snapshots onde `operatorId = X`
- **Breakdown por status**: distribuição de onde o operador atua mais

### Heatmap Operacional

Distribuição de volume (contagem de transições) por:
- **Hora do dia** (0–23, horário BRT)
- **Dia da semana** (Seg–Dom)

Permite identificar **horários de pico** e alocar operadores preventivamente.

---

## Sistema de Alertas

### Tipos

| Tipo              | Trigger                                          | Severidade     |
|-------------------|--------------------------------------------------|----------------|
| `STUCK`           | Card em status > threshold de "stuck"            | WARNING/CRITICAL |
| `SLA_BREACH`      | Solicitação ativa com idade > threshold SLA      | CRITICAL       |
| `CLAIM_EXPIRING`  | Lock operacional com ≤ 2 min para expirar        | INFO           |
| `QUEUE_OVERLOAD`  | Coluna com > 15 cards acumulados                 | WARNING        |

### Severidade

- **CRITICAL**: requer ação imediata (SLA violado, card parado > 1h além do threshold)
- **WARNING**: situação degradada, monitorar (stuck moderado, fila acumulando)
- **INFO**: informativo (claim expirando, aviso preventivo)

### Exibição

- Alertas são calculados em cada chamada ao `getOperationalQueue()`
- Exibidos na `MetricsBar` com contador e badge de severidade
- Cards stuck mostram `stuckMinutes` no `DeliveryCard` (indicador vermelho)
- Painel `/operacao/analytics` mostra mapa de cards stuck por status

---

## Ciclo de Vida Operacional

```
Criação da solicitação
    │
    └─ [sem snapshot inicial — criado retroativamente na primeira transição]
    
Primeira transição (ex: PENDING → AWAITING_ITEMS)
    │
    ├─ Snapshot PENDING criado retroativamente (enteredAt = request.createdAt)
    ├─ Snapshot PENDING fechado (exitedAt = now, durationSeconds calculado)
    └─ Snapshot AWAITING_ITEMS aberto (enteredAt = now)
    
Transições subsequentes
    │
    ├─ Snapshot atual fechado
    └─ Novo snapshot aberto
    
Estado terminal (DELIVERED ou CANCELLED)
    │
    └─ Snapshot atual fechado
       Nenhum novo snapshot aberto
```

---

## Arquitetura das Queries

### Princípios

1. **Queries por índice**: toda query de analytics usa as colunas indexadas (`status`, `storeId`, `operatorId`, `enteredAt`)
2. **Snapshots persistidos**: nenhum recálculo sobre dados brutos em tempo real
3. **Período fixo**: queries filtradas por `periodStart` derivado do parâmetro (`today` / `week` / `month`)
4. **P90 via raw SQL**: `PERCENTILE_CONT(0.9)` não é suportado pelo Prisma ORM; usa `$queryRaw`
5. **Denormalização**: `operatorName` e `storeCode` são persistidos nos snapshots para evitar JOINs nas queries analíticas

### Evolução prevista

- **Cache de analytics**: resultado de `getAnalyticsSummary` pode ser cacheado por 5–15 min sem perda significativa de precisão
- **Materialização**: para datasets maiores, criar tabela `analytics_daily_snapshot` com agregações pré-computadas via cron
- **IA preditiva** (fase futura): usar histórico de snapshots para prever gargalos por horário e volume

---

## Pontos de Integração

| Componente                    | Responsabilidade                                           |
|-------------------------------|------------------------------------------------------------|
| `state-machine.service.ts`    | Abre e fecha snapshots em cada `_applyTransition`          |
| `services/analytics.service.ts` | Queries agregadas sobre `operational_metrics_snapshots`  |
| `services/operacao.service.ts` | Calcula `isStuck`, `slaBreached` e `alerts` no payload da fila |
| `app/api/operacao/analytics/route.ts` | Expõe summary via GET com filtro de período        |
| `app/(app)/operacao/analytics/page.tsx` | Dashboard de analytics (Server Component)         |
| `components/operacao/MetricsBar.tsx` | Exibe contagem de alertas em tempo real (via polling) |
