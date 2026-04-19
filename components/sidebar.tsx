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
