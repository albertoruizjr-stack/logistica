"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Camera, Truck, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";

interface Props {
  routeId: string;
}

export default function IniciarRotaButton({ routeId }: Props) {
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [photo,      setPhoto]      = useState<File | null>(null);
  const [preparing,  setPreparing]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function handlePick(raw: File | null) {
    if (!raw) return;
    setError(null);
    setPreparing(true);
    try {
      setPhoto(await compressImage(raw));
    } catch {
      // Se a compressão falhar (HEIC sem suporte no canvas, p.ex.), usa o original.
      setPhoto(raw);
    } finally {
      setPreparing(false);
    }
  }

  async function handleStart() {
    if (!photo) {
      setError("Tire a foto do veículo carregado antes de iniciar.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("photo", photo);
      const res = await fetch(`/api/driver/rotas/${routeId}/iniciar`, {
        method: "POST",
        body:   fd,
      });
      const parsed = await safeReadJson(res);
      if (!res.ok || !parsed.success) {
        setError(parsed.error ?? friendlyHttpError(res.status));
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void handlePick(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      {photo && (
        <div className="rounded-lg border-2 border-green-300 bg-green-50 px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          <p className="text-[11px] text-gray-700 truncate flex-1">
            {photo.name} · {Math.round(photo.size / 1024)} KB
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={submitting}
            className="text-xs text-red-600 font-medium px-2 py-1 hover:bg-red-100 rounded disabled:opacity-50"
          >
            Trocar
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!photo ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={preparing}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white active:bg-blue-700 disabled:opacity-60"
        >
          {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          {preparing ? "Preparando foto…" : "Iniciar rota"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={submitting}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-colors",
            "bg-blue-600 text-white active:bg-blue-700 disabled:opacity-60",
          )}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
          {submitting ? "Iniciando…" : "Confirmar e iniciar rota"}
        </button>
      )}
    </div>
  );
}

async function safeReadJson(res: Response): Promise<{ success?: boolean; error?: string; [k: string]: unknown }> {
  const text = await res.text();
  if (!text) return { success: false };
  try {
    return JSON.parse(text);
  } catch {
    return { success: false };
  }
}

function friendlyHttpError(status: number): string {
  if (status === 413) return "Foto grande demais. Tire de novo — vamos comprimir.";
  if (status === 401) return "Sua sessão expirou. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para esta ação.";
  if (status === 404) return "Rota não encontrada.";
  if (status === 503) return "Serviço temporariamente indisponível. Tente novamente.";
  if (status >= 500)  return "Erro no servidor. Tente novamente em instantes.";
  return `Erro ${status}. Tente novamente.`;
}
