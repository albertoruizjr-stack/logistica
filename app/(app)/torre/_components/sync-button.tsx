"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/torre/sync", { method: "POST", body: "{}" });
      const data = await res.json();
      if (data.skipped) {
        setResult("Sync em andamento, aguarde.");
      } else if (data.storesProcessed !== undefined) {
        setResult(`${data.storesProcessed} loja(s) processada(s)`);
        router.refresh();
      } else {
        setResult(data.error ?? "Erro desconhecido");
      }
    } catch {
      setResult("Falha na conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span className="text-[11px]" style={{ color: "#A3A3A3" }}>
          {result}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all disabled:opacity-50"
        style={{
          backgroundColor: loading ? "#F4F4F4" : "#111111",
          color: loading ? "#A3A3A3" : "white",
        }}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Sincronizando…" : "Atualizar agora"}
      </button>
    </div>
  );
}
