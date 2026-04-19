# Spec: Refatoração Tela Solicitações (Fase 2)

## Objetivo

Refatorar `app/(app)/solicitacoes/page.tsx` para usar os componentes do design system criados na Fase 1 (`PageHeader`, `FilterBar`, `DataTable`, `StatusBadge`, `EmptyState`), eliminando toda a marcação manual de tabela, badges e filtros inline.

---

## Arquitetura de Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `app/(app)/solicitacoes/page.tsx` | Modificar | Server component — fetch de dados, mapeamento para `SolicitacaoRow[]`, layout |
| `app/(app)/solicitacoes/_components/solicitacoes-filters.tsx` | Criar | Client component — lê `useSearchParams`, atualiza URL via `router.replace` |
| `app/(app)/solicitacoes/_components/solicitacoes-table.tsx` | Criar | Client component — define colunas, renderiza `DataTable` |

---

## 1. page.tsx (server component)

### O que muda

- Remove: tabela `<table>` manual, chips de status `<Link>`, empty state inline
- Adiciona: `PageHeader`, container card-like, `SolicitacoesFilters`, `SolicitacoesTable`

### Fetch de dados

Mantém a query Prisma atual sem alterações:

```typescript
const requests = await prisma.deliveryRequest.findMany({
  where: {
    ...(searchParams.status ? { status: searchParams.status as never } : {}),
    ...(storeFilter ? { storeId: storeFilter } : {}),
  },
  include: {
    store: { select: { code: true, name: true } },
    seller: { select: { name: true } },
    freightQuote: { select: { distanceKm: true, suggestedPrice: true } },
    transfers: { select: { id: true, status: true, priority: true } },
    dispatch: { select: { modal: true, status: true } },
    _count: { select: { items: true } },
  },
  orderBy: { createdAt: "desc" },
  take: 100,
});
```

Mantém query de lojas para ADMIN/OPERATOR (sem alteração).

### Mapeamento → SolicitacaoRow

Antes de passar para o componente client, mapeia os dados Prisma para `SolicitacaoRow[]` (tipo serializable — sem `Date`, sem objetos complexos):

```typescript
const rows: SolicitacaoRow[] = requests.map((req) => ({
  id: req.id,
  invoiceNumber: req.invoiceNumber,
  isUrgent: req.deliveryType === "URGENT",
  itemCount: req._count.items,
  storeCode: req.store.code,
  customerName: req.customerName,
  sellerName: req.seller.name,
  status: req.status,
  hasActiveTransfer: req.transfers.some(
    (t) => t.status !== "RECEIVED" && t.status !== "CANCELLED"
  ),
  chargedFreight: req.chargedFreight ?? null,
  suggestedPrice: req.freightQuote?.suggestedPrice ?? null,
  createdAt: req.createdAt.toISOString(),
}));
```

### Layout

```tsx
<div className="space-y-6">
  <PageHeader
    title="Solicitações de Entrega"
    description={`${requests.length} resultado${requests.length !== 1 ? "s" : ""}`}
    actions={
      session.role !== "SELLER" ? (
        <Link
          href="/solicitacoes/nova"
          className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition"
        >
          <Plus className="w-4 h-4" />
          Nova solicitação
        </Link>
      ) : undefined
    }
  />

  <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
    <Suspense fallback={<div className="h-12 bg-slate-50 border-b border-slate-200 animate-pulse" />}>
      <SolicitacoesFilters role={session.role} stores={stores} />
    </Suspense>
    <SolicitacoesTable data={rows} />
  </div>
</div>
```

---

## 2. SolicitacoesFilters (client component)

**Arquivo:** `app/(app)/solicitacoes/_components/solicitacoes-filters.tsx`

### Props

```typescript
interface SolicitacoesFiltersProps {
  role: string;
  stores: { id: string; code: string }[];
}
```

### Comportamento

- `useSearchParams()` lê os valores atuais de `status` e `storeId` da URL
- `useRouter()` para `router.replace()`
- Ao mudar qualquer filtro via `onChange`, constrói nova URL com `URLSearchParams` e chama `router.replace(newUrl, { scroll: false })`
- `onReset` limpa ambos os parâmetros (`router.replace("/solicitacoes", { scroll: false })`)

### Filtros renderizados

```typescript
const filters: FilterConfig[] = [
  {
    type: "select",
    key: "status",
    options: [
      { value: "", label: "Todos os status" },
      { value: "PENDING", label: "Pendente" },
      { value: "AWAITING_TRANSFER", label: "Aguard. Transferência" },
      { value: "READY", label: "Pronto para Despacho" },
      { value: "DISPATCHED", label: "Despachado" },
      { value: "IN_TRANSIT", label: "Em trânsito" },
      { value: "DELIVERED", label: "Entregue" },
    ],
  },
  // Apenas para ADMIN e OPERATOR:
  ...(role !== "SELLER"
    ? [
        {
          type: "select" as const,
          key: "storeId",
          options: [
            { value: "", label: "Todas as lojas" },
            ...stores.map((s) => ({ value: s.id, label: `Loja ${s.code}` })),
          ],
        },
      ]
    : []),
];
```

### Valores iniciais

```typescript
const values = {
  status: searchParams.get("status") ?? "",
  storeId: searchParams.get("storeId") ?? "",
};
```

---

## 3. SolicitacoesTable (client component)

**Arquivo:** `app/(app)/solicitacoes/_components/solicitacoes-table.tsx`

### Tipo local

