/**
 * Unified KitStak theme constants, shared by Portal, CRM and WMS so the preference
 * follows the user across apps (BLUEPRINT.md §4).
 *
 * Two stores, one value:
 * - cookie `kitstak-theme` — server-readable (CRM renders `<html data-theme>`
 *   from it); it WINS when both stores disagree.
 * - localStorage `kitstak-theme` — client mirror, powers cross-tab sync.
 *
 * `persistTheme` writes both stores on every change so they never drift.
 *
 * Both stores are PER ORIGIN. In production the three apps live on different
 * domains (separate Vercel projects), so a preference saved in one app cannot
 * be read by another. Cross-app consistency instead rides on navigation: links
 * between KitStak apps carry the stored preference as a `ks-theme` URL param
 * (handoff.tsx appends it; each app's proxy consumes it via
 * `extractThemeHandoff` and persists the cookie before the page renders).
 */

export const THEME_COOKIE = 'kitstak-theme';
export const THEME_STORAGE_KEY = 'kitstak-theme';
/** Query param carrying the stored preference across app origins (see handoff.tsx). */
export const THEME_URL_PARAM = 'ks-theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Cookie lifetime; exported for proxy handlers that persist a handed-off theme. */
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Narrow an untrusted stored value (cookie or localStorage) to an explicit theme. */
export function parseStoredTheme(value: string | null | undefined): ResolvedTheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** Cookie string for `document.cookie`; 'system' clears the cookie ("follow the OS"). */
export function themeCookieString(theme: Theme): string {
  if (theme === 'system') return `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export interface ThemeHandoffResult {
  readonly theme: ResolvedTheme;
  /** The request URL with the `ks-theme` param removed (redirect target). */
  readonly cleanUrl: URL;
}

/**
 * Read a theme handed off by another KitStak app via the `ks-theme` URL param.
 * Returns null when the param is absent or not a valid theme. Framework-free so
 * each app's proxy (Next middleware) can use it: persist `theme` to the
 * `kitstak-theme` cookie and redirect to `cleanUrl`.
 */
export function extractThemeHandoff(url: URL): ThemeHandoffResult | null {
  const theme = parseStoredTheme(url.searchParams.get(THEME_URL_PARAM));
  if (!theme) return null;
  const cleanUrl = new URL(url);
  cleanUrl.searchParams.delete(THEME_URL_PARAM);
  return { theme, cleanUrl };
}

/**
 * Persist a preference to BOTH stores. 'system' clears them, so the pre-paint
 * script and tokens.css fall back to `prefers-color-scheme`.
 */
export function persistTheme(theme: Theme): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode): the cookie still carries the preference.
  }
  document.cookie = themeCookieString(theme);
}
