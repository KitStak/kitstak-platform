'use client';
import { useEffect, useRef } from 'react';
import { parseHandoffIdentity, type HandoffIdentity } from '@kitstak/billing/handoff';

/**
 * Reads name, email and company from the part of the link after the "#", once, then takes them
 * out of the address bar. That part of a link never reaches a server or a log, which is why the
 * marketing site and the auth screens pass personal details there.
 *
 * `onReady` runs once after the first paint with what was found (empty when nothing was passed).
 * The values are kept in a ref, so React's double run of effects in development cannot lose them.
 */
export function useHashIdentity(onReady: (identity: HandoffIdentity) => void, options: { strip?: boolean } = {}): void {
  const captured = useRef<HandoffIdentity | null>(null);
  const callback = useRef(onReady);
  const strip = options.strip ?? true;

  useEffect(() => {
    callback.current = onReady;
  });

  useEffect(() => {
    if (captured.current === null) {
      captured.current = parseHandoffIdentity(window.location.hash);
      if (strip && window.location.hash) {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      }
    }
    const identity = captured.current;
    const frame = requestAnimationFrame(() => callback.current(identity));
    return () => cancelAnimationFrame(frame);
  }, [strip]);
}

/** True on devices with a mouse or trackpad. Fields are focused for them, never on phones. */
export function prefersAutoFocus(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
