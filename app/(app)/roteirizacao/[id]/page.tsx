import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getWaveDetail } from "@/services/routing-wave.service";
import { PageHeader } from "@/components/ui";
import { ArrowLeft, Truck, MapPin, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

const WAVE_STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:       { bg: "bg-gray-100",    text: "text-gray-700",    label: "Rascunho" },
  SENT:        { bg: "bg-blue-100",    text: "text-blue-700",    label: "Otimizando" },
  OPTIMIZED:   { bg: "bg-indigo-100",  text: "text-indigo-700",  label: "Otimizada" },
  DISTRIBUTED: { bg: "bg-green-100",   text: "text-green-700",   label: "Distribuída" },
  DISPATCHED:  { bg: "bg-purple-100",  text: "text-purple-700",  label: "Despachada" },
  COMPLETED:   { bg: "bg-emerald-100", text: "text-emerald-700", label: "Concluída" },
  FAILED:      { bg: "bg-red-100",     text: "text-red-700",     label: "Falhou" },
};

interface SequenceStop {
  stopPosition:      number | null;
  deliveryRequestId: string;
  eta:               number | null;
}

export default async function WaveDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.role)) redirect("/dashboard");

  const wave = await getWaveDetail(params.id);
  if (!wave) notFound();

  const cfg = WAVE_STATUS_COLORS[wave.status] ?? { bg: "bg-gray-100", text: "text-gray-700", label: wave.status };
  const totalStops = wave.routes.reduce((s, r) => s + (r.stopCount ?? 0), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link
        href="/roteirizacao"
        className="text-xs text-orange-600 hover:underline font-medium flex items-center gap-1 mb-3"
      >
        <ArrowLeft className="w-3 h-3" />
        Voltar para roteirização
      </Link>

      <PageHeader
        title={wave.name}
        description={`${wave.routes.length} rota${wave.routes.length !== 1 ? "s" : ""} · ${totalStops} parada${totalStops !== 1 ? "s" : ""}`}
        actions={
          <span className={cn(
            "text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5",
            cfg.bg, cfg.text,
          )}>
            {wave.status === "FAILED" && <AlertTriangle className="w-3 h-3" />}
            {wave.status === "DISTRIBUTED" && <CheckCircle2 className="w-3 h-3" />}
            {cfg.label}
          </span>
        }
      />

      {/* Meta da wave */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 grid grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Data</p>
          <p className="font-semibold text-gray-900">
            {wave.date.toLocaleDateString("pt-BR", { timeZone: "UTC" })}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Criada por</p>
          <p className="font-semibold text-gray-900">{wave.createdBy.name}</p>
        </div>
        <div>
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Plan Spoke</p>
          <p className="font-mono text-xs text-gray-700 truncate">{wave.spokePlanId ?? "—"}</p>
        </div>
        <div>
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Criada em</p>
          <p className="font-semibold text-gray-900">
            {wave.createdAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          </p>
        </div>
      </div>

      {wave.errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-red-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-900">Falha no pipeline</p>
            <p className="text-xs text-red-700 mt-0.5">{wave.errorMessage}</p>
          </div>
        </div>
      )}

      {/* Rotas geradas */}
      <h2 className="text-base font-bold text-gray-900 mb-3">Rotas</h2>
      {wave.routes.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-8 text-center">
          Nenhuma rota foi gerada ainda. A wave ainda está no estado {cfg.label}.
        </p>
      ) : (
        <div className="space-y-3">
          {wave.routes.map((route) => {
            const sequence = (route.sequenceJson as unknown as SequenceStop[] | null) ?? [];
            return (
              <div key={route.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Header da rota */}
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
                  <Truck className="w-4 h-4 text-orange-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{route.driver.name}</p>
                    <p className="text-[11px] text-gray-500">
                      {route.stopCount ?? 0} paradas
                      {route.estimatedReturnAt && (
                        <>
                          {" · "}retorno estimado {route.estimatedReturnAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </>
                      )}
                    </p>
                  </div>
                  {route.driver.phone && (
                    <span className="text-[11px] text-gray-500">{route.driver.phone}</span>
                  )}
                </div>

                {/* Sequência de paradas */}
                <ol className="divide-y divide-gray-100">
                  {sequence.length === 0 ? (
                    <li className="px-4 py-3 text-sm text-gray-400 italic">Sem paradas registradas</li>
                  ) : sequence.map((stop, idx) => (
                    <li key={`${stop.deliveryRequestId}-${idx}`} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {stop.stopPosition ?? idx + 1}
                      </span>
                      <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <Link
                        href={`/solicitacoes?detail=${stop.deliveryRequestId}`}
                        className="flex-1 text-gray-700 hover:text-orange-600 hover:underline truncate"
                      >
                        Solicitação #{stop.deliveryRequestId.slice(-6)}
                      </Link>
                      {stop.eta && (
                        <span className="text-[11px] text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(stop.eta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
