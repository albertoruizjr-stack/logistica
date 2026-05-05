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
    <header
      className="h-[52px] flex items-center justify-between px-6 flex-shrink-0 border-b"
      style={{
        backgroundColor: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderColor: "var(--color-border)",
      }}
    >
      <span
        className="text-[15px] font-bold text-[#1C1C1C]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </span>
      <div className="flex items-center gap-2.5">
        <span
          className="text-[11px] px-2.5 py-1 rounded-md font-medium border"
          style={{
            backgroundColor: "var(--color-background)",
            color: "var(--color-muted-text)",
            borderColor: "var(--color-border)",
          }}
        >
          {storeCode ? `${storeCode} — ${storeName}` : storeName}
        </span>
        {CAN_CREATE_DELIVERY.includes(userRole) && (
          <Link
            href="/solicitacoes/nova"
            className="flex items-center gap-1.5 text-white text-[13px] font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{
              backgroundColor: "var(--color-primary)",
              boxShadow: "0 1px 3px rgba(249,115,22,0.25)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-primary-dark)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-primary)";
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Solicitação
          </Link>
        )}
        <button
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
            style={{ backgroundColor: "#1C1C1C" }}
          >
            {userName.charAt(0).toUpperCase()}
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        </button>
      </div>
    </header>
  );
}
