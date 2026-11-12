'use client';
/**
 * Shared data layer for board views: the board payload, the view's filtered items, a config
 * writer (optimistic, persisted per view) and an optimistic cell writer whose failure toast
 * offers Retry.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast as sonnerToast } from 'sonner';
import { useApi, useBoard, useOrgId } from '@/lib/hooks';
import { errorMessage, patchItemInCaches, restore, snapshot, toastError } from '@/lib/hooks/cache';
import { queryKeys } from '@/lib/query-keys';
import type { ColumnDto, ItemDto, ViewDto } from '@/server/services/contracts/dto';
import { createConfigWriter, type ConfigWriter } from './lib/config-writer';
import { applyViewFilters, type ViewFilterInput } from './lib/filter';

export function useViewModel(boardId: string, view: ViewDto) {
  const query = useBoard(boardId);
  const [search, setSearch] = useState('');
  // Typing stays responsive: filtering big boards runs at low priority.
  const deferredSearch = useDeferredValue(search);
  const payload = query.data;
  const columns = useMemo<ColumnDto[]>(
    () => (payload?.columns ?? []).filter((column) => column.scope === 'item'),
    [payload?.columns],
  );
  const groups = useMemo(() => (payload?.groups ?? []).filter((group) => !group.archivedAt), [payload?.groups]);
  const allItems = useMemo(
    () => (payload?.items ?? []).filter((item) => !item.parentItemId && !item.archivedAt && !item.deletedAt),
    [payload?.items],
  );
  const config = view.config;
  const savedFilters = config as ViewFilterInput;
  const items = useMemo(
    () =>
      applyViewFilters(allItems, columns, {
        filters: savedFilters.filters ?? null,
        personFilter: savedFilters.personFilter ?? null,
        search: [savedFilters.search, deferredSearch].filter(Boolean).join(' ') || null,
      }),
    [allItems, columns, savedFilters.filters, savedFilters.personFilter, savedFilters.search, deferredSearch],
  );
  const isFiltered = items.length !== allItems.length;
  const noun = payload?.board.itemTerminology || 'Item';
  return {
    query,
    board: payload?.board,
    columns,
    groups,
    users: payload?.users ?? [],
    allItems,
    items,
    isFiltered,
    search,
    setSearch,
    clearSearch: () => setSearch(''),
    noun,
    canEdit: payload?.board.canEdit ?? false,
  };
}

/**
 * Persist a slice of the view config under `namespace` (`kanban`, `calendar`…). The write is
 * optimistic; rapid edits are coalesced (trailing 350ms) and serialized so typing never spams
 * the API and late responses never overwrite newer keystrokes. `serverOwned` keys are kept in
 * the local echo but never sent (e.g. a form's token / published / responseCount).
 */
export function useViewConfig<T extends Record<string, unknown>>(
  boardId: string,
  view: ViewDto,
  namespace: string,
  options: { readonly serverOwned?: readonly string[] } = {},
) {
  const api = useApi();
  const queryClient = useQueryClient();
  const orgId = useOrgId();
  const [saving, setSaving] = useState(false);
  const current = (view.config[namespace] ?? {}) as T;
  const serverOwnedKey = (options.serverOwned ?? []).join(',');
  const contextRef = useRef({ api, queryClient, orgId, boardId, viewId: view.id, namespace, serverOwned: serverOwnedKey });
  useEffect(() => {
    contextRef.current = { api, queryClient, orgId, boardId, viewId: view.id, namespace, serverOwned: serverOwnedKey };
  }, [api, queryClient, orgId, boardId, view.id, namespace, serverOwnedKey]);

  // One writer per hook instance, created lazily from event handlers (never during render).
  const writerRef = useRef<ConfigWriter<Record<string, unknown>> | null>(null);
  const getWriter = useCallback((): ConfigWriter<Record<string, unknown>> => {
    writerRef.current ??= createConfigWriter<Record<string, unknown>>({
      delayMs: 350,
      send: (slice) => {
        const ctx = contextRef.current;
        const omit = ctx.serverOwned ? ctx.serverOwned.split(',') : [];
        const outgoing = Object.fromEntries(Object.entries(slice).filter(([key]) => !omit.includes(key)));
        return ctx.api.views.update(ctx.viewId, { config: { [ctx.namespace]: outgoing } as never });
      },
      onBusyChange: setSaving,
      onSettled: (result) => {
        const ctx = contextRef.current;
        const fresh = result as ViewDto;
        ctx.queryClient.setQueryData(queryKeys.boardPayload(ctx.orgId, ctx.boardId), (payload: { views: ViewDto[] } | undefined) =>
          payload ? { ...payload, views: payload.views.map((entry) => (entry.id === fresh.id ? fresh : entry)) } : payload,
        );
      },
      onError: (error) => {
        const ctx = contextRef.current;
        toastError(error, 'Could not save the view');
        void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.boardPayload(ctx.orgId, ctx.boardId) });
      },
    });
    return writerRef.current;
  }, []);

  const save = useCallback(
    (patch: Partial<T>, saveOptions: { immediate?: boolean } = {}) => {
      const base = (view.config[namespace] ?? {}) as Record<string, unknown>;
      const next = getWriter().edit(base, patch as Record<string, unknown>, saveOptions.immediate);
      // Optimistic local echo so the view reacts instantly even while the write is debounced.
      queryClient.setQueryData(queryKeys.boardPayload(orgId, boardId), (payload: { views: ViewDto[] } | undefined) =>
        payload
          ? {
              ...payload,
              views: payload.views.map((entry) => {
                if (entry.id !== view.id) return entry;
                const stored = (entry.config[namespace] ?? {}) as Record<string, unknown>;
                const kept = Object.fromEntries((options.serverOwned ?? []).filter((key) => key in stored).map((key) => [key, stored[key]]));
                return { ...entry, config: { ...entry.config, [namespace]: { ...next, ...kept } } };
              }),
            }
          : payload,
      );
    },
    [boardId, getWriter, namespace, options.serverOwned, orgId, queryClient, view.config, view.id],
  );

  // Final flush on unmount only.
  useEffect(() => () => writerRef.current?.dispose(), []);

  return { settings: current, save, saving };
}

