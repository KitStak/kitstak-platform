'use client';
/**
 * Sending side of the cross-app theme handoff (receiving side: `extractThemeHandoff`
 * in each app's proxy). Theme stores are per origin, so when the user navigates to a
 * sibling KitStak app the stored preference rides along as a `ks-theme` URL param.
 *
 * `ThemeHandoff` is a mount-once, render-nothing component: a capture-phase click
 * listener rewrites the href of any anchor pointing at a sibling app origin just
 * before navigation. Catching clicks (not render-time hrefs) keeps the param current
 * after in-page theme toggles and covers every present and future cross-app link
 * without per-link wiring. `withThemeParam` is the manual escape hatch for
 * programmatic navigation (`window.open`).
 */
import * as React from 'react';
import {
  parseStoredTheme,
  THEME_COOKIE,
  THEME_STORAGE_KEY,
  THEME_URL_PARAM,
  type ResolvedTheme,
} from './theme';

const COOKIE_PATTERN = new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`);

/**
 * The user's explicitly stored preference, or null when they follow the OS.
 * Only an explicit choice is handed off: with nothing stored anywhere, every
 * app already follows `prefers-color-scheme` and agrees on its own.
 */
export function storedTheme(): ResolvedTheme | null {
  const match = COOKIE_PATTERN.exec(document.cookie);
  const fromCookie = parseStoredTheme(match && decodeURIComponent(match[1]));
  if (fromCookie) return fromCookie;
  try {
    return parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null; // storage blocked (private mode)
  }
}

/** Append the stored theme as `ks-theme` to a cross-app URL (no-op when following the OS). */
export function withThemeParam(href: string): string {
  const theme = storedTheme();
  if (!theme) return href;
  try {
    const url = new URL(href, window.location.href);
    url.searchParams.set(THEME_URL_PARAM, theme);
    return url.toString();
  } catch {
    return href;
  }
}

export interface ThemeHandoffProps {
  /** Sibling KitStak app origins (full URLs are fine; only the origin is compared). */
  readonly appUrls: readonly string[];
}

function toOrigins(appUrls: readonly string[]): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const appUrl of appUrls) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // Ignore malformed configuration; the link then navigates without a handoff.
    }
  }
  return origins;
}

/** Mount once per app (render-nothing) to carry the theme on every cross-app anchor click. */
export function ThemeHandoff({ appUrls }: ThemeHandoffProps) {
  React.useEffect(() => {
    const origins = toOrigins(appUrls);

    const rewrite = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.origin === window.location.origin || !origins.has(anchor.origin)) return;
      anchor.href = withThemeParam(anchor.href);
    };

    // Capture phase + auxclick: runs before navigation for plain, new-tab and middle clicks.
    document.addEventListener('click', rewrite, true);
    document.addEventListener('auxclick', rewrite, true);
    return () => {
      document.removeEventListener('click', rewrite, true);
      document.removeEventListener('auxclick', rewrite, true);
    };
  }, [appUrls]);

  return null;
}
