"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, AlertTriangle, CheckCircle2, Truck, PackageCheck, X, ArrowRight, Zap, Calendar, Store } from "lucide-react";
import { cn, calculateHaversineDistance } from "@/lib/utils";
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
  // selos de classificação (calculados no server)
  appUrgent:          boolean;
  todayUrgent:        boolean;
  scheduledDateLabel: string | null;
  isFutureScheduled:  boolean;
  originStoreCode:    string | null;
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

// Transferência disponível para coleta (renderizada como item na roteirização).
interface EligibleCollection {
  id:            string;
  doc:           string;   // "TE 123" | "NF 456" | "#abc123"
  fromStoreId:   string;
  fromStoreCode: string;
  fromStoreName: string;
  fromLat:       number | null;
  fromLng:       number | null;
  toStoreCode:   string;
  itemCount:     number;
}

// Rota candidata para o seletor "Incluir na rota".
interface CandidateRoute {
  id:         string;
  name:       string;
  status:     string;
  driverName: string;
  stopCount:  number;
  // Coords das paradas (entregas + loja do motorista como fallback) — base da recomendação.
  stopCoords: { lat: number; lng: number }[];
}

interface Props {
  eligibleRequests:   EligibleRequest[];
  availableDrivers:   AvailableDriver[];
  suggestedName:      string;
  eligibleCollections?: EligibleCollection[];
  candidateRoutes?:     CandidateRoute[];
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
  eligibleCollections = [],
  candidateRoutes = [],
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
  // Seleção de coletas de transferência — independente da seleção de entregas.
  const [collectionIds, setCollectionIds] = useState<Set<string>>(new Set());
  // Modal "Incluir na rota".
  const [includeOpen, setIncludeOpen] = useState(false);

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

  // Entregas de hoje (não-futuras) — base do "Selecionar de hoje".
  const todayIds = eligibleRequests.filter((r) => !r.isFutureScheduled).map((r) => r.id);
  const allTodaySelected = todayIds.length > 0 && todayIds.every((id) => reqIds.has(id));
  const urgentCount = eligibleRequests.filter(
    (r) => (r.appUrgent || r.todayUrgent) && !r.isFutureScheduled,
  ).length;
  const scheduledCount = eligibleRequests.filter((r) => r.isFutureScheduled).length;

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

