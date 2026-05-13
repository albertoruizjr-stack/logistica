"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2 } from "lucide-react";

interface Props {
  waveId:   string;
  waveName: string;
}

// Botão "X" vermelho que aparece sobre o card da wave. Recusa servidor se DISPATCHED/COMPLETED.
export default function DeleteWaveButton({ waveId, waveName }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Excluir a wave "${waveName}"? As entregas vinculadas voltam para "Pronto para roteirização".`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/roteirizacao/waves/${waveId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        alert(json.error ?? "Erro ao excluir wave");
        return;
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      title="Excluir wave"
      className="flex items-center justify-center w-5 h-5 rounded text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors disabled:opacity-40"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3.5 h-3.5" />}
    </button>
  );
}
