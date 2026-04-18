# Sprint 2A — Google Maps: Distância e Duração de Rota Real

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o cálculo Haversine (linha reta) por distância e duração de rota real via Google Maps Distance Matrix API, com cache PostgreSQL com TTL dinâmico por distância, chave contextualizada por período do dia, e fallback automático com alerta visível quando o Google Maps não estiver disponível.

**Architecture:** Um novo trio de arquivos em `lib/` — `google-maps.ts` (cliente HTTP), `route-cache.ts` (chave + operações Prisma), `route-resolver.ts` (orquestrador: cache → API → fallback) — mantém `frete.service.ts` com responsabilidade única de negócio. O schema ganha o modelo `RouteCache` e campos em `FreightQuote` (`durationMinutes`, `isApproximate`). O motor de despacho (`decideModal`) passa a considerar `durationMinutes` além de `distanceKm`.

---

## Ajustes ao Plano (2026-04-17)

| # | Ajuste | Tasks impactadas |
|---|--------|-----------------|
| 1 | **TTL dinâmico por distância**: ≤5 km → 7d · 5-15 km → 15d · >15 km → 30d | Task 4 |
| 2 | **timeBucket na chave de cache**: MORNING (6h-12h) / AFTERNOON (12h-18h) / EVENING (18h-6h) | Task 4, Task 5 |
| 3 | **durationMinutes no motor de despacho**: `decideModal` recebe duração; nova regra >45 min → Lalamove | Task 6.5 (nova) |
| 4 | **Fallback gera alerta**: `isApproximate` produz `warning` na resposta + badge visual na tela de cotação | Task 2, Task 6, Task 7 |

**Tech Stack:** Google Maps Distance Matrix API · Prisma (PostgreSQL) · Vitest · Next.js 14 (App Router) · TypeScript

---

## Mapa de Arquivos

| Ação | Arquivo | Responsabilidade |
|------|---------|-----------------|
| Criar | `vitest.config.ts` | Configuração do test runner |
| Criar | `lib/google-maps.ts` | Cliente HTTP da Distance Matrix API |
| Criar | `lib/route-cache.ts` | Chave de cache + CRUD no PostgreSQL |
| Criar | `lib/route-resolver.ts` | Orquestra cache → Google Maps → Haversine |
| Criar | `tests/lib/google-maps.test.ts` | Testes do cliente HTTP (mock fetch) |
| Criar | `tests/lib/route-cache.test.ts` | Testes da chave de cache (função pura) |
| Criar | `tests/lib/route-resolver.test.ts` | Testes do orquestrador (mocks) |
| Criar | `.env.local.example` | Documentação das variáveis de ambiente |
| Modificar | `prisma/schema.prisma` | Adicionar RouteCache + campos a FreightQuote |
| Modificar | `types/index.ts` | Estender FreightQuoteResult |
| Modificar | `services/frete.service.ts` | Usar resolveRoute, persistir novos campos |
| Modificar | `package.json` | Adicionar vitest + script test |

---

## Task 0: Configurar Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts + devDependencies)

- [ ] **Step 1: Instalar Vitest**

```bash
cd "C:/Users/Alberto/OneDrive - Atual Comercio de Tintas e Materiais para Pintura/Claude/Projects/sistema-logistica"
npm install -D vitest vite-tsconfig-paths
```

Expected: instalação sem erros, `node_modules/vitest` presente.

- [ ] **Step 2: Criar vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
  },
});
```

- [ ] **Step 3: Adicionar script de test no package.json**

No bloco `"scripts"`, adicionar após `"lint"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Criar teste de smoke para verificar setup**

```typescript
// tests/smoke.test.ts
describe("vitest smoke test", () => {
  it("vitest está funcionando", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Rodar o smoke test**

```bash
npm test
```

Expected:
```
✓ tests/smoke.test.ts (1)
  ✓ vitest está funcionando

