'use client';

/**
 * Typed search-param state (BUILD_PLAN F4.1).
 *
 *   const [state, setState] = useUrlState({ tab: urlParam.enum(["all", "open"], "all"), page: urlParam.int(1) });
 *   const grid = useGridUrlState("orders");   // KitStaks grid grammar (q, qm, f.*, sort, page, ps)
 *
 * Updates are reflected locally at once and written after a 250 ms debounce with
 * `history.replaceState` (client-only, keeps the hash, no scroll jump). Pass
 * `{ serverParams: true }` when a server component reads the params; that path uses
 * `router.replace` and refetches the RSC payload.
 * Components using these hooks read `useSearchParams`, so render them inside <Suspense>.
 */
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  EMPTY_GRID_QUERY,
  parseGridQuery,
  serializeGridQuery,
  type GridFilter,
  type GridQuery,
  type QuickSearchMode,
  type SortSpec,
} from '@/server/query/grid-query';

export const URL_WRITE_DEBOUNCE_MS = 250;

export interface UrlParamDef<T> {
  parse(raw: string | null): T;
  /** `null` removes the param (used for the default value). Method syntax keeps defs assignable to `UrlStateDefs`. */
  serialize(value: T): string | null;
}

function withDefault<T>(
  fallback: T,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string,
): UrlParamDef<T> {
  return {
    parse: (raw) => (raw === null ? fallback : (parse(raw) ?? fallback)),
    serialize: (value) => (Object.is(value, fallback) ? null : serialize(value)),
  };
}

export const urlParam = {
  string: (fallback = ''): UrlParamDef<string> =>
    withDefault(
      fallback,
      (raw) => raw,
      (v) => (v === '' ? '' : v),
    ),
  int: (fallback: number): UrlParamDef<number> =>
    withDefault(fallback, (raw) => (/^-?\d+$/.test(raw) ? Number(raw) : undefined), String),
  bool: (fallback = false): UrlParamDef<boolean> =>
    withDefault(
      fallback,
      (raw) => (raw === '1' || raw === 'true' ? true : raw === '0' || raw === 'false' ? false : undefined),
      (v) => (v ? '1' : '0'),
    ),
  enum: <const V extends string>(values: readonly V[], fallback: V): UrlParamDef<V> =>
    withDefault(
      fallback,
      (raw) => ((values as readonly string[]).includes(raw) ? (raw as V) : undefined),
      (v) => v,
    ),
  list: (): UrlParamDef<readonly string[]> => ({
    parse: (raw) => (raw ? raw.split(',').filter(Boolean) : []),
    serialize: (value) => (value.length ? value.join(',') : null),
  }),
} as const;

export type UrlStateDefs = Readonly<Record<string, UrlParamDef<unknown>>>;
export type UrlStateValues<D extends UrlStateDefs> = {
  readonly [K in keyof D]: D[K] extends UrlParamDef<infer T> ? T : never;
};

export function readUrlState<D extends UrlStateDefs>(defs: D, params: URLSearchParams): UrlStateValues<D> {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(defs)) out[key] = def.parse(params.get(key));
  return out as UrlStateValues<D>;
}

/** New URLSearchParams with `values` applied (other params preserved). */
export function writeUrlState<D extends UrlStateDefs>(
  defs: D,
  params: URLSearchParams,
  values: Partial<UrlStateValues<D>>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(values)) {
    const def = defs[key];
    if (!def) continue;
    const serialized = def.serialize(value);
    if (serialized === null || serialized === '') next.delete(key);
    else next.set(key, serialized);
  }
  return next;
}

export interface UrlWriteOptions {
  /**
   * Set when a *server* component reads these params, so the RSC payload must be
   * refetched. Default `false`: the URL is written with `history.replaceState`
   * (Next syncs `useSearchParams` from native history) — no server roundtrip, no
   * scroll jump, and the `#hash` is kept.
   */
  readonly serverParams?: boolean;
}

