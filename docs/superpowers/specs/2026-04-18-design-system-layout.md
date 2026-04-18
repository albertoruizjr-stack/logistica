# Design System + Layout Base — Design Spec
**Data:** 2026-04-18
**Status:** Aprovado

---

## Objetivo

Refatorar completamente o front-end do sistema em uma interface clara, moderna e organizada para uso operacional diário. Não é apenas um redesign visual — é a criação de um design system consistente que serve de fundação para todas as telas atuais e futuras.

Referência: ferramentas SaaS operacionais como Linear, Vercel Dashboard e Retool. Densidade inteligente: o usuário vê muita informação útil sem se sentir sobrecarregado.

**Escopo desta spec:** Design System (tokens) + Layout Base + 9 componentes reutilizáveis.
**Fora do escopo:** Refatoração de telas (spec separada, começa por Solicitações).

---

## Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS (CSS variables, sem dark mode)
- shadcn/ui como base de componentes primitivos
- Lucide React para ícones

---

## 1. Design System — Tokens

### 1.1 Cores

Todas as cores definidas como CSS variables em `globals.css`. Os valores Tailwind são os equivalentes mais próximos para uso inline.

#### Paleta principal

| Token CSS | Tailwind equivalente | Hex | Uso |
|---|---|---|---|
| `--color-primary` | `orange-500` | `#f97316` | Botões primários, links ativos |
| `--color-primary-dark` | `orange-600` | `#ea580c` | Hover de botão primário |
| `--color-primary-light` | `orange-50` | `#fff7ed` | Background de badge, highlight sutil |

#### Superfícies e estrutura

| Token CSS | Tailwind | Hex | Uso |
|---|---|---|---|
| `--color-surface` | `white` | `#ffffff` | Cards, modais, sidebar |
| `--color-background` | `slate-50` | `#f8fafc` | Fundo de página |
| `--color-border` | `slate-200` | `#e2e8f0` | Bordas de card, input, separadores |
| `--color-sidebar-bg` | `slate-900` | `#0f172a` | Fundo da sidebar |

#### Texto

| Token CSS | Tailwind | Hex | Uso |
|---|---|---|---|
| `--color-text-primary` | `slate-900` | `#0f172a` | Títulos, labels, dados principais |
| `--color-text-secondary` | `slate-600` | `#475569` | Subtítulos, metadados |
| `--color-text-muted` | `slate-400` | `#94a3b8` | Placeholders, info terciária |
| `--color-text-sidebar` | `slate-100` | `#f1f5f9` | Texto na sidebar |

#### Status (hierarquia de prioridade visual)

| Token | Tailwind | Hex | Prioridade | Uso |
|---|---|---|---|---|
| `--color-urgent` | `orange-700` | `#c2410c` | 1 — ação imediata | Entregas urgentes |
| `--color-danger` | `red-600` | `#dc2626` | 2 — erro/falha | Cancelado, falha de API |
| `--color-warning` | `amber-600` | `#d97706` | 3 — atenção | Pendente, aguardando |
| `--color-in-transit` | `cyan-600` | `#0891b2` | 4 — progresso | Em trânsito (neutro, não compete com links) |
| `--color-success` | `green-600` | `#16a34a` | — | Entregue, concluído |
| `--color-info` | `slate-500` | `#64748b` | — | Info geral, sem ação necessária |

Regra: nunca usar `--color-urgent` e `--color-danger` para o mesmo estado. Urgente = precisa de ação agora. Erro = algo falhou.

---

### 1.2 Tipografia

Fonte: **Inter** (já instalada). Sem dark mode — valores fixos.

| Nível | Classe Tailwind | Peso | Uso |
|---|---|---|---|
| `heading-page` | `text-lg font-semibold` (18px) | 600 | Título da página no PageHeader |
| `heading-section` | `text-xs font-semibold uppercase tracking-wider` (12px) | 600 | Cabeçalho de grupo na sidebar, separadores de seção |
| `body` | `text-sm` (14px) | 400 | Texto geral, conteúdo de card |
| `body-medium` | `text-sm font-medium` (14px) | 500 | Labels, nomes, valores importantes |
| `table-data` | `text-[13px]` | 400 | Dados em linhas de tabela |
| `caption` | `text-xs` (12px) | 400 | Timestamps, metadados, tooltips |