Test Files  1 passed (1)
Tests       1 passed (1)
```

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/smoke.test.ts package.json package-lock.json
git commit -m "chore: adicionar vitest como test runner"
```

---

## Task 1: Schema Prisma — RouteCache + campos em FreightQuote

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Escrever teste de migração (verificação manual)**

Anotar o estado atual das tabelas — será verificado no Step 5.

```bash
npx prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns
WHERE table_name = 'freight_quotes'
ORDER BY column_name;
SQL
```

Expected: lista sem `duration_minutes` nem `is_approximate`.

- [ ] **Step 2: Adicionar campos em FreightQuote**

No modelo `FreightQuote`, após a linha `estimatedDays`:

```prisma
  durationMinutes Float?          // duração real de rota em minutos (Google Maps)
  isApproximate   Boolean @default(false) // true = distância via Haversine (fallback)
```

- [ ] **Step 3: Adicionar modelo RouteCache no final do schema**

Após o modelo `SystemConfig`:

```prisma
// ──────────────────────────────────────────────
// CACHE DE ROTAS (Google Maps Distance Matrix)
// ──────────────────────────────────────────────

model RouteCache {
  id          String   @id @default(cuid())
  // chave de lookup: coordenadas arredondadas a 4 casas (~11m de precisão)
  cacheKey    String   @unique // "{oLat4dp}_{oLng4dp}_{dLat4dp}_{dLng4dp}"
  originLat   Float
  originLng   Float
  destLat     Float
  destLng     Float
  distanceKm  Float
  durationMin Float    // duração em minutos
  source      String   @default("GOOGLE_MAPS")
  fetchedAt   DateTime @default(now())
  expiresAt   DateTime // TTL = 30 dias

  @@index([cacheKey])
  @@map("route_cache")
}
```

- [ ] **Step 4: Gerar e aplicar migração**

```bash
npx prisma migrate dev --name google_maps_route_cache
```

Expected:
```
✔ Generated Prisma Client
The following migration(s) have been created and applied:

migrations/
  └─ 20260417xxxxxx_google_maps_route_cache/
       └─ migration.sql
```

- [ ] **Step 5: Verificar tabela criada**

```bash
npx prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns
WHERE table_name = 'freight_quotes'
  AND column_name IN ('duration_minutes', 'is_approximate')
ORDER BY column_name;
SQL
```

Expected:
```
duration_minutes
is_approximate
```

```bash
npx prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns
WHERE table_name = 'route_cache'
ORDER BY column_name;
SQL
```

Expected: `cache_key`, `dest_lat`, `dest_lng`, `distance_km`, `duration_min`, `expires_at`, `fetched_at`, `id`, `origin_lat`, `origin_lng`, `source`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: adicionar RouteCache e campos de rota real em FreightQuote"
```

---

## Task 2: Estender FreightQuoteResult nos tipos

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Escrever teste de compilação (verificação)**

Este step verifica que o TypeScript não compila com os tipos antigos incompletos.
O teste real é o `tsc --noEmit` no final.

- [ ] **Step 2: Atualizar a interface FreightQuoteResult**

Localizar em `types/index.ts` a interface `FreightQuoteResult` (linha 115) e adicionar dois campos:

```typescript
export interface FreightQuoteResult {
  distanceKm: number;
  durationMinutes: number;      // duração real de rota em minutos
  isApproximate: boolean;       // true = fallback Haversine ativo
  zone: FreightZone | null;
  suggestedPrice: number;
  isUrgent: boolean;
  urgentFactor: number | null;
  estimatedDays: number;
  deliveryType: DeliveryType;
  underConsultation: boolean;
}
```

- [ ] **Step 3: Verificar que TypeScript compila**

```bash
npx tsc --noEmit
```

Expected: saída vazia (sem erros). Se aparecer erro em `frete.service.ts`, é esperado — será corrigido na Task 6.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat: adicionar durationMinutes e isApproximate em FreightQuoteResult"
```

