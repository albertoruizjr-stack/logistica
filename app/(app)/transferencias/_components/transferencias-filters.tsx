"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { FilterBar } from "@/components/ui";
import type { FilterConfig } from "@/components/ui";

interface TransferenciasFiltersProps {
  stores: { id: string; code: string }[];
}

export default function TransferenciasFilters({ stores }: TransferenciasFiltersProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const filters: FilterConfig[] = [
    {
      type: "select",
      key: "fromStore",
      options: [
        { value: "", label: "Todas as lojas" },
        ...stores.map((s) => ({ value: s.id, label: `Loja ${s.code}` })),
      ],
    },
    {
      type: "select",
      key: "priority",
      options: [
        { value: "", label: "Todas as prioridades" },
        { value: "ANTICIPATED", label: "Antecipada" },
        { value: "ON_ROUTE", label: "Na rota" },
        { value: "URGENT", label: "Urgente" },
      ],
    },
  ];

  const values = {
    fromStore: searchParams.get("fromStore") ?? "",
    priority: searchParams.get("priority") ?? "",
  };

  function handleChange(key: string, value: unknown) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "" || value == null) {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
    router.replace(`/transferencias?${params.toString()}`, { scroll: false });
  }

  function handleReset() {
    const status = searchParams.get("status");
    router.replace(
      status ? `/transferencias?status=${status}` : "/transferencias",
      { scroll: false }
    );
  }

  return (
    <FilterBar
      filters={filters}
      values={values}
      onChange={handleChange}
      onReset={handleReset}
    />
  );
}
