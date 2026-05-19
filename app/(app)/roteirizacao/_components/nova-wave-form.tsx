"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface EligibleRequest {
  id:               string;
  orderNumber:      string | null;
  invoiceNumber:    string | null;
  customerName:     string;
  deliveryAddress:  string;
  deliveryCity:     string | null;
  totalWeightKg:    number | null;
  totalLatas:       number | null;
}

interface AvailableDriver {
  id:           string;
  name:         string;
  vehicleType:  string | null;
  hasSpokeId:   boolean;
  hasEmail:     boolean;
}

interface WaveProgress {
  id:           string;
  status:       string;
  errorMessage: string | null;
  sentAt:       string | null;
  optimizedAt:  string | null;
  distributedAt: string | null;
}

interface Props {
  eligibleRequests: EligibleRequest[];
  availableDrivers: AvailableDriver[];
  suggestedName:    string;
}

const TERMINAL_STATUSES = new Set(["DISTRIBUTED", "DISPATCHED", "COMPLETED", "FAILED"]);

const STATUS_LABEL: Record<string, string> = {
  DRAFT:       "Criada (rascunho)",
  SENT:        "Enviada ao Spoke",
  OPTIMIZED:   "Otimizada",
  DISTRIBUTED: "Distribuída aos motoristas",
  DISPATCHED:  "Despachada",
  COMPLETED:   "Concluída",
  FAILED:      "Falhou",
};