---

### 1.3 Espaçamento

Unidade base: 4px (padrão Tailwind). Tokens de uso:

| Contexto | Classe | Valor |
|---|---|---|
| Padding de página | `p-6` | 24px |
| Padding de card (padrão) | `p-4` | 16px |
| Padding de card (confortável) | `p-5` | 20px |
| Gap entre cards/seções | `gap-4` a `gap-6` | 16–24px |
| Altura de linha de tabela | `py-3 px-4` | 12px vertical, 16px horizontal |
| Stack interno de card | `space-y-3` | 12px |

### 1.4 Bordas e Sombras

| Elemento | Classe |
|---|---|
| Card | `rounded-lg border border-slate-200 shadow-sm` |
| Input / Select | `rounded-md border border-slate-300` |
| Badge | `rounded-full` |
| Botão | `rounded-md` |
| Modal | `rounded-xl shadow-lg` |

---

## 2. Layout Base

### 2.1 Estrutura geral

```
┌─────────────────────────────────────────────────────┐
│ SIDEBAR (240px fixa) │ HEADER (56px sticky)          │
│                      ├───────────────────────────────┤
│                      │ CONTENT AREA                  │
│                      │ padding: 24px                 │
│                      │ max-width: 1400px centrado    │
│                      │ background: slate-50          │
│                      │ height: calc(100vh - 56px)    │
│                      │ overflow-y: auto              │
└──────────────────────┴───────────────────────────────┘
```

- Sidebar e Header nunca fazem scroll.
- Apenas a área de conteúdo rola verticalmente.
- `max-width: 1400px` centrado — evita linhas longas em monitores ultrawide sem fragmentar o layout.

---

### 2.2 Sidebar

**Dimensões:** 240px largura fixa, 100vh altura, fundo `slate-900`.

**Estrutura:**

```
┌──────────────────────────┐
│  ■ Logística             │  ← logo + nome (16px, white, font-semibold)
│    Mestre da Pintura     │
├──────────────────────────┤
│  OPERAÇÃO                │  ← heading-section (12px, slate-400, uppercase)
│  ◉ Solicitações    [3]   │  ← item ativo + badge urgentes
│  ○ Despacho              │
│  ○ Dashboard             │
├──────────────────────────┤
│  LOGÍSTICA               │
│  ○ Transferências        │
│  ○ Rastreamento          │
│  ○ Cotação de Frete      │
├──────────────────────────┤
│  PERFORMANCE             │
│  ○ Auditoria             │
├──────────────────────────┤
│  [avatar] Alberto Ruiz   │  ← rodapé: info do usuário
│  Loja 067 — Morumbi      │
│  [Sair]                  │
└──────────────────────────┘
```

**Estados dos itens de menu:**

| Estado | Estilo |
|---|---|
| Default | `text-slate-300 hover:bg-slate-800 hover:text-white` |
| Ativo | `bg-orange-600/15 text-orange-400` + barra esquerda `w-0.5 bg-orange-500` |
| Grupo heading | `text-slate-400 text-xs uppercase tracking-wider px-3 mb-1` |

**Badge de urgência:** aparece no item "Solicitações" quando há entregas urgentes pendentes. Fundo `orange-600`, texto `white`, formato pill. Oculto quando count = 0.

---

### 2.3 Header

**Dimensões:** largura `calc(100vw - 240px)`, altura 56px, fundo `white`, `border-b border-slate-200`.

**Layout:**

```
┌──────────────────────────────────────────────────────────┐
│  [Título da página]    [Loja 067] [+ Nova Solicitação]   │
└──────────────────────────────────────────────────────────┘
```

- **Esquerda:** título da página atual (`text-lg font-semibold text-slate-900`) + breadcrumb opcional em `text-sm text-slate-500`
- **Direita (da esquerda para direita):**
  1. Badge da loja atual — `text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md`
  2. Botão "Nova Solicitação" — botão primário (laranja), só exibido quando a role permite
  3. Avatar do usuário com dropdown (perfil / sair)

---

### 2.4 Área de conteúdo — padrão de página

Toda tela segue esta estrutura vertical:

```tsx
<PageHeader title="..." description="..." actions={...} />
<AlertBanner />          {/* quando houver alerta ativo */}
<FilterBar filters={...} />
<Card>
  <DataTable ... />
</Card>
```

