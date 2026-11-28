import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { Teach } from '@/components/crew/teach';
import { Badge } from '@/components/ui';
import { NAV_ICONS } from '@/features/shell/nav-icons';
import { PAGE_ICONS } from '@/features/phase/page-icons';
import { navFor } from '@/lib/nav';
import { arrivesIn, CREW_PAGES } from '@/lib/pages';
import { canCrew } from '@/lib/permissions';
import { pageFor } from '@/server/page';

export const metadata: Metadata = { title: 'Search' };

const matches = (q: string, ...texts: readonly string[]): boolean => q === '' || texts.some((text) => text.toLowerCase().includes(q));

/** `/search` (SPEC 6.1): every page the person may open, filtered by `?q=`. People search arrives in phase 1. */
export default async function SearchPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = (typeof params.q === 'string' ? params.q : '').trim().toLowerCase();
  const { access, locked } = await pageFor(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  if (locked) return null;
  const nav = navFor(access.role).filter((entry) => matches(q, entry.label, entry.description, ...entry.keywords));
  const pages = CREW_PAGES.filter((page) => !page.path.includes('[') && page.needs !== 'self' && canCrew(access.role, page.needs) && !nav.some((entry) => entry.href === page.path) && matches(q, page.title, page.why));
  return (
    <Page title="Search" subtitle="Every Crew page you can open. Press Ctrl K anywhere to jump straight there.">
      <form action="/search" className="mb-4 flex max-w-xl items-center gap-2 rounded-md border border-border-input bg-panel px-3">
        <Search aria-hidden className="size-4 text-icon" />
        <label htmlFor="search-q" className="sr-only">
          Search pages
        </label>
        <input id="search-q" name="q" defaultValue={q} placeholder="Search pages" className="h-10 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-placeholder" />
      </form>
      {nav.length === 0 && pages.length === 0 ? (
        <Panel>
          <Teach icon={Search} title="Nothing matches that" why="Try another word. Finding people by name or number arrives in phase 1." size="sm" />
        </Panel>
      ) : (
        <Panel bodyClassName="p-0">
          <ul className="divide-y divide-border-subtle" data-testid="search-results">
            {nav.map((entry) => {
              const Icon = NAV_ICONS[entry.id];
              return (
                <li key={entry.id}>
                  <Link href={entry.href} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
                    <Icon aria-hidden className="size-4 text-icon" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium text-fg">{entry.label}</span>
                      <span className="truncate text-sm text-fg-muted">{entry.description}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
            {pages.map((page) => {
              const Icon = PAGE_ICONS[page.icon];
              return (
                <li key={page.id}>
                  <Link href={page.path} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
                    <Icon aria-hidden className="size-4 text-icon" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium text-fg">{page.title}</span>
                      <span className="truncate text-sm text-fg-muted">{page.why}</span>
                    </span>
                    {page.phase > 0 ? <Badge tone="neutral">{arrivesIn(page.phase)}</Badge> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </Page>
  );
}
