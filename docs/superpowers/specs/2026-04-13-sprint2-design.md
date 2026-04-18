# Sprint 2 — Design Spec
**Sistema de Gestão Logística — Mestre da Pintura**
Data: 2026-04-13

---

## Objetivo

Transformar o MVP técnico (Sprint 1) em um MVP operacional confiável: dados reais, regras próximas da operação, e um sistema que toma decisões — não apenas registra.

---

## Entregas

1. Provider de ERP desacoplado (Citel REST + Mock + CSV skeleton)
2. Google Maps real com fallback em 3 camadas
3. Auditoria comercial de frete com hard gate de justificativa
4. Score logístico de transferência com 5 critérios (incluindo motorista ativo)
5. Tracking de motoristas com funções de decisão operacional
6. Dashboard operacional/gerencial com KPIs de custo e eficiência

---

## Seção 1 — Provider de ERP

### Estrutura

```
providers/
└── erp/
    ├── erp.provider.interface.ts   ← IERPProvider
    ├── rest.provider.ts            ← REST Bearer ou ApiKey
    ├── mock.provider.ts            ← dados locais dev/test
    ├── csv.provider.ts             ← esqueleto CSV/Excel (não é caminho principal)
    └── index.ts                    ← factory por env
```

### Contrato — IERPProvider

```typescript
interface IERPProvider {
  // operações atômicas
  fetchInvoice(number: string): Promise<ERPInvoice | null>
  fetchOrder(invoiceNumber: string): Promise<ERPOrder | null>
  fetchCustomer(customerId: string): Promise<ERPCustomer | null>
  fetchSeller(sellerId: string): Promise<ERPSeller | null>
  fetchOrderItems(invoiceNumber: string): Promise<ERPOrderItem[]>

  // estoque — retorna LISTA por loja (não objeto singular)
  fetchStockByProduct(productCode: string): Promise<ERPStoreStock[]>
  fetchStockByStore(storeCode: string, productCodes: string[]): Promise<ERPStoreStock[]>

  // método agregador — uma chamada para preparar o fluxo de entrega completo
  // combina: fetchInvoice + fetchOrder + fetchOrderItems + fetchCustomer + fetchSeller
  fetchDeliveryContextByInvoice(invoiceNumber: string): Promise<ERPDeliveryContext | null>
}

interface ERPStoreStock {
  storeCode: string
  storeName: string
  productCode: string
  qty: number
  available: boolean  // qty >= quantidade mínima de venda
}

interface ERPDeliveryContext {
  invoice: ERPInvoice
  order: ERPOrder
  customer: ERPCustomer
  seller: ERPSeller
  items: ERPOrderItem[]
}
```

### Autenticação REST

Controlada por env:
- `ERP_AUTH_TYPE=bearer` → `Authorization: Bearer {ERP_API_KEY}`
- `ERP_AUTH_TYPE=apikey` → `X-Api-Key: {ERP_API_KEY}`
- Sem config → MockProvider automático

### Factory

```typescript
// providers/erp/index.ts
export function getERPProvider(): IERPProvider {
  if (!process.env.ERP_API_URL) return new MockERPProvider()
  return new RestERPProvider()
}
```

### Política de Retry (explícita)

```
Retry APENAS para:
  - timeout (AbortError / fetch timeout)
  - falha de rede (NetworkError / ECONNREFUSED)
  - 5xx (erro no servidor ERP)

Sem retry para:
  - 4xx (400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found)
  - Erros de parsing/validação

Backoff simples:
  tentativa 1 → imediata
  tentativa 2 → aguarda 800ms
  máximo 2 tentativas (1 retry)

Configurável via env: ERP_MAX_RETRIES (default: 1)
```

### Logs estruturados com Correlation ID

Todos os logs do ERP provider incluem:

