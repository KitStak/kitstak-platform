'use client';
import { DARK_QUERY, persistTheme, type ResolvedTheme } from '@kitstak/ui/theme';

function currentTheme(): ResolvedTheme {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Flips light/dark and persists it to the shared kitstak-theme cookie + localStorage.
 * Called from the account menu; callers swap their icons with the `dark:` variant so they
 * never read the theme during render (keeps SSR markup stable).
 */
export function toggleTheme(): void {
  const next: ResolvedTheme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  persistTheme(next);
}
