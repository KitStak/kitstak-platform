"use client";

import * as React from "react";

/** Standard KitStak list envelope: { success, data, meta: { total } }. */
export interface ListEnvelope<T> {
  success: boolean;
  data?: T[];
  error?: string;
  meta?: { total: number; page: number; pageSize: number };
}

const SEARCH_DEBOUNCE_MS = 300;

export function useDebouncedValue<T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

export interface ReportQuery<T> {
  rows: T[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches a paginated report endpoint. Re-runs whenever the resolved query
 * string changes and aborts stale in-flight requests.
 */
export function useReportRows<T>(
  endpoint: string,
  params: Record<string, string | number | undefined>
): ReportQuery<T> {
  const [rows, setRows] = React.useState<T[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  const query = React.useMemo(() => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") qs.set(key, String(value));
    }
    return qs.toString();
  }, [params]);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`${endpoint}?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as ListEnvelope<T>;
        if (!active) return;
        if (!res.ok || !body.success || !body.data) {
          setError(body.error ?? `Request failed (${res.status})`);
          setRows([]);
          setTotal(0);
        } else {
          setRows(body.data);
          setTotal(body.meta?.total ?? body.data.length);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Network error");
        setRows([]);
        setTotal(0);
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint, query, tick]);

  const refetch = React.useCallback(() => setTick((t) => t + 1), []);

  return { rows, total, loading, error, refetch };
}

export interface ClientOption {
  id: string;
  name: string;
}

/** Loads the 3PL client list once, for report filter dropdowns. */
export function useClientOptions(): ClientOption[] {
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/clients?pageSize=100", { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as ListEnvelope<{ id: string; name: string }>;
        if (res.ok && body.success && body.data) {
          setClients(body.data.map((c) => ({ id: c.id, name: c.name })));
        }
      })
      .catch(() => {
        /* filter options are non-critical; the grid still works without them */
      });
    return () => controller.abort();
  }, []);
  return clients;
}
