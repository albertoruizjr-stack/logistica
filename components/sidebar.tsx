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
} from "lucide-react";

const navItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["ADMIN", "OPERATOR", "SELLER", "DRIVER"],
  },
  {
    href: "/cotacao",
    label: "Cotação de Frete",
    icon: Calculator,
    roles: ["ADMIN", "OPERATOR", "SELLER"],
  },
  {
    href: "/solicitacoes",
    label: "Solicitações",
    icon: FileText,
    roles: ["ADMIN", "OPERATOR", "SELLER"],
  },
  {
    href: "/transferencias",
    label: "Transferências",
    icon: ArrowLeftRight,
    roles: ["ADMIN", "OPERATOR"],
    badge: "central",  // destaque visual — entidade central
  },
  {
    href: "/despacho",
    label: "Painel de Despacho",
    icon: Truck,
    roles: ["ADMIN", "OPERATOR"],
  },
  {
    href: "/rastreamento",
    label: "Rastreamento",
    icon: MapPin,
    roles: ["ADMIN", "OPERATOR"],
  },
  {
    href: "/auditoria",
    label: "Auditoria & KPIs",
    icon: BarChart3,
    roles: ["ADMIN", "OPERATOR"],
  },
];

interface SidebarProps {
  userRole: string;
  userName: string;
  storeName: string;
}

export function Sidebar({ userRole, userName, storeName }: SidebarProps) {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const visibleItems = navItems.filter((item) => item.roles.includes(userRole));

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Package className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">Logística</p>
            <p className="text-xs text-gray-400 leading-tight">Mestre da Pintura</p>
          </div>
        </div>
      </div>

      {/* Loja/Usuário */}
      <div className="px-6 py-3 border-b border-gray-800">
        <p className="text-xs text-gray-400">Loja atual</p>
        <p className="text-sm font-medium text-white truncate">{storeName}</p>
        <p className="text-xs text-gray-500 truncate">{userName}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group",
                isActive
                  ? "bg-orange-500 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
            >
              <item.icon className={cn(
                "w-4 h-4 flex-shrink-0",
                isActive ? "text-white" : "text-gray-500 group-hover:text-white"
              )} />
              <span className="flex-1">{item.label}</span>
              {item.badge === "central" && !isActive && (
                <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">
                  central
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-gray-800">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
