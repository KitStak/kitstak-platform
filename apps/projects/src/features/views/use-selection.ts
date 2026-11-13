'use client';
/**
 * Multi-select for list rows / table rows: click toggles, Shift+click selects a range in the
 * visible order, Cmd/Ctrl+A (from the view) selects everything visible, Escape clears.
 * Selected ids that disappear from the view (filtered out, deleted) are dropped.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

export interface Selection {
  readonly ids: ReadonlySet<string>;
  readonly count: number;
  has(id: string): boolean;
  toggle(id: string, options?: { readonly range?: boolean }): void;
  set(ids: Iterable<string>): void;
  selectAll(): void;
  clear(): void;
}

export function useSelection(orderedIds: readonly string[]): Selection {
  const [raw, setRaw] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const visible = useMemo(() => new Set(orderedIds), [orderedIds]);
  const ids = useMemo(() => {
    const next = new Set<string>();
    for (const id of raw) if (visible.has(id)) next.add(id);
    return next;
  }, [raw, visible]);

  const toggle = useCallback(
    (id: string, options: { readonly range?: boolean } = {}) => {
      setRaw((current) => {
        const next = new Set(current);
        if (options.range && anchor.current && anchor.current !== id) {
          const from = orderedIds.indexOf(anchor.current);
          const to = orderedIds.indexOf(id);
          if (from >= 0 && to >= 0) {
            const [start, end] = from < to ? [from, to] : [to, from];
            for (const entry of orderedIds.slice(start, end + 1)) next.add(entry);
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
    },
    [orderedIds],
  );

  const set = useCallback((entries: Iterable<string>) => setRaw(new Set(entries)), []);
  const selectAll = useCallback(() => setRaw(new Set(orderedIds)), [orderedIds]);
  const clear = useCallback(() => {
    anchor.current = null;
    setRaw(new Set());
  }, []);
  const has = useCallback((id: string) => ids.has(id), [ids]);

  return { ids, count: ids.size, has, toggle, set, selectAll, clear };
}
