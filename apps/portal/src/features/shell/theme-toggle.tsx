'use client';
import { Moon, Sun } from 'lucide-react';
import { DARK_QUERY, persistTheme, type ResolvedTheme } from '@kitstak/ui/theme';
import { cn } from '@/components/ui';

function currentTheme(): ResolvedTheme {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Flips light/dark and persists it to the shared kitstak-theme cookie + localStorage.
 * Called from the account menu and from `ThemeToggle`; callers swap their icons with the `dark:`
 * variant so they never read the theme during render (keeps SSR markup stable).
 */
export function toggleTheme(): void {
  const next: ResolvedTheme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  persistTheme(next);
}

/**
 * The light/dark button for pages with no account menu: sign in and sign up, the "not a member"
 * and "not found" pages, the test checkout and the dev outbox. The signed-in shell has no such
 * button: its switch is in the account menu.
 */
export function ThemeToggle({ className }: { readonly className?: string }) {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light/dark theme"
      title="Toggle light/dark theme"
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-icon',
        'hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus',
        className,
      )}
    >
      <Sun aria-hidden className="size-4 dark:hidden" />
      <Moon aria-hidden className="hidden size-4 dark:inline" />
    </button>
  );
}
