# Motor de Decisão de Frete — Design Spec
**Data:** 2026-04-18  
**Status:** Aprovado

---

## Objetivo

Criar um motor que decide automaticamente o modal de entrega (motorista próprio ou Lalamove), calcula o custo real e sugere o preço ao cliente — com base em carga, rota, urgência e disponibilidade de motoristas.

O vendedor não escolhe o modal. O sistema decide e explica.

---

## Contexto existente reutilizado

| Componente | Uso |
|---|---|
| `lib/route-resolver.ts` | Cache → Google Maps → Haversine. Retorna `distanceKm`, `durationMin`, `isApproximate`. |
| `services/lalamove.service.ts` | `getLalamoveQuote()` para cotação via API. |
| `services/despacho.service.ts::decideModal()` | Mantido para casos simples (sem itens). O novo motor é para fluxo completo. |
| `lib/constants.ts` | Tipos de serviço Lalamove existentes. |
| `prisma/schema.prisma` | `Driver`, `DriverLocation`, `SystemConfig`, `FreightZone`. |

---

## Tipos novos

### InternalVehicleType (frota própria)

Três tipos — classificados por peso total e quantidade de latas:

```typescript
enum InternalVehicleType {
  MOTO      // até 20 kg
  FIORINO   // até 500 kg OU até 20 latas
  CAMINHAO  // até 1.500 kg OU até 67 latas
  // acima disso → exceção operacional (EXCEPTION)
}
```

### LalamoveServiceType (Lalamove Brasil)

Cinco tipos — classificados por peso total da carga:

```typescript
enum LalamoveServiceType {
  LALAPRO    // até 20 kg
  UTILITARIO // até 500 kg
  VAN        // até 1.000 kg
  CARRETO    // até 1.500 kg
  CAMINHAO   // até 2.500 kg
}
```

> Os nomes acima são internos. Os códigos reais da API Lalamove BR devem ser confirmados na documentação antes do go-live (ex: `"MOTORCYCLE"`, `"VAN"`, `"TRUCK"`, etc.).

### VehicleType (resultado unificado no FreightDecisionResult)

Para não duplicar campos no resultado, o motor retorna:

```typescript
// Qual veículo foi selecionado (interno OU Lalamove)
type VehicleType = InternalVehicleType | LalamoveServiceType
```

### FreightDecisionInput

```typescript
interface FreightDecisionInput {
  originLat: number
  originLng: number
  destLat: number
  destLng: number
  isUrgent: boolean
  deliveryDate: Date
  deliveryWindowStart: Date
  deliveryWindowEnd: Date
  items: {
    productCode: string
    quantity: number
    weightKg: number
    latas?: number   // quantidade de latas (embalagem padrão 18L) — usado no limite de capacidade da frota
    volumeM3?: number
  }[]
  sellerId: string
  storeId: string
}
```

### FreightDecisionResult

```typescript
interface FreightDecisionResult {
  selectedMode: "INTERNAL" | "LALAMOVE"
  selectedVehicle: VehicleType
  driverId?: string           // se INTERNAL
  requiresManualAssignment: boolean  // true quando nenhum recurso disponível
  lalamoveQuote?: {           // se LALAMOVE
    quotationId: string
    estimatedPrice: number
    vehicleType: string
  }
  distanceKm: number
  durationMinutes: number
  isApproximate: boolean
  internalCost: number
  lalamoveCost: number | null // null se API indisponível
  suggestedPrice: number
  decisionReason: string
}
```

### FreightDecisionLog (Prisma — nova tabela)

```prisma
model FreightDecisionLog {
  id              String     @id @default(cuid())
  storeId         String
  deliveryRequestId String?
  selectedMode    String     // INTERNAL | LALAMOVE
  selectedVehicle String
  driverId        String?
  distanceKm      Float
  durationMin     Float
  internalCost    Float
  lalamoveCost    Float?
  suggestedPrice  Float
  decisionReason  String
  isUrgent        Boolean
  isApproximate   Boolean
  totalWeightKg   Float
  totalVolumeM3   Float?
  createdAt       DateTime   @default(now())
}
```

---

## Configurações no SystemConfig (novas chaves)

### Frota própria

