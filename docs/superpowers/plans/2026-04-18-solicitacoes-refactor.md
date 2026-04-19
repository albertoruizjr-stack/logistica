# Solicitações Screen Refactor (Fase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `app/(app)/solicitacoes/page.tsx` to use the Fase 1 design system components, replacing manual table HTML, inline status badges, and filter chips with `DataTable`, `StatusBadge`, `FilterBar`, `PageHeader`, and `EmptyState`.

**Architecture:** Hybrid server/client — `page.tsx` remains a server component that reads `searchParams` and fetches data; two new client components handle URL-synced filtering (`SolicitacoesFilters` via `useSearchParams` + `router.replace`) and table rendering with column definitions (`SolicitacoesTable`). The `DataTable` columns use `render` functions which can't be serialized from server to client, hence the wrapper component.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma, Tailwind CSS, shadcn/ui design system (Fase 1 components at `components/ui/`).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `app/(app)/solicitacoes/_components/solicitacoes-table.tsx` | Create | Client component — exports `SolicitacaoRow` type, defines columns, renders DataTable |
| `app/(app)/solicitacoes/_components/solicitacoes-filters.tsx` | Create | Client component — reads useSearchParams, calls router.replace, renders FilterBar |
| `app/(app)/solicitacoes/page.tsx` | Modify | Replace manual HTML with PageHeader + new client components; map Prisma → SolicitacaoRow[] |

---

## Task 1: Create `SolicitacoesTable` client component

**Files:**
- Create: `app/(app)/solicitacoes/_components/solicitacoes-table.tsx`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p "app/(app)/solicitacoes/_components"
```

- [ ] **Step 2: Write the full component**

Create `app/(app)/solicitacoes/_components/solicitacoes-table.tsx` with this exact content:

```tsx
"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { DataTable, StatusBadge, EmptyState } from "@/components/ui";
import type { Column } from "@/components/ui";
import type { StatusVariant } from "@/components/ui";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { Zap, ArrowLeftRight, FileText } from "lucide-react";

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
  createdAt: string; // ISO string — serializable from server component
}

interface SolicitacoesTableProps {
  data: SolicitacaoRow[];
}

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
      if (row.chargedFreight == null)
        return <span className="text-slate-400">—</span>;
      const diff =
        row.suggestedPrice != null
          ? row.chargedFreight - row.suggestedPrice
          : null;
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
      <span className="text-xs text-slate-400">
        {formatRelativeTime(row.createdAt)}
      </span>
    ),
  },
];

export default function SolicitacoesTable({ data }: SolicitacoesTableProps) {
  const router = useRouter();

  return (
    <DataTable
      columns={columns}
      data={data}
      onRowClick={(row) => router.push(`/solicitacoes/${row.id}`)}
      rowActions={(row) => (
        <Link
          href={`/solicitacoes/${row.id}`}
          className="text-xs text-orange-600 hover:underline font-medium whitespace-nowrap"
          onClick={(e) => e.stopPropagation()}
        >
          Ver →
        </Link>
      )}
      emptyState={
        <EmptyState
          icon={FileText}
          title="Nenhuma solicitação encontrada"
          description="Tente ajustar os filtros ou criar uma nova solicitação."
        />
      }
    />
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "solicitacoes-table|error TS" | head -20
```

Expected: no lines starting with `error TS` related to `solicitacoes-table`.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/solicitacoes/_components/solicitacoes-table.tsx"
git commit -m "feat: SolicitacoesTable client component com DataTable e StatusBadge"
```

---

## Task 2: Create `SolicitacoesFilters` client component

**Files:**
- Create: `app/(app)/solicitacoes/_components/solicitacoes-filters.tsx`

- [ ] **Step 1: Write the full component**

Create `app/(app)/solicitacoes/_components/solicitacoes-filters.tsx` with this exact content:

```tsx
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { FilterBar } from "@/components/ui";
import type { FilterConfig } from "@/components/ui";

interface SolicitacoesFiltersProps {
  role: string;
  stores: { id: string; code: string }[];
}

export default function SolicitacoesFilters({
  role,
  stores,
}: SolicitacoesFiltersProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const values = {
    status: searchParams.get("status") ?? "",
    storeId: searchParams.get("storeId") ?? "",
  };

  function handleChange(key: string, value: unknown) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "" || value == null) {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
    const query = params.toString();
    router.replace(
      query ? `/solicitacoes?${query}` : "/solicitacoes",
      { scroll: false }
    );
  }

  function handleReset() {
    router.replace("/solicitacoes", { scroll: false });
  }

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

  return (
    <FilterBar
      filters={filters}
      values={values}
      onChange={handleChange}
      onReset={handleReset}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "solicitacoes-filters|error TS" | head -20
```

Expected: no lines starting with `error TS` related to `solicitacoes-filters`.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/solicitacoes/_components/solicitacoes-filters.tsx"
git commit -m "feat: SolicitacoesFilters client component com URL sync via useSearchParams"
```

---

## Task 3: Refactor `page.tsx`

**Files:**
- Modify: `app/(app)/solicitacoes/page.tsx`

- [ ] **Step 1: Read the current file**

Read `app/(app)/solicitacoes/page.tsx` to confirm it matches the expected 191-line server component with manual `<table>`, `<Link>` filter chips, and inline status badges.

- [ ] **Step 2: Replace the entire file**

Write `app/(app)/solicitacoes/page.tsx` with this exact content:

```tsx
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import SolicitacoesFilters from "./_components/solicitacoes-filters";
import SolicitacoesTable from "./_components/solicitacoes-table";
import type { SolicitacaoRow } from "./_components/solicitacoes-table";
import { Plus } from "lucide-react";

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: { status?: string; storeId?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const storeFilter =
    session.role === "SELLER"
      ? session.storeId
      : searchParams.storeId ?? undefined;

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

  const stores =
    session.role !== "SELLER"
      ? await prisma.store.findMany({
          where: { active: true },
          select: { id: true, code: true },
          orderBy: { code: "asc" },
        })
      : [];

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

  return (
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
        <Suspense
          fallback={
            <div className="h-12 bg-slate-50 border-b border-slate-200 animate-pulse" />
          }
        >
          <SolicitacoesFilters role={session.role} stores={stores} />
        </Suspense>
        <SolicitacoesTable data={rows} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript across the whole project**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: zero output (no type errors). If errors appear, read the error messages and fix them before proceeding.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/solicitacoes/page.tsx"
git commit -m "refactor: tela Solicitações usa design system (DataTable, FilterBar, PageHeader)"
```

---

## Task 4: Final verification

**Files:** no changes

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit
```

Expected: exits with code 0, no output.

- [ ] **Step 2: Run existing tests to confirm no regressions**

```bash
npm test
```

Expected: all existing tests pass (tests/smoke.test.ts, tests/lib/*, tests/services/* — none related to solicitacoes UI).

- [ ] **Step 3: Verify the 6 acceptance criteria via build**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes without errors. The Next.js build validates:
1. TypeScript types are correct
2. No missing imports
3. Server/client component boundaries respected (no passing non-serializable props)

- [ ] **Step 4: Final commit if build passes with no issues**

If the build passes cleanly, no additional commit needed (Task 3 commit already covers the change).

If the build surfaces any additional type errors not caught by `tsc --noEmit`, fix them and commit:

```bash
git add -p
git commit -m "fix: corrige erros de tipo na refatoração Solicitações"
```
