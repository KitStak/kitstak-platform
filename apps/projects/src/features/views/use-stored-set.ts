'use client';
/**
 * A per-browser set of ids (collapsed board columns, collapsed list groups…) kept in local
 * storage. Starts empty on the server and the first client render, then loads (no hydration
 * mismatch). Personal convenience only: it is never shared or saved to a view.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface StoredSet {
  readonly values: ReadonlySet<string>;
  has(id: string): boolean;
  toggle(id: string): void;
  set(ids: Iterable<string>): void;
}

export function useStoredSet(key: string): StoredSet {
  const [state, setState] = useState<{ key: string; values: ReadonlySet<string> }>({ key: '', values: new Set() });
  useEffect(() => {
    let values: ReadonlySet<string> = new Set();
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(parsed)) values = new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
    } catch {
      // Unreadable storage: start empty.
    }
    // Load from local storage (an external system) once the key is known.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ key, values });
  }, [key]);
  const values = useMemo(() => (state.key === key ? state.values : new Set<string>()), [key, state]);

  const persist = useCallback(
    (next: ReadonlySet<string>) => {
      setState({ key, values: next });
      try {
        if (next.size) window.localStorage.setItem(key, JSON.stringify([...next]));
        else window.localStorage.removeItem(key);
      } catch {
        // Storage full or blocked: the toggle still works for this visit.
      }
    },
    [key],
  );

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(values);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist(next);
    },
    [persist, values],
  );
  const set = useCallback((ids: Iterable<string>) => persist(new Set(ids)), [persist]);
  const has = useCallback((id: string) => values.has(id), [values]);
  return { values, has, toggle, set };
}
