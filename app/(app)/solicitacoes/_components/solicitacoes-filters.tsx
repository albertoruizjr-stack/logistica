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