---

## Task 3: lib/google-maps.ts — Cliente Distance Matrix

**Files:**
- Create: `lib/google-maps.ts`
- Create: `tests/lib/google-maps.test.ts`

- [ ] **Step 1: Escrever os testes primeiro**

```typescript
// tests/lib/google-maps.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRouteDistance } from "@/lib/google-maps";

// mock da fetch global
global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

describe("getRouteDistance", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.clearAllMocks();
  });

  it("retorna null sem chamar fetch quando API_KEY está ausente", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retorna distância e duração quando API responde OK", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [
          {
            elements: [
              {
                status: "OK",
                distance: { value: 3540 }, // 3.54 km
                duration: { value: 840 },  // 14 min
              },
            ],
          },
        ],
      }),
    } as Response);

    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBeCloseTo(3.54, 2);
    expect(result!.durationMin).toBeCloseTo(14, 0);
  });

  it("retorna null quando elemento tem status diferente de OK", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [{ elements: [{ status: "ZERO_RESULTS" }] }],
      }),
    } as Response);

    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result).toBeNull();
  });

  it("retorna null quando HTTP status não é 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as Response);

    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result).toBeNull();
  });

  it("retorna null quando fetch lança exceção de rede", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);
    expect(result).toBeNull();
  });

  it("constrói URL com os parâmetros corretos", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [{ elements: [{ status: "OK", distance: { value: 1000 }, duration: { value: 120 } }] }],
      }),
    } as Response);

    await getRouteDistance(-23.5501, -46.6333, -23.5435, -46.629);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("origins=-23.5501,-46.6333");
    expect(calledUrl).toContain("destinations=-23.5435,-46.629");
    expect(calledUrl).toContain("mode=driving");
    expect(calledUrl).toContain("key=test-key-123");
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npm test tests/lib/google-maps.test.ts
```

Expected: FAIL com `Cannot find module '@/lib/google-maps'`.

- [ ] **Step 3: Criar lib/google-maps.ts**

