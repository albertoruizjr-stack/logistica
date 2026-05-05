"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Play, Clock, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Tipos ────────────────────────────────────────────────

interface NfLinkJob {
  id: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  trigger: "CRON" | "MANUAL";
  requestsChecked: number;
  requestsLinked: number;
  requestsPartial: number;
  requestsMultiNf: number;
  requestsNotFound: number;
  requestsError: number;
  startedAt: string;
  finishedAt: string | null;
  errorDetail: string | null;
}

interface PanelData {
  jobs: NfLinkJob[];
  pendingCount: number;
  needsReview: number;
}

// ─── Status config ─────────────────────────────────────────

const STATUS_CONFIG = {
  RUNNING:  { label: "Rodando",  icon: RefreshCw,     color: "#2563EB", bg: "rgba(37,99,235,0.10)",  spin: true  },
  SUCCESS:  { label: "Sucesso",  icon: CheckCircle2,  color: "#16A34A", bg: "rgba(22,163,74,0.10)",  spin: false },
  PARTIAL:  { label: "Parcial",  icon: AlertTriangle, color: "#B45309", bg: "rgba(217,119,6,0.10)",  spin: false },
  FAILED:   { label: "Falhou",   icon: XCircle,       color: "#B91C1C", bg: "rgba(220,38,38,0.10)",  spin: false },
} as const;

// ─── Helpers ───────────────────────────────────────────────

function fmtDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ─── Componente de linha de job ────────────────────────────