  function toggleCollection(id: string) {
    const next = new Set(collectionIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setCollectionIds(next);
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

  // Coletas selecionadas (objetos).
  const selectedCollections = useMemo(
    () => eligibleCollections.filter((c) => collectionIds.has(c.id)),
    [eligibleCollections, collectionIds],
  );

  // Recomendação: rota cuja parada mais próxima está mais perto das lojas de origem
  // das coletas selecionadas. Usa o menor Haversine entre cada origem e cada parada.
  // Se faltarem coords (origem ou paradas), não recomenda (todas selecionáveis).
  const recommendedRouteId = useMemo<string | null>(() => {
    const origins = selectedCollections
      .filter((c) => c.fromLat != null && c.fromLng != null)
      .map((c) => ({ lat: c.fromLat as number, lng: c.fromLng as number }));
    if (origins.length === 0) return null;

    let best: { routeId: string; dist: number } | null = null;
    for (const route of candidateRoutes) {
      if (route.stopCoords.length === 0) continue;
      // Menor distância de qualquer origem a qualquer parada desta rota.
      let routeMin = Infinity;
      for (const o of origins) {
        for (const s of route.stopCoords) {
          const d = calculateHaversineDistance(o.lat, o.lng, s.lat, s.lng);
          if (d < routeMin) routeMin = d;
        }
      }
      if (routeMin < Infinity && (best === null || routeMin < best.dist)) {
        best = { routeId: route.id, dist: routeMin };
      }
    }
    return best?.routeId ?? null;
  }, [selectedCollections, candidateRoutes]);

  async function handleInclude(routeId: string) {
    const res = await fetch("/api/roteirizacao/incluir-coleta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transferIds: Array.from(collectionIds),
        routeId,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? "Erro ao incluir coleta na rota");
    }
    // Sucesso: coletas saem da lista (agora estão numa rota) — recarrega dados do server.
    setCollectionIds(new Set());
    setIncludeOpen(false);
    router.refresh();
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
            {urgentCount > 0 && <span className="text-red-600"> · {urgentCount} urgentes</span>}
            {scheduledCount > 0 && <span className="text-violet-600"> · {scheduledCount} agendadas</span>}
          </span>
          {todayIds.length > 0 && (
            <button
              type="button"
              onClick={() => setReqIds(allTodaySelected ? new Set() : new Set(todayIds))}
              className="text-[11px] text-orange-600 hover:underline font-medium"
            >
              {allTodaySelected ? "Limpar" : `Selecionar de hoje (${todayIds.length})`}
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
                    <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                      <span className="flex-shrink-0">
                        {r.invoiceNumber
                          ? `NF ${r.invoiceNumber}`
                          : r.orderNumber
                            ? `PD ${r.orderNumber}`
                            : `#${r.id.slice(-6)}`}
                      </span>
                      <DeliveryBadges r={r} />
                      <span className="text-gray-400 font-normal flex-shrink-0">·</span>
                      <span className="truncate">{r.customerName}</span>
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
        {eligibleRequests.length > 0 && (
          <p className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-0.5"><Zap className="w-2.5 h-2.5 text-amber-500" /> App (Lalamove/99)</span>
            <span className="inline-flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Hoje (frota)</span>
            <span className="inline-flex items-center gap-0.5"><Calendar className="w-2.5 h-2.5 text-violet-500" /> agendada</span>
            <span className="inline-flex items-center gap-0.5"><Store className="w-2.5 h-2.5 text-sky-500" /> outra loja</span>
          </p>
        )}
      </div>

      {/* Coletas de transferência — seleção independente das entregas. NÃO entram na wave. */}
      <div>
        <label className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
            <PackageCheck className="w-3.5 h-3.5 text-orange-500" />
            Coletas de transferência ({collectionIds.size} de {eligibleCollections.length})
          </span>
          {eligibleCollections.length > 0 && (
            <button
              type="button"
              onClick={() => setCollectionIds(
                collectionIds.size === eligibleCollections.length
                  ? new Set()
                  : new Set(eligibleCollections.map((c) => c.id)),
              )}
              className="text-[11px] text-orange-600 hover:underline font-medium"
            >
              {collectionIds.size === eligibleCollections.length ? "Limpar" : "Selecionar todas"}
            </button>
          )}
        </label>
        {eligibleCollections.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Nenhuma transferência disponível para coleta.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
            {eligibleCollections.map((c) => {
              const isSelected = collectionIds.has(c.id);
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleCollection(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (e.key === " ") e.preventDefault();
                      toggleCollection(c.id);
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
                    <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                      {c.doc}
                      <span className="text-gray-400 font-normal">·</span>
                      <span className="inline-flex items-center gap-1 text-gray-600">
                        {c.fromStoreCode}
                        <ArrowRight className="w-3 h-3 text-gray-400" />
                        {c.toStoreCode}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 truncate">{c.fromStoreName}</p>
                  </div>
                  <div className="flex-shrink-0 text-right text-[11px] text-gray-400">
                    {c.itemCount} {c.itemCount === 1 ? "item" : "itens"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {eligibleCollections.length > 0 && (
          <div className="flex items-center justify-end pt-2">
            <button
              type="button"
              onClick={() => setIncludeOpen(true)}
              disabled={collectionIds.size === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-orange-300 text-orange-700 hover:bg-orange-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PackageCheck className="w-4 h-4" />
              Incluir na rota ({collectionIds.size})
            </button>
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

      {/* Modal "Incluir na rota" — escolhe a rota destino das coletas selecionadas */}
      {includeOpen && (
        <IncluirNaRotaModal
          collections={selectedCollections}
          routes={candidateRoutes}
          recommendedRouteId={recommendedRouteId}
          onConfirm={handleInclude}
          onClose={() => setIncludeOpen(false)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// MODAL: Incluir coleta(s) na rota
// ──────────────────────────────────────────────
function IncluirNaRotaModal({
  collections,
  routes,
  recommendedRouteId,
  onConfirm,
  onClose,
}: {
  collections: EligibleCollection[];
  routes: CandidateRoute[];
  recommendedRouteId: string | null;
  onConfirm: (routeId: string) => Promise<void>;
  onClose: () => void;
}) {
  // Pré-seleciona a rota recomendada (ou a primeira).
  const [routeId, setRouteId] = useState<string | null>(
    recommendedRouteId ?? routes[0]?.id ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!routeId) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(routeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao incluir coleta");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-orange-500" />
            Incluir na rota
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 rounded-lg p-1 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {/* Coletas selecionadas */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1.5">
              {collections.length} coleta{collections.length === 1 ? "" : "s"} selecionada{collections.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {collections.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-700 rounded-md px-2 py-0.5"
                >
                  {c.doc} · {c.fromStoreCode}→{c.toStoreCode}
                </span>
              ))}
            </div>
          </div>

          {/* Seletor de rota */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1.5">Escolha a rota</p>
            {routes.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Nenhuma rota ativa disponível hoje.</p>
            ) : (
              <div className="space-y-2">
                {routes.map((r) => {
                  const isSelected = routeId === r.id;
                  const isRecommended = recommendedRouteId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRouteId(r.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                        isSelected
                          ? "bg-orange-50 border-orange-300"
                          : "bg-white border-gray-200 hover:border-gray-300",
                      )}
                    >
                      <span className={cn(
                        "w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0",
                        isSelected ? "bg-orange-500 border-orange-500" : "border-gray-300",
                      )}>
                        {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-2">
                          {r.name}
                          {isRecommended && (
                            <span className="text-[10px] font-bold text-green-700 bg-green-100 rounded-full px-2 py-0.5 flex-shrink-0">
                              ✓ recomendado
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {r.driverName} · {r.stopCount} paradas · {r.status === "DISPATCHED" ? "Despachada" : "Ativa"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!routeId || submitting}
            className="flex items-center gap-2 bg-orange-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            Incluir na rota
          </button>
        </div>
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

// Selos de classificação exibidos na linha de cada entrega elegível.
function DeliveryBadges({ r }: { r: EligibleRequest }) {
  return (
    <>
      {r.appUrgent && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 flex-shrink-0">
          <Zap className="w-2.5 h-2.5" /> App
        </span>
      )}
      {r.todayUrgent && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-700 bg-red-100 rounded px-1.5 py-0.5 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Hoje
        </span>
      )}
      {r.scheduledDateLabel && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-violet-700 bg-violet-100 rounded px-1.5 py-0.5 flex-shrink-0">
          <Calendar className="w-2.5 h-2.5" /> {r.scheduledDateLabel}
        </span>
      )}
      {r.originStoreCode && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-sky-700 bg-sky-100 rounded px-1.5 py-0.5 flex-shrink-0">
          <Store className="w-2.5 h-2.5" /> {r.originStoreCode}
        </span>
      )}
    </>
  );
}