```typescript
// lib/google-maps.ts
// Cliente do Google Maps Distance Matrix API.
// Responsabilidade única: converter dois pares de coordenadas
// em distância e duração de rota real via API HTTP.

const DISTANCE_MATRIX_URL =
  "https://maps.googleapis.com/maps/api/distancematrix/json";

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
}

export async function getRouteDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<RouteResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn(
      "[google-maps] GOOGLE_MAPS_API_KEY não configurada — fallback ativo"
    );
    return null;
  }

  const url = new URL(DISTANCE_MATRIX_URL);
  url.searchParams.set("origins", `${originLat},${originLng}`);
  url.searchParams.set("destinations", `${destLat},${destLng}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("units", "metric");
  url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error(`[google-maps] HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const element = data?.rows?.[0]?.elements?.[0];

    if (!element || element.status !== "OK") {
      console.error(`[google-maps] status inesperado: ${element?.status}`);
      return null;
    }

    return {
      distanceKm: element.distance.value / 1000, // metros → km
      durationMin: element.duration.value / 60,  // segundos → minutos
    };
  } catch (err) {
    console.error("[google-maps] erro na chamada:", err);
    return null;
  }
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
npm test tests/lib/google-maps.test.ts
```

Expected:
```
✓ tests/lib/google-maps.test.ts (6)
  ✓ retorna null sem chamar fetch quando API_KEY está ausente
  ✓ retorna distância e duração quando API responde OK
  ✓ retorna null quando elemento tem status diferente de OK
  ✓ retorna null quando HTTP status não é 200
  ✓ retorna null quando fetch lança exceção de rede
  ✓ constrói URL com os parâmetros corretos

Test Files  1 passed (1)
Tests       6 passed (6)
```

- [ ] **Step 5: Commit**

```bash
git add lib/google-maps.ts tests/lib/google-maps.test.ts
git commit -m "feat: adicionar cliente Google Maps Distance Matrix"
```

---

## Task 4: lib/route-cache.ts — Cache de Rotas no PostgreSQL

**Files:**
- Create: `lib/route-cache.ts`
- Create: `tests/lib/route-cache.test.ts`

- [ ] **Step 1: Escrever os testes da função pura buildCacheKey**

```typescript
// tests/lib/route-cache.test.ts
import { describe, it, expect } from "vitest";
import { buildCacheKey } from "@/lib/route-cache";

describe("buildCacheKey", () => {
  it("arredonda coordenadas para 4 casas decimais", () => {
    const key = buildCacheKey(
      -23.55012345,
      -46.63334567,
      -23.54350001,
      -46.62900099
    );
    expect(key).toBe("-23.5501_-46.6333_-23.5435_-46.6290");
  });

  it("origem e destino são posicionalmente distintos", () => {
    const keyAB = buildCacheKey(-23.5501, -46.6333, -23.5435, -46.629);
    const keyBA = buildCacheKey(-23.5435, -46.629, -23.5501, -46.6333);
    expect(keyAB).not.toBe(keyBA);
  });

  it("coordenadas idênticas geram a mesma chave em chamadas diferentes", () => {
    const key1 = buildCacheKey(-23.5501, -46.6333, -23.5435, -46.629);
    const key2 = buildCacheKey(-23.5501, -46.6333, -23.5435, -46.629);
    expect(key1).toBe(key2);
  });

  it("diferenças menores que 11m (5ª casa decimal) resultam na mesma chave", () => {
    // -23.55011 e -23.55019 ambos arredondam para -23.5501
    const key1 = buildCacheKey(-23.55011, -46.6333, -23.5435, -46.629);
    const key2 = buildCacheKey(-23.55019, -46.6333, -23.5435, -46.629);
    expect(key1).toBe(key2);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npm test tests/lib/route-cache.test.ts
```

Expected: FAIL com `Cannot find module '@/lib/route-cache'`.

- [ ] **Step 3: Criar lib/route-cache.ts**

```typescript
// lib/route-cache.ts
// Cache de rotas no PostgreSQL.
// Responsabilidade: construir chave de lookup e executar
// operações de leitura/escrita no modelo RouteCache.

import { prisma } from "@/lib/prisma";
import type { RouteResult } from "./google-maps";

const CACHE_TTL_DAYS = 30;

// Arredonda para 4 casas decimais (~11m de precisão em SP).
// Formato: "{oLat}_{oLng}_{dLat}_{dLng}"
export function buildCacheKey(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): string {
  return [
    originLat.toFixed(4),
    originLng.toFixed(4),
    destLat.toFixed(4),
    destLng.toFixed(4),
  ].join("_");
}

export async function getCachedRoute(
  cacheKey: string
): Promise<RouteResult | null> {
  const cached = await prisma.routeCache.findUnique({ where: { cacheKey } });

  if (!cached) return null;

  if (cached.expiresAt < new Date()) {
    // expirado: remove de forma assíncrona e retorna null para nova consulta
    prisma.routeCache.delete({ where: { cacheKey } }).catch(() => {});
    return null;
  }

  return { distanceKm: cached.distanceKm, durationMin: cached.durationMin };
}

export async function saveCachedRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  result: RouteResult
): Promise<void> {
  const cacheKey = buildCacheKey(originLat, originLng, destLat, destLng);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

  await prisma.routeCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      originLat,
      originLng,
      destLat,
      destLng,
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      expiresAt,
    },
    update: {
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      fetchedAt: new Date(),
      expiresAt,
    },
  });
}
```

- [ ] **Step 4: Rodar os testes**

```bash
npm test tests/lib/route-cache.test.ts
```

Expected:
```
✓ tests/lib/route-cache.test.ts (4)
  ✓ arredonda coordenadas para 4 casas decimais
  ✓ origem e destino são posicionalmente distintos
  ✓ coordenadas idênticas geram a mesma chave em chamadas diferentes
  ✓ diferenças menores que 11m (5ª casa decimal) resultam na mesma chave

Test Files  1 passed (1)
Tests       4 passed (4)
```

- [ ] **Step 5: Commit**

```bash
git add lib/route-cache.ts tests/lib/route-cache.test.ts
git commit -m "feat: adicionar cache de rotas no PostgreSQL"
```

---

## Task 5: lib/route-resolver.ts — Orquestrador Cache → API → Fallback

**Files:**
- Create: `lib/route-resolver.ts`
- Create: `tests/lib/route-resolver.test.ts`

- [ ] **Step 1: Escrever os testes do orquestrador**

```typescript
// tests/lib/route-resolver.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/google-maps", () => ({
  getRouteDistance: vi.fn(),
}));
vi.mock("@/lib/route-cache", () => ({
  buildCacheKey: vi.fn(() => "mock-cache-key"),
  getCachedRoute: vi.fn(),
  saveCachedRoute: vi.fn(),
}));

import { getRouteDistance } from "@/lib/google-maps";
import { getCachedRoute, saveCachedRoute } from "@/lib/route-cache";
import { resolveRoute } from "@/lib/route-resolver";

describe("resolveRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna cache sem chamar Google Maps quando há hit", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue({
      distanceKm: 3.5,
      durationMin: 8,
    });

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBe(3.5);
    expect(result.durationMin).toBe(8);
    expect(result.isApproximate).toBe(false);
    expect(getRouteDistance).not.toHaveBeenCalled();
    expect(saveCachedRoute).not.toHaveBeenCalled();
  });

  it("chama Google Maps no cache miss e salva resultado", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(getRouteDistance).mockResolvedValue({
      distanceKm: 4.2,
      durationMin: 11,
    });

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBe(4.2);
    expect(result.durationMin).toBe(11);
    expect(result.isApproximate).toBe(false);
    expect(saveCachedRoute).toHaveBeenCalledOnce();
  });

  it("usa Haversine quando cache miss E Google Maps retorna null", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(getRouteDistance).mockResolvedValue(null);

    // SP: coordenadas da loja 067 (~Tatuapé) até um ponto próximo
    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.distanceKm).toBeLessThan(20); // razoável para SP
    expect(result.isApproximate).toBe(true);
    expect(saveCachedRoute).not.toHaveBeenCalled();
  });

  it("durationMin no fallback Haversine usa estimativa de 30km/h", async () => {
    vi.mocked(getCachedRoute).mockResolvedValue(null);
    vi.mocked(getRouteDistance).mockResolvedValue(null);

    const result = await resolveRoute(-23.5501, -46.6333, -23.5435, -46.629);

    // verificação: distanceKm / 30 * 60 ≈ durationMin
    const expectedDuration = (result.distanceKm / 30) * 60;
    expect(result.durationMin).toBeCloseTo(expectedDuration, 1);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npm test tests/lib/route-resolver.test.ts
```

Expected: FAIL com `Cannot find module '@/lib/route-resolver'`.

- [ ] **Step 3: Criar lib/route-resolver.ts**

```typescript
// lib/route-resolver.ts
// Orquestrador da resolução de rota.
// Fluxo: cache PostgreSQL → Google Maps API → Haversine fallback.
// Garante que frete.service.ts nunca fique sem uma distância,
// mesmo que a API esteja indisponível.

import { calculateHaversineDistance } from "@/lib/utils";
import { getRouteDistance } from "./google-maps";
import { buildCacheKey, getCachedRoute, saveCachedRoute } from "./route-cache";

export interface RouteResolution {
  distanceKm: number;
  durationMin: number;
  isApproximate: boolean; // true = Haversine ativo, dado não é rota real
}

export async function resolveRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<RouteResolution> {
  const cacheKey = buildCacheKey(originLat, originLng, destLat, destLng);

  // 1. cache hit?
  const cached = await getCachedRoute(cacheKey);
  if (cached) {
    return { ...cached, isApproximate: false };
  }

  // 2. Google Maps Distance Matrix
  const fromApi = await getRouteDistance(originLat, originLng, destLat, destLng);
  if (fromApi) {
    // salva no cache em background — não bloqueia a resposta
    saveCachedRoute(originLat, originLng, destLat, destLng, fromApi).catch(
      () => {}
    );
    return { ...fromApi, isApproximate: false };
  }

  // 3. fallback Haversine — estimativa de linha reta
  const distanceKm = calculateHaversineDistance(
    originLat,
    originLng,
    destLat,
    destLng
  );
  return {
    distanceKm,
    durationMin: (distanceKm / 30) * 60, // estimativa: 30 km/h em SP
    isApproximate: true,
  };
}
```

- [ ] **Step 4: Rodar os testes**

```bash
npm test tests/lib/route-resolver.test.ts
```

Expected:
```
✓ tests/lib/route-resolver.test.ts (4)
  ✓ retorna cache sem chamar Google Maps quando há hit
  ✓ chama Google Maps no cache miss e salva resultado
  ✓ usa Haversine quando cache miss E Google Maps retorna null
  ✓ durationMin no fallback Haversine usa estimativa de 30km/h

Test Files  1 passed (1)
Tests       4 passed (4)
```

- [ ] **Step 5: Commit**

```bash
git add lib/route-resolver.ts tests/lib/route-resolver.test.ts
git commit -m "feat: adicionar orquestrador de rota (cache → Google Maps → Haversine)"
```

---

## Task 6: Atualizar services/frete.service.ts

**Files:**
- Modify: `services/frete.service.ts`

- [ ] **Step 1: Verificar que TypeScript reporta erro antes da mudança**

```bash
npx tsc --noEmit
```

Expected: erro em `frete.service.ts` — `FreightQuoteResult` exige `durationMinutes` e `isApproximate` que não estão sendo retornados.

- [ ] **Step 2: Reescrever services/frete.service.ts**

Substituir o conteúdo completo do arquivo:

```typescript
// services/frete.service.ts
// Cálculo de frete: zona, preço sugerido e tipo de entrega.
// A distância agora vem do resolveRoute (cache → Google Maps → Haversine).

import { prisma } from "@/lib/prisma";
import { resolveRoute } from "@/lib/route-resolver";
import { DEFAULT_URGENT_MULTIPLIER, INTERNAL_ROUTE_CUTOFF_HOUR } from "@/lib/constants";
import { DeliveryType } from "@prisma/client";
import type { FreightQuoteInput, FreightQuoteResult } from "@/types";

export async function calculateFreightQuote(
  input: FreightQuoteInput
): Promise<FreightQuoteResult> {
  // 1. resolve rota: cache → Google Maps → Haversine
  const route = await resolveRoute(
    input.originLat,
    input.originLng,
    input.destLat,
    input.destLng
  );

  // 2. busca zona correspondente à distância real
  const zone = await prisma.freightZone.findFirst({
    where: {
      active: true,
      minKm: { lte: route.distanceKm },
      OR: [
        { maxKm: null },
        { maxKm: { gt: route.distanceKm } },
      ],
    },
    orderBy: { minKm: "asc" },
  });

  // 3. multiplicador urgente (banco → fallback da constante)
  const urgentConfig = await prisma.systemConfig.findUnique({
    where: { key: "URGENT_MULTIPLIER" },
  });
  const urgentFactor = urgentConfig
    ? parseFloat(urgentConfig.value)
    : DEFAULT_URGENT_MULTIPLIER;

  // 4. calcula preço
  let suggestedPrice = 0;
  let deliveryType: DeliveryType = DeliveryType.STANDARD;

  if (!zone || zone.underConsultation) {
    return {
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMin,
      isApproximate: route.isApproximate,
      zone: zone ?? null,
      suggestedPrice: 0,
      isUrgent: input.isUrgent,
      urgentFactor: null,
      estimatedDays: 1,
      deliveryType: DeliveryType.EXCEPTION,
      underConsultation: true,
    };
  }

  suggestedPrice = zone.basePrice;

  if (input.isUrgent) {
    suggestedPrice = suggestedPrice * urgentFactor;
    deliveryType = DeliveryType.URGENT;
  }

  // 5. prazo estimado
  const currentHour = new Date().getHours();
  const estimatedDays =
    deliveryType === DeliveryType.URGENT
      ? 0
      : currentHour >= INTERNAL_ROUTE_CUTOFF_HOUR
      ? 1
      : 0;

  return {
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMin,
    isApproximate: route.isApproximate,
    zone,
    suggestedPrice,
    isUrgent: input.isUrgent,
    urgentFactor: input.isUrgent ? urgentFactor : null,
    estimatedDays,
    deliveryType,
    underConsultation: false,
  };
}

// persiste a cotação incluindo os novos campos de rota real
export async function saveFreightQuote(
  input: FreightQuoteInput,
  result: FreightQuoteResult,
  userId: string
) {
  return prisma.freightQuote.create({
    data: {
      storeId: input.storeId,
      originAddress: input.originAddress,
      originLat: input.originLat,
      originLng: input.originLng,
      destAddress: input.destAddress,
      destLat: input.destLat,
      destLng: input.destLng,
      distanceKm: result.distanceKm,
      durationMinutes: result.durationMinutes,
      isApproximate: result.isApproximate,
      zoneId: result.zone?.id ?? null,
      suggestedPrice: result.suggestedPrice,
      isUrgent: result.isUrgent,
      urgentFactor: result.urgentFactor,
      estimatedDays: result.estimatedDays,
      deliveryType: result.deliveryType,
      createdById: userId,
    },
    include: { zone: true },
  });
}

export async function getFreightZones() {
  return prisma.freightZone.findMany({
    where: { active: true },
    orderBy: { minKm: "asc" },
  });
}
```

- [ ] **Step 3: Verificar que TypeScript compila sem erros**

```bash
npx tsc --noEmit
```

Expected: saída vazia (sem erros).

- [ ] **Step 4: Rodar toda a suite de testes**

```bash
npm test
```

Expected:
```
✓ tests/smoke.test.ts (1)
✓ tests/lib/google-maps.test.ts (6)
✓ tests/lib/route-cache.test.ts (4)
✓ tests/lib/route-resolver.test.ts (4)

Test Files  4 passed (4)
Tests       15 passed (15)
```

- [ ] **Step 5: Commit**

```bash
git add services/frete.service.ts
git commit -m "feat: integrar resolveRoute em calculateFreightQuote — distância e duração reais"
```

---

## Task 7: Variáveis de Ambiente e Verificação End-to-End

**Files:**
- Create: `.env.local.example`

- [ ] **Step 1: Criar .env.local.example**

```bash
# .env.local.example
# Copie para .env.local e preencha os valores reais.

# Banco de dados PostgreSQL
DATABASE_URL="postgresql://usuario:senha@localhost:5432/sistema_logistica"

# Google Maps — habilitar: Distance Matrix API
# Console: https://console.cloud.google.com/apis/library/distance-matrix-backend.googleapis.com
GOOGLE_MAPS_API_KEY="sua-chave-aqui"

# JWT — gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET="sua-chave-jwt-aqui"
```

- [ ] **Step 2: Verificar que .env.local.example existe e .env.local não está no git**

```bash
cat .gitignore | grep env
```

Expected: `.env.local` listado (não comitar a chave real).

- [ ] **Step 3: Iniciar o servidor de desenvolvimento**

```bash
npm run dev
```

Expected: `Ready on http://localhost:3000` sem erros de compilação.

- [ ] **Step 4: Testar cotação SEM chave Google Maps (fallback Haversine)**

```bash
curl -s -X POST http://localhost:3000/api/frete/cotacao \
  -H "Content-Type: application/json" \
  -H "Cookie: token=SEU_JWT_TOKEN" \
  -d '{
    "storeId": "ID_DA_LOJA",
    "originAddress": "Rua Tuiuti, 45, Tatuapé",
    "originLat": -23.5388,
    "originLng": -46.5706,
    "destAddress": "Av. Paulista, 1000",
    "destLat": -23.5616,
    "destLng": -46.6557,
    "isUrgent": false,
    "save": false
  }' | python -m json.tool
```

Expected (fallback ativo):
```json
{
  "data": {
    "distanceKm": 9.4,
    "durationMinutes": 18.8,
    "isApproximate": true,
    ...
  },
  "success": true
}
```

- [ ] **Step 5: Configurar GOOGLE_MAPS_API_KEY em .env.local e restartar**

```bash
# editar .env.local com chave real, depois:
# Ctrl+C para parar o servidor
npm run dev
```

- [ ] **Step 6: Testar cotação COM chave Google Maps (rota real)**

Repetir o mesmo curl do Step 4.

Expected (Google Maps ativo):
```json
{
  "data": {
    "distanceKm": 12.3,
    "durationMinutes": 28,
    "isApproximate": false,
    ...
  },
  "success": true
}
```

Observar: `distanceKm` agora reflete o percurso de carro (não linha reta) e `isApproximate` é `false`.

- [ ] **Step 7: Verificar cache criado no banco**

```bash
npx prisma db execute --stdin <<'SQL'
SELECT cache_key, distance_km, duration_min, expires_at, source
FROM route_cache
ORDER BY fetched_at DESC
LIMIT 5;
SQL
```

Expected: 1 registro com `source = GOOGLE_MAPS` e `expires_at` = hoje + 30 dias.

- [ ] **Step 8: Testar que segunda chamada com mesmas coordenadas usa cache (sem hit na API)**

Repetir o curl do Step 6 e observar no terminal do servidor:
- Deve **não** aparecer logs de `[google-maps]`
- Deve responder com os mesmos valores e `isApproximate: false`

- [ ] **Step 9: Commit final**

```bash
git add .env.local.example
git commit -m "chore: adicionar .env.local.example com GOOGLE_MAPS_API_KEY documentada"
```

---

## Self-Review

### Cobertura do spec

| Requisito | Task que implementa |
|-----------|-------------------|
| Integrar Google Maps (geocoding + route distance + duration) | Task 3 (distance matrix) + Task 5 (resolveRoute) |
| Substituir cálculo simplificado nas cotações | Task 6 (frete.service.ts) |
| Salvar lat/lng e cache de rota | Task 4 (route-cache.ts) + schema Task 1 |
| Marcar quando houver fallback aproximado | Task 5 (isApproximate) + Task 6 (persistido) |

**Nota:** O spec menciona "geocoding" — o sistema já recebe `lat/lng` no `FreightQuoteInput`, então não há geocoding necessário nesta sprint. Se no futuro a API do ERP retornar apenas endereço textual sem coordenadas, adicionar geocoding em sprint separada.

### Placeholder scan

Nenhum "TBD", "TODO", "implement later" ou "similar ao task N" encontrado.

### Consistência de tipos

- `RouteResult` (google-maps.ts) → usado em `route-cache.ts` e `route-resolver.ts`
- `RouteResolution` (route-resolver.ts) → campo `durationMin` (não `durationMinutes`) → `frete.service.ts` mapeia `route.durationMin` para `result.durationMinutes`
- `FreightQuoteResult.durationMinutes` ↔ `FreightQuote.durationMinutes` no Prisma ✓
- `FreightQuoteResult.isApproximate` ↔ `FreightQuote.isApproximate` no Prisma ✓