```typescript
{
  requestId: string,      // uuid gerado por chamada — rastreia toda a cadeia
  invoiceNumber?: string, // quando disponível no contexto
  deliveryId?: string,    // quando disponível no contexto
  operation: string,      // ex: "fetchDeliveryContextByInvoice"
  durationMs: number,
  status: "ok" | "retry" | "fallback" | "error",
  attempt?: number        // 1 ou 2
}
```

O `requestId` é gerado na entrada de cada request HTTP (`/api/solicitacoes`, etc.) e propagado até o provider via contexto.

### Timeout e configuração

- Timeout por chamada: `ERP_TIMEOUT_MS` (default: 5000ms)
- Max retries: `ERP_MAX_RETRIES` (default: 1)

### CSV Provider (esqueleto)

Implementa `IERPProvider` lendo arquivos no formato `estoque_<CODIGO>.csv` (mesmo padrão do sistema_compras). Não é o fluxo principal — permite fallback quando API indisponível em ambiente de homologação.

---

## Seção 2 — Google Maps com Fallback em Camadas

### Estrutura

```
providers/
└── maps/
    ├── maps.provider.interface.ts   ← IMapsProvider
    ├── google-maps.provider.ts      ← Distance Matrix API
    ├── haversine.provider.ts        ← cálculo offline
    └── index.ts                     ← factory
```

### Contrato — IMapsProvider

```typescript
interface IMapsProvider {
  geocodeAddress(address: string): Promise<Coordinates | null>
  getRouteDistance(origin: Coordinates, dest: Coordinates): Promise<RouteResult>
  getMultipleRouteDistances(origin: Coordinates, destinations: Coordinates[]): Promise<RouteResult[]>
  reverseGeocode(coords: Coordinates): Promise<string | null>
}

interface RouteResult {
  distanceKm: number
  durationMin: number | null
  approximated: boolean
  source: "CACHE" | "GOOGLE" | "HAVERSINE"
}
```

### Fallback em 3 camadas

```
resolveDistance(origin, dest):
  1. RouteCache válido (expiresAt > now)
     → retorna { source: "CACHE", approximated: false }

  2. Google Maps Distance Matrix
     → se OK: salva RouteCache (TTL 24h), retorna { source: "GOOGLE", approximated: false }
     → se falha: loga warning com motivo

  3. Haversine
     → retorna { source: "HAVERSINE", approximated: true }
```

### Schema — Novos modelos

```prisma
model GeoCache {
  id        String   @id @default(cuid())
  address   String   @unique
  lat       Float
  lng       Float
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model RouteCache {
  id          String   @id @default(cuid())
  cacheKey    String   @unique  // sha256(originLat+originLng+destLat+destLng)
  fromLat     Float
  fromLng     Float
  toLat       Float
  toLng       Float
  distanceKm  Float
  durationMin Int
  source      String   @default("GOOGLE")
  createdAt   DateTime @default(now())
  expiresAt   DateTime
}
```

### Schema — Campos novos em FreightQuote

```prisma
distanceApproximated  Boolean  @default(false)
distanceSource        String   @default("ROUTE")  // ROUTE | CACHE | APPROXIMATED
durationMin           Int?
```

### Persistência do flag de aproximação (campo auditável)

Quando `resolveDistance` retorna `source: "HAVERSINE"`, o service de frete **obrigatoriamente** persiste no banco:

```typescript
FreightQuote.distanceApproximated = true
FreightQuote.distanceSource = "APPROXIMATED"
```

Este é um **campo de banco de dados**, não apenas um estado de UI. Permite:
- Auditoria histórica: saber qual cotação usou distância real vs estimada
- Filtros na tela de auditoria: "mostrar apenas cotações com distância aproximada"
- Alertas operacionais: cotações pendentes de confirmação de distância real

A lógica de persistência fica em `services/frete.service.ts`, não no provider Maps.

### UI — Exibição de aproximação