export interface CellWriteOptions {
  /** Toast title on failure, e.g. "Couldn't move deal". */
  readonly failure: string;
  /** Extra name patch (e.g. rename while scheduling). */
  readonly onSuccess?: (item: ItemDto) => void;
}

/** Optimistic single-cell write; on failure rolls back and toasts with a Retry action. */
export function useCellWriter(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const write = useCallback(
    (itemId: string, columnKey: string, value: unknown, options: CellWriteOptions): Promise<void> => {
      const run = async (): Promise<void> => {
        const saved = await snapshot(queryClient, queryKeys.board(orgId, boardId));
        patchItemInCaches(queryClient, orgId, boardId, itemId, (item) => {
          const values = { ...item.values } as Record<string, unknown>;
          if (value === null || value === undefined) delete values[columnKey];
          else values[columnKey] = value;
          return { ...item, values: values as ItemDto['values'], updatedAt: new Date().toISOString() };
        });
        try {
          const fresh = await api.items.setCell(itemId, columnKey, value);
          patchItemInCaches(queryClient, orgId, boardId, itemId, () => fresh);
          options.onSuccess?.(fresh);
          void queryClient.invalidateQueries({ queryKey: queryKeys.itemActivity(orgId, itemId) });
        } catch (error) {
          restore(queryClient, saved);
          sonnerToast.error(options.failure, {
            description: errorMessage(error, 'The change was not saved. Try again.'),
            action: { label: 'Retry', onClick: () => void run() },
          });
        }
      };
      return run();
    },
    [api, boardId, orgId, queryClient],
  );

  return write;
}

/** Element size via ResizeObserver (charts need explicit pixel sizes). Returns [measure, size]. */
export function useElementSize<T extends HTMLElement>(): readonly [(element: T | null) => void, { width: number; height: number }] {
  const [node, setNode] = useState<T | null>(null);
  const measure = useCallback((element: T | null) => setNode(element), []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
          ? previous
          : { width: Math.floor(width), height: Math.floor(height) },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [measure, size] as const;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCED_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** True when the user prefers reduced motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false);
}

/** True while a CSS media query matches (false during SSR). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

const SHORTCUTS_KEY = 'ks.boardViews.shortcuts';
const SHORTCUTS_EVENT = 'ks:board-view-shortcuts';

function readShortcuts(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function subscribeShortcuts(onChange: () => void): () => void {
  window.addEventListener(SHORTCUTS_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SHORTCUTS_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Per-viewer toggle for the single-key view shortcuts (WCAG 2.1.4). Stored in localStorage as a
 * per-browser convenience; defaults to on.
 */
export function useViewShortcutsEnabled(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeShortcuts, readShortcuts, () => true);
  const setEnabled = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SHORTCUTS_KEY, next ? 'on' : 'off');
    } catch {
      // Storage blocked: the toggle still applies for this tab via the event below.
    }
    window.dispatchEvent(new Event(SHORTCUTS_EVENT));
  }, []);
  return [enabled, setEnabled] as const;
}