| Chave | Valor padrão | Significado |
|---|---|---|
| `COST_PER_KM` | `1.50` | Custo por km (flat, todos os veículos) |
| `COST_PER_HOUR` | `30.00` | Custo por hora de rota |
| `FIXED_ROUTE_COST` | `8.00` | Custo fixo por saída |
| `INTERNAL_MOTO_MAX_KG` | `20` | Máximo para moto (frota própria) |
| `INTERNAL_FIORINO_MAX_KG` | `500` | Máximo em kg para fiorino |
| `INTERNAL_FIORINO_MAX_LATAS` | `20` | Máximo em latas para fiorino |
| `INTERNAL_CAMINHAO_MAX_KG` | `1500` | Máximo em kg para caminhão |
| `INTERNAL_CAMINHAO_MAX_LATAS` | `67` | Máximo em latas para caminhão |

### Lalamove

| Chave | Valor padrão | Significado |
|---|---|---|
| `LALA_LALAPRO_MAX_KG` | `20` | Máximo para LalaPro (moto) |
| `LALA_UTILITARIO_MAX_KG` | `500` | Máximo para utilitário |
| `LALA_VAN_MAX_KG` | `1000` | Máximo para van |
| `LALA_CARRETO_MAX_KG` | `1500` | Máximo para carreto |
| `LALA_CAMINHAO_MAX_KG` | `2500` | Máximo para caminhão |

### Preço e urgência

| Chave | Valor padrão | Significado |
|---|---|---|
| `URGENCY_SURCHARGE_MIN` | `1.30` | Sobretaxa de urgência (padrão aplicado) |
| `URGENCY_SURCHARGE_MAX` | `1.50` | Limite superior (para ajuste manual em pico) |
| `DRIVER_MAX_LOCATION_AGE_MIN` | `30` | Máximo de minutos desde última localização do motorista |

---

## Funções do serviço

### Passo 1 — classifyVehicle(items, config)

Retorna dois tipos independentes: um para frota própria e um para Lalamove.

**Frota própria** — usa peso total E contagem de latas (o que for mais restritivo):

```
totalKg   = sum(item.weightKg × item.quantity)
totalLatas = sum(item.latas ?? 0)

fits_moto     = totalKg ≤ INTERNAL_MOTO_MAX_KG
fits_fiorino  = totalKg ≤ INTERNAL_FIORINO_MAX_KG AND totalLatas ≤ INTERNAL_FIORINO_MAX_LATAS
fits_caminhao = totalKg ≤ INTERNAL_CAMINHAO_MAX_KG AND totalLatas ≤ INTERNAL_CAMINHAO_MAX_LATAS

internalVehicle:
  fits_moto     → MOTO
  fits_fiorino  → FIORINO
  fits_caminhao → CAMINHAO
  else          → EXCEPTION (acima da capacidade da frota própria)
```

**Lalamove** — usa apenas peso total:

```
totalKg ≤ LALA_LALAPRO_MAX_KG    → LALAPRO
totalKg ≤ LALA_UTILITARIO_MAX_KG → UTILITARIO
totalKg ≤ LALA_VAN_MAX_KG        → VAN
totalKg ≤ LALA_CARRETO_MAX_KG    → CARRETO
totalKg ≤ LALA_CAMINHAO_MAX_KG   → CAMINHAO
totalKg > LALA_CAMINHAO_MAX_KG   → EXCEPTION (carga acima de 2.500 kg)
```

Se `latas` não for informado, a classificação de frota própria usa apenas peso.

### Passo 2 — resolveRoute() [existente]

Retorna `distanceKm`, `durationMin`, `isApproximate`.

### Passo 3 — calculateInternalCost(route, config)

Custo flat — não varia por tipo de veículo (frota própria sem distinção de preço por modal):

```
custo = FIXED_ROUTE_COST
      + (distanceKm × COST_PER_KM)
      + ((durationMin / 60) × COST_PER_HOUR)
```

### Passo 4 — getAvailableDrivers(storeId)

Retorna motoristas com `available = true` e `active = true` da loja.  
Filtra por última localização dentro de `DRIVER_MAX_LOCATION_AGE_MIN` minutos (se existir).

### Passo 5 — scoreDriverForDelivery(driver, origin, dest)

Score 0–100 baseado em:
- **Proximidade da origem** (40 pts): distância Haversine entre última localização do motorista e origem
- **Proximidade do destino** (30 pts): distância Haversine entre última localização e destino
- **Dispatches ativos** (30 pts): 30 pts se 0 ativos, 15 se 1, 0 se ≥2

