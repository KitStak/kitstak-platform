'use client';
import { useId, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { filterApps, type SearchableApp } from '@/lib/app-search';
import { cn } from '@/components/ui';

/**
 * One quiet line about the plan state of an app: days left in a free trial, a payment that is past
 * due (the app still opens), or view only. The page writes the words from the plan.
 */
export interface LauncherPlanNote {
  readonly text: string;
  readonly tone: 'muted' | 'warning' | 'danger';
}

export interface LauncherApp extends SearchableApp {
  readonly href: string;
  /** null: the app is on and there is nothing to say. */
  readonly planNote: LauncherPlanNote | null;
}

const NOTE_TONE: Readonly<Record<LauncherPlanNote['tone'], string>> = {
  muted: 'text-fg-muted',
  warning: 'font-medium text-warning-text',
  danger: 'font-medium text-danger-text',
};

/** One app: its icon, name and tagline. The whole tile opens the app in a new tab. */
function AppTile({ app }: { readonly app: LauncherApp }) {
  return (
    <a
      href={app.href}
      target="_blank"
      rel="noopener"
      data-testid={`tile-${app.module}`}
      className={cn(
        'group flex items-center gap-5 rounded-2xl border border-border-default bg-panel p-5 sm:gap-6 sm:p-6',
        'transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-out',
        'hover:border-border-strong hover:shadow-md',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
      )}
    >
      <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-sunken sm:size-20">
        <AppIcon app={app.module} size={64} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-lg font-semibold text-fg sm:text-xl">{app.name}</span>
        <span className="mt-0.5 text-sm text-fg-secondary sm:text-lg">{app.tagline}</span>
        {app.planNote ? (
          <span data-testid={`tile-plan-${app.module}`} data-tone={app.planNote.tone} className={cn('mt-1 text-xs', NOTE_TONE[app.planNote.tone])}>
            {app.planNote.text}
          </span>
        ) : null}
      </span>
      <ArrowRight
        aria-hidden
        className="size-5 shrink-0 text-icon transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5 group-hover:text-fg"
      />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** The home page: the apps on the plan, two to a row, and a search box that filters them. */
export function AppLauncher({ apps }: { readonly apps: readonly LauncherApp[] }) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const shown = filterApps(apps, query);

  return (
    <div className="flex flex-col gap-6">
      {shown.length > 0 ? (
        <section aria-label="Your apps" className="grid gap-5 sm:grid-cols-2">
          {shown.map((app) => (
            <AppTile key={app.module} app={app} />
          ))}
        </section>
      ) : (
        <p role="status" className="rounded-2xl border border-dashed border-border-default px-6 py-8 text-center text-md text-fg-secondary">
          No apps match “{query.trim()}”.
        </p>
      )}
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search apps
        </label>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-icon" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search apps…"
          autoComplete="off"
          className={cn(
            'h-14 w-full rounded-2xl border border-border-input bg-panel pr-5 pl-14 text-md text-fg placeholder:text-fg-muted',
            'hover:border-border-input-hover focus-visible:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
        />
      </div>
    </div>
  );
}
