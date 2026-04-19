"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, ChevronDown } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  "/solicitacoes": "Solicitações",
  "/despacho": "Painel de Despacho",
  "/dashboard": "Dashboard",
  "/transferencias": "Transferências",
  "/rastreamento": "Rastreamento",
  "/cotacao": "Cotação de Frete",
  "/auditoria": "Auditoria & KPIs",
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
          {storeCode ? `${storeCode} — ${storeName}` : storeName}
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
