"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { OperationalQueuePayload } from "@/components/operacao/types";

const POLL_INTERVAL_MS = 30_000;

export function useOperationalQueue(initial: OperationalQueuePayload) {
  const [data, setData]         = useState<OperationalQueuePayload>(initial);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const intervalRef             = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/operacao/queue");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar fila");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    intervalRef.current = setInterval(fetchQueue, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchQueue]);

  return { data, loading, error, refetch: fetchQueue };
}
