"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

interface OrphanDR {
  id:              string;
  invoiceNumber:   string | null;
  orderNumber:     string | null;
  customerName:    string;
  deliveryAddress: string;
}

interface Driver {
  id:   string;
  name: string;
  available: boolean;
}

interface Props {
  waveId:  string;
  orphans: OrphanDR[];
  drivers: Driver[];
}

// Quando o Spoke não consegue encaixar todas as DRs numa wave, sobram "órfãs"
// (DRs com status ROTEIRIZADO sem routeId). Esse banner permite re-tentar
// roteirização criando uma nova wave só com elas.
export default function ReRoteirizarBanner({ waveId, orphans, drivers }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(drivers.filter((d) => d.available).map((d) => d.id));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (orphans.length === 0) return null;

  function toggle(driverId: string) {
    setSelected((prev) => prev.includes(driverId) ? prev.filter((id) => id !== driverId) : [...prev, driverId]);
  }

  async function handleSubmit() {
    if (selected.length === 0) {
      setError("Selecione pelo menos 1 motorista");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/roteirizacao/waves/${waveId}/re-roteirizar`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ driverIds: selected }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao re-roteirizar");
        return;
      }
      router.push(`/roteirizacao/${json.data.waveId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 mt-0.5 text-amber-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-900 text-sm">
            {orphans.length} entrega{orphans.length > 1 ? "s" : ""} não couberam no roteiro
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            O otimizador não conseguiu encaixar essas entregas com os motoristas escolhidos.
            Crie uma nova wave para tentar novamente.
          </p>

          {!open ? (
            <button
              onClick={() => setOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Roteirizar novamente
            </button>
          ) : (
            <div className="mt-3 bg-white border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-700 mb-2">
                Entregas a re-roteirizar:
              </p>
              <ul className="text-xs text-gray-600 space-y-1 mb-3">
                {orphans.map((o) => (
                  <li key={o.id} className="truncate">
                    • {o.invoiceNumber ? `NF ${o.invoiceNumber}` : `PD ${o.orderNumber ?? o.id.slice(-6)}`}
                    {" — "}{o.customerName}
                  </li>
                ))}
              </ul>

              <p className="text-xs font-semibold text-gray-700 mb-2">
                Motoristas para a nova rota:
              </p>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {drivers.map((d) => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border cursor-pointer ${
                      selected.includes(d.id)
                        ? "border-amber-400 bg-amber-50 text-amber-900"
                        : "border-gray-200 bg-white text-gray-700"
                    } ${!d.available ? "opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggle(d.id)}
                      className="w-3.5 h-3.5"
                    />
                    <span className="truncate">{d.name}</span>
                    {!d.available && <span className="text-[10px]">(em rota)</span>}
                  </label>
                ))}
              </div>

              {error && (
                <p className="text-xs text-red-700 mb-2">{error}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Criar nova wave
                </button>
                <button
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