- Badge amarelo `⚠ Distância aproximada — confirmar valor` quando `distanceApproximated = true`
- Ícone `~` com tooltip na tabela de solicitações e auditoria
- Não bloqueia o fluxo — apenas sinaliza para revisão humana

---

## Seção 3 — Auditoria Comercial de Frete com Hard Gate

### Novos campos em FreightAudit

```prisma
deviationPercent          Float?    // (charged - suggested) / suggested * 100
deviationClassification   String?   // WITHIN_RULE | BELOW_RULE | ABOVE_RULE
justificationRequired     Boolean   @default(false)
justification             String?
justifiedById             String?
justifiedAt               DateTime?
toleranceApplied          Float?    // % de tolerância vigente no momento
```

### Novo modelo — AuditConfig

```prisma
model AuditConfig {
  id                          String   @id @default(cuid())
  storeId                     String?  // null = global
  tolerancePercent            Float    @default(10.0)
  justificationThresholdPct   Float    @default(20.0)
  active                      Boolean  @default(true)
  updatedAt                   DateTime @updatedAt
  store Store? @relation(...)
}
```

### Lógica de classificação

```
deviationPct = (chargedFreight - suggestedFreight) / suggestedFreight * 100

| Desvio | Classificação |
|---|---|
| dentro da tolerância (ex: ±10%) | WITHIN_RULE |
| abaixo do mínimo | BELOW_RULE |
| acima do limite soft | ABOVE_RULE |
| acima do limite hard (ex: >20%) | ABOVE_RULE + justificationRequired = true |
```

### Hard Gate — comportamento obrigatório

Quando `justificationRequired = true`:
- **API** `POST /api/solicitacoes` e `PATCH /api/solicitacoes/[id]` retornam `HTTP 422` com `code: "JUSTIFICATION_REQUIRED"` se tentar avançar status sem justificativa
- **UI** exibe modal obrigatório: "O frete cobrado (R$ X) está Y% acima do sugerido (R$ Z). Informe o motivo para continuar."
- A justificativa é salva em `FreightAudit.justification` + `justifiedById` + `justifiedAt`
- Após justificativa salva, o fluxo é desbloqueado

### Audit Service

```typescript
// services/audit.service.ts
classifyFreightDeviation(charged, suggested, config): AuditClassification
requiresJustification(deviationPct, config): boolean
saveAuditEntry(input): Promise<FreightAudit>
getAuditSummary(filters): Promise<AuditSummary>
getDeviationBySellerRanking(storeId?, period?): Promise<SellerDeviationRank[]>
```

---

## Seção 4 — Score Logístico de Transferência

### Pesos (configuráveis por SystemConfig)

| Critério | Peso padrão |
|---|---|
| Disponibilidade do item | 30% |
| Proximidade da loja complementar → loja origem | 20% |
| Proximidade da loja complementar → destino final | 20% |
| Impacto no prazo estimado | 15% |
| Proximidade do motorista ativo mais próximo | 15% |

### Algoritmo por candidato

```
score_disponibilidade = estoque >= qtd_solicitada ? 100 : 0

score_prox_origem = max(0, 100 - (distancia_candidata_origem / MAX_KM * 100))
score_prox_destino = max(0, 100 - (distancia_candidata_destino / MAX_KM * 100))

score_prazo:
  se ANTICIPATED → 100 (sem urgência)
  se ON_ROUTE ou URGENT → função inversa do tempo estimado de chegada

score_motorista:
  buscar motorista disponível mais próximo da loja candidata
  score = max(0, 100 - (distancia_motorista_candidata / RAIO_MAXIMO * 100))
  se nenhum motorista disponível → 0

score_final = Σ(peso_i * score_i)
```

### Saída do score

