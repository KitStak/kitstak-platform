/** Shared (server + client) theme constants. Not a client module so the server layout can read them. */
export const THEME_STORAGE_KEY = 'kitstak.theme';

/**
 * Cookie mirror of the theme preference. The root layout reads it on the server and renders
 * `<html data-theme>` directly, so no inline script is needed to avoid a flash of the wrong theme
 * (an inline <script> in the React tree logs a console error whenever React client-renders the
 * root, e.g. on not-found pages). With no cookie, tokens.css follows `prefers-color-scheme`.
 */
export const THEME_COOKIE = 'kitstak-theme';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type StoredTheme = 'light' | 'dark';

export function parseThemeCookie(value: string | undefined | null): StoredTheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** Cookie string for `document.cookie` (null clears it, i.e. "follow the system"). */
export function themeCookieString(theme: StoredTheme | null): string {
  if (!theme) return `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}
