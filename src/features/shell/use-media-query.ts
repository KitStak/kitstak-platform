'use client';
import { useMemo, useSyncExternalStore } from 'react';

/** Shell layout breakpoints (px), matching Tailwind's md / lg. */
export const SHELL_BREAKPOINTS = { drawer: 768, rail: 1024 } as const;

function subscribe(query: string) {
  return (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
}

/** Reactive `matchMedia`. Renders `serverValue` during SSR and hydration, then the live value. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscriber = useMemo(() => subscribe(query), [query]);
  return useSyncExternalStore(
    subscriber,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export type ShellLayout = 'drawer' | 'rail' | 'full';

/**
 * drawer: < 768px (off-canvas nav). At md and up the top bar carries the navigation; `rail` and
 * `full` only differ for components that still size themselves by width.
 */
export function useShellLayout(): ShellLayout {
  const isDrawer = useMediaQuery(`(max-width: ${SHELL_BREAKPOINTS.drawer - 0.02}px)`);
  const isRail = useMediaQuery(`(max-width: ${SHELL_BREAKPOINTS.rail - 0.02}px)`);
  if (isDrawer) return 'drawer';
  if (isRail) return 'rail';
  return 'full';
}
