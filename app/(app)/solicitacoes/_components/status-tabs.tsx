"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

interface Tab {
  key: string;
  label: string;
  count: number;
}

interface StatusTabsProps {
  tabs: Tab[];
  currentTab: string;
}

export function StatusTabs({ tabs, currentTab }: StatusTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(tab: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    // ao trocar de aba, mantém filtro de loja mas reseta status
    params.delete("status");
    router.replace(`/solicitacoes?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex items-center gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
      {tabs.map((tab) => {
        const active = tab.key === currentTab;
        return (
          <button
            key={tab.key}
            onClick={() => navigate(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors",
              active
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            )}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className={cn(
                  "text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none",
                  active
                    ? "bg-orange-100 text-orange-700"
                    : "bg-gray-100 text-gray-500"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
