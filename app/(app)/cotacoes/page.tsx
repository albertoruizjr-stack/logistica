import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { QuotesList } from "@/components/cotacoes/QuotesList";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function CotacoesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAdmin = session.role === "ADMIN" || session.role === "OPERATOR" || session.role === "STOCK_OPERATOR" || session.role === "LOGISTICS_OPERATOR";

  const stores = isAdmin
    ? await prisma.store.findMany({
        where:   { active: true },
        select:  { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      })
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <PageHeader
          title="Cotações de Frete"
          description="Cotações salvas — convertidas, em aberto e expiradas"
        />
        <Link
          href="/cotacao"
          className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition"
        >
          <Plus className="w-4 h-4" />
          Nova cotação
        </Link>
      </div>

      <QuotesList
        initialStoreId={isAdmin ? undefined : session.storeId}
        isAdmin={isAdmin}
        stores={stores}
      />
    </div>
  );
}
