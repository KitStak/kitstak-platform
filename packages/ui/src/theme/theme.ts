/**
 * Unified KitStak theme constants, shared by CRM and WMS so the preference
 * follows the user across apps (BLUEPRINT.md §4).
 *
 * Two stores, one value:
 * - cookie `kitstak-theme` — server-readable (CRM renders `<html data-theme>`
 *   from it) and shared across subdomains; it WINS when both stores disagree.
 * - localStorage `kitstak-theme` — client mirror, powers cross-tab sync.
 *
 * `persistTheme` writes both stores on every change so they never drift.
 */

export const THEME_COOKIE = 'kitstak-theme';
export const THEME_STORAGE_KEY = 'kitstak-theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Narrow an untrusted stored value (cookie or localStorage) to an explicit theme. */
export function parseStoredTheme(value: string | null | undefined): ResolvedTheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** Cookie string for `document.cookie`; 'system' clears the cookie ("follow the OS"). */
export function themeCookieString(theme: Theme): string {
  if (theme === 'system') return `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
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
