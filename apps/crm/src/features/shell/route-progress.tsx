'use client';
/**
 * Thin top progress bar for in-app navigations (the App Router exposes no route events).
 * It starts when a same-origin link is clicked (or `startRouteProgress()` is called before a
 * programmatic `router.push`) and completes when the pathname changes. It never shows for
 * navigations that resolve in under 120ms, so fast routes don't flicker.
 *
 * The click listener runs in the CAPTURE phase: next/link calls preventDefault() in its own
 * (React root) handler, so a bubble-phase document listener would always see a prevented event.
 * Links that never navigate can opt out with `data-no-progress`.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { shouldTrackLinkClick } from './route-progress-model';

const START_EVENT = 'kitstak:route-start';
const SHOW_DELAY_MS = 120;
const SAFETY_TIMEOUT_MS = 25_000;

/** Call right before a programmatic navigation to show the progress bar. */
export function startRouteProgress(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(START_EVENT));
}

type Phase = 'idle' | 'running' | 'done';

export function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);
  const pending = useRef(false);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  useEffect(() => {
    const start = () => {
      clearTimers();
      pending.current = true;
      timers.current.push(
        window.setTimeout(() => {
          if (pending.current) setPhase('running');
        }, SHOW_DELAY_MS),
        window.setTimeout(() => {
          pending.current = false;
          setPhase('idle');
        }, SAFETY_TIMEOUT_MS),
      );
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('data-no-progress')) return;
      if (
        shouldTrackLinkClick({
          href: anchor.href,
          target: anchor.target,
          download: anchor.hasAttribute('download'),
          button: event.button,
          modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
          defaultPrevented: event.defaultPrevented,
          current: window.location.href,
        })
      ) {
        start();
      }
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener(START_EVENT, start);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener(START_EVENT, start);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    clearTimers();
    setPhase((current) => (current === 'running' ? 'done' : 'idle'));
    timers.current.push(window.setTimeout(() => setPhase('idle'), 320));
  }, [pathname]);

  if (phase === 'idle') return null;
  return (
    <div
      aria-hidden
      data-testid="route-progress"
      className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-toast)] h-0.5 overflow-hidden"
    >
      <div
        className={
          phase === 'running'
            ? 'h-full origin-left animate-[ks-route-progress_8s_var(--ease-out)_forwards] bg-primary'
            : 'h-full origin-left scale-x-100 bg-primary opacity-0 transition-opacity duration-[var(--duration-slow)]'
        }
      />
    </div>
  );
}
