"use client";

/**
 * Catalog list-page helpers layered over the shared grid (M09-owned, no shared edits):
 *
 * - `useStickySearchMode`: the quick-search mode (Equal / Starts With) survives an empty search
 *   box. The shared serializer only writes `qm` next to a non-empty `q`, so "pick Equal, then type"
 *   used to drop the mode. The mode is kept here, written raw to the URL (`?qm=eq`, Logiwa keeps
 *   `skuqt=eq`) and to sessionStorage, and sent with the next search.
 * - `GridFetchFrame`: while a list refetches, the previous rows dim and an indeterminate bar runs
 *   under the toolbar. On the first load the footer total shows "—" instead of "0".
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import type { GridUrlState } from "@/lib/use-url-state";
import { QUICK_SEARCH_MODES, type QuickSearchMode } from "@/server/query/grid-query";
import { cn } from "@/lib/utils";
import { useApiQuery } from "@/lib/query-client";
import { savedViewsQueryKey } from "@/components/grid/use-saved-views";

const storageKey = (gridKey: string) => `kitstak:grid-qm:${gridKey}`;

export function isSearchMode(v: unknown): v is QuickSearchMode {
  return typeof v === "string" && (QUICK_SEARCH_MODES as readonly string[]).includes(v);
}

/** Initial mode: a raw `qm` in the URL wins, then the per-tab stored mode, then Starts With. */
export function initialSearchMode(urlQm: string | null, stored: string | null): QuickSearchMode {
  if (isSearchMode(urlQm)) return urlQm;
  if (isSearchMode(stored)) return stored;
  return "sw";
}

/** The URL after a mode change with an empty search box (raw `qm`, default omitted). */
export function withRawSearchMode(search: string, mode: QuickSearchMode): string {
  const params = new URLSearchParams(search);
  if (mode === "sw") params.delete("qm");
  else params.set("qm", mode);
  return params.toString();
}

function readStored(gridKey: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(storageKey(gridKey));
  } catch {
    return null;
  }
}

function writeStored(gridKey: string, mode: QuickSearchMode): void {
  try {
    if (mode === "sw") window.sessionStorage.removeItem(storageKey(gridKey));
    else window.sessionStorage.setItem(storageKey(gridKey), mode);
  } catch {
    /* storage blocked: the URL still carries the mode */
  }
}

export function useStickySearchMode(grid: GridUrlState): GridUrlState {
  const params = useSearchParams();
  const { gridKey } = grid;
  const [mode, setModeState] = React.useState<QuickSearchMode>(() => initialSearchMode(params.get("qm"), readStored(gridKey)));
  const hasQ = Boolean(grid.query.q);
  const urlMode = grid.query.qm;

  // With a search in the URL the URL is authoritative (back/forward, shared links).
  const effective: QuickSearchMode = hasQ ? urlMode : mode;
  const base = grid.setQuery;
  const q = grid.query.q;

  const setQuery = React.useCallback<GridUrlState["setQuery"]>((patch) => {
    if (patch.qm !== undefined) {
      const next = patch.qm;
      setModeState(next);
      writeStored(gridKey, next);
      const { qm: _qm, ...rest } = patch;
      void _qm;
      const willHaveQ = "q" in patch ? Boolean(patch.q) : Boolean(q);
      if (willHaveQ) {
        base({ ...rest, qm: next });
        return;
      }
      // Other changes go through the shared writer (sessionStorage keeps the mode for reloads).
      if (Object.keys(rest).length) {
        base(rest);
        return;
      }
      // Mode only, no search text: the shared serializer would drop qm, so keep it raw in the URL.
      const nextSearch = withRawSearchMode(window.location.search, next);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);
      return;
    }
    base({ qm: effective, ...patch });
  }, [base, gridKey, q, effective]);

  return React.useMemo<GridUrlState>(() => ({
    ...grid,
    query: { ...grid.query, qm: effective },
    setQuery,
    setSearch: (text, qm) => setQuery({ q: text.trim() || undefined, qm: qm ?? effective }),
  }), [grid, effective, setQuery]);
}

/**
 * Wraps a DataGrid: dims stale rows + indeterminate bar while refetching, "—" total while the
 * first page is pending.
 */