Retorna o motorista com maior score como candidato preferido.

### Passo 6 — getLalamoveQuote(vehicleType, origin, dest)

Usa `services/lalamove.service.ts::getLalamoveQuote()` existente com o service type mapeado.  
Retorna `null` se API indisponível ou sandbox ativo — decisão continua sem custo Lalamove.

### Passo 7 — decideBestDeliveryOption(params)

Regras em ordem de prioridade:

1. **Urgente + Lalamove disponível + lalamoveCost < internalCost × 1.2**: usar Lalamove
2. **Motorista disponível com score ≥ 60 + internalCost ≤ lalamoveCost**: usar interno
3. **Motorista disponível mas lalamoveCost < internalCost**: usar Lalamove (mais barato)
4. **Nenhum motorista disponível**: usar Lalamove
5. **Lalamove indisponível + motorista disponível**: usar interno
6. **Nenhum disponível**: retornar INTERNAL com `requiresManualAssignment: true`

Cada ramificação define um `decisionReason` legível.

### Passo 8 — calculateCustomerPrice(zone, internalCost, vehicleType, isUrgent, config)

```
// margens por veículo interno (usado quando selectedMode = INTERNAL)
margem = { MOTO: 1.8, FIORINO: 1.4, CAMINHAO: 1.3 }

// quando selectedMode = LALAMOVE, precoBase = MAX(zone.basePrice, lalamoveCost × 1.15)
// margem menor porque o custo Lalamove já é o custo real cobrado

precoBase = MAX(zone.basePrice, internalCost × margem[vehicleType])

precoFinal = isUrgent
  ? precoBase × URGENCY_SURCHARGE_MIN   // usa o mínimo configurado (conservador)
  : precoBase
```

`URGENCY_SURCHARGE_MAX` fica disponível no SystemConfig para o operador ajustar manualmente se quiser cobrar mais em pico de demanda — mas o motor sempre usa o mínimo.

### Passo 9 — log

Persiste `FreightDecisionLog` de forma assíncrona (não bloqueia a resposta).

---

## Nova rota de API

```
POST /api/frete/decisao
Body: FreightDecisionInput
Resposta: FreightDecisionResult
Auth: JWT (SELLER, OPERATOR, ADMIN)
```

---

## Integrações

| Serviço | Papel |
|---|---|
| `lib/route-resolver.ts` | Resolve rota (cache → Maps → Haversine) |
| `services/lalamove.service.ts` | Cotação Lalamove |
| `prisma` (Driver + DriverLocation) | Busca motoristas disponíveis |
| `prisma` (SystemConfig) | Carrega todos os configs de uma vez (`findMany WHERE key IN [...]`) |
| `prisma` (FreightZone) | Busca zona da distância para calcular preço |
| `prisma` (FreightDecisionLog) | Persiste log assíncrono |

---

## Arquivos a criar/modificar

| Arquivo | Ação |
|---|---|
| `services/freight-decision.service.ts` | Criar — serviço principal |
| `types/index.ts` | Adicionar `VehicleType`, `FreightDecisionInput`, `FreightDecisionResult` |
| `lib/constants.ts` | Adicionar `LALAMOVE_VEHICLE_MAP` e margens por veículo |
| `prisma/schema.prisma` | Adicionar `FreightDecisionLog` e enum `VehicleType` |
| `app/api/frete/decisao/route.ts` | Criar endpoint |
| `prisma/seed.ts` | Adicionar as 11 novas chaves do SystemConfig |
| `tests/services/freight-decision.test.ts` | Criar testes unitários |

---

## Testes unitários

- `classifyVehicleType`: thresholds corretos, volume eleva tipo
- `calculateInternalCost`: cálculo correto com configs variáveis
- `scoreDriverForDelivery`: score 0-100, sem localização = 0
- `decideBestDeliveryOption`: todas as 6 ramificações
- `calculateCustomerPrice`: MAX entre zona e custo×margem, urgência
- Integração: `makeFreightDecision()` com mocks de Prisma e Lalamove

---

## O que não está no escopo deste sprint

- UI para exibir a decisão ao vendedor (próxima sprint)
- Integração com rastreamento em tempo real de motoristas (GPS tracker)
- Otimização de rotas múltiplas (várias entregas por saída)
- Integração com Spoke para roteirização
