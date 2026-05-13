"use client";

import { useEffect, useState } from "react";
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
  Radar,
  AlertTriangle,
  MonitorDot,
  ClipboardList,
  Map,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
  showUrgentBadge?: boolean;
  matchExact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Logística",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard Logístico",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER", "SELLER", "DRIVER"],
      },
      {
        href: "/cotacao",
        label: "Nova Cotação",
        icon: Calculator,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER", "SELLER"],
      },
      {
        href: "/cotacoes",
        label: "Cotações Salvas",
        icon: ClipboardList,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER", "SELLER"],
      },
      {
        href: "/solicitacoes",
        label: "Solicitações",
        icon: FileText,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER", "SELLER"],
        showUrgentBadge: true,
      },
      {
        href: "/transferencias",
        label: "Transferências",
        icon: ArrowLeftRight,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"],
      },
      {
        href: "/rastreamento",
        label: "Rastreamento",
        icon: MapPin,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"],
      },
      {
        href: "/roteirizacao",
        label: "Roteirização",
        icon: Map,
        roles: ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"],
      },
      {
        href: "/despacho",
        label: "Despacho",
        icon: Truck,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"],
      },
      {
        href: "/operacao",
        label: "Fila Operacional",
        icon: MonitorDot,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"],
      },
    ],
  },
  {
    label: "Estoque",
    items: [
      {
        href: "/torre",
        label: "Torre de Controle",
        icon: Radar,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"],
        matchExact: true,
      },
      {
        href: "/torre/ruptura",
        label: "Ruptura",
        icon: AlertTriangle,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"],
      },
    ],
  },
  {
    label: "Gestão",
    items: [
      {
        href: "/auditoria",
        label: "Auditoria",
        icon: BarChart3,
        roles: ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"],
      },
      {
        href: "/admin/motoristas",
        label: "Motoristas",
        icon: Truck,
        roles: ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"],
      },
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

function isItemActive(pathname: string, item: NavItem): boolean {
  if (item.matchExact) return pathname === item.href;
  return pathname.startsWith(item.href);
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
  const [badges, setBadges] = useState<Record<string, number>>({});

  // Poll de badges a cada 30s. Não bloqueia render.
  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const res = await fetch("/api/badges", { cache: "no-store" });
        const json = await res.json();
        if (!stopped && json.success) setBadges(json.data.paths ?? {});
      } catch { /* silencioso */ }
    }
    void load();
    const t = setInterval(load, 30_000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside
      className={cn(
        "flex flex-col h-screen flex-shrink-0 transition-all duration-200",
        collapsed ? "w-14" : "w-56"
      )}
      style={{ backgroundColor: "#111111", color: "white" }}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex items-center gap-3 border-b",
          collapsed ? "p-3 justify-center" : "px-4 py-[18px]"
        )}
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
          <Package className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div>
            <p
              className="text-[13px] font-bold text-white tracking-tight leading-none"
              style={{ fontFamily: "var(--font-display)" }}
            >
              LOGÍSTICA
            </p>
            <p className="text-[11px] leading-none mt-1" style={{ color: "#555555" }}>
              Mestre da Pintura
            </p>
          </div>
        )}
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-2 py-4 overflow-y-auto space-y-5">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) =>
            item.roles.includes(userRole)
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              {!collapsed && (
                <p
                  className="text-[10px] font-semibold uppercase px-3 mb-1.5"
                  style={{
                    letterSpacing: "0.14em",
                    color: "#4B4B4B",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive = isItemActive(pathname, item);
                  const dynamicCount = badges[item.href] ?? 0;
                  const showUrgent = item.showUrgentBadge && urgentCount > 0;
                  const showCount  = dynamicCount > 0 && !showUrgent;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150",
                        isActive
                          ? "text-white"
                          : "hover:text-zinc-200"
                      )}
                      style={{
                        backgroundColor: isActive ? "rgba(255,255,255,0.07)" : "transparent",
                        color: isActive ? "white" : "#777777",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.04)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                      }}
                    >
                      {isActive && (
                        <span
                          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
                          style={{ backgroundColor: "#F97316" }}
                        />
                      )}
                      <item.icon
                        className="w-4 h-4 flex-shrink-0"
                        style={{ color: isActive ? "#FB923C" : "#555555" }}
                      />
                      {!collapsed && (
                        <>
                          <span className="flex-1">{item.label}</span>
                          {showUrgent && (
                            <span
                              className="text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
                              style={{ backgroundColor: "#F97316" }}
                            >
                              {urgentCount}
                            </span>
                          )}
                          {showCount && (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
                              style={{
                                backgroundColor: "rgba(255,255,255,0.10)",
                                color: isActive ? "white" : "#999",
                              }}
                            >
                              {dynamicCount > 99 ? "99+" : dynamicCount}
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
      <div
        className="px-2 py-3 space-y-0.5 border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        {!collapsed && (
          <div className="px-3 py-2 flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border"
              style={{
                backgroundColor: "rgba(249,115,22,0.15)",
                borderColor: "rgba(249,115,22,0.25)",
              }}
            >
              <span
                className="text-[11px] font-bold"
                style={{ color: "#FB923C" }}
              >
                {userName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-white truncate leading-none">
                {userName}
              </p>
              <p className="text-[11px] truncate leading-none mt-0.5" style={{ color: "#555555" }}>
                {storeCode ? `${storeCode} — ` : ""}{storeName}
              </p>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors"
          style={{ color: "#4B4B4B" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.04)";
            (e.currentTarget as HTMLElement).style.color = "#999999";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
            (e.currentTarget as HTMLElement).style.color = "#4B4B4B";
          }}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