export function GridFetchFrame({ fetching, pending, children }: { readonly fetching: boolean; readonly pending: boolean; readonly children: React.ReactNode }) {
  const stale = fetching && !pending;
  return (
    <div
      data-stale={stale || undefined}
      data-pending={pending || undefined}
      aria-busy={fetching || undefined}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col",
        // Scrim on the sticky actions column so a scrolled cell fades under it (no cut glyphs).
        // (a positioned pseudo-element: Chrome paints table-cell box-shadows under neighbour content).
        "[&_td.sticky[style*=right]]:before:pointer-events-none [&_td.sticky[style*=right]]:before:absolute [&_td.sticky[style*=right]]:before:inset-y-0 [&_td.sticky[style*=right]]:before:w-5 [&_td.sticky[style*=right]]:before:content-['']",
        "[&_td.sticky[style*=right]]:before:bg-[linear-gradient(to_right,transparent,var(--color-surface)_70%)] [&_tr:hover_td.sticky[style*=right]]:before:bg-[linear-gradient(to_right,transparent,var(--color-surface-sunken)_70%)]",
        // Selected rows paint the sticky cell primary-soft: the scrim must match or a light sliver shows.
        "[&_tr[aria-selected]_td.sticky[style*=right]]:before:bg-[linear-gradient(to_right,transparent,var(--color-primary-soft)_70%)]",
        // The scrim is the boundary: drop the 1px inset divider (it read as a stray line), and pull the
        // pseudo-element 1px into the cell so sub-pixel column widths cannot leave a gap.
        "[&_td.sticky[style*=right]]:shadow-none [&_th.sticky[style*=right]]:shadow-none [&_td.sticky[style*=right]]:before:-left-[19px]",
        // Same scrim on the header: a scrolled header label fades under the column-settings icon
        // instead of being cut to "H." (header background is surface).
        "[&_th.sticky[style*=right]]:before:pointer-events-none [&_th.sticky[style*=right]]:before:absolute [&_th.sticky[style*=right]]:before:top-0 [&_th.sticky[style*=right]]:before:bottom-px [&_th.sticky[style*=right]]:before:-left-[39px] [&_th.sticky[style*=right]]:before:w-10 [&_th.sticky[style*=right]]:before:content-['']",
        "[&_th.sticky[style*=right]]:before:bg-[linear-gradient(to_right,transparent,var(--color-surface)_55%)]",
        "[&_tbody]:transition-opacity [&_tbody]:duration-150 [&[data-stale]_tbody]:opacity-55",
        // First load: the shared footer would print "Total: 0" under the skeleton.
        "[&[data-pending]_[aria-live=polite]>span:first-child]:text-[0px] [&[data-pending]_[aria-live=polite]>span:first-child]:after:text-xs [&[data-pending]_[aria-live=polite]>span:first-child]:after:text-faint [&[data-pending]_[aria-live=polite]>span:first-child]:after:content-['—']"
      )}
    >
      {fetching ? (
        <div role="progressbar" aria-label="Loading results" className="pointer-events-none absolute inset-x-6 top-0 z-40 h-0.5 overflow-hidden rounded-t-lg">
          <style>{"@keyframes ks-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}"}</style>
          <div className="h-full w-2/5 bg-primary/70" style={{ animation: "ks-indeterminate 1.1s ease-in-out infinite" }} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Starts the first page request of a list grid during hydration, in parallel with the session /
 * permission check (the grid itself mounts only after `CatalogViewGate` resolves). It uses the
 * grid's own query key (`["grid", gridKey, path, query]`), so `useGrid` picks up the answer, and
 * only runs when the URL carries no grid state besides `extraKeys` (otherwise the grid's query
 * differs and the grid fetches it itself). A 403 here is harmless: the gate shows its screen.
 */
export function usePrefetchGridFirstPage(gridKey: string, path: string, extra: Readonly<Record<string, string>> = {}, extraKeys: readonly string[] = []): void {
  const params = useSearchParams();
  const plain = [...params.keys()].every((k) => extraKeys.includes(k));
  const query = new URLSearchParams(extra).toString();
  useApiQuery<unknown>(["grid", gridKey, path], plain ? path : null, { query, staleTime: 5_000 });
  // The grid also reads its saved views before it settles (default view); same key as useSavedViews.
  useApiQuery<unknown>(savedViewsQueryKey(gridKey), "/api/saved-views", { query: { gridKey } });
}
