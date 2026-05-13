"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncResult {
  spokeDriversTotal:      number;
  spokeActive:            number;
  created:                number;
  updated:                number;
  placeholdersDeleted:    number;
  placeholdersDeactivated: number;
}

export default function SyncDriversButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<SyncResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/roteirizacao/drivers/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao sincronizar");
        return;
      }
      setResult(json.data);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSync}
        disabled={loading}
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors",
          loading
            ? "border-gray-200 text-gray-400 cursor-wait"
            : "border-orange-200 text-orange-700 hover:bg-orange-50",
        )}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Sincronizar motoristas do Spoke
      </button>
      {result && (
        <p className="text-[10px] text-green-700 flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" />
          {result.created} criado{result.created !== 1 ? "s" : ""}, {result.updated} atualizado{result.updated !== 1 ? "s" : ""}
          {result.placeholdersDeleted > 0 && `, ${result.placeholdersDeleted} placeholder${result.placeholdersDeleted > 1 ? "s" : ""} removido${result.placeholdersDeleted > 1 ? "s" : ""}`}
          {result.placeholdersDeactivated > 0 && `, ${result.placeholdersDeactivated} desativado${result.placeholdersDeactivated > 1 ? "s" : ""}`}
        </p>
      )}
      {error && (
        <p className="text-[10px] text-red-600 flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5" />
          {error}
        </p>
      )}
    </div>
  );
}