Para telas de detalhe (ex: transferência):

```tsx
<PageHeader title="..." actions={...} />
<AlertBanner />
<div className="grid grid-cols-3 gap-4">
  <div className="col-span-2">
    <Card><DataTable ... /></Card>
  </div>
  <div>
    <Card><KeyValueList items={...} /></Card>
  </div>
</div>
```

---

## 3. Componentes

### 3.1 `<PageHeader />`

```typescript
interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}
```

Layout: linha com `title` à esquerda, `actions` à direita. `description` abaixo do título em `text-sm text-slate-500`. Separado do conteúdo por `border-b border-slate-200 pb-4 mb-6`.

---

### 3.2 `<MetricCard />`

```typescript
interface MetricCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  variant?: "default" | "urgent" | "warning" | "success" | "danger"
  trend?: { value: number; label: string }  // ex: { value: -3, label: "vs ontem" }
}
```

Fundo `white`. Ícone no canto superior direito com cor do `variant`. Valor em `text-2xl font-bold`. Trend em `text-xs text-slate-500` com seta ↑↓ colorida. Border esquerda colorida por `variant` (4px).

---

### 3.3 `<Card />`

```typescript
interface CardProps {
  title?: string
  description?: string
  actions?: React.ReactNode
  padding?: "sm" | "md" | "lg"   // p-3, p-4, p-5
  children: React.ReactNode
}
```

Container base: `bg-white rounded-lg border border-slate-200 shadow-sm`. Header interno com `title` + `actions` separado por `border-b` quando presente.

---

### 3.4 `<DataTable />`

```typescript
interface Column<T> {
  key: keyof T | string
  header: string
  width?: string
  sortable?: boolean
  truncate?: boolean       // trunca com tooltip no overflow
  render?: (row: T) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  onRowClick?: (row: T) => void
  rowActions?: (row: T) => React.ReactNode   // coluna de ações no final
  sortKey?: string
  sortDirection?: "asc" | "desc"
  onSort?: (key: string, direction: "asc" | "desc") => void
  pagination?: {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
  }
  emptyState?: React.ReactNode
}
```

- Cabeçalho sticky dentro do `<Card>` que o envolve
- Hover de linha: `hover:bg-slate-50 cursor-pointer` quando `onRowClick` definido
- Coluna de ações: sempre última, `w-[60px]`, alinhada à direita
- Truncamento: células com `truncate` mostram tooltip nativo (`title`) no hover
- Ordenação: ícone `↕ ↑ ↓` no header clicável, estado controlado externamente
- Paginação: rodapé com `Anterior / Próxima` + `Página X de Y` + total de registros
- Loading: skeleton de 5 linhas (sem spinner central)

---

### 3.5 `<StatusBadge />`

```typescript
type StatusVariant =
  | "PENDING" | "AWAITING_ITEMS" | "AWAITING_TRANSFER"
  | "READY" | "DISPATCHED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED"
  | "URGENT" | "APPROVED" | "PREPARING" | "RECEIVED"

interface StatusBadgeProps {
  status: StatusVariant
  size?: "sm" | "md"
  showIcon?: boolean
}
```

Mapa completo de status → (label PT-BR, cor de fundo, cor de texto, ícone Lucide opcional):

| Status | Label | Cores | Ícone |
|---|---|---|---|
| URGENT | Urgente | orange-100 / orange-700 | `Zap` |
| PENDING | Pendente | amber-100 / amber-700 | `Clock` |
| AWAITING_ITEMS | Aguard. Itens | amber-100 / amber-700 | `Package` |
| AWAITING_TRANSFER | Aguard. Transferência | amber-100 / amber-700 | `ArrowLeftRight` |
| READY | Pronto | blue-100 / blue-700 | `CheckCircle` |
| DISPATCHED | Despachado | purple-100 / purple-700 | `Truck` |
| IN_TRANSIT | Em Trânsito | cyan-100 / cyan-700 | `Navigation` |
| DELIVERED | Entregue | green-100 / green-700 | `CheckCircle2` |
| CANCELLED | Cancelado | red-100 / red-700 | `XCircle` |
| APPROVED | Aprovada | blue-100 / blue-700 | `ThumbsUp` |
| PREPARING | Em Preparação | purple-100 / purple-700 | `Package2` |
| RECEIVED | Recebida | green-100 / green-700 | `PackageCheck` |

