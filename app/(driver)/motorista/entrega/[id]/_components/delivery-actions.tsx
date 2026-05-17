"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, AlertTriangle, Loader2, X, FileSignature, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";

interface ExistingProof {
  id:        string;
  type:      "RECEIPT" | "MATERIAL" | "OCCURRENCE";
  photoUrl:  string;
  createdAt: string;
}

interface Props {
  deliveryRequestId: string;
  existingProofs:    ExistingProof[];
}

export default function DeliveryActions({ deliveryRequestId, existingProofs }: Props) {
  const router = useRouter();
  const receiptRef  = useRef<HTMLInputElement>(null);
  const materialRef = useRef<HTMLInputElement>(null);

  const [receiptFile,  setReceiptFile]  = useState<File | null>(null);
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [preparing,    setPreparing]    = useState<"receipt" | "material" | null>(null);

  async function handlePick(slot: "receipt" | "material", raw: File | null) {
    if (!raw) return;
    setError(null);
    setPreparing(slot);
    try {
      const compressed = await compressImage(raw);
      if (slot === "receipt")  setReceiptFile(compressed);
      else                     setMaterialFile(compressed);
    } catch {
      // Se a compressão falhar (HEIC sem suporte no canvas, p.ex.), usa o arquivo original.
      // Server ainda valida 10 MB e devolve erro tratado.
      if (slot === "receipt")  setReceiptFile(raw);
      else                     setMaterialFile(raw);
    } finally {
      setPreparing(null);
    }
  }

  const [occurrenceOpen, setOccurrenceOpen] = useState(false);
  const [occurrenceType, setOccurrenceType] = useState("");
  const [occurrenceNotes, setOccurrenceNotes] = useState("");
  const [occurrenceLoading, setOccurrenceLoading] = useState(false);

  const hasReceipt  = existingProofs.some((p) => p.type === "RECEIPT")  || Boolean(receiptFile);
  const hasMaterial = existingProofs.some((p) => p.type === "MATERIAL") || Boolean(materialFile);
  const canDeliver  = hasReceipt && hasMaterial;

  async function handleDeliver() {
    if (!canDeliver) {
      setError("Faltam fotos: canhoto e material são obrigatórios");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      if (receiptFile)  fd.append("receipt",  receiptFile);
      if (materialFile) fd.append("material", materialFile);
      const res = await fetch(`/api/driver/entregas/${deliveryRequestId}/concluir`, {
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

  async function handleOccurrence() {
    if (!occurrenceType || occurrenceNotes.trim().length < 10) {
      setError("Selecione um motivo e descreva (mín 10 caracteres)");
      return;
    }
    setOccurrenceLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/driver/entregas/${deliveryRequestId}/ocorrencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: occurrenceType, notes: occurrenceNotes.trim() }),
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
      setOccurrenceLoading(false);
    }
  }

  return (
    <>
      {/* Upload de fotos */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
          <Camera className="w-3 h-3" />
          Comprovantes obrigatórios
        </p>

        <PhotoSlot
          label="Canhoto assinado"
          icon={FileSignature}
          file={receiptFile}
          preparing={preparing === "receipt"}
          existing={existingProofs.find((p) => p.type === "RECEIPT")}
          onPick={() => receiptRef.current?.click()}
          onClear={() => setReceiptFile(null)}
        />
        <input
          ref={receiptRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handlePick("receipt", e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />

        <PhotoSlot
          label="Material na obra"
          icon={Package}
          file={materialFile}
          preparing={preparing === "material"}
          existing={existingProofs.find((p) => p.type === "MATERIAL")}
          onPick={() => materialRef.current?.click()}
          onClear={() => setMaterialFile(null)}
        />
        <input
          ref={materialRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handlePick("material", e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Botão Entregue */}
      <button
        type="button"
        onClick={handleDeliver}
        disabled={!canDeliver || submitting}
        className={cn(
          "w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-bold shadow-sm transition-colors",
          canDeliver
            ? "bg-green-500 text-white active:bg-green-600 disabled:opacity-60"
            : "bg-gray-200 text-gray-500"
        )}
      >
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
        {submitting ? "Enviando…" : "Marcar como entregue"}
      </button>

      {/* Botão Ocorrência */}
      <button
        type="button"
        onClick={() => setOccurrenceOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border-2 border-red-200 text-red-600 active:bg-red-50"
      >
        <AlertTriangle className="w-4 h-4" />
        Registrar ocorrência
      </button>

      {/* Modal Ocorrência */}
      {occurrenceOpen && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/60" onClick={() => !occurrenceLoading && setOccurrenceOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[81] bg-white rounded-t-2xl shadow-2xl pointer-events-auto max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 px-5 py-4 border-b border-gray-100 bg-white flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">Registrar ocorrência</h2>
                <p className="text-xs text-gray-500 mt-0.5">Não foi possível entregar — informe o motivo</p>
              </div>
              <button
                onClick={() => setOccurrenceOpen(false)}
                disabled={occurrenceLoading}
                className="text-gray-400 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-[11.5px] font-semibold text-gray-700 mb-2">Motivo</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "AUSENTE",         label: "Ausente" },
                    { value: "RECUSA_ENTREGA",  label: "Recusou entrega" },
                    { value: "ENDERECO_ERRADO", label: "Endereço errado" },
                    { value: "AVARIA",          label: "Material avariado" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setOccurrenceType(opt.value)}
                      className={cn(
                        "px-3 py-3 rounded-lg text-sm font-medium border transition-colors",
                        occurrenceType === opt.value
                          ? "bg-red-50 border-red-300 text-red-700"
                          : "bg-white border-gray-200 text-gray-700"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] font-semibold text-gray-700 mb-2">Descrição</label>
                <textarea
                  value={occurrenceNotes}
                  onChange={(e) => setOccurrenceNotes(e.target.value)}
                  placeholder="Descreva o ocorrido em detalhe (mín 10 caracteres)"
                  rows={4}
                  disabled={occurrenceLoading}
                  className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 outline-none focus:border-red-400 disabled:opacity-50"
                />
                <p className="text-[10px] text-gray-400 mt-1">{occurrenceNotes.trim().length}/10</p>
              </div>
            </div>

            <div className="sticky bottom-0 px-5 py-3 border-t border-gray-100 bg-gray-50 flex gap-2">
              <button
                onClick={() => setOccurrenceOpen(false)}
                disabled={occurrenceLoading}
                className="flex-1 px-4 py-3 rounded-lg text-sm font-medium text-gray-700 bg-white border border-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleOccurrence}
                disabled={occurrenceLoading || !occurrenceType || occurrenceNotes.trim().length < 10}
                className="flex-1 px-4 py-3 rounded-lg text-sm font-semibold bg-red-500 text-white active:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {occurrenceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                Registrar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function PhotoSlot({
  label,
  icon: Icon,
  file,
  preparing,
  existing,
  onPick,
  onClear,
}: {
  label:     string;
  icon:      React.ComponentType<{ className?: string }>;
  file:      File | null;
  preparing: boolean;
  existing?: ExistingProof;
  onPick:    () => void;
  onClear:   () => void;
}) {
  const isOk = Boolean(file || existing);

  return (
    <div className={cn(
      "rounded-lg border-2 px-3 py-3 flex items-center gap-3 transition-colors",
      isOk ? "border-green-300 bg-green-50" : "border-dashed border-gray-300 bg-gray-50"
    )}>
      <Icon className={cn("w-5 h-5 flex-shrink-0", isOk ? "text-green-600" : "text-gray-400")} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        {preparing && (
          <p className="text-[11px] text-gray-600 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Preparando foto…
          </p>
        )}
        {!preparing && existing && !file && (
          <p className="text-[11px] text-gray-600">enviada {new Date(existing.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        )}
        {!preparing && file && (
          <p className="text-[11px] text-gray-600 truncate">{file.name} · {Math.round(file.size / 1024)} KB</p>
        )}
        {!preparing && !isOk && (
          <p className="text-[11px] text-gray-500">Toque pra abrir a câmera</p>
        )}
      </div>
      {preparing ? null : file ? (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-red-600 font-medium px-2 py-1 hover:bg-red-100 rounded"
        >
          Trocar
        </button>
      ) : !existing ? (
        <button
          type="button"
          onClick={onPick}
          className="text-xs font-semibold text-orange-600 bg-orange-50 px-3 py-2 rounded-lg active:bg-orange-100"
        >
          <Camera className="w-3.5 h-3.5 inline-block mr-1" />
          Tirar foto
        </button>
      ) : (
        <CheckCircle2 className="w-5 h-5 text-green-600" />
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
    // Server retornou texto/HTML (ex: 413 da Vercel "Request Entity Too Large").
    // Devolve um objeto com error vazio — o caller cai no friendlyHttpError(status).
    return { success: false };
  }
}

function friendlyHttpError(status: number): string {
  if (status === 413) return "Foto grande demais. Tire de novo — vamos comprimir.";
  if (status === 401) return "Sua sessão expirou. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para esta ação.";
  if (status === 404) return "Entrega não encontrada.";
  if (status === 503) return "Serviço temporariamente indisponível. Tente novamente.";
  if (status >= 500)  return "Erro no servidor. Tente novamente em instantes.";
  return `Erro ${status}. Tente novamente.`;
}