/** Builds `pathname?query#hash`, keeping the current location hash. */
export function buildUrl(pathname: string, params: URLSearchParams, hash: string): string {
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ''}${hash}`;
}

/** Debounced URL writer, flushing the latest params; flushes on unmount. */
function useDebouncedReplace(options: UrlWriteOptions): (params: URLSearchParams) => void {
  const router = useRouter();
  const pathname = usePathname();
  const serverParams = options.serverParams === true;
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = React.useRef<URLSearchParams | null>(null);

  const flush = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const params = pending.current;
    pending.current = null;
    if (!params) return;
    const url = buildUrl(pathname, params, window.location.hash);
    if (serverParams) router.replace(url, { scroll: false });
    else window.history.replaceState(window.history.state, '', url);
  }, [router, pathname, serverParams]);

  React.useEffect(() => flush, [flush]);

  return React.useCallback(
    (params: URLSearchParams) => {
      pending.current = params;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, URL_WRITE_DEBOUNCE_MS);
    },
    [flush],
  );
}

/**
 * Shared core: holds an optimistic copy of the params until the URL catches up.
 */
function useOptimisticParams(
  options: UrlWriteOptions = {},
): readonly [URLSearchParams, (update: (current: URLSearchParams) => URLSearchParams) => void] {
  const searchParams = useSearchParams();
  const urlString = searchParams.toString();
  const [local, setLocal] = React.useState<{ readonly base: string; readonly value: string } | null>(null);
  const replace = useDebouncedReplace(options);

  const effective = local && local.base === urlString ? local.value : urlString;
  const effectiveRef = React.useRef(effective);
  React.useEffect(() => {
    effectiveRef.current = effective;
  }, [effective]);

  const update = React.useCallback(
    (fn: (current: URLSearchParams) => URLSearchParams) => {
      const next = fn(new URLSearchParams(effectiveRef.current));
      const value = next.toString();
      effectiveRef.current = value;
      setLocal({ base: urlString, value });
      replace(next);
    },
    [replace, urlString],
  );

  const params = React.useMemo(() => new URLSearchParams(effective), [effective]);
  return [params, update] as const;
}

export function useUrlState<D extends UrlStateDefs>(
  defs: D,
  options: UrlWriteOptions = {},
): readonly [UrlStateValues<D>, (patch: Partial<UrlStateValues<D>>) => void] {
  const [params, update] = useOptimisticParams(options);
  // Define `defs` at module level (or memoise it) so `state` keeps a stable identity.
  const state = React.useMemo(() => readUrlState(defs, params), [defs, params]);
  const setState = React.useCallback(
    (patch: Partial<UrlStateValues<D>>) => update((current) => writeUrlState(defs, current, patch)),
    [update, defs],
  );
  return [state, setState] as const;
}

/* ---------------- grid grammar ---------------- */

const GRID_KEYS = new Set(['q', 'qm', 'sort', 'page', 'ps']);

function isGridParam(key: string): boolean {
  return GRID_KEYS.has(key) || key.startsWith('f.');
}

/** Replaces every grid param in `params` with the canonical form of `query`. */
export function applyGridQuery(params: URLSearchParams, query: GridQuery): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of params.entries()) if (!isGridParam(key)) next.append(key, value);
  for (const [key, value] of new URLSearchParams(serializeGridQuery(query)).entries())
    next.append(key, value);
  return next;
}

export interface GridUrlState {
  readonly gridKey: string;
  readonly query: GridQuery;
  /** Canonical grid query string — feed it to the list API and to Save view. */
  readonly queryString: string;
  readonly setQuery: (patch: Partial<GridQuery>) => void;
  readonly setSearch: (q: string, qm?: QuickSearchMode) => void;
  readonly setFilters: (filters: readonly GridFilter[]) => void;
  readonly upsertFilter: (filter: GridFilter) => void;
  readonly removeFilter: (field: string) => void;
  readonly setSort: (sort: readonly SortSpec[]) => void;
  readonly setPage: (page: number) => void;
  readonly setPageSize: (pageSize: number) => void;
  readonly reset: () => void;
}

/** Pure reducer used by the hook (exported for tests). Non-page changes reset to page 1. */
export function patchGridQuery(current: GridQuery, patch: Partial<GridQuery>): GridQuery {
  const resetsPage = Object.keys(patch).some((key) => key !== 'page');
  return { ...current, ...(resetsPage ? { page: 1 } : {}), ...patch };
}

export function useGridUrlState(gridKey: string, options: UrlWriteOptions = {}): GridUrlState {
  const [params, update] = useOptimisticParams(options);
  const query = React.useMemo(() => parseGridQuery(params).query, [params]);

  const setQuery = React.useCallback(
    (patch: Partial<GridQuery>) =>
      update((current) => applyGridQuery(current, patchGridQuery(parseGridQuery(current).query, patch))),
    [update],
  );

  return React.useMemo<GridUrlState>(
    () => ({
      gridKey,
      query,
      queryString: serializeGridQuery(query),
      setQuery,
      setSearch: (q, qm) => setQuery({ q: q.trim() || undefined, ...(qm ? { qm } : {}) }),
      setFilters: (filters) => setQuery({ filters }),
      upsertFilter: (filter) =>
        setQuery({ filters: [...query.filters.filter((f) => f.field !== filter.field), filter] }),
      removeFilter: (field) => setQuery({ filters: query.filters.filter((f) => f.field !== field) }),
      setSort: (sort) => setQuery({ sort }),
      setPage: (page) => setQuery({ page }),
      setPageSize: (pageSize) => setQuery({ pageSize }),
      reset: () => update((current) => applyGridQuery(current, EMPTY_GRID_QUERY)),
    }),
    [gridKey, query, setQuery, update],
  );
}
