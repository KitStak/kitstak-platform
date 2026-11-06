'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { THEME_STORAGE_KEY, parseThemeCookie, themeCookieString } from './theme-script';

export { THEME_STORAGE_KEY };

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const CHANGE_EVENT = 'kitstak:theme-change';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function syncCookie(preference: ThemePreference): void {
  const wanted = preference === 'system' ? null : preference;
  const current = parseThemeCookie(/(?:^|; )kitstak-theme=([^;]*)/.exec(document.cookie)?.[1]);
  if (current !== wanted) document.cookie = themeCookieString(wanted);
}

const systemPrefersDark = (): boolean => window.matchMedia(DARK_QUERY).matches;

function currentResolved(): ResolvedTheme {
  const preference = readPreference();
  if (preference !== 'system') return preference;
  return systemPrefersDark() ? 'dark' : 'light';
}

function subscribePreference(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage); // other tabs
  window.addEventListener(CHANGE_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function subscribeSystem(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Theme state lives in localStorage + the OS setting; React subscribes to both. */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribePreference,
    readPreference,
    () => 'system',
  );
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => false);
  const resolved: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    // Read the live value (not the hydration snapshot) so the first commit never flashes.
    document.documentElement.setAttribute('data-theme', currentResolved());
    // Keep the server-readable cookie in sync (migrates preferences saved before the cookie existed).
    syncCookie(readPreference());
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage unavailable: falls back to the OS preference */
    }
    syncCookie(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
