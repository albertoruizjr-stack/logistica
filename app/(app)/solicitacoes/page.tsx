import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { cn, formatRelativeTime, formatCurrency } from "@/lib/utils";
import {
  DELIVERY_STATUS_LABELS, DELIVERY_STATUS_COLORS,
} from "@/lib/constants";
import { Plus, Package, ArrowLeftRight, Zap, FileText } from "lucide-react";

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: { status?: string; storeId?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const storeFilter =
    session.role === "SELLER"
      ? session.storeId  // vendedor só vê sua loja
      : searchParams.storeId ?? undefined;

  const requests = await prisma.deliveryRequest.findMany({
    where: {
      ...(searchParams.status ? { status: searchParams.status as never } : {}),
      ...(storeFilter ? { storeId: storeFilter } : {}),
    },
    include: {
      store: { select: { code: true, name: true } },
      seller: { select: { name: true } },
      freightQuote: { select: { distanceKm: true, suggestedPrice: true } },
      transfers: { select: { id: true, status: true, priority: true } },
      dispatch: { select: { modal: true, status: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const stores = session.role !== "SELLER"
    ? await prisma.store.findMany({
        where: { active: true },
        select: { id: true, code: true },
        orderBy: { code: "asc" },
      })
    : [];

  const statusOptions = [
    { value: "", label: "Todas" },
    { value: "PENDING", label: "Pendentes" },
    { value: "AWAITING_TRANSFER", label: "Aguard. Transferência" },
    { value: "READY", label: "Prontas" },
    { value: "DISPATCHED", label: "Despachadas" },
    { value: "IN_TRANSIT", label: "Em trânsito" },
    { value: "DELIVERED", label: "Entregues" },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Solicitações de Entrega</h1>
          <p className="text-gray-500 text-sm mt-1">{requests.length} resultado{requests.length !== 1 ? "s" : ""}</p>
        </div>
        <Link
          href="/solicitacoes/nova"
          className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-orange-600 transition"
        >
          <Plus className="w-4 h-4" />
          Nova solicitação
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-5">
        {statusOptions.map((opt) => (
          <Link
            key={opt.value}
            href={`/solicitacoes${opt.value ? `?status=${opt.value}` : ""}`}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              (opt.value === "" && !searchParams.status) || searchParams.status === opt.value
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            )}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {/* Tabela */}
      {requests.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">Nenhuma solicitação encontrada</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">NF</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Loja</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Frete</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Criado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {requests.map((req) => (
                <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{req.invoiceNumber}</span>
                      {req.deliveryType === "URGENT" && (
                        <Zap className="w-3 h-3 text-red-500" />
                      )}
                    </div>
                    <span className="text-xs text-gray-400">{req._count.items} iten{req._count.items !== 1 ? "s" : ""}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {req.store.code}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-gray-900 truncate max-w-[180px]">{req.customerName}</p>
                    <p className="text-xs text-gray-400 truncate max-w-[180px]">{req.seller.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium w-fit",
                        DELIVERY_STATUS_COLORS[req.status]
                      )}>
                        {DELIVERY_STATUS_LABELS[req.status]}
                      </span>
                      {req.transfers.some((t) => t.status !== "RECEIVED" && t.status !== "CANCELLED") && (
                        <span className="text-xs text-orange-600 flex items-center gap-0.5">
                          <ArrowLeftRight className="w-2.5 h-2.5" />
                          Transferência
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {req.chargedFreight != null ? (
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {formatCurrency(req.chargedFreight)}
                        </p>
                        {req.freightQuote && (
                          <p className={cn(
                            "text-xs",
                            req.chargedFreight > req.freightQuote.suggestedPrice
                              ? "text-green-600"
                              : req.chargedFreight < req.freightQuote.suggestedPrice
                              ? "text-red-500"
                              : "text-gray-400"
                          )}>
                            Sug: {formatCurrency(req.freightQuote.suggestedPrice)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {formatRelativeTime(req.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/solicitacoes/${req.id}`}
                      className="text-xs text-orange-600 hover:underline font-medium"
                    >
                      Ver →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
