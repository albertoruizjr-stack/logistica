import { getSession } from "@/lib/auth";
import { getFreightZones } from "@/services/frete.service";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { FreightQuoteForm } from "@/components/forms/cotacao-form";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui";

export default async function CotacaoPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [zones, stores] = await Promise.all([
    getFreightZones(),
    prisma.store.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, lat: true, lng: true, address: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Cotação de Frete"
        description="Calcule o valor sugerido de frete por zona de distância"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulário */}
        <div className="lg:col-span-2">
          <FreightQuoteForm stores={stores} sessionStoreId={session.storeId} />
        </div>

        {/* Tabela de zonas */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 h-fit">
          <h3 className="font-semibold text-gray-900 text-sm mb-4">Tabela de Frete</h3>
          <div className="space-y-2">
            {zones.map((zone) => (
              <div
                key={zone.id}
                className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
              >
                <div>
                  <p className="text-xs font-medium text-gray-700">{zone.name}</p>
                  {zone.underConsultation && (
                    <p className="text-xs text-orange-600">Sob consulta</p>
                  )}
                </div>
                {!zone.underConsultation ? (
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(zone.basePrice)}
                    </p>
                    {/* Express usa expressBasePrice absoluto (tabela 2026-05-13).
                        Fallback pra zonas legadas sem expressBasePrice continua mostrando
                        basePrice × urgentFactor pra não quebrar histórico visual. */}
                    <p className="text-xs text-red-600">
                      Express:{" "}
                      {formatCurrency(
                        zone.expressBasePrice != null && zone.expressBasePrice > 0
                          ? zone.expressBasePrice
                          : zone.basePrice * zone.urgentFactor
                      )}
                    </p>
                  </div>
                ) : (
                  // Z7 (acima de 30 km): R$ 3/km na normal, Lalamove no express.
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">R$ 3,00/km</p>
                    <p className="text-xs text-red-600">Express: cotação Lalamove</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-4">
            * Express usa valor absoluto por zona (tabela atualizada — sem multiplicador).
          </p>
        </div>
      </div>
    </div>
  );
}
