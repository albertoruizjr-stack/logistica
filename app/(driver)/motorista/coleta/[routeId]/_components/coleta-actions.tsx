"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, AlertTriangle, Loader2, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";

interface TransferRow {
  id:        string;
  doc:       string;   // "TE 123" | "NF 456" | "#abc123"
  itemCount: number;
}

interface Props {
  routeId:      string;
  transfers:    TransferRow[];
  requirePhoto?: boolean;
}

export default function ColetaActions({ routeId, transfers, requirePhoto = true }: Props) {
  const router = useRouter();
  const photoRef = useRef<HTMLInputElement>(null);

  // Todas marcadas por padrão.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(transfers.map((t) => t.id)));
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handlePick(raw: File | null) {
    if (!raw) return;
    setError(null);
    setPreparing(true);
    try {
      const compressed = await compressImage(raw);
      setPhotoFile(compressed);
    } catch {
      // compressão falhou (ex: HEIC) → usa original; server valida 10 MB.
      setPhotoFile(raw);
    } finally {
      setPreparing(false);
    }
  }

  const selectedCount = selected.size;
  const hasPhoto = Boolean(photoFile);
  const canSubmit = selectedCount > 0 && (requirePhoto ? hasPhoto : true);

  async function handleConfirm() {
    if (selectedCount === 0) {
      setError("Selecione ao menos uma transferência");
      return;
    }
    if (requirePhoto && !hasPhoto) {
      setError("Tire a foto da coleta antes de confirmar");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("transferIds", JSON.stringify(Array.from(selected)));
      if (photoFile) fd.append("photo", photoFile);

      const res = await fetch("/api/driver/coletas", { method: "POST", body: fd });
      const parsed = await safeReadJson(res);

      if (!res.ok || !parsed.success) {
        setError(parsed.error ?? friendlyHttpError(res.status));
        return;
      }

      // Resultado parcial: alguma falhou (ex: sem documento TE/NF).
      const data = (parsed.data ?? {}) as { collected?: string[]; failed?: { id: string; reason: string }[] };
      const failed = data.failed ?? [];
      if (failed.length > 0) {
        const docById = new Map(transfers.map((t) => [t.id, t.doc]));
        const lines = failed.map((f) => `${docById.get(f.id) ?? f.id}: ${f.reason}`);
        setError(`Algumas não foram coletadas:\n${lines.join("\n")}`);
        // Mesmo com falha parcial, atualiza a tela pra refletir as que deram certo.
        router.refresh();
        return;
      }

      router.push("/motorista");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Lista de transferências com checkbox */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
          <Package className="w-3 h-3" />
          Transferências pra coletar
        </p>
        {transfers.map((t) => {
          const checked = selected.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              className={cn(
                "w-full rounded-lg border-2 px-3 py-3 flex items-center gap-3 text-left transition-colors",
                checked ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-gray-50",
              )}
            >
              <span
                className={cn(
                  "w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2",
                  checked ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 bg-white",
                )}
              >
                {checked && <CheckCircle2 className="w-4 h-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{t.doc}</p>
                <p className="text-xs text-gray-600">{t.itemCount} {t.itemCount === 1 ? "item" : "itens"}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Foto da coleta (uma só) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
          <Camera className="w-3 h-3" />
          {requirePhoto ? "Foto da coleta (obrigatória)" : "Foto da coleta (opcional)"}
        </p>

        <div className={cn(
          "rounded-lg border-2 px-3 py-3 flex items-center gap-3 transition-colors",
          photoFile ? "border-green-300 bg-green-50" : "border-dashed border-gray-300 bg-gray-50",
        )}>
          <Camera className={cn("w-5 h-5 flex-shrink-0", photoFile ? "text-green-600" : "text-gray-400")} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Material coletado</p>
            {preparing && (
              <p className="text-[11px] text-gray-600 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Preparando foto…
              </p>
            )}
            {!preparing && photoFile && (
              <p className="text-[11px] text-gray-600 truncate">{photoFile.name} · {Math.round(photoFile.size / 1024)} KB</p>
            )}
            {!preparing && !photoFile && (
              <p className="text-[11px] text-gray-500">Toque pra abrir a câmera</p>
            )}
          </div>
          {preparing ? null : photoFile ? (
            <button
              type="button"
              onClick={() => setPhotoFile(null)}
              className="text-xs text-red-600 font-medium px-2 py-1 hover:bg-red-100 rounded"
            >
              Trocar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              className="text-xs font-semibold text-orange-600 bg-orange-50 px-3 py-2 rounded-lg active:bg-orange-100"
            >
              <Camera className="w-3.5 h-3.5 inline-block mr-1" />
              Tirar foto
            </button>
          )}
        </div>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handlePick(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      {/* Confirmar coleta */}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={!canSubmit || submitting}
        className={cn(
          "w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-bold shadow-sm transition-colors",
          canSubmit
            ? "bg-indigo-600 text-white active:bg-indigo-700 disabled:opacity-60"
            : "bg-gray-200 text-gray-500",
        )}
      >
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
        {submitting ? "Enviando…" : `Confirmar coleta (${selectedCount})`}
      </button>
    </>
  );
}

async function safeReadJson(res: Response): Promise<{ success?: boolean; error?: string; data?: unknown; [k: string]: unknown }> {
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
  if (status === 404) return "Coleta não encontrada.";
  if (status === 503) return "Serviço temporariamente indisponível. Tente novamente.";
  if (status >= 500)  return "Erro no servidor. Tente novamente em instantes.";
  return `Erro ${status}. Tente novamente.`;
}
