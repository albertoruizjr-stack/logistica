"use client";

import { useState, useEffect } from "react";
import { Clock, AlertTriangle, Zap } from "lucide-react";

// Horário de Brasília
function getNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function formatTime(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function minutesUntil(targetHour: number, targetMin: number, now: Date) {
  const target = new Date(now);
  target.setHours(targetHour, targetMin, 0, 0);
  if (target <= now) return null; // já passou
  return Math.floor((target.getTime() - now.getTime()) / 60_000);
}

export function CutoffBar() {
  const [now, setNow] = useState(getNow);

  useEffect(() => {
    const t = setInterval(() => setNow(getNow()), 1_000);
    return () => clearInterval(t);
  }, []);

  const mins12h    = minutesUntil(12, 0, now);
  const mins17h30  = minutesUntil(17, 30, now);
  const after12h   = mins12h === null;
  const after17h30 = mins17h30 === null;

  const cutoffWarning = (
    mins: number | null,
    label: string,
    color: string,
    warnAt: number
  ) => {
    if (mins === null) return null;
    const isWarning = mins <= warnAt;
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium"
        style={{
          backgroundColor: isWarning ? `${color}22` : "transparent",
          color: isWarning ? color : "#4B5563",
          border: isWarning ? `1px solid ${color}44` : "1px solid transparent",
        }}
      >
        <AlertTriangle className="w-3 h-3" style={{ color: isWarning ? color : "#4B5563" }} />
        {label} em {mins}min
      </div>
    );
  };

  return (
    <div
      className="flex items-center gap-4 px-5 py-2 border-b text-[11px]"
      style={{ backgroundColor: "#080C10", borderColor: "#1E2530" }}
    >
      {/* Relógio BRT */}
      <div className="flex items-center gap-1.5" style={{ color: "#9CA3AF" }}>
        <Clock className="w-3 h-3" />
        <span className="tabular-nums font-mono">{formatTime(now)}</span>
        <span style={{ color: "#374151" }}>BRT</span>
      </div>

      <span style={{ color: "#1E2530" }}>|</span>

      {/* Corte 12h */}
      {after12h ? (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ backgroundColor: "#EF444422", color: "#EF4444", border: "1px solid #EF444433" }}>
          <Zap className="w-3 h-3" />
          <span className="font-semibold">Corte 12h — só Express</span>
        </div>
      ) : (
        cutoffWarning(mins12h, "Corte 12h00", "#EF4444", 30)
      )}

      {/* Corte 17h30 */}
      {after17h30 ? (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ backgroundColor: "#F59E0B22", color: "#F59E0B", border: "1px solid #F59E0B33" }}>
          <AlertTriangle className="w-3 h-3" />
          <span className="font-semibold">Após 17h30 — 2º despacho</span>
        </div>
      ) : (
        cutoffWarning(mins17h30, "Corte 17h30", "#F59E0B", 60)
      )}
    </div>
  );
}
