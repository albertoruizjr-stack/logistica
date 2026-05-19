"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X, Store, MapPin } from "lucide-react";

interface StoreOption {
  id:   string;
  code: string;
  name: string;
}

interface Props {
  routeId: string;
  stores:  StoreOption[];
  // Quando há paradas, mostra dropdown "inserir antes da parada X". Default: ao final.
  totalStops: number;
}

export default function AddExtraStopButton({ routeId, stores, totalStops }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"STORE_VISIT" | "EXTRA_STOP">("STORE_VISIT");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [insertAt, setInsertAt] = useState<number | null>(null);  // null = final
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKind("STORE_VISIT");
    setStoreId(stores[0]?.id ?? "");
    setAddress("");
    setNotes("");
    setInsertAt(null);
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (kind === "STORE_VISIT" && !storeId) return setError("Selecione uma loja");
    if (kind === "EXTRA_STOP"  && address.trim().length < 5) return setError("Informe o endereço");

    setSubmitting(true);
    try {
      const res = await fetch(`/api/roteirizacao/routes/${routeId}/extra-stop`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          storeId: kind === "STORE_VISIT" ? storeId : undefined,
          address: kind === "EXTRA_STOP"  ? address.trim() : undefined,
          notes:   notes.trim() || undefined,
          insertAtPosition: insertAt ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao adicionar parada");
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 px-2 py-1 rounded hover:bg-orange-50"
      >
        <Plus className="w-3.5 h-3.5" /> Adicionar parada
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={() => !submitting && setOpen(false)} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-xl shadow-2xl p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Adicionar parada extra</h3>
            <p className="text-xs text-gray-500 mt-0.5">Inclui uma escala fora da lista de entregas.</p>
          </div>
          <button onClick={() => setOpen(false)} disabled={submitting} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind("STORE_VISIT")}
              className={`px-3 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                kind === "STORE_VISIT" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-gray-200 bg-white"
              }`}
            >
              <Store className="w-3.5 h-3.5" /> Loja
            </button>
            <button
              type="button"
              onClick={() => setKind("EXTRA_STOP")}
              className={`px-3 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                kind === "EXTRA_STOP" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-gray-200 bg-white"
              }`}
            >
              <MapPin className="w-3.5 h-3.5" /> Endereço livre
            </button>
          </div>

          {kind === "STORE_VISIT" ? (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Qual loja</label>
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Endereço</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
                placeholder="Rua, número, bairro, cidade"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Observação (opcional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='Ex: "Buscar tinta acrílica branca 18L"'
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          {totalStops > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Posição na rota</label>
              <select
                value={insertAt ?? ""}
                onChange={(e) => setInsertAt(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">Adicionar ao final (após última parada)</option>
                {Array.from({ length: totalStops }, (_, i) => i + 1).map((pos) => (
                  <option key={pos} value={pos}>Inserir antes da parada #{pos}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-700">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg disabled:opacity-60 flex items-center justify-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Adicionar
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="px-3 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
