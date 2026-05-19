"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Printer, Truck, MapPin, Clock, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatVolumeBreakdown } from "@/services/citel-stock.service";

interface SequenceStop {
  stopPosition:      number | null;
  deliveryRequestId: string;
  eta:               number | null;
}

interface StopMeta {
  deliveryRequestId: string;
  orderNumber:       string | null;
  invoiceNumber:     string | null;
  customerName:      string;
  customerPhone:     string | null;
  deliveryAddress:   string;
  deliveryCity:      string | null;
  totalWeightKg:     number | null;
  totalLatas:        number | null;
  volumeBreakdown:   Record<string, number> | null;
}

interface Props {
  route: {
    id:                string;
    name:              string | null;
    status:            string;
    waveName:          string | null;
    driver:            { id: string; name: string; phone: string; vehicleType: string | null };
    stopCount:         number | null;
    totalWeightKg:     number | null;
    estimatedReturnAt: string | null;
    sequenceJson:      SequenceStop[] | null;
  };
  stopsMeta: StopMeta[];
}

export default function RouteDispatchPanel({ route, stopsMeta }: Props) {
  const router = useRouter();
  const [dispatching, setDispatching] = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const stopsMetaMap = new Map(stopsMeta.map((s) => [s.deliveryRequestId, s]));
  const orderedStops = (route.sequenceJson ?? [])
    .slice()
    .sort((a, b) => (a.stopPosition ?? 0) - (b.stopPosition ?? 0));

  function handlePrint() {
    // Abre página dedicada de impressão em nova janela.
    // A página dispara window.print() automaticamente ao carregar.
    window.open(`/manifest/${route.id}`, "_blank", "noopener");
  }

  async function handleDispatch() {
    if (!confirm(`Despachar rota com ${orderedStops.length} paradas para ${route.driver.name}?`)) return;
    setDispatching(true);
    setError(null);
    try {
      const res = await fetch(`/api/despacho/routes/${route.id}/dispatch`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao despachar rota");
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setDispatching(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Excluir a rota de ${route.driver.name}? As ${orderedStops.length} entrega(s) voltam para "Pronto para roteirização".`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/despacho/routes/${route.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao excluir rota");
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-2 print:border-black print:shadow-none">
      {/* Cabeçalho */}
      <div className="px-5 py-4 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-gray-100 print:bg-white">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Truck className="w-5 h-5 text-orange-600 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900 truncate">{route.driver.name}</h3>
              <p className="text-xs text-gray-500 truncate">
                {route.waveName ?? route.name ?? "Rota"} · {route.driver.vehicleType ?? "veículo"} · {route.driver.phone}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={handleDelete}
              disabled={deleting || dispatching || route.status === "DISPATCHED"}
              title="Excluir rota — entregas voltam para roteirização"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Excluir
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <Printer className="w-3 h-3" />
              Imprimir manifest
            </button>
            <button
              onClick={handleDispatch}
              disabled={dispatching || route.status === "DISPATCHED"}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {dispatching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />}
              {route.status === "DISPATCHED" ? "Despachada" : "Despachar rota"}
            </button>
          </div>
        </div>

        {/* KPIs da rota */}
        <div className="flex items-center gap-4 text-[11px] text-gray-600">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            <strong>{route.stopCount ?? orderedStops.length}</strong> paradas
          </span>
          {route.totalWeightKg != null && (
            <span><strong>{route.totalWeightKg.toFixed(0)} kg</strong> peso total</span>
          )}
          {route.estimatedReturnAt && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              retorno previsto {new Date(route.estimatedReturnAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {route.status === "DISPATCHED" && (
            <span className="flex items-center gap-1 text-green-600 font-semibold">
              <CheckCircle2 className="w-3 h-3" /> em rota
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-y border-red-200 px-4 py-2 text-xs text-red-700 flex items-start gap-2 print:hidden">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Manifest — sequência de paradas */}
      <ol className="divide-y divide-gray-100">
        {orderedStops.map((stop, idx) => {
          const meta = stopsMetaMap.get(stop.deliveryRequestId);
          return (
            <li key={`${stop.deliveryRequestId}-${idx}`} className="px-5 py-3 flex items-start gap-3 text-sm">
              <span className="w-7 h-7 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center flex-shrink-0 print:border print:border-black print:bg-white print:text-black">
                {stop.stopPosition ?? idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 truncate">
                  {meta?.invoiceNumber
                    ? `NF ${meta.invoiceNumber}`
                    : meta?.orderNumber
                      ? `PD ${meta.orderNumber}`
                      : `#${stop.deliveryRequestId.slice(-6)}`}
                  {meta && ` · ${meta.customerName}`}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {meta?.deliveryAddress ?? "—"}{meta?.deliveryCity ? ` — ${meta.deliveryCity}` : ""}
                </p>
                {meta?.customerPhone && (
                  <p className="text-[11px] text-gray-400">{meta.customerPhone}</p>
                )}
              </div>
              <div className="flex-shrink-0 text-right text-[11px] text-gray-500 space-y-0.5">
                {meta?.volumeBreakdown && Object.keys(meta.volumeBreakdown).length > 0 ? (
                  <p>{formatVolumeBreakdown(meta.volumeBreakdown)}</p>
                ) : meta?.totalLatas != null && meta.totalLatas > 0 ? (
                  <p>{meta.totalLatas} volumes</p>
                ) : null}
                {meta?.totalWeightKg != null && <p>{meta.totalWeightKg.toFixed(0)} kg</p>}
                {stop.eta && (
                  <p className={cn(
                    "flex items-center gap-1 justify-end",
                    "text-gray-700 font-medium",
                  )}>
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(stop.eta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

    </div>
  );
}
