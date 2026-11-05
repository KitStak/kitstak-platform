"use client";

import * as React from "react";

interface ListEnvelope<T> {
  success: boolean;
  data?: T[];
  error?: string;
  meta?: { total: number };
}

export interface ListQueryState<T> {
  rows: T[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Debounce a changing value (used for grid search inputs). */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Fetch a paginated list endpoint using the standard `{ success, data, meta }`
 * envelope. Aborts in-flight requests when params change or on unmount.
 */
export function useListQuery<T>(
  path: string,
  query: Record<string, string>
): ListQueryState<T> {
  const [rows, setRows] = React.useState<T[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }, [query]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${path}?${queryString}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<ListEnvelope<T>>)
      .then((body) => {
        if (!body.success || !body.data) {
          setError(body.error ?? "Request failed");
          setRows([]);
          setTotal(0);
        } else {
          setError(null);
          setRows(body.data);
          setTotal(body.meta?.total ?? body.data.length);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Could not reach the server. Check your connection and retry.");
        setRows([]);
        setTotal(0);
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, queryString, refreshKey]);

  const refetch = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  return { rows, total, loading, error, refetch };
}
