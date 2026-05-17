"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, MapPinOff, AlertTriangle } from "lucide-react";

type Status =
  | "idle"           // ainda verificando se tem rota
  | "no_route"       // motorista sem rota dispatched → GPS desligado
  | "requesting"     // pedindo permissão
  | "denied"         // motorista negou GPS
  | "unavailable"    // browser sem geolocation
  | "tracking"       // ok, mandando pings
  | "error";         // erro temporário (rede, sensor)

const PING_INTERVAL_MS         = 30_000;
const ACTIVE_ROUTE_REFRESH_MS  = 60_000;
const GEO_TIMEOUT_MS           = 15_000;

export default function DriverLocationTracker() {
  const [status,     setStatus]     = useState<Status>("idle");
  const [lastPingAt, setLastPingAt] = useState<Date | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

  // Refs pra evitar stale closures nos setIntervals
  const hasActiveRef = useRef(false);
  const inFlightRef  = useRef(false);
  const intervalRef  = useRef<number | null>(null);

  // ─────────────────────────────────────────
  // 1. Detecta se há rota ativa (polling 60s)
  // ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function checkActive() {
      try {
        const res = await fetch("/api/driver/active-route", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (cancelled || !json?.success) return;

        const wasActive = hasActiveRef.current;
        hasActiveRef.current = Boolean(json.data?.hasActive);

        if (hasActiveRef.current && !wasActive) {
          startTracking();
        } else if (!hasActiveRef.current && wasActive) {
          stopTracking("no_route");
        } else if (!hasActiveRef.current && status === "idle") {
          setStatus("no_route");
        }
      } catch {
        // ignora — próximo tick tenta de novo
      }
    }

    checkActive();
    const id = window.setInterval(checkActive, ACTIVE_ROUTE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      stopTracking("no_route");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────
  // 2. Pinga GPS + envia ao backend
  // ─────────────────────────────────────────
  function startTracking() {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    if (intervalRef.current != null) return;

    setStatus("requesting");
    pingOnce(); // primeiro ping imediato (dispara o prompt de permissão)
    intervalRef.current = window.setInterval(pingOnce, PING_INTERVAL_MS);
  }

  function stopTracking(next: Status) {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStatus(next);
  }

  function pingOnce() {
    if (inFlightRef.current) return;
    if (document.visibilityState === "hidden") return; // poupa bateria quando aba escondida

    inFlightRef.current = true;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/driver/location", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat:      pos.coords.latitude,
              lng:      pos.coords.longitude,
              speed:    pos.coords.speed    ?? null,
              heading:  pos.coords.heading  ?? null,
              accuracy: pos.coords.accuracy ?? null,
            }),
          });
          if (res.ok) {
            setLastPingAt(new Date());
            setErrorMsg(null);
            setStatus("tracking");
          } else {
            setStatus("error");
            setErrorMsg(`HTTP ${res.status}`);
          }
        } catch (e) {
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : "Erro de rede");
        } finally {
          inFlightRef.current = false;
        }
      },
      (geoErr) => {
        inFlightRef.current = false;
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          stopTracking("denied");
        } else {
          setStatus("error");
          setErrorMsg(geoErr.message);
        }
      },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 10_000 },
    );
  }

  // ─────────────────────────────────────────
  // 3. Renderiza chip + banner se necessário
  // ─────────────────────────────────────────

  // Sem rota ativa → não polui a tela
  if (status === "idle" || status === "no_route") return null;

  if (status === "denied" || status === "unavailable") {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 flex items-start gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">
            {status === "denied" ? "GPS bloqueado" : "GPS indisponível"}
          </p>
          <p className="text-[11px] mt-0.5">
            {status === "denied"
              ? "Ative a localização nas configurações do navegador pra loja acompanhar sua rota."
              : "Seu navegador não suporta GPS. Tente abrir no Chrome."}
          </p>
        </div>
      </div>
    );
  }

  const isOk      = status === "tracking";
  const lastLabel = lastPingAt
    ? humanAgo(lastPingAt)
    : "aguardando…";

  return (
    <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 mb-3 ${
      isOk ? "bg-green-50 border border-green-200 text-green-800" : "bg-gray-100 border border-gray-200 text-gray-700"
    }`}>
      {isOk ? <MapPin className="w-4 h-4" /> : <MapPinOff className="w-4 h-4" />}
      <span className="font-semibold">
        {isOk ? "Loja acompanhando sua localização" : "Tentando obter localização…"}
      </span>
      {isOk && <span className="text-[10px] opacity-70">· última {lastLabel}</span>}
      {errorMsg && !isOk && <span className="text-[10px] opacity-70">· {errorMsg}</span>}
    </div>
  );
}

function humanAgo(d: Date): string {
  const sec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60)    return `há ${sec}s`;
  if (sec < 3600)  return `há ${Math.floor(sec / 60)}min`;
  return `há ${Math.floor(sec / 3600)}h`;
}
