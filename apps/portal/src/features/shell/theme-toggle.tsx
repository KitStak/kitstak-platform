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
 * Light/dark toggle persisting to the shared kitstak-theme cookie + localStorage.
 * Stateless on purpose: the icon pair swaps via the `dark:` variant, so the component
 * never needs to read the theme during render (keeps SSR markup stable).
 */
/** Flips the theme and saves the choice. Shared by the top bar button and the account menu row. */
export function toggleTheme(): void {
  const next: ResolvedTheme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  persistTheme(next);
}

export function ThemeToggle({ className }: { readonly className?: string }) {
  const toggle = toggleTheme;

  return (
    <button
      type="button"
      onClick={toggle}
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