export default function NovaWaveForm({
  eligibleRequests,
  availableDrivers,
  suggestedName,
}: Props) {
  const router = useRouter();
  const [name,       setName]       = useState(suggestedName);
  const [date,       setDate]       = useState(new Date().toISOString().slice(0, 10));
  const [reqIds,     setReqIds]     = useState<Set<string>>(new Set());
  const [drvIds,     setDrvIds]     = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [progress,   setProgress]   = useState<WaveProgress | null>(null);

  // Polling: enquanto progress não estiver terminal, chamar /advance a cada 3s
  useEffect(() => {
    if (!progress || TERMINAL_STATUSES.has(progress.status)) return;

    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/roteirizacao/waves/${progress.id}/advance`, { method: "POST" });
        const json = await res.json();
        if (json?.data) {
          setProgress({
            id:            json.data.id,
            status:        json.data.status,
            errorMessage:  json.data.errorMessage,
            sentAt:        json.data.sentAt,
            optimizedAt:   json.data.optimizedAt,
            distributedAt: json.data.distributedAt,
          });
        }
      } catch (e) {
        console.error("[wave/advance polling]", e);
      }
    }, 3000);

    return () => clearTimeout(id);
  }, [progress]);

  // Quando atinge terminal sucesso, refresh server data
  useEffect(() => {
    if (progress && progress.status === "DISTRIBUTED") {
      router.refresh();
    }
  }, [progress, router]);

  function toggleReq(id: string) {
    const next = new Set(reqIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setReqIds(next);
  }

  function toggleDrv(id: string) {
    const next = new Set(drvIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setDrvIds(next);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/roteirizacao/waves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          date:               new Date(date).toISOString(),
          deliveryRequestIds: Array.from(reqIds),
          driverIds:          Array.from(drvIds),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao criar wave");
        return;
      }
      // wave criada — dispara primeiro advance
      setProgress({
        id:            json.data.id,
        status:        json.data.status,
        errorMessage:  json.data.errorMessage,
        sentAt:        json.data.sentAt,
        optimizedAt:   json.data.optimizedAt,
        distributedAt: json.data.distributedAt,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setSubmitting(false);
    }
  }

  const driversBlocked = availableDrivers.filter((d) => !d.hasEmail);
  const canSubmit = reqIds.size > 0 && drvIds.size > 0 && name.trim().length > 0;

  // Wave em progresso → mostra apenas o painel de progresso
  if (progress) {
    return <WaveProgressPanel progress={progress} onReset={() => {
      setProgress(null);
      setReqIds(new Set());
      setDrvIds(new Set());
    }} />;
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nome da wave</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 outline-none focus:border-orange-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Data</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 outline-none focus:border-orange-400"
          />
        </div>
      </div>

      {/* Motoristas */}
      <div>
        <label className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700">
            Motoristas ({drvIds.size} de {availableDrivers.length})
          </span>
          {driversBlocked.length > 0 && (
            <span className="text-[10px] text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {driversBlocked.length} sem email — não selecionáveis
            </span>
          )}
        </label>
        {availableDrivers.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Nenhum motorista disponível.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {availableDrivers.map((d) => {
              const isSelected = drvIds.has(d.id);
              const isDisabled = !d.hasEmail;
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && toggleDrv(d.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors text-left",
                    isDisabled
                      ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                      : isSelected
                      ? "bg-orange-50 border-orange-300 text-orange-900"
                      : "bg-white border-gray-200 text-gray-700 hover:border-gray-300",
                  )}
                >
                  <span className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                    isSelected ? "bg-orange-500 border-orange-500" : "border-gray-300",
                  )}>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-[11px] text-gray-400 flex items-center gap-1">
                      {d.vehicleType ?? "—"}
                      {!d.hasSpokeId && <span className="text-blue-500">· será criado no Spoke</span>}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Entregas */}
      <div>
        <label className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700">
            Entregas elegíveis ({reqIds.size} de {eligibleRequests.length})
          </span>
          {eligibleRequests.length > 0 && (
            <button
              type="button"
              onClick={() => setReqIds(
                reqIds.size === eligibleRequests.length
                  ? new Set()
                  : new Set(eligibleRequests.map((r) => r.id)),
              )}
              className="text-[11px] text-orange-600 hover:underline font-medium"
            >
              {reqIds.size === eligibleRequests.length ? "Limpar" : "Selecionar todas"}
            </button>
          )}
        </label>
        {eligibleRequests.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Nenhuma solicitação em PRONTO_ROTEIRIZACAO.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg max-h-96 overflow-y-auto divide-y divide-gray-100">
            {eligibleRequests.map((r) => {
              const isSelected = reqIds.has(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleReq(r.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                    isSelected ? "bg-orange-50" : "bg-white hover:bg-gray-50",
                  )}
                >
                  <span className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                    isSelected ? "bg-orange-500 border-orange-500" : "border-gray-300",
                  )}>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {r.invoiceNumber
                        ? `NF ${r.invoiceNumber}`
                        : r.orderNumber
                          ? `PD ${r.orderNumber}`
                          : `#${r.id.slice(-6)}`} · {r.customerName}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {r.deliveryAddress}{r.deliveryCity && ` — ${r.deliveryCity}`}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right text-[11px] text-gray-400">
                    {r.totalLatas != null && <p>{r.totalLatas} latas</p>}
                    {r.totalWeightKg != null && <p>{r.totalWeightKg.toFixed(0)} kg</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Submit */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="flex items-center gap-2 bg-orange-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Criar wave e otimizar
        </button>
      </div>
    </div>
  );
}

function WaveProgressPanel({ progress, onReset }: { progress: WaveProgress; onReset: () => void }) {
  const isFailed = progress.status === "FAILED";
  const isDone   = progress.status === "DISTRIBUTED" || progress.status === "DISPATCHED" || progress.status === "COMPLETED";

  const steps = [
    { key: "DRAFT",       label: "Criada",        done: true },
    { key: "SENT",        label: "Enviada",       done: Boolean(progress.sentAt) },
    { key: "OPTIMIZED",   label: "Otimizada",     done: Boolean(progress.optimizedAt) },
    { key: "DISTRIBUTED", label: "Distribuída",   done: Boolean(progress.distributedAt) },
  ];

  return (
    <div className="space-y-5">
      <div className={cn(
        "rounded-xl p-4 border",
        isFailed ? "bg-red-50 border-red-200" : isDone ? "bg-green-50 border-green-200" : "bg-blue-50 border-blue-200",
      )}>
        <div className="flex items-center gap-3 mb-3">
          {isFailed ? (
            <AlertTriangle className="w-5 h-5 text-red-600" />
          ) : isDone ? (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          ) : (
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          )}
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {STATUS_LABEL[progress.status] ?? progress.status}
            </p>
            {progress.errorMessage && (
              <p className="text-xs text-red-700 mt-0.5">{progress.errorMessage}</p>
            )}
          </div>
        </div>

        <ol className="space-y-1.5">
          {steps.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              <span className={cn(
                "w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0",
                s.done ? "bg-green-500 border-green-500" : "bg-white border-gray-300",
              )}>
                {s.done && <CheckCircle2 className="w-3 h-3 text-white" />}
              </span>
              <span className={s.done ? "text-gray-900" : "text-gray-400"}>{s.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          {isDone ? "Criar nova wave" : isFailed ? "Tentar de novo" : "Voltar"}
        </button>
      </div>
    </div>
  );
}
