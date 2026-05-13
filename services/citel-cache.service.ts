// services/citel-cache.service.ts
//
// Cache in-memory com TTL para respostas da API Citel.
// Fluid Compute reutiliza instâncias → cache persiste entre requests concorrentes.
// Para cache distribuído (multi-instância), substitua por Upstash Redis.
//
// TTLs definidos por tipo de dado:
//   header: 10 min  — dados de cliente/endereço mudam raramente
//   items:  10 min  — itens do pedido confirmado são estáveis
//   stock:  45s     — saldo muda a cada reserva ou venda

import type { CitelPedidoCabecalho, CitelPedidoItem, EnrichedDeliveryItem } from "@/types/stock";

// ─── Cache genérico com TTL ───────────────────────────────────────────────

interface CacheEntry<T> {
  data:       T;
  expiresAt:  number;
  fetchedAt:  number;
}

class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly label: string
  ) {}

  get(key: string): { data: T; ageMs: number } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      console.log(`[citel-cache] MISS ${this.label} key=${key} reason=expired`);
      return null;
    }
    const ageMs = Date.now() - entry.fetchedAt;
    console.log(`[citel-cache] HIT  ${this.label} key=${key} age=${Math.round(ageMs / 1000)}s`);
    return { data: entry.data, ageMs };
  }

  set(key: string, data: T): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
      fetchedAt: Date.now(),
    });
    console.log(`[citel-cache] SET  ${this.label} key=${key} ttl=${this.ttlMs / 1000}s`);
  }

  invalidate(key: string): void {
    const had = this.store.has(key);
    this.store.delete(key);
    if (had) console.log(`[citel-cache] EVICT ${this.label} key=${key}`);
  }

  invalidatePrefix(prefix: string): void {
    let n = 0;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) { this.store.delete(k); n++; }
    }
    if (n > 0) console.log(`[citel-cache] EVICT_PREFIX ${this.label} prefix=${prefix} count=${n}`);
  }

  size(): number {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt) this.store.delete(k);
    }
    return this.store.size;
  }
}

// ─── Instâncias por tipo de dado ─────────────────────────────────────────

export const headerCache = new TtlCache<CitelPedidoCabecalho>(10 * 60 * 1000, "header");
export const itemsCache  = new TtlCache<CitelPedidoItem[]>   (10 * 60 * 1000, "items");
export const stockCache  = new TtlCache<EnrichedDeliveryItem[]>(45 * 1000,    "stock");

// ─── Chaves canônicas ─────────────────────────────────────────────────────

export const headerKey = (order: string, store: string) => `${order}:${store}`;
export const itemsKey  = (order: string, store: string) => `${order}:${store}`;
export const stockKey  = (order: string, store: string, empresa: string) =>
  `${order}:${store}:${empresa}`;

// ─── Invalidação por evento ───────────────────────────────────────────────
//
// Chamar quando: solicitação criada, NF emitida, transferência criada,
// separação iniciada, estoque reservado.

export function invalidatePedido(orderNumber: string, storeCode: string): void {
  const k = `${orderNumber}:${storeCode}`;
  headerCache.invalidate(k);
  itemsCache.invalidate(k);
  stockCache.invalidatePrefix(k);
  console.log(`[citel-cache] INVALIDATE_PEDIDO order=${orderNumber} store=${storeCode}`);
}

export function invalidateStockOnly(orderNumber: string, storeCode: string): void {
  stockCache.invalidatePrefix(`${orderNumber}:${storeCode}`);
  console.log(`[citel-cache] INVALIDATE_STOCK order=${orderNumber} store=${storeCode}`);
}

// ─── Diagnóstico ─────────────────────────────────────────────────────────
// Preparado para webhook futuro da Citel:
// quando a Citel notificar mudança de pedido via webhook,
// chamar invalidatePedido(orderNumber, storeCode) para forçar refresh.

export function cacheStats() {
  return {
    header: headerCache.size(),
    items:  itemsCache.size(),
    stock:  stockCache.size(),
  };
}