`showIcon` padrão `false`. `size="sm"` usa `text-xs px-2 py-0.5`, `size="md"` usa `text-xs px-2.5 py-1`.

---

### 3.6 `<FilterBar />`

```typescript
interface FilterConfig {
  type: "search" | "select" | "daterange"
  key: string
  placeholder?: string
  options?: { label: string; value: string }[]
}

interface FilterBarProps {
  filters: FilterConfig[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  onReset?: () => void
}
```

Layout horizontal, altura 48px, fundo `slate-50`, `border-b border-slate-200`. Filtros dispostos da esquerda para direita. Botão "Limpar filtros" à direita, visível apenas quando algum filtro está ativo.

---

### 3.7 `<EmptyState />`

```typescript
interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}
```

Centralizado vertical e horizontalmente dentro do container pai. Ícone 40px em `slate-300`. Título `text-sm font-medium text-slate-600`. Description `text-sm text-slate-400`. Botão de ação primário quando fornecido.

---

### 3.8 `<KeyValueList />` (também chamado `<InfoRow />`)

```typescript
interface KeyValueItem {
  label: string
  value: React.ReactNode
  fullWidth?: boolean   // ocupa coluna inteira em grids de 2 colunas
}

interface KeyValueListProps {
  items: KeyValueItem[]
  columns?: 1 | 2       // padrão: 2
}
```

Grid de 1 ou 2 colunas. `label` em `text-xs text-slate-500 uppercase tracking-wide`. `value` em `text-sm font-medium text-slate-900`. Separação por `divide-y divide-slate-100`. Usado em telas de detalhe e cards operacionais laterais.

---

### 3.9 `<AlertBanner />`

```typescript
interface AlertBannerProps {
  variant: "info" | "warning" | "danger" | "urgent"
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void   // undefined = não dispensável
}
```

Faixa horizontal abaixo do `PageHeader`, acima do conteúdo principal. Largura total, `rounded-lg`, `border`. Ícone à esquerda, texto central, ação + fechar à direita.

| Variant | Cores | Ícone |
|---|---|---|
| `info` | slate-50 / slate-700 / slate-200 | `Info` |
| `warning` | amber-50 / amber-800 / amber-200 | `AlertTriangle` |
| `danger` | red-50 / red-800 / red-200 | `AlertCircle` |
| `urgent` | orange-50 / orange-800 / orange-200 | `Zap` |

Exemplos de uso: fallback Haversine ativo, auditoria bloqueando despacho, erro de integração ERP, entregas urgentes sem motorista.

---

## 4. Arquivos a criar/modificar

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `app/globals.css` | Modificar | CSS variables dos tokens de cor |
| `tailwind.config.ts` | Modificar | Remover dark mode, adicionar tokens customizados |
| `app/(app)/layout.tsx` | Modificar | Sidebar + Header + estrutura base |
| `components/sidebar.tsx` | Modificar | Sidebar com grupos, badge urgência, rodapé de usuário |
| `components/header.tsx` | Criar | Header com título, loja, botão Nova Solicitação |
| `components/ui/page-header.tsx` | Criar | Componente PageHeader |
| `components/ui/metric-card.tsx` | Criar | Componente MetricCard |
| `components/ui/card.tsx` | Modificar | Wrapper sobre shadcn Card com variantes do sistema |
| `components/ui/data-table.tsx` | Criar | DataTable com paginação, sort, truncate, row click |
| `components/ui/status-badge.tsx` | Criar | StatusBadge com mapa completo de estados |
| `components/ui/filter-bar.tsx` | Criar | FilterBar horizontal |
| `components/ui/empty-state.tsx` | Criar | EmptyState |
| `components/ui/key-value-list.tsx` | Criar | KeyValueList / InfoRow |
| `components/ui/alert-banner.tsx` | Criar | AlertBanner com 4 variantes |

---

## 5. O que não está no escopo desta spec

- Refatoração de telas individuais (spec separada)
- Tela de Solicitações refatorada (próxima spec)
- Dashboard, Transferências, Despacho, Auditoria (specs subsequentes)
- Animações e transições (pode ser adicionado depois)
- Componentes de formulário além do que shadcn/ui já fornece
