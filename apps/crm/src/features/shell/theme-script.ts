/**
 * Shared (server + client) theme constants. Not a client module so the server layout can read
 * them. The cross-app contract (cookie name, parsing, cookie string) comes from @kitstak/ui so
 * CRM and WMS cannot drift; this module only adapts it to CRM's existing API shape.
 */
import {
  THEME_COOKIE,
  parseStoredTheme,
  themeCookieString as sharedThemeCookieString,
} from '@kitstak/ui/theme';

/**
 * Cookie mirror of the theme preference (shared constant, `kitstak-theme`). The root layout
 * reads it on the server and renders `<html data-theme>` directly, so no inline script is needed
 * to avoid a flash of the wrong theme (an inline <script> in the React tree logs a console error
 * whenever React client-renders the root, e.g. on not-found pages). With no cookie, tokens.css
 * follows `prefers-color-scheme`.
 */
export { THEME_COOKIE };

/**
 * localStorage key for the preference. Deliberately CRM's historical key (`kitstak.theme`, not
 * the shared `kitstak-theme`) so existing users keep their saved preference; the cross-app
 * contract is the cookie, which wins everywhere.
 */
export const THEME_STORAGE_KEY = 'kitstak.theme';

export type StoredTheme = 'light' | 'dark';

export function parseThemeCookie(value: string | undefined | null): StoredTheme | null {
  return parseStoredTheme(value);
}

/** Cookie string for `document.cookie` (null clears it, i.e. "follow the system"). */
export function themeCookieString(theme: StoredTheme | null): string {
  return sharedThemeCookieString(theme ?? 'system');
}
