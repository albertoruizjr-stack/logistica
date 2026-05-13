"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MapViewData, MapFilters }              from "@/types";

const POLL_INTERVAL_MS = 30_000;

export function useOperationalMap(initial: MapViewData, filters: MapFilters) {
  const [data, setData]       = useState<MapViewData>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const intervalRef           = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.storeId) params.set("storeId", filters.storeId);
      const res = await fetch(`/api/map-view?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar mapa");
    } finally {
      setLoading(false);
    }
  }, [filters.storeId]);

  useEffect(() => {
    intervalRef.current = setInterval(fetchMap, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMap]);

  return { data, loading, error, refetch: fetchMap };
}