```typescript
interface TransferScoreResult {
  storeId: string
  storeCode: string
  storeName: string
  score: number           // 0–100
  scoreBreakdown: {
    availability: number
    originProximity: number
    destinationProximity: number
    deadlineImpact: number
    driverProximity: number
  }
  availableQty: number
  distanceToOriginKm: number
  distanceToDestKm: number
  closestDriverName?: string
  closestDriverDistanceKm?: number
  recommendationSummary: string  // ex: "Loja 131 — estoque OK, motorista a 2km, mais próxima do cliente"
}
```

`scoreDetails` (JSON) salvo no `Transfer` no momento da criação para auditabilidade futura.

### Novo modelo Transfer — campos SLA

```prisma
// Campos adicionados em Transfer:
scoreDetails          Json?       // TransferScoreResult[]
expectedCompletionAt  DateTime?   // prazo acordado
actualCompletionAt    DateTime?   // quando foi concluída de fato
delayReason           String?     // motivo do atraso se houve
```

---

## Seção 5 — Tracking com Funções de Decisão Operacional

### Status do motorista (novo enum DriverStatus)

```prisma
enum DriverStatus {
  AVAILABLE
  ON_ROUTE
  COLLECTING
  ON_TRANSFER
  FINISHING
  OFF_DUTY
}

// Campos novos em Driver:
currentStatus    DriverStatus @default(AVAILABLE)
statusUpdatedAt  DateTime?
```

### Tracking Service — funções de decisão

```typescript
// services/tracking.service.ts

// localização
updateDriverLocation(driverId, coords, status?): Promise<void>
getLatestLocation(driverId): Promise<DriverLocation | null>

// contexto operacional
getDriverContext(driverId): Promise<{
  nearestStore: { store, distanceKm }
  nearestActiveDispatch: { dispatch, distanceKm } | null
  nearestPendingTransfer: { transfer, distanceKm } | null
  activeDispatchCount: number
}>

// funções de decisão
getClosestDriverToLocation(lat, lng): Promise<DriverWithDistance | null>
getDriverWithLowestLoad(): Promise<Driver | null>
getDriversNearStore(storeId, radiusKm): Promise<DriverWithDistance[]>
suggestDriverForUrgentDelivery(deliveryRequestId): Promise<{
  driver: Driver
  reason: string
  distanceKm: number
}>
```

### API Routes de tracking

- `POST /api/motoristas/[id]/localizacao` — recebe `{ lat, lng, speed?, heading?, status? }`
- `PATCH /api/motoristas/[id]/status` — atualiza `currentStatus`
- `GET /api/motoristas` — lista com última localização e contexto
- `GET /api/motoristas/[id]/contexto` — contexto operacional completo de um motorista

### UI — Painel de rastreamento

Lista operacional (sem mapa nesta sprint) com:
- Nome, loja base, status atual (badge colorido)
- Última posição: "X min atrás"
- Loja mais próxima
- Tarefa ativa (entrega ou transferência)
- Número de despachos ativos
- Botão "Sugerir para urgente" (chama `suggestDriverForUrgentDelivery`)

Estrutura pronta para mapa: hook `useDriverLocations()` expõe array `{ driverId, lat, lng, status }` no formato consumível por Google Maps JS API ou Leaflet.

---

## Seção 6 — Dashboard Operacional e Gerencial

### KPIs obrigatórios

**Financeiros:**
- Custo logístico bruto no período
- Frete cobrado no período
- Subsídio líquido (custo - receita de frete)
- % subsídio sobre faturamento expedido
- Custo médio por entrega
- **Custo médio por km rodado** ← novo

**Volume:**
- Total de entregas
- % entregas urgentes
- % entregas com transferência
- Transferências antecipadas vs emergenciais
- % via Lalamove

**Qualidade:**
- **% entregas fora da rota ideal** ← novo (distância real > 1.3x distância reta = rota subótima)
- Desvio médio de frete por vendedor
- Ranking de vendedores com maior desvio
- SLA de entrega (média de dias prometido vs realizado)
- SLA de transferências (expectedCompletionAt vs actualCompletionAt)

