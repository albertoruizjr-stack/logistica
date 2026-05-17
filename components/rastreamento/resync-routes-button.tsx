"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

type Feedback =
  | { kind: "ok";    closed: number; scanned: number }
  | { kind: "error"; message: string };

// Permite ao operador disparar manualmente o fechamento de rotas órfãs
// (rotas DISPATCHED cujas DRs já foram todas finalizadas mas a rota não fechou).
// Necessário apenas para corrigir rotas criadas ANTES do fix automático.
export default function ResyncRoutesButton() {
  const router = useRouter();
  const [loading,  setLoading]  = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function handleClick() {
    setLoading(true);
    setFeedback(null);
    try {
      const res  = await fetch("/api/admin/routes/resync-completion", { method: "POST" });
      const text = await res.text();
      let json: { success?: boolean; error?: string; data?: { closed?: number; scanned?: number } } = {};
      try { json = JSON.parse(text); } catch { /* resposta não-JSON cai pro erro genérico */ }

      if (!res.ok || !json.success) {
        setFeedback({ kind: "error", message: json.error ?? `HTTP ${res.status}` });
        return;
      }

      setFeedback({
        kind:    "ok",
        closed:  json.data?.closed  ?? 0,
        scanned: json.data?.scanned ?? 0,
      });
      router.refresh(); // re-renderiza tela com motoristas liberados
    } catch (e) {
      setFeedback({ kind: "error", message: e instanceof Error ? e.message : "Erro de rede" });
    } finally {
      setLoading(false);
      // limpa o feedback depois de 6s pra não ficar acumulando
      window.setTimeout(() => setFeedback(null), 6_000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        title="Fecha rotas DISPATCHED cujas entregas já foram todas concluídas e libera o motorista"
        className="flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-60"
      >
        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <RefreshCw className="w-3.5 h-3.5" />}
        Sincronizar rotas
      </button>

      {feedback?.kind === "ok" && (
        <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {feedback.closed === 0
            ? "Tudo em dia — nenhuma rota para fechar"
            : `${feedback.closed} rota${feedback.closed > 1 ? "s" : ""} fechada${feedback.closed > 1 ? "s" : ""}`}
        </span>
      )}
      {feedback?.kind === "error" && (
        <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          {feedback.message}
        </span>
      )}
    </div>
  );
}