function JobRow({ job }: { job: NfLinkJob }) {
  const cfg = STATUS_CONFIG[job.status];
  const Icon = cfg.icon;

  return (
    <div
      className="flex items-center gap-3 py-2.5 px-3 rounded-lg"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      {/* Status icon */}
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: cfg.bg }}
      >
        <Icon
          className={cn("w-3.5 h-3.5", cfg.spin && "animate-spin")}
          style={{ color: cfg.color }}
        />
      </div>

      {/* Info principal */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold" style={{ color: cfg.color }}>
            {cfg.label}
          </span>
          <span className="text-[11px]" style={{ color: "var(--color-muted-text)" }}>
            {fmtDate(job.startedAt)} {fmtTime(job.startedAt)}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{
              backgroundColor: job.trigger === "MANUAL" ? "rgba(139,92,246,0.10)" : "var(--color-surface-raised)",
              color: job.trigger === "MANUAL" ? "#7C3AED" : "var(--color-muted-text)",
            }}
          >
            {job.trigger === "MANUAL" ? "Manual" : "Cron"}
          </span>
          <span className="text-[11px]" style={{ color: "var(--color-muted-text)" }}>
            {fmtDuration(job.startedAt, job.finishedAt)}
          </span>
        </div>

        {/* Contadores */}
        {job.status !== "RUNNING" && (
          <div className="flex items-center gap-3 mt-1">
            {job.requestsLinked > 0 && (
              <span className="text-[11px]" style={{ color: "#16A34A" }}>
                ✓ {job.requestsLinked} vinculad{job.requestsLinked === 1 ? "a" : "as"}
              </span>
            )}
            {job.requestsChecked > 0 && (
              <span className="text-[11px]" style={{ color: "var(--color-muted-text)" }}>
                {job.requestsChecked} verificad{job.requestsChecked === 1 ? "a" : "as"}
              </span>
            )}
            {job.requestsPartial > 0 && (
              <span className="text-[11px]" style={{ color: "#B45309" }}>
                {job.requestsPartial} parcial
              </span>
            )}
            {job.requestsMultiNf > 0 && (
              <span className="text-[11px]" style={{ color: "#B91C1C" }}>
                {job.requestsMultiNf} múltiplas NF
              </span>
            )}
            {job.requestsLinked === 0 && job.requestsChecked === 0 && (
              <span className="text-[11px]" style={{ color: "var(--color-muted-text)" }}>
                Sem pendências
              </span>
            )}
          </div>
        )}

        {job.errorDetail && (
          <p className="text-[11px] mt-1 truncate" style={{ color: "#B91C1C" }}>
            {job.errorDetail}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Painel principal ──────────────────────────────────────

interface NfLinkAdminPanelProps {
  initialData: PanelData;
}

export function NfLinkAdminPanel({ initialData }: NfLinkAdminPanelProps) {
  const [data, setData]           = useState<PanelData>(initialData);
  const [expanded, setExpanded]   = useState(false);
  const [firing, setFiring]       = useState(false);
  const [fireError, setFireError] = useState<string | null>(null);
  const [polling, setPolling]     = useState(false);

  const latestJob = data.jobs[0] ?? null;
  const isRunning = latestJob?.status === "RUNNING";

  // Polling: ativo quando há job RUNNING
  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch("/api/admin/nf-link");
      const json = await res.json();
      if (json.data) setData(json.data);
    } catch {
      // silencioso — não bloqueia o painel por falha de rede
    }
  }, []);

  useEffect(() => {
    if (!isRunning && !polling) return;
    if (!isRunning) { setPolling(false); return; }

    setPolling(true);
    const id = setInterval(fetchData, 2500);
    return () => clearInterval(id);
  }, [isRunning, polling, fetchData]);

  // Disparo manual
  async function handleFire() {
    setFiring(true);
    setFireError(null);
    try {
      const res  = await fetch("/api/admin/nf-link", { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setFireError("Job já está em execução. Aguarde.");
        } else {
          setFireError(json.error ?? "Erro ao disparar job.");
        }
        return;
      }

      // Sucesso — atualiza a lista e abre o painel
      await fetchData();
      setExpanded(true);
    } catch {
      setFireError("Erro de rede. Tente novamente.");
    } finally {
      setFiring(false);
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      {/* Header — sempre visível */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          className="flex items-center gap-2.5 text-left flex-1 min-w-0"
          onClick={() => setExpanded((v) => !v)}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "rgba(37,99,235,0.10)" }}
          >
            <Link2 className="w-3.5 h-3.5" style={{ color: "#2563EB" }} />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-[13px] font-semibold"
              style={{ color: "var(--color-body-text)", fontFamily: "var(--font-display)" }}
            >
              Vínculo PD → NF
            </span>

            {/* Badges de pendências */}
            {data.pendingCount > 0 && (
              <span
                className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: "rgba(37,99,235,0.10)", color: "#2563EB" }}
              >
                {data.pendingCount} aguardando
              </span>
            )}
            {data.needsReview > 0 && (
              <span
                className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: "rgba(220,38,38,0.10)", color: "#B91C1C" }}
              >
                {data.needsReview} para revisar
              </span>
            )}

            {/* Status do último job */}
            {latestJob && (
              <span
                className="text-[11px]"
                style={{ color: "var(--color-muted-text)" }}
              >
                · último {fmtDate(latestJob.startedAt)} {fmtTime(latestJob.startedAt)}
              </span>
            )}
          </div>
          {expanded
            ? <ChevronUp className="w-4 h-4 ml-1 flex-shrink-0" style={{ color: "var(--color-muted-text)" }} />
            : <ChevronDown className="w-4 h-4 ml-1 flex-shrink-0" style={{ color: "var(--color-muted-text)" }} />
          }
        </button>

        {/* Botão disparar */}
        <button
          onClick={handleFire}
          disabled={firing || isRunning}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold ml-3 transition-opacity",
            (firing || isRunning) ? "opacity-50 cursor-not-allowed" : "hover:opacity-80"
          )}
          style={{ backgroundColor: "var(--color-primary)", color: "#fff" }}
        >
          {isRunning ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {isRunning ? "Rodando…" : firing ? "Disparando…" : "Disparar agora"}
        </button>
      </div>

      {/* Erro de disparo */}
      {fireError && (
        <div
          className="mx-4 mb-3 px-3 py-2 rounded-lg text-[12px]"
          style={{ backgroundColor: "rgba(220,38,38,0.08)", color: "#B91C1C" }}
        >
          {fireError}
        </div>
      )}

      {/* Conteúdo expansível */}
      {expanded && (
        <div
          className="border-t px-4 py-3 space-y-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          {data.jobs.length === 0 ? (
            <p className="text-[12px] text-center py-4" style={{ color: "var(--color-muted-text)" }}>
              Nenhuma execução registrada ainda.
            </p>
          ) : (
            data.jobs.map((job) => <JobRow key={job.id} job={job} />)
          )}
        </div>
      )}
    </div>
  );
}
