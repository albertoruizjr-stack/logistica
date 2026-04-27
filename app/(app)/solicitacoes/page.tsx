import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DeliveryRequestStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import SolicitacoesFilters from "./_components/solicitacoes-filters";
import SolicitacoesTable from "./_components/solicitacoes-table";
import type { SolicitacaoRow } from "./_components/solicitacoes-table";
import { Plus } from "lucide-react";

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: { status?: string; storeId?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const storeFilter =
    session.role === "SELLER"
      ? session.storeId
      : searchParams.storeId ?? undefined;

  const validatedStatus =
    searchParams.status &&
    Object.values(DeliveryRequestStatus).includes(
      searchParams.status as DeliveryRequestStatus
    )
      ? (searchParams.status as DeliveryRequestStatus)
      : undefined;

  const requests = await prisma.deliveryRequest.findMany({
    where: {
      ...(validatedStatus ? { status: validatedStatus } : {}),
      ...(storeFilter ? { storeId: storeFilter } : {}),
    },
    include: {
      store: { select: { code: true } },
      seller: { select: { name: true } },
      freightQuote: { select: { suggestedPrice: true } },
      transfers: { select: { status: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const stores =
    session.role !== "SELLER"
      ? await prisma.store.findMany({
          where: { active: true },
          select: { id: true, code: true },
          orderBy: { code: "asc" },
        })
      : [];

  const rows: SolicitacaoRow[] = requests.map((req) => ({
    id: req.id,
    invoiceNumber: req.invoiceNumber,
    isUrgent: req.deliveryType === "URGENT",
    itemCount: req._count.items,
    storeCode: req.store.code,
    customerName: req.customerName,
    sellerName: req.seller.name,
    status: req.status,
    hasActiveTransfer: req.transfers.some(
      (t) => t.status !== "RECEIVED" && t.status !== "CANCELLED"
    ),
    chargedFreight: req.chargedFreight != null ? Number(req.chargedFreight) : null,
    suggestedPrice: req.freightQuote?.suggestedPrice != null ? Number(req.freightQuote.suggestedPrice) : null,
    createdAt: req.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitações de Entrega"
        description={`${requests.length} resultado${requests.length !== 1 ? "s" : ""}`}
        actions={
          session.role !== "SELLER" ? (
            <Link
              href="/solicitacoes/nova"
              className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition"
            >
              <Plus className="w-4 h-4" />
              Nova solicitação
            </Link>
          ) : undefined
        }
      />

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <Suspense
          fallback={
            <div className="h-12 bg-slate-50 border-b border-slate-200 animate-pulse" />
          }
        >
          <SolicitacoesFilters role={session.role} stores={stores} />
        </Suspense>
        <SolicitacoesTable data={rows} />
      </div>
    </div>
  );
}
