'use client';

/**
 * Unsaved-changes guard hooks (BUILD_PLAN 0.3: guard on close or navigate).
 *   useBeforeUnload(dirty)    browser reload / tab close prompt
 *   useNavigationGuard(dirty) intercepts in-app <a> clicks and history back; the UI
 *                             (`UnsavedChangesGuard`) asks "No / Leave" then proceeds.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { startRouteProgress } from '@/components/layout/route-progress';

export function useBeforeUnload(active: boolean): void {
  React.useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Required by some browsers to show the native prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}

/** Internal same-origin navigation target of a click, or null when the click should pass. */
export function interceptableHref(
  event: Pick<
    MouseEvent,
    'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented' | 'target'
  >,
  origin: string,
): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return null;
  const target = event.target;
  if (typeof Element === 'undefined' || !(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download') || anchor.dataset.skipUnsavedGuard !== undefined) return null;
  const url = new URL(anchor.href, origin);
  if (url.origin !== origin) return null;
  const here = typeof window === 'undefined' ? null : window.location;
  if (here && url.pathname === here.pathname && url.search === here.search && url.hash) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface NavigationGuard {
  /** Destination waiting for confirmation (null when nothing is blocked). */
  readonly pendingHref: string | null;
  readonly proceed: () => void;
  readonly cancel: () => void;
}

export function useNavigationGuard(active: boolean): NavigationGuard {
  const router = useRouter();
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const bypass = React.useRef(false);

  React.useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const onClick = (event: MouseEvent): void => {
      if (bypass.current) return;
      const href = interceptableHref(event, window.location.origin);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  const proceed = React.useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    if (!href) return;
    bypass.current = true;
    startRouteProgress(href);
    router.push(href);
    // Released after the navigation has been scheduled.
    setTimeout(() => {
      bypass.current = false;
    }, 0);
  }, [pendingHref, router]);

  const cancel = React.useCallback(() => setPendingHref(null), []);
  return { pendingHref, proceed, cancel };
}
