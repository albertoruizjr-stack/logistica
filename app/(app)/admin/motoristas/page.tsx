import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { Truck, Key } from "lucide-react";
import DriverPasswordPanel from "./_components/driver-password-panel";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

export default async function AdminMotoristasPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.role)) redirect("/dashboard");

  const drivers = await prisma.driver.findMany({
    where:   { active: true },
    include: { user: { select: { id: true, email: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Motoristas"
        description="Gerencie acessos dos motoristas ao app móvel"
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-600">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Motorista</th>
              <th className="text-left px-4 py-3 font-semibold">Email (login)</th>
              <th className="text-left px-4 py-3 font-semibold">Telefone</th>
              <th className="text-center px-4 py-3 font-semibold">Acesso</th>
              <th className="text-right px-4 py-3 font-semibold">Senha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {drivers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400 italic">
                  Nenhum motorista cadastrado. Sincronize com o Spoke em /roteirizacao.
                </td>
              </tr>
            )}
            {drivers.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-orange-500 flex-shrink-0" />
                    <span className="font-medium text-gray-900">{d.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-700">{d.email ?? d.user?.email ?? "—"}</td>
                <td className="px-4 py-3 text-gray-700">{d.phone || "—"}</td>
                <td className="px-4 py-3 text-center">
                  {d.userId ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                      <Key className="w-2.5 h-2.5" />
                      ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                      sem login
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <DriverPasswordPanel
                    driverId={d.id}
                    driverName={d.name}
                    hasUser={Boolean(d.userId)}
                    hasEmail={Boolean(d.email || d.user?.email)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
