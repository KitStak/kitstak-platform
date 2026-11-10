"use client";

/**
 * Grid preferences persisted per user through `GET/PUT /api/grid-prefs/[gridKey]`
 * (GET returns the prefs object or null; PUT takes the flat prefs object, see
 * `gridPrefsPutBody`, validated server-side by `gridPrefsSchema`).
 * Without a gridKey the prefs live in component state only. Writes are debounced so a
 * column resize drag produces one request.
 *
 * Deliberately independent of the React Query provider so legacy pages that render
 * `DataGrid` outside `<QueryProvider>` keep working.
 */
import * as React from "react";
import { ApiError, apiRequest } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { defaultGridPrefs, prefsEqual, reconcileGridPrefs, type PrefColumn } from "./grid-prefs";
import type { GridPrefs } from "./grid-types";

export const PREFS_SAVE_DEBOUNCE_MS = 600;

export function gridPrefsPath(gridKey: string): string {
  return `/api/grid-prefs/${encodeURIComponent(gridKey)}`;
}

function extractPrefs(data: unknown): unknown {
  if (data && typeof data === "object" && "prefs" in data) return (data as { prefs: unknown }).prefs;
  return data;
}

/** The exact PUT body the hook sends: the flat prefs object (server `gridPrefsSchema`). */
export function gridPrefsPutBody(prefs: GridPrefs): GridPrefs {
  return {
    visible: prefs.visible,
    order: prefs.order,
    widths: prefs.widths,
    density: prefs.density,
    pageSize: prefs.pageSize,
    ...(prefs.pinned ? { pinned: prefs.pinned } : {}),
  };
}

function reportPrefsSaveError(error: unknown): void {
  // Keep validation detail out of the UI; it is diagnostic only.
  const details = error instanceof ApiError
    ? { code: error.code, status: error.status, message: error.message, fieldErrors: error.fieldErrors, requestId: error.requestId }
    : error;
  console.error("[grid-prefs] save failed", details);
  toast.error("Could not save column settings", "Your layout is kept for this session. Try again later.");
}

/** Remote payload per gridKey for this page session (avoids refetching per mount). */
const remoteCache = new Map<string, unknown>();

export interface GridPrefsState {
  readonly prefs: GridPrefs;
  readonly isLoaded: boolean;
  readonly update: (patch: Partial<GridPrefs>) => void;
  readonly reset: () => void;
}

function useRemotePrefs(gridKey: string | undefined): { readonly raw: unknown; readonly loaded: boolean } {
  const [state, setState] = React.useState<{ readonly key: string; readonly raw: unknown } | null>(null);
  React.useEffect(() => {
    if (!gridKey || remoteCache.has(gridKey)) return;
    const controller = new AbortController();
    apiRequest<unknown>(gridPrefsPath(gridKey), { signal: controller.signal, skipAuthRedirect: true })
      .then(({ data }) => {
        const raw = extractPrefs(data);
        remoteCache.set(gridKey, raw);
        setState({ key: gridKey, raw });
      })
      .catch(() => {
        // Missing endpoint or no saved prefs: defaults apply; not worth a toast.
        if (!controller.signal.aborted) setState({ key: gridKey, raw: null });
      });
    return () => controller.abort();
  }, [gridKey]);
  if (!gridKey) return { raw: null, loaded: true };
  if (remoteCache.has(gridKey)) return { raw: remoteCache.get(gridKey), loaded: true };
  return state?.key === gridKey ? { raw: state.raw, loaded: true } : { raw: null, loaded: false };
}

export function useGridPrefs(gridKey: string | undefined, columns: readonly PrefColumn[]): GridPrefsState {
  const remote = useRemotePrefs(gridKey);
  const columnsKey = columns.map((c) => `${c.id}:${c.defaultVisible ? 1 : 0}:${c.alwaysVisible ? 1 : 0}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- columnsKey captures the column identity
  const stableColumns = React.useMemo(() => columns, [columnsKey]);
  const base = React.useMemo(() => reconcileGridPrefs(remote.raw, stableColumns), [remote.raw, stableColumns]);
  const [local, setLocal] = React.useState<{ readonly base: GridPrefs; readonly value: GridPrefs } | null>(null);
  const prefs = local && local.base === base ? local.value : base;

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const persist = React.useCallback(
    (next: GridPrefs) => {
      if (!gridKey) return;
      remoteCache.set(gridKey, next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        apiRequest(gridPrefsPath(gridKey), { method: "PUT", body: gridPrefsPutBody(next) }).catch((error: unknown) => {
          reportPrefsSaveError(error);
        });
      }, PREFS_SAVE_DEBOUNCE_MS);
    },
    [gridKey]
  );

  const update = React.useCallback(
    (patch: Partial<GridPrefs>) => {
      const next = { ...prefs, ...patch };
      if (prefsEqual(prefs, next)) return;
      setLocal({ base, value: next });
      persist(next);
    },
    [base, prefs, persist]
  );

  const reset = React.useCallback(() => {
    const next = defaultGridPrefs(stableColumns);
    setLocal({ base, value: next });
    persist(next);
  }, [base, persist, stableColumns]);

  return { prefs, isLoaded: remote.loaded, update, reset };
}
