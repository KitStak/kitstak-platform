'use client';
/**
 * Full-screen KitStak handoff screen: the company loader (`/brand/kitstak-loader-kitstak.svg`,
 * shipped in every app's public/brand) plus a short status line. Used while sign-in completes and
 * while the app switcher hands off to another KitStak app. Tokens only, so it follows the theme.
 * The loader SVG stops animating for people who prefer reduced motion.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import './handoff.css';

export const COMPANY_LOADER_SRC = '/brand/kitstak-loader-kitstak.svg';

export interface HandoffScreenProps {
  /** Main line, e.g. "Signing you in" or "Opening KitStak CRM". */
  readonly title: string;
  /** Optional second line. */
  readonly detail?: string;
  /** Loader size in px (default 72). */
  readonly size?: number;
}

/** Inline (non-portal) version: fills its container. Handy for route loading states on auth pages. */
export function HandoffPanel({ title, detail, size = 72 }: HandoffScreenProps) {
  return (
    <div role="status" aria-live="polite" className="ks-handoff-panel" data-testid="kitstak-handoff">
      {/* eslint-disable-next-line @next/next/no-img-element -- animated SVG must stay an <img> */}
      <img src={COMPANY_LOADER_SRC} width={size} height={size} alt="Loading" className="ks-handoff-loader" />
      <p className="ks-handoff-title">{title}</p>
      {detail ? <p className="ks-handoff-detail">{detail}</p> : null}
    </div>
  );
}

/** Fixed full-viewport overlay rendered into document.body. */
export function HandoffScreen(props: HandoffScreenProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="ks-handoff-overlay">
      <HandoffPanel {...props} />
    </div>,
    document.body,
  );
}

/**
 * State helper for a navigation that leaves the page: returns `[active, start]`. The overlay is
 * cleared again when the page is restored from the back/forward cache, so Back never shows a
 * stuck loader.
 */
export function useHandoff(): readonly [active: boolean, start: () => void, stop: () => void] {
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setActive(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  const start = React.useCallback(() => setActive(true), []);
  const stop = React.useCallback(() => setActive(false), []);
  return [active, start, stop] as const;
}