```typescript
export interface SolicitacaoRow {
  id: string;
  invoiceNumber: string;
  isUrgent: boolean;
  itemCount: number;
  storeCode: string;
  customerName: string;
  sellerName: string;
  status: string;
  hasActiveTransfer: boolean;
  chargedFreight: number | null;
  suggestedPrice: number | null;
  createdAt: string; // ISO string
}
```

### Props

```typescript
interface SolicitacoesTableProps {
  data: SolicitacaoRow[];
}
```

### Colunas

```typescript
const columns: Column<SolicitacaoRow>[] = [
  {
    key: "invoiceNumber",
    header: "NF",
    width: "160px",
    render: (row) => (
      <div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-slate-900">{row.invoiceNumber}</span>
          {row.isUrgent && <Zap className="w-3 h-3 text-red-500" />}
        </div>
        <span className="text-xs text-slate-400">
          {row.itemCount} iten{row.itemCount !== 1 ? "s" : ""}
        </span>
      </div>
    ),
  },
  {
    key: "storeCode",
    header: "Loja",
    width: "80px",
    render: (row) => (
      <span className="text-xs font-medium text-slate-600">{row.storeCode}</span>
    ),
  },
  {
    key: "customerName",
    header: "Cliente",
    truncate: true,
    render: (row) => (
      <div>
        <p className="text-sm text-slate-900 truncate max-w-[180px]">{row.customerName}</p>
        <p className="text-xs text-slate-400 truncate max-w-[180px]">{row.sellerName}</p>
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    width: "160px",
    render: (row) => (
      <div className="flex flex-col gap-1">
        <StatusBadge status={row.status as StatusVariant} showIcon />
        {row.hasActiveTransfer && (
          <span className="text-xs text-orange-600 flex items-center gap-0.5">
            <ArrowLeftRight className="w-2.5 h-2.5" />
            Transferência
          </span>
        )}
      </div>
    ),
  },
  {
    key: "chargedFreight",
    header: "Frete",
    width: "120px",
    render: (row) => {
      if (row.chargedFreight == null) return <span className="text-slate-400">—</span>;
      const diff =
        row.suggestedPrice != null ? row.chargedFreight - row.suggestedPrice : null;
      return (
        <div>
          <p className="text-sm font-medium text-slate-900">
            {formatCurrency(row.chargedFreight)}
          </p>
          {row.suggestedPrice != null && (
            <p
              className={cn(
                "text-xs",
                diff === 0
                  ? "text-slate-400"
                  : diff! > 0
                  ? "text-green-600"
                  : "text-red-500"
              )}
            >
              Sug: {formatCurrency(row.suggestedPrice)}
            </p>
          )}
        </div>
      );
    },
  },
  {
    key: "createdAt",
    header: "Criado",
    width: "100px",
    render: (row) => (
      <span className="text-xs text-slate-400">{formatRelativeTime(row.createdAt)}</span>
    ),
  },
];
```

### Mapeamento de status → StatusVariant

Os valores de `status` do banco (`PENDING`, `AWAITING_TRANSFER`, etc.) são idênticos ao tipo `StatusVariant` do componente — cast direto é suficiente:

```typescript
// Nenhuma função de mapeamento necessária — os valores já coincidem
<StatusBadge status={row.status as StatusVariant} showIcon />
```

### rowActions

```typescript
rowActions={(row) => (
  <Link
    href={`/solicitacoes/${row.id}`}
    className="text-xs text-orange-600 hover:underline font-medium whitespace-nowrap"
    onClick={(e) => e.stopPropagation()}
  >
    Ver →
  </Link>
)}
```

### onRowClick

```typescript
onRowClick={(row) => router.push(`/solicitacoes/${row.id}`)}
```

### emptyState

```tsx
<EmptyState
  icon={FileText}
  title="Nenhuma solicitação encontrada"
  description="Tente ajustar os filtros ou criar uma nova solicitação."
/>
```

---

## 4. Dependências e imports

### page.tsx

```typescript
import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import SolicitacoesFilters from "./_components/solicitacoes-filters";
import SolicitacoesTable from "./_components/solicitacoes-table";
import type { SolicitacaoRow } from "./_components/solicitacoes-table";
import { Plus } from "lucide-react";
import Link from "next/link";
```

### solicitacoes-filters.tsx

```typescript
import { useSearchParams, useRouter } from "next/navigation";
import { FilterBar } from "@/components/ui";
import type { FilterConfig } from "@/components/ui";
```

### solicitacoes-table.tsx

```typescript
import { useRouter } from "next/navigation";
import { DataTable, StatusBadge, EmptyState } from "@/components/ui";
import type { Column } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { Zap, ArrowLeftRight, FileText } from "lucide-react";
import Link from "next/link";
```

---

## 5. O que NÃO muda

- Lógica de autenticação e redirect (`getSession`, `redirect("/login")`)
- Query Prisma e filtro por role (SELLER só vê sua loja)
- Lógica de storeFilter (server-side)
- Rota `/solicitacoes/nova` e `/solicitacoes/[id]` (não são escopo desta Fase 2)
- `take: 100` — sem paginação nesta fase

---

## 6. Critérios de aceitação

1. Tela renderiza sem erros de TypeScript
2. Filtro de status atualiza a URL e re-renderiza os dados do servidor
3. Filtro de loja aparece apenas para ADMIN e OPERATOR
4. "Limpar filtros" remove ambos os params da URL
5. Linha clicável navega para `/solicitacoes/{id}`
6. Empty state aparece quando nenhum registro é retornado
7. Indicador "Transferência" aparece quando há transferência ativa
8. Comparação de frete (cobrado vs sugerido) mantém cores verdes/vermelhas
