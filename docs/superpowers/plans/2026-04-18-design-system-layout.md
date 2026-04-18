# Design System + Layout Base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o design system (tokens CSS), refatorar o layout base (sidebar + header) e implementar os 10 componentes reutilizáveis especificados.

**Architecture:** CSS variables para tokens em `globals.css`; Tailwind CSS sem dark mode; componentes puros em `components/ui/`; sidebar e header como client components em `components/`; `app/(app)/layout.tsx` como server component que busca dados e distribui props.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS v3, shadcn/ui primitives (Radix), Lucide React, `cn` utility de `@/lib/utils`

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `app/globals.css` | Modificar — adicionar tokens, remover bloco `.dark` |
| `tailwind.config.ts` | Modificar — `darkMode: false` |
| `components/sidebar.tsx` | Modificar — grupos, props novas, collapsed stub |
| `app/(app)/layout.tsx` | Modificar — Header + urgentCount + storeCode |
| `components/header.tsx` | Criar — header global client component |
| `components/ui/card.tsx` | Criar |
| `components/ui/page-header.tsx` | Criar |
| `components/ui/metric-card.tsx` | Criar |
| `components/ui/status-badge.tsx` | Criar |
| `components/ui/data-table.tsx` | Criar |
| `components/ui/filter-bar.tsx` | Criar |
| `components/ui/empty-state.tsx` | Criar |
| `components/ui/error-state.tsx` | Criar |
| `components/ui/key-value-list.tsx` | Criar |
| `components/ui/alert-banner.tsx` | Criar |
| `components/ui/index.ts` | Criar — barrel export |

> **Nota sobre testes:** Estes são componentes React puros sem lógica de negócio. O projeto não tem `@testing-library/react` instalado. A verificação é feita por TypeScript (`npx tsc --noEmit`) após cada tarefa, e por inspeção visual no servidor de desenvolvimento após a Task 3.

---

## Task 1: Design Tokens

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Atualizar `app/globals.css`**

Substituir o conteúdo completo do arquivo por:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* ── shadcn/ui primitives (necessários para componentes Radix) ── */
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 24 95% 53%;
    --primary-foreground: 0 0% 100%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 24 95% 53%;
    --radius: 0.5rem;

    /* ── Design System tokens ── */
    --color-primary:       #f97316;
    --color-primary-dark:  #ea580c;
    --color-primary-light: #fff7ed;
    --color-surface:       #ffffff;
    --color-background:    #f8fafc;
    --color-border:        #e2e8f0;
    --color-sidebar-bg:    #0f172a;
    --color-urgent:        #c2410c;
    --color-danger:        #dc2626;
    --color-warning:       #d97706;
    --color-in-transit:    #0891b2;
    --color-success:       #16a34a;
    --color-muted-text:    #64748b;
    --color-body-text:     #1e293b;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    background-color: var(--color-background);
  }
}
```

- [ ] **Step 2: Atualizar `tailwind.config.ts`**

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: false,
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add app/globals.css tailwind.config.ts
git commit -m "feat: design system tokens e remoção de dark mode"
```

---

## Task 2: Sidebar Refactor

**Files:**
- Modify: `components/sidebar.tsx`

- [ ] **Step 1: Reescrever `components/sidebar.tsx`**

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Calculator,
  FileText,
  ArrowLeftRight,
  Truck,
  MapPin,
  BarChart3,
  Package,
  LogOut,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
  showUrgentBadge?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "OPERAÇÃO",
    items: [
      {
        href: "/solicitacoes",
        label: "Solicitações",
        icon: FileText,
        roles: ["ADMIN", "OPERATOR", "SELLER"],
        showUrgentBadge: true,
      },
      { href: "/despacho", label: "Despacho", icon: Truck, roles: ["ADMIN", "OPERATOR"] },
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OPERATOR", "SELLER", "DRIVER"],
      },
    ],
  },
  {
    label: "LOGÍSTICA",
    items: [
      { href: "/transferencias", label: "Transferências", icon: ArrowLeftRight, roles: ["ADMIN", "OPERATOR"] },
      { href: "/rastreamento", label: "Rastreamento", icon: MapPin, roles: ["ADMIN", "OPERATOR"] },
      { href: "/cotacao", label: "Cotação de Frete", icon: Calculator, roles: ["ADMIN", "OPERATOR", "SELLER"] },
    ],
  },
  {
    label: "PERFORMANCE",
    items: [
      { href: "/auditoria", label: "Auditoria", icon: BarChart3, roles: ["ADMIN", "OPERATOR"] },
    ],
  },
];

