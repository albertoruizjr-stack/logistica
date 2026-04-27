# Spec: Refatoração Tela Transferências (Fase 2)

## Objetivo

Refatorar `app/(app)/transferencias/page.tsx` para usar os componentes do design system (`PageHeader`, `FilterBar`, `StatusBadge`, `EmptyState`), eliminando badges manuais de status, filtros de loja como chips e o empty state inline. Mantém card layout, status tabs URL-driven e `TransferActionsPanel` inalterado.

---

## Arquitetura de Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `app/(app)/transferencias/page.tsx` | Modificar | Server component — fetch, card layout, PageHeader, StatusBadge inline |
| `app/(app)/transferencias/_components/transferencias-filters.tsx` | Criar | Client component — FilterBar com loja + prioridade, URL sync |

---

## 1. page.tsx (server component)

### O que muda

- Remove: `div` header manual com badges urgentes inline
- Remove: filtros de loja como `<Link>` chips manuais com `cn`/`Filter`
- Remove: badges de status com `TRANSFER_STATUS_COLORS`/`TRANSFER_STATUS_LABELS`
- Remove: empty state `<div>` manual
- Adiciona: `PageHeader` com urgentCount badge + "Nova transferência"
- Adiciona: `<TransferenciasFilters>` (em `<Suspense>`) substituindo chips de loja
- Substitui: badges de status por `<StatusBadge>`
- Substitui: empty state por `<EmptyState>`

### O que NÃO muda

- Role guard: `if (!["ADMIN", "OPERATOR"].includes(session.role)) redirect("/dashboard")`
- `Promise.all` com `listTransfers`, `prisma.store.findMany`, `countByStatus`
- `statusFilter` default (todos não concluídos)
- Status tabs (`statusTabs` array + `<Link>` chips com contagem — permanecem exatamente iguais)
- Card layout HTML estrutural (`div`, `items`, `TransferActionsPanel`)
- Badges de prioridade manuais (`TRANSFER_PRIORITY_COLORS`/`TRANSFER_PRIORITY_LABELS` — `ANTICIPATED`/`ON_ROUTE` não existem no `StatusVariant`)
- `urgentCount` cálculo

### PageHeader

```tsx
import { PageHeader } from "@/components/ui";
import Link from "next/link";
import { Plus } from "lucide-react";

<PageHeader
  title="Transferências"
  description={`${total} transferência${total !== 1 ? "s" : ""} no filtro atual`}
  actions={
    <>
      {urgentCount > 0 && (
        <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
          {urgentCount} urgente{urgentCount > 1 ? "s" : ""}
        </span>
      )}
      <Link
        href="/transferencias/nova"
        className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition"
      >
        <Plus className="w-4 h-4" />
        Nova transferência
      </Link>
    </>
  }
/>
```

### TransferenciasFilters no layout

```tsx
import { Suspense } from "react";
import TransferenciasFilters from "./_components/transferencias-filters";

<Suspense
  fallback={<div className="h-12 bg-slate-50 border border-slate-200 rounded-lg animate-pulse" />}
>
  <TransferenciasFilters stores={stores} />
</Suspense>
```

Posicionado **entre as abas de status e a lista de cards**, substituindo o bloco de filtros de loja manual.

### StatusBadge para status de transferência

```tsx
import { StatusBadge } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";

// Substitui:
// <span className={cn("...", TRANSFER_STATUS_COLORS[transfer.status])}>
//   {TRANSFER_STATUS_LABELS[transfer.status]}
// </span>

// Por:
<StatusBadge status={transfer.status as StatusVariant} />
```

Os valores de `TransferStatus` (`PENDING`, `APPROVED`, `PREPARING`, `IN_TRANSIT`, `RECEIVED`, `CANCELLED`) estão todos presentes no `StatusVariant` do `StatusBadge`.

### Badges de prioridade — mantidos manualmente

`TransferPriority` tem valores `ANTICIPATED` e `ON_ROUTE` que **não existem** no `StatusVariant`. Manter como estão:

