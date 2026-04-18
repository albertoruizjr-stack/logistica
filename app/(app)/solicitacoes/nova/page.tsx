import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { NovaSolicitacaoForm } from "@/components/forms/solicitacao-form";

export default async function NovaSolicitacaoPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const stores = await prisma.store.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true, lat: true, lng: true },
    orderBy: { code: "asc" },
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Nova Solicitação de Entrega</h1>
        <p className="text-gray-500 text-sm mt-1">
          Informe o número da nota fiscal para buscar os dados do ERP
        </p>
      </div>
      <NovaSolicitacaoForm
        stores={stores}
        sessionStoreId={session.storeId}
        sessionUserId={session.userId}
      />
    </div>
  );
}