interface SidebarProps {
  userRole: string;
  userName: string;
  storeName: string;
  storeCode?: string;
  urgentCount?: number;
  collapsed?: boolean;
}

export function Sidebar({
  userRole,
  userName,
  storeName,
  storeCode = "",
  urgentCount = 0,
  collapsed = false,
}: SidebarProps) {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside
      className={cn(
        "bg-slate-900 text-white flex flex-col h-screen flex-shrink-0 transition-all duration-200",
        collapsed ? "w-14" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Package className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white leading-tight">Logística</p>
              <p className="text-xs text-slate-400 leading-tight">Mestre da Pintura</p>
            </div>
          )}
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-4">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) =>
            item.roles.includes(userRole)
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              {!collapsed && (
                <p className="text-slate-400 text-xs uppercase tracking-wider px-3 mb-1">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  const showBadge = item.showUrgentBadge && urgentCount > 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors relative",
                        isActive
                          ? "bg-orange-600/15 text-orange-400"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-orange-500 rounded-r" />
                      )}
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1">{item.label}</span>
                          {showBadge && (
                            <span className="bg-orange-600 text-white text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                              {urgentCount}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="px-2 py-3 border-t border-slate-800 space-y-0.5">
        {!collapsed && (
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-white truncate">{userName}</p>
            <p className="text-xs text-slate-400 truncate">
              {storeCode ? `${storeCode} — ` : ""}{storeName}
            </p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Expected: sem erros (storeCode e urgentCount são opcionais com defaults)

- [ ] **Step 3: Commit**

```bash
git add components/sidebar.tsx
git commit -m "feat: sidebar refatorada com grupos, badge urgência e stub collapsed"
```

---

## Task 3: Layout Base + Header

**Files:**
- Modify: `app/(app)/layout.tsx`
- Create: `components/header.tsx`

- [ ] **Step 1: Criar `components/header.tsx`**

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, ChevronDown } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  "/solicitacoes": "Solicitações",
  "/despacho":     "Painel de Despacho",
  "/dashboard":    "Dashboard",
  "/transferencias": "Transferências",
  "/rastreamento": "Rastreamento",
  "/cotacao":      "Cotação de Frete",
  "/auditoria":    "Auditoria & KPIs",
};

const CAN_CREATE_DELIVERY = ["ADMIN", "OPERATOR", "SELLER"];

interface HeaderProps {
  userRole: string;
  userName: string;
  storeName: string;
  storeCode: string;
}

export function Header({ userRole, userName, storeName, storeCode }: HeaderProps) {
  const pathname = usePathname();
  const baseRoute = "/" + (pathname.split("/")[1] ?? "");
  const title = PAGE_TITLES[baseRoute] ?? "Logística";

  return (
    <header className="h-14 flex items-center justify-between px-6 bg-white border-b border-slate-200 flex-shrink-0">
      <span className="text-lg font-semibold text-slate-900">{title}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md font-medium">
          {storeCode} — {storeName}
        </span>
        {CAN_CREATE_DELIVERY.includes(userRole) && (
          <Link
            href="/solicitacoes/nova"
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nova Solicitação
          </Link>
        )}
        <button className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors">
          <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
            {userName.charAt(0).toUpperCase()}
          </div>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Reescrever `app/(app)/layout.tsx`**

```typescript
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [store, urgentCount] = await Promise.all([
    prisma.store.findUnique({
      where: { id: session.storeId },
      select: { name: true, code: true },
    }),
    prisma.deliveryRequest.count({
      where: {
        status: { notIn: ["DELIVERED", "CANCELLED"] },
        deliveryType: "URGENT",
        ...(session.role === "SELLER" ? { storeId: session.storeId } : {}),
      },
    }),
  ]);

  const storeName = store?.name ?? "Loja";
  const storeCode = store?.code ?? "";

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar
        userRole={session.role}
        userName={session.name}
        storeName={storeName}
        storeCode={storeCode}
        urgentCount={urgentCount}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <Header
          userRole={session.role}
          userName={session.name}
          storeName={storeName}
          storeCode={storeCode}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Expected: sem erros

- [ ] **Step 4: Iniciar servidor dev e verificar visualmente**

```bash
npm run dev
```

Abrir `http://localhost:3000`. Confirmar:
- Sidebar slate-900 com grupos OPERAÇÃO / LOGÍSTICA / PERFORMANCE
- Header branco 56px com título da página, badge da loja, botão "Nova Solicitação"
- Conteúdo centralizado em max-width 1400px
- Fundo de página slate-50

- [ ] **Step 5: Commit**

```bash
git add app/(app)/layout.tsx components/header.tsx
git commit -m "feat: layout base com header global e sidebar atualizada"
```

---

## Task 4: Card Component

**Files:**
- Create: `components/ui/card.tsx`

- [ ] **Step 1: Criar `components/ui/card.tsx`**

```typescript
import { cn } from "@/lib/utils";

interface CardProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  padding?: "sm" | "md" | "lg";
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}

const paddingMap: Record<string, string> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

export function Card({
  title,
  description,
  actions,
  padding = "md",
  loading = false,
  children,
  className,
}: CardProps) {
  return (
    <div className={cn("bg-white rounded-lg border border-slate-200 shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-200">
          <div>
            {title && <p className="text-sm font-semibold text-slate-900">{title}</p>}
            {description && (
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 ml-4">{actions}</div>
          )}
        </div>
      )}
      <div className={paddingMap[padding]}>
        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-slate-100 rounded w-full" />
            <div className="h-4 bg-slate-100 rounded w-3/4" />
            <div className="h-4 bg-slate-100 rounded w-1/2" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/card.tsx
git commit -m "feat: componente Card com loading state"
```

---

## Task 5: PageHeader Component

**Files:**
- Create: `components/ui/page-header.tsx`

- [ ] **Step 1: Criar `components/ui/page-header.tsx`**

```typescript
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  loading?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  loading = false,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between pb-4 mb-6 border-b border-slate-200">
      <div>
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-5 bg-slate-100 rounded w-48" />
            <div className="h-3 bg-slate-100 rounded w-64" />
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {description && (
              <p className="text-sm text-slate-500 mt-0.5">{description}</p>
            )}
          </>
        )}
      </div>
      {!loading && actions && (
        <div className="flex items-center gap-2 ml-6">{actions}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/page-header.tsx
git commit -m "feat: componente PageHeader com loading state"
```

---

## Task 6: MetricCard Component

**Files:**
- Create: `components/ui/metric-card.tsx`

- [ ] **Step 1: Criar `components/ui/metric-card.tsx`**

```typescript
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant?: "default" | "urgent" | "warning" | "success" | "danger";
  trend?: { value: number; label: string };
}

const variantConfig = {
  default: { border: "border-l-slate-300",  iconColor: "text-slate-400"  },
  urgent:  { border: "border-l-orange-600", iconColor: "text-orange-600" },
  warning: { border: "border-l-amber-500",  iconColor: "text-amber-500"  },
  success: { border: "border-l-green-500",  iconColor: "text-green-500"  },
  danger:  { border: "border-l-red-500",    iconColor: "text-red-500"    },
} as const;

export function MetricCard({
  label,
  value,
  icon: Icon,
  variant = "default",
  trend,
}: MetricCardProps) {
  const { border, iconColor } = variantConfig[variant];

  return (
    <div
      className={cn(
        "bg-white rounded-lg border border-slate-200 shadow-sm border-l-4 p-4",
        border
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          {label}
        </p>
        <Icon className={cn("w-4 h-4 flex-shrink-0", iconColor)} />
      </div>
      <p className="text-2xl font-bold text-slate-900 mt-2">{value}</p>
      {trend && (
        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
          {trend.value > 0 ? (
            <TrendingUp className="w-3 h-3 text-green-500" />
          ) : (
            <TrendingDown className="w-3 h-3 text-red-500" />
          )}
          {Math.abs(trend.value)} {trend.label}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/metric-card.tsx
git commit -m "feat: componente MetricCard com variantes e trend"
```

---

## Task 7: StatusBadge Component

**Files:**
- Create: `components/ui/status-badge.tsx`

- [ ] **Step 1: Criar `components/ui/status-badge.tsx`**

```typescript
import { cn } from "@/lib/utils";
import {
  Zap, Clock, Package, ArrowLeftRight, CheckCircle, Truck,
  Navigation, CheckCircle2, XCircle, ThumbsUp, Package2, PackageCheck,
  type LucideIcon,
} from "lucide-react";

export type StatusVariant =
  | "PENDING" | "AWAITING_ITEMS" | "AWAITING_TRANSFER"
  | "READY" | "DISPATCHED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED"
  | "URGENT" | "APPROVED" | "PREPARING" | "RECEIVED";

interface StatusBadgeProps {
  status: StatusVariant;
  size?: "sm" | "md";
  showIcon?: boolean;
  icon?: LucideIcon;
}

const STATUS_MAP: Record<
  StatusVariant,
  { label: string; bg: string; text: string; icon: LucideIcon }
> = {
  URGENT:            { label: "Urgente",               bg: "bg-orange-100", text: "text-orange-700", icon: Zap },
  PENDING:           { label: "Pendente",              bg: "bg-amber-100",  text: "text-amber-700",  icon: Clock },
  AWAITING_ITEMS:    { label: "Aguard. Itens",         bg: "bg-amber-100",  text: "text-amber-700",  icon: Package },
  AWAITING_TRANSFER: { label: "Aguard. Transferência", bg: "bg-amber-100",  text: "text-amber-700",  icon: ArrowLeftRight },
  READY:             { label: "Pronto",                bg: "bg-blue-100",   text: "text-blue-700",   icon: CheckCircle },
  DISPATCHED:        { label: "Despachado",            bg: "bg-purple-100", text: "text-purple-700", icon: Truck },
  IN_TRANSIT:        { label: "Em Trânsito",           bg: "bg-cyan-100",   text: "text-cyan-700",   icon: Navigation },
  DELIVERED:         { label: "Entregue",              bg: "bg-green-100",  text: "text-green-700",  icon: CheckCircle2 },
  CANCELLED:         { label: "Cancelado",             bg: "bg-red-100",    text: "text-red-700",    icon: XCircle },
  APPROVED:          { label: "Aprovada",              bg: "bg-blue-100",   text: "text-blue-700",   icon: ThumbsUp },
  PREPARING:         { label: "Em Preparação",         bg: "bg-purple-100", text: "text-purple-700", icon: Package2 },
  RECEIVED:          { label: "Recebida",              bg: "bg-green-100",  text: "text-green-700",  icon: PackageCheck },
};

export function StatusBadge({
  status,
  size = "sm",
  showIcon = false,
  icon: CustomIcon,
}: StatusBadgeProps) {
  const config = STATUS_MAP[status];
  const Icon = CustomIcon ?? config.icon;
  const sizeClasses =
    size === "sm" ? "text-xs px-2 py-0.5" : "text-xs px-2.5 py-1";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        config.bg,
        config.text,
        sizeClasses
      )}
    >
      {(showIcon || CustomIcon) && <Icon className="w-3 h-3" />}
      {config.label}
    </span>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/status-badge.tsx
git commit -m "feat: componente StatusBadge com mapa completo de estados"
```

---

## Task 8: DataTable Component

**Files:**
- Create: `components/ui/data-table.tsx`

- [ ] **Step 1: Criar `components/ui/data-table.tsx`**

```typescript
"use client";

import { cn } from "@/lib/utils";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface Column<T> {
  key: keyof T | string;
  header: string;
  width?: string;
  sortable?: boolean;
  truncate?: boolean;
  render?: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  density?: "default" | "compact";
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string, direction: "asc" | "desc") => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  emptyState?: React.ReactNode;
}

function getCellValue<T>(row: T, key: keyof T | string): React.ReactNode {
  return String((row as Record<string, unknown>)[key as string] ?? "—");
}

export function DataTable<T extends { id?: string | number }>({
  columns,
  data,
  loading = false,
  density = "default",
  onRowClick,
  rowActions,
  sortKey,
  sortDirection,
  onSort,
  pagination,
  emptyState,
}: DataTableProps<T>) {
  const cellPadding = density === "compact" ? "px-3 py-1.5" : "px-4 py-3";
  const textSize = density === "compact" ? "text-xs" : "text-sm";
  const totalColumns = columns.length + (rowActions ? 1 : 0);

  function handleSort(key: string) {
    if (!onSort) return;
    onSort(key, sortKey === key && sortDirection === "asc" ? "desc" : "asc");
  }

  const totalPages = pagination
    ? Math.ceil(pagination.total / pagination.pageSize)
    : 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  "text-left text-xs font-semibold text-slate-500 uppercase tracking-wide select-none",
                  cellPadding,
                  col.sortable && onSort && "cursor-pointer hover:text-slate-700"
                )}
                onClick={col.sortable ? () => handleSort(String(col.key)) : undefined}
              >
                <span className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && onSort && (
                    <span className="text-slate-400">
                      {sortKey === String(col.key) ? (
                        sortDirection === "asc" ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="w-3 h-3" />
                      )}
                    </span>
                  )}
                </span>
              </th>
            ))}
            {rowActions && <th className="w-[60px]" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: totalColumns }).map((_, j) => (
                  <td key={j} className={cellPadding}>
                    <div
                      className={cn(
                        "bg-slate-100 rounded animate-pulse w-full",
                        density === "compact" ? "h-9" : "h-[52px]"
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={totalColumns} className="py-12">
                {emptyState ?? (
                  <p className="text-center text-sm text-slate-400">
                    Nenhum registro encontrado
                  </p>
                )}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={String(row.id ?? i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "transition-colors",
                  onRowClick && "hover:bg-slate-50 cursor-pointer"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    className={cn(
                      cellPadding,
                      textSize,
                      "text-slate-700",
                      col.truncate && "max-w-0"
                    )}
                  >
                    {col.render ? (
                      col.render(row)
                    ) : col.truncate ? (
                      <span
                        className="block truncate"
                        title={String(getCellValue(row, col.key))}
                      >
                        {getCellValue(row, col.key)}
                      </span>
                    ) : (
                      getCellValue(row, col.key)
                    )}
                  </td>
                ))}
                {rowActions && (
                  <td
                    className={cn(cellPadding, "text-right")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowActions(row)}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {pagination && !loading && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white">
          <p className="text-xs text-slate-500">
            {pagination.total} registro{pagination.total !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              Página {pagination.page} de {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={pagination.page <= 1}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={pagination.page >= totalPages}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/data-table.tsx
git commit -m "feat: componente DataTable com sort, paginação e densidade"
```

---

## Task 9: FilterBar Component

**Files:**
- Create: `components/ui/filter-bar.tsx`

- [ ] **Step 1: Criar `components/ui/filter-bar.tsx`**

```typescript
"use client";

import { Search, X } from "lucide-react";

export interface FilterConfig {
  type: "search" | "select" | "daterange";
  key: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

interface FilterBarProps {
  filters: FilterConfig[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onReset?: () => void;
}

export function FilterBar({ filters, values, onChange, onReset }: FilterBarProps) {
  const hasActiveFilters = Object.values(values).some(
    (v) => v !== "" && v !== null && v !== undefined
  );

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 min-h-[48px] flex-wrap">
      {filters.map((filter) => {
        if (filter.type === "search") {
          return (
            <div key={filter.key} className="relative flex-1 max-w-xs min-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder={filter.placeholder ?? "Buscar..."}
                value={String(values[filter.key] ?? "")}
                onChange={(e) => onChange(filter.key, e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
              />
            </div>
          );
        }

        if (filter.type === "select" && filter.options) {
          return (
            <select
              key={filter.key}
              value={String(values[filter.key] ?? "")}
              onChange={(e) => onChange(filter.key, e.target.value)}
              className="py-1.5 px-3 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400 text-slate-700"
            >
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        }

        return null;
      })}

      {hasActiveFilters && onReset && (
        <button
          onClick={onReset}
          className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Limpar filtros
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/filter-bar.tsx
git commit -m "feat: componente FilterBar horizontal"
```

---

## Task 10: EmptyState + ErrorState

**Files:**
- Create: `components/ui/empty-state.tsx`
- Create: `components/ui/error-state.tsx`

- [ ] **Step 1: Criar `components/ui/empty-state.tsx`**

```typescript
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && <Icon className="w-10 h-10 text-slate-300 mb-3" />}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description && (
        <p className="text-sm text-slate-400 mt-1">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-md transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Criar `components/ui/error-state.tsx`**

```typescript
import { AlertCircle } from "lucide-react";

export type ErrorSource = "ERP" | "Maps" | "Lalamove" | "Database" | "Unknown";

interface ErrorStateProps {
  source: ErrorSource;
  title?: string;
  description?: string;
  onRetry?: () => void;
}

const DEFAULT_TITLES: Record<ErrorSource, string> = {
  ERP:      "Erro ao buscar dados do ERP",
  Maps:     "Erro ao calcular rota",
  Lalamove: "Cotação Lalamove indisponível",
  Database: "Erro ao carregar dados",
  Unknown:  "Algo deu errado",
};

export function ErrorState({ source, title, description, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
      <p className="text-sm font-medium text-slate-700">
        {title ?? DEFAULT_TITLES[source]}
      </p>
      {description && (
        <p className="text-sm text-slate-400 mt-1">{description}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 text-sm font-medium text-slate-700 border border-slate-300 hover:border-slate-400 px-4 py-2 rounded-md transition-colors"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/ui/empty-state.tsx components/ui/error-state.tsx
git commit -m "feat: componentes EmptyState e ErrorState"
```

---

## Task 11: KeyValueList + AlertBanner

**Files:**
- Create: `components/ui/key-value-list.tsx`
- Create: `components/ui/alert-banner.tsx`

- [ ] **Step 1: Criar `components/ui/key-value-list.tsx`**

```typescript
import { cn } from "@/lib/utils";

interface KeyValueItem {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
}

interface KeyValueListProps {
  items: KeyValueItem[];
  columns?: 1 | 2;
}

export function KeyValueList({ items, columns = 2 }: KeyValueListProps) {
  return (
    <dl
      className={cn(
        "grid gap-0 divide-y divide-slate-100",
        columns === 2 ? "grid-cols-2" : "grid-cols-1"
      )}
    >
      {items.map((item, i) => (
        <div key={i} className={cn("py-2.5 px-1", item.fullWidth && "col-span-2")}>
          <dt className="text-xs text-slate-500 uppercase tracking-wide">
            {item.label}
          </dt>
          <dd className="text-sm font-medium text-slate-900 mt-0.5">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 2: Criar `components/ui/alert-banner.tsx`**

```typescript
import { cn } from "@/lib/utils";
import {
  Info,
  AlertTriangle,
  AlertCircle,
  Zap,
  X,
  type LucideIcon,
} from "lucide-react";

interface AlertBannerProps {
  variant: "info" | "warning" | "danger" | "urgent";
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}

const variantConfig: Record<
  string,
  { bg: string; border: string; text: string; icon: LucideIcon }
> = {
  info:    { bg: "bg-slate-50",  border: "border-slate-200",  text: "text-slate-700",  icon: Info },
  warning: { bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-800",  icon: AlertTriangle },
  danger:  { bg: "bg-red-50",    border: "border-red-200",    text: "text-red-800",    icon: AlertCircle },
  urgent:  { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-800", icon: Zap },
};

export function AlertBanner({
  variant,
  title,
  description,
  action,
  onDismiss,
}: AlertBannerProps) {
  const { bg, border, text, icon: Icon } = variantConfig[variant];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 mb-4",
        bg,
        border
      )}
    >
      <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", text)} />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium", text)}>{title}</p>
        {description && (
          <p className={cn("text-xs mt-0.5 opacity-80", text)}>{description}</p>
        )}
      </div>
      {(action || onDismiss) && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {action && (
            <button
              onClick={action.onClick}
              className={cn("text-xs font-medium underline underline-offset-2", text)}
            >
              {action.label}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className={cn("hover:opacity-70 transition-opacity", text)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/ui/key-value-list.tsx components/ui/alert-banner.tsx
git commit -m "feat: componentes KeyValueList e AlertBanner"
```

---

## Task 12: Barrel Export + Verificação Final

**Files:**
- Create: `components/ui/index.ts`

- [ ] **Step 1: Criar `components/ui/index.ts`**

```typescript
export { Card } from "./card";
export { PageHeader } from "./page-header";
export { MetricCard } from "./metric-card";
export { DataTable } from "./data-table";
export type { Column, DataTableProps } from "./data-table";
export { StatusBadge } from "./status-badge";
export type { StatusVariant } from "./status-badge";
export { FilterBar } from "./filter-bar";
export type { FilterConfig } from "./filter-bar";
export { EmptyState } from "./empty-state";
export { ErrorState } from "./error-state";
export type { ErrorSource } from "./error-state";
export { KeyValueList } from "./key-value-list";
export { AlertBanner } from "./alert-banner";
```

- [ ] **Step 2: Verificação TypeScript completa**

```bash
npx tsc --noEmit
```

Expected: 0 erros

- [ ] **Step 3: Verificação visual no servidor dev**

```bash
npm run dev
```

Abrir `http://localhost:3000/solicitacoes` e confirmar:
- Sidebar: grupos OPERAÇÃO / LOGÍSTICA / PERFORMANCE visíveis, item ativo com barra laranja esquerda e fundo `bg-orange-600/15`
- Header: título "Solicitações", badge da loja, botão "Nova Solicitação"
- Fundo de página slate-50, conteúdo em max-width 1400px
- Nenhuma quebra nas páginas existentes

- [ ] **Step 4: Commit final**

```bash
git add components/ui/index.ts
git commit -m "feat: barrel export dos componentes do design system

Design System Fase 1 completo:
- Tokens CSS (globals.css + tailwind.config.ts)
- Layout base: sidebar com grupos + header global
- 10 componentes: Card, PageHeader, MetricCard, DataTable,
  StatusBadge, FilterBar, EmptyState, ErrorState, KeyValueList, AlertBanner"
```
