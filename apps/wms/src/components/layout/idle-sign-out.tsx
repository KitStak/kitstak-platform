'use client';

/**
 * Company idle sign-out (Settings › Company Settings › Security). Activity in any KitStaks tab
 * (pointer, key, wheel, touch) is shared through localStorage, so a user working in one tab is
 * never signed out by another. A warning dialog with a live countdown appears
 * `IDLE_WARNING_SECONDS` before the end; "Stay signed in" resets the timer. At zero the session
 * is ended server-side (Better Auth `/api/auth/sign-out`) and every tab goes to /login.
 */
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Clock } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { IDLE_WARNING_SECONDS } from '@/lib/grid-defs/admin/company';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';

const ACTIVITY_KEY = 'ks.idle.lastActivity';
const SIGNED_OUT_KEY = 'ks.idle.signedOut';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;
const WRITE_THROTTLE_MS = 10_000;
const TICK_MS = 1_000;

/** Pure: idle phase for a timestamp. `remainingMs` counts down to the sign-out. */
export function idlePhase(
  lastActivityMs: number,
  nowMs: number,
  minutes: number,
  warningSeconds = IDLE_WARNING_SECONDS,
): { readonly phase: 'active' | 'warning' | 'expired'; readonly remainingMs: number } {
  const remainingMs = lastActivityMs + minutes * 60_000 - nowMs;
  if (remainingMs <= 0) return { phase: 'expired', remainingMs: 0 };
  return { phase: remainingMs <= warningSeconds * 1000 ? 'warning' : 'active', remainingMs };
}

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* storage blocked: this tab still tracks itself */
  }
}

export function IdleSignOut({ minutes }: { readonly minutes: number | null }) {
  const pathname = usePathname();
  const last = React.useRef(0);
  const written = React.useRef(0);
  const leaving = React.useRef(false);
  const [warning, setWarning] = React.useState<number | null>(null);
  // While the warning is open, passive movement must not silently dismiss it.
  const warningRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    warningRef.current = warning;
  }, [warning]);

  const touch = React.useCallback((force = false) => {
    const now = Date.now();
    last.current = now;
    if (force || now - written.current > WRITE_THROTTLE_MS) {
      written.current = now;
      writeShared(ACTIVITY_KEY, now);
    }
  }, []);

  const leave = React.useCallback(async (next: string) => {
    if (leaving.current) return;
    leaving.current = true;
    writeShared(SIGNED_OUT_KEY, Date.now());
    try {
      await authClient.signOut();
    } catch {
      /* the session may already be gone */
    }
    // A full page load is deliberate: it drops every piece of in-memory client state (as in the user menu).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?reason=idle&next=${encodeURIComponent(next)}`);
  }, []);

  React.useEffect(() => {
    if (!minutes) return;
    touch(true);
    const onActivity = () => {
      if (warningRef.current === null) touch();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNED_OUT_KEY && e.newValue)
        void leave(window.location.pathname + window.location.search);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(() => {
      const state = idlePhase(Math.max(last.current, readShared()), Date.now(), minutes);
      if (state.phase === 'expired') void leave(window.location.pathname + window.location.search);
      else setWarning(state.phase === 'warning' ? Math.ceil(state.remainingMs / 1000) : null);
    }, TICK_MS);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [minutes, touch, leave]);

  // Navigation counts as activity.
  React.useEffect(() => {
    if (minutes) touch();
  }, [pathname, minutes, touch]);

  if (!minutes) return null;
  return (
    <Dialog
      open={warning !== null}
      onOpenChange={(open) => {
        if (!open) {
          touch(true);
          setWarning(null);
        }
      }}
    >
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader title="Are you still there?" />
        <DialogBody className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
            <Clock className="h-4 w-4" aria-hidden />
          </span>
          <p className="text-sm text-body" aria-live="polite">
            For security, you&apos;ll be signed out in{' '}
            <strong className="tabular-nums">{warning ?? 0} seconds</strong> after {minutes} minutes without
            activity. Unsaved changes will be lost.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => void leave(window.location.pathname + window.location.search)}
          >
            Sign out now
          </Button>
          <Button
            variant="primary"
            autoFocus
            onClick={() => {
              touch(true);
              setWarning(null);
            }}
          >
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
