"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, AlertTriangle, CheckCircle2, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatVolumeBreakdown } from "@/services/citel-stock.service";
import { LalamoveCallModal } from "./lalamove-call-modal";

interface EligibleRequest {
  id:               string;
  orderNumber:      string | null;
  invoiceNumber:    string | null;
  customerName:     string;
  deliveryAddress:  string;
  deliveryCity:     string | null;
  totalWeightKg:    number | null;
  totalLatas:       number | null;
  volumeBreakdown:  Record<string, number> | null;
}

interface AvailableDriver {
  id:           string;
  name:         string;
  vehicleType:  string | null;
  // Capacidade efetiva em kg. Já vem resolvida (maxLoadKg do banco ou default por tipo).
  maxLoadKg:    number;
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
  // Quando peso total excede capacidade, operador precisa marcar pra liberar.
  const [bypassCapacity, setBypassCapacity] = useState(false);
  // Entrega-alvo do modal Lalamove (chamada avulsa por entrega).
  const [lalaTarget, setLalaTarget] = useState<EligibleRequest | null>(null);

  // Capacidade selecionada × peso total das DRs selecionadas
  const totalWeightKg = Array.from(reqIds).reduce((acc, id) => {
    const r = eligibleRequests.find((x) => x.id === id);
    return acc + (r?.totalWeightKg ?? 0);
  }, 0);
  const totalCapacityKg = Array.from(drvIds).reduce((acc, id) => {
    const d = availableDrivers.find((x) => x.id === id);
    return acc + (d?.maxLoadKg ?? 0);
  }, 0);
  const exceedsCapacity = drvIds.size > 0 && totalWeightKg > totalCapacityKg;
  const excessKg = exceedsCapacity ? Math.round((totalWeightKg - totalCapacityKg) * 10) / 10 : 0;

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
          date:                new Date(date).toISOString(),
          deliveryRequestIds:  Array.from(reqIds),
          driverIds:           Array.from(drvIds),
          bypassCapacityCheck: exceedsCapacity ? bypassCapacity : undefined,
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
  // Bloqueia submit quando peso excede capacidade — exceto se operador marcou "liberar".
  const canSubmit =
    reqIds.size > 0 &&
    drvIds.size > 0 &&
    name.trim().length > 0 &&
    (!exceedsCapacity || bypassCapacity);

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
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleReq(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (e.key === " ") e.preventDefault();
                      toggleReq(r.id);
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer",
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
                    {r.volumeBreakdown && Object.keys(r.volumeBreakdown).length > 0 ? (
                      <p>{formatVolumeBreakdown(r.volumeBreakdown)}</p>
                    ) : r.totalLatas && r.totalLatas > 0 ? (
                      <p>{r.totalLatas} volumes</p>
                    ) : null}
                    {r.totalWeightKg != null && <p>{r.totalWeightKg.toFixed(0)} kg</p>}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLalaTarget(r);
                    }}
                    className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-[11px] font-medium text-gray-500 hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                  >
                    <Truck className="w-3 h-3" />
                    Lalamove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resumo de capacidade — só aparece quando há motoristas selecionados */}
      {drvIds.size > 0 && (
        <div className={cn(
          "rounded-lg px-3 py-2.5 text-sm border",
          exceedsCapacity
            ? "bg-amber-50 border-amber-300 text-amber-900"
            : "bg-gray-50 border-gray-200 text-gray-700"
        )}>
          <div className="flex items-center gap-2 mb-1">
            {exceedsCapacity
              ? <AlertTriangle className="w-4 h-4 text-amber-600" />
              : <CheckCircle2 className="w-4 h-4 text-gray-500" />}
            <p className="font-semibold text-xs">
              {exceedsCapacity
                ? `Carga excede capacidade dos motoristas em ${excessKg.toFixed(1)} kg`
                : "Carga dentro da capacidade"}
            </p>
          </div>
          <p className="text-[11px] ml-6">
            Peso total: <strong>{totalWeightKg.toFixed(1)} kg</strong>
            {" "}· Capacidade selecionada: <strong>{totalCapacityKg.toFixed(0)} kg</strong>
            {" "}({Array.from(drvIds).map((id) => {
              const d = availableDrivers.find((x) => x.id === id);
              return d ? `${d.name.split(" ")[0]} ${d.maxLoadKg}kg` : "";
            }).filter(Boolean).join(" + ")})
          </p>

          {exceedsCapacity && (
            <div className="mt-2 pt-2 border-t border-amber-200 space-y-1.5">
              <p className="text-[11px] ml-6">
                Adicione outro motorista ou remova entregas pra resolver — ou:
              </p>
              <label className="flex items-start gap-2 ml-6 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bypassCapacity}
                  onChange={(e) => setBypassCapacity(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 accent-amber-600"
                />
                <span className="text-[11px]">
                  <strong>Liberar mesmo assim</strong> — assumo a responsabilidade de exceder a capacidade.
                </span>
              </label>
            </div>
          )}
        </div>
      )}

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

      {/* Modal Lalamove — chamada avulsa por entrega */}
      {lalaTarget && (
        <LalamoveCallModal
          delivery={{
            id: lalaTarget.id,
            label: `${
              lalaTarget.invoiceNumber
                ? `NF ${lalaTarget.invoiceNumber}`
                : lalaTarget.orderNumber
                  ? `PD ${lalaTarget.orderNumber}`
                  : `#${lalaTarget.id.slice(-6)}`
            } · ${lalaTarget.customerName}`,
            address: `${lalaTarget.deliveryAddress}${lalaTarget.deliveryCity ? ` — ${lalaTarget.deliveryCity}` : ""}`,
          }}
          onClose={() => setLalaTarget(null)}
        />
      )}
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