**Lojas:**
- Lojas com maior necessidade de transferência (saída)
- Lojas com maior recebimento de transferência
- Ranking de desvio de frete por loja

### Filtros

Por período (hoje / semana / mês / customizado), loja e vendedor.

---

## Mudanças no Schema — Resumo

| Modelo | Operação | Campos |
|---|---|---|
| `FreightQuote` | ALTER | + `distanceApproximated`, `distanceSource`, `durationMin` |
| `FreightAudit` | ALTER | + `deviationPercent`, `deviationClassification`, `justificationRequired`, `justification`, `justifiedById`, `justifiedAt`, `toleranceApplied` |
| `Driver` | ALTER | + `currentStatus`, `statusUpdatedAt` |
| `Transfer` | ALTER | + `scoreDetails`, `expectedCompletionAt`, `actualCompletionAt`, `delayReason` |
| `GeoCache` | CREATE | novo modelo |
| `RouteCache` | CREATE | novo modelo |
| `AuditConfig` | CREATE | novo modelo |
| `DriverStatus` | CREATE | novo enum |

---

## Variáveis de Ambiente Novas

```env
# ERP
ERP_API_URL=
ERP_API_KEY=
ERP_AUTH_TYPE=bearer           # bearer | apikey
ERP_TIMEOUT_MS=5000

# Google Maps
GOOGLE_MAPS_KEY=
GOOGLE_MAPS_ROUTE_CACHE_TTL_H=24

# Auditoria
FREIGHT_TOLERANCE_PCT=10       # tolerância padrão global
FREIGHT_JUSTIFICATION_PCT=20   # acima disso exige justificativa
```

---

## Arquivos — Criados / Alterados

**Criados (18 novos):**
```
providers/erp/erp.provider.interface.ts
providers/erp/rest.provider.ts
providers/erp/mock.provider.ts
providers/erp/csv.provider.ts
providers/erp/index.ts
providers/maps/maps.provider.interface.ts
providers/maps/google-maps.provider.ts
providers/maps/haversine.provider.ts
providers/maps/index.ts
services/audit.service.ts
services/transfer-score.service.ts
services/tracking.service.ts
app/api/motoristas/route.ts
app/api/motoristas/[id]/localizacao/route.ts
app/api/motoristas/[id]/status/route.ts
app/api/auditoria/frete/route.ts
app/api/auditoria/frete/[id]/justificativa/route.ts
app/api/auditoria/kpis/route.ts
app/(app)/rastreamento/page.tsx
app/(app)/auditoria/page.tsx
```

**Alterados (7 existentes):**
```
prisma/schema.prisma
prisma/seed.ts
services/erp.service.ts
services/frete.service.ts
services/transferencia.service.ts
app/(app)/dashboard/page.tsx
components/forms/cotacao-form.tsx
.env.example
```

---

## Decisões de Design Registradas

1. **ERP via provider pattern:** Código de negócio nunca importa um provider diretamente — sempre via factory `getERPProvider()`. Troca de ERP = novo arquivo, zero mudança nos services.

2. **Distância com fallback em camadas:** Consistência de dados é mais importante que precisão ocasional. Qualquer distância calculada por Haversine é marcada como aproximada e sinalizada ao usuário.

3. **Auditoria como hard gate:** Desvio > limite configurado bloqueia o avanço do status via API (HTTP 422). Não é apenas relatório — é controle em tempo real.

4. **Motorista no score de transferência:** Score considera disponibilidade de recurso humano ativo, não apenas estoque e geografia. Torna a sugestão acionável imediatamente.

5. **SLA em Transfer:** `expectedCompletionAt` definido no momento de criação/aprovação. `actualCompletionAt` e `delayReason` preenchidos ao receber. Permite medir gargalo por loja.

6. **Tracking como lista operacional primeiro:** Mapa completo tem custo de implementação e billing Maps alto. Lista com dados estruturados entrega valor operacional imediato e prepara a estrutura para mapa.
