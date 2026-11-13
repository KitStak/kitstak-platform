'use client';
/**
 * Per-viewer view preferences (zoom, grouping, toggles) for the Timeline, Calendar and Workload
 * views, remembered per project in this browser. Storage can be missing or blocked (private
 * windows, previews), so every read and write is guarded and the defaults always render.
 */
import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'ks-projects:view:';

function read<T extends object>(key: string, defaults: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    return { ...defaults, ...(parsed as Partial<T>) };
  } catch {
    return defaults;
  }
}

function write(key: string, value: object): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the preference simply isn't remembered.
  }
}

/**
 * `const [prefs, setPrefs] = useViewPrefs('timeline:OPS', { zoom: 'week' })`. The first render uses
 * the defaults (so server and client HTML match); stored values load right after mount.
 */
export function useViewPrefs<T extends object>(key: string, defaults: T): readonly [T, (patch: Partial<T>) => void] {
  const [prefs, setPrefsState] = useState<T>(defaults);
  useEffect(() => {
    // Loading from storage after mount keeps server HTML and the first client render identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefsState(read(key, defaults));
    // Defaults are a literal at the call site; only the key decides what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const setPrefs = useCallback(
    (patch: Partial<T>) => {
      setPrefsState((current) => {
        const next = { ...current, ...patch };
        write(key, next);
        return next;
      });
    },
    [key],
  );
  return [prefs, setPrefs] as const;
}

/** True below the `sm` breakpoint (640px): views switch to their compact phone layout. */
export function useIsNarrow(query = '(max-width: 639px)'): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return narrow;
}