```tsx
// MANTÉM — não usa StatusBadge
<span className={cn(
  "text-xs px-2 py-0.5 rounded-full font-medium border",
  TRANSFER_PRIORITY_COLORS[transfer.priority]
)}>
  {TRANSFER_PRIORITY_LABELS[transfer.priority]}
</span>
```

### EmptyState

```tsx
import { EmptyState } from "@/components/ui";
import { ArrowLeftRight } from "lucide-react";

// Substitui div manual por:
<EmptyState
  icon={ArrowLeftRight}
  title="Nenhuma transferência no filtro selecionado"
  description="Crie uma nova transferência ou ajuste os filtros."
/>
```

### Imports removidos de page.tsx

```typescript
// Remover:
import { TRANSFER_STATUS_LABELS, TRANSFER_STATUS_COLORS } from "@/lib/constants";
import { Filter } from "lucide-react"; // usado só nos chips de loja removidos
```

`TRANSFER_PRIORITY_LABELS`, `TRANSFER_PRIORITY_COLORS`, `cn`, `formatRelativeTime`, `ArrowLeftRight`, `Package`, `Clock`, `CheckCircle2`, `AlertTriangle` **permanecem** — usados nos cards, status tabs e badges de prioridade.

`formatDateTime` está importado no arquivo original mas não é chamado no JSX visível — pode ser removido também se não houver uso nas sub-páginas de transferência.

### Imports adicionados

```typescript
import { Suspense } from "react";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";
import TransferenciasFilters from "./_components/transferencias-filters";
import { Plus } from "lucide-react"; // substitui uso no botão
```

---

## 2. TransferenciasFilters (client component)

**Arquivo:** `app/(app)/transferencias/_components/transferencias-filters.tsx`

### Props

```typescript
interface TransferenciasFiltersProps {
  stores: { id: string; code: string }[];
}
```

### Comportamento

- `useSearchParams()` lê `fromStore` e `priority` atuais da URL
- `handleChange(key, value)`: constrói nova `URLSearchParams` preservando **todos os params existentes** (incluindo `status`), deleta param se valor `""` ou null, chama `router.replace(url, { scroll: false })`
- `handleReset()`: limpa apenas `fromStore` e `priority` — preserva `status` (controlado pelas abas): `router.replace(status ? \`/transferencias?status=${status}\` : "/transferencias", { scroll: false })`

### Filtros renderizados

```typescript
const filters: FilterConfig[] = [
  {
    type: "select",
    key: "fromStore",
    options: [
      { value: "", label: "Todas as lojas" },
      ...stores.map((s) => ({ value: s.id, label: `Loja ${s.code}` })),
    ],
  },
  {
    type: "select",
    key: "priority",
    options: [
      { value: "", label: "Todas as prioridades" },
      { value: "ANTICIPATED", label: "Antecipada" },
      { value: "ON_ROUTE", label: "Na rota" },
      { value: "URGENT", label: "Urgente" },
    ],
  },
];
```

### Valores iniciais

```typescript
const values = {
  fromStore: searchParams.get("fromStore") ?? "",
  priority: searchParams.get("priority") ?? "",
};
```

### handleReset

```typescript
function handleReset() {
  const status = searchParams.get("status");
  router.replace(
    status ? `/transferencias?status=${status}` : "/transferencias",
    { scroll: false }
  );
}
```

### Imports

```typescript
"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { FilterBar } from "@/components/ui";
import type { FilterConfig } from "@/components/ui";
```

---

## 3. Critérios de aceitação

1. Header exibe "Transferências" com `PageHeader`, urgentCount badge e botão "Nova transferência"
2. Status tabs permanecem com contagens e navegação URL funcionando
3. Filtro de loja (`fromStore`) e prioridade (`priority`) aparecem no `FilterBar`
4. Mudar filtro de loja/prioridade preserva o `status` na URL
5. "Limpar filtros" remove `fromStore` e `priority`, mantém `status`
6. Badges de status usam `StatusBadge` (sem classes manuais de cor)
7. Badges de prioridade mantêm aparência atual (ANTICIPATED/ON_ROUTE/URGENT)
8. Empty state usa `EmptyState` com ícone `ArrowLeftRight`
9. `TransferActionsPanel` funciona sem alterações
10. Zero erros TypeScript nos arquivos modificados
