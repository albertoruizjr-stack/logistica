"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, AlertTriangle, Loader2, User, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";

interface Props {
  transferId:  string;
  expectedQty: number;
  unit:        string;
}

export default function EntregaTransferActions({ transferId, expectedQty, unit }: Props) {
  const router = useRouter();
  const photoRef = useRef<HTMLInputElement>(null);

  const [photoFile, setPhotoFile]         = useState<File | null>(null);
  const [preparing, setPreparing]         = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [receivedQty, setReceivedQty]     = useState(String(expectedQty));
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  async function handlePick(raw: File | null) {
    if (!raw) return;
    setError(null);
    setPreparing(true);
    try {
      const compressed = await compressImage(raw);
      setPhotoFile(compressed);
    } catch {
      setPhotoFile(raw);
    } finally {
      setPreparing(false);
    }
  }

  const qtyNum = Number(receivedQty);
  const validQty = Number.isFinite(qtyNum) && qtyNum > 0;
  const canSubmit = Boolean(photoFile) && recipientName.trim().length > 0 && validQty;
  const isDivergence = validQty && qtyNum < expectedQty;

  async function handleConfirm() {
    if (!photoFile) { setError("Tire a foto da entrega"); return; }
    if (!recipientName.trim()) { setError("Informe quem recebeu"); return; }
    if (!validQty) { setError("Quantidade recebida inválida"); return; }

    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("photo", photoFile);
      fd.append("recipientName", recipientName.trim());
      fd.append("receivedQty", String(qtyNum));

      const res = await fetch(`/api/driver/transferencias/${transferId}/entregar`, {
        method: "POST",
        body:   fd,
      });
      const parsed = await safeReadJson(res);
      if (!res.ok || !parsed.success) {
        setError(parsed.error ?? friendlyHttpError(res.status));
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
      {/* Foto da entrega */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
          <Camera className="w-3 h-3" />
          Foto da entrega (obrigatória)
        </p>
        <div className={cn(
          "rounded-lg border-2 px-3 py-3 flex items-center gap-3 transition-colors",
          photoFile ? "border-green-300 bg-green-50" : "border-dashed border-gray-300 bg-gray-50",
        )}>
          <Camera className={cn("w-5 h-5 flex-shrink-0", photoFile ? "text-green-600" : "text-gray-400")} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Material entregue</p>
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

      {/* Recebedor */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-2">
        <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
          <User className="w-3 h-3" />
          Quem recebeu (obrigatório)
        </label>
        <input
          type="text"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          placeholder="Nome do funcionário da loja destino"
          disabled={submitting}
          className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-300 outline-none focus:border-orange-400 disabled:opacity-50"
        />
      </div>

      {/* Quantidade recebida */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-2">
        <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
          <Package className="w-3 h-3" />
          Quantidade recebida ({unit})
        </label>
        <input
          type="number"
          step="any"
          min="0"
          value={receivedQty}
          onChange={(e) => setReceivedQty(e.target.value)}
          disabled={submitting}
          className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-300 outline-none focus:border-orange-400 disabled:opacity-50"
        />
        <p className="text-[11px] text-gray-500">
          Esperado: {expectedQty} {unit}
        </p>
        {isDivergence && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded">
            ⚠ Quantidade menor que a esperada — será registrada como divergência.
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!canSubmit || submitting}
        className={cn(
          "w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-bold shadow-sm transition-colors",
          canSubmit
            ? "bg-green-500 text-white active:bg-green-600 disabled:opacity-60"
            : "bg-gray-200 text-gray-500",
        )}
      >
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
        {submitting ? "Enviando…" : "Confirmar entrega"}
      </button>
    </>
  );
}

async function safeReadJson(res: Response): Promise<{ success?: boolean; error?: string; data?: unknown; [k: string]: unknown }> {
  const text = await res.text();
  if (!text) return { success: false };
  try { return JSON.parse(text); } catch { return { success: false }; }
}

function friendlyHttpError(status: number): string {
  if (status === 413) return "Foto grande demais. Tire de novo — vamos comprimir.";
  if (status === 401) return "Sua sessão expirou. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para esta transferência.";
  if (status === 404) return "Transferência não encontrada.";
  if (status === 503) return "Serviço temporariamente indisponível. Tente novamente.";
  if (status >= 500)  return "Erro no servidor. Tente novamente em instantes.";
  return `Erro ${status}. Tente novamente.`;
}
