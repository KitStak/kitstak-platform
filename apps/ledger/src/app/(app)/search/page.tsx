import type { Metadata } from 'next';
import Link from 'next/link';
import { Page } from '@/components/layout/page';
import { EmptyState } from '@/components/ui';
import { ledgerPage } from '@/server/page';
import { navFor } from '@/lib/nav';

export const metadata: Metadata = { title: 'Search' };

/** `/search?q=`: the pages a person may open that match. Finding invoices, customers and bills by name lands with those screens. */
export default async function SearchPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { q } = await searchParams;
  const query = (typeof q === 'string' ? q : '').trim().toLowerCase();
  const page = await ledgerPage(`/search${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const pages = navFor(page.access.rights).filter((entry) => !query || [entry.label, entry.description, ...entry.keywords].some((word) => word.toLowerCase().includes(query)));
  return (
    <Page title="Search" subtitle="Press Ctrl K or the slash key anywhere to search and run commands." width="narrow">
      <form action="/search" className="mb-4">
        <label htmlFor="search-q" className="sr-only">
          Search
        </label>
        <input
          id="search-q"
          name="q"
          defaultValue={query}
          placeholder="Search pages"
          className="h-10 w-full rounded-md border border-border-input bg-panel px-3 text-base text-fg focus-visible:outline-2 focus-visible:outline-focus"
        />
      </form>
      {pages.length === 0 ? (
        <EmptyState title="Nothing matches that" description="Try a page name like Invoices, Bills or Close." illustration="search" />
      ) : (
        <ul className="divide-y divide-border-subtle" data-testid="search-results">
          {pages.map((entry) => (
            <li key={entry.id} className="py-2.5">
              <Link href={entry.href} className="font-medium text-fg hover:underline">
                {entry.label}
              </Link>
              <p className="text-sm text-fg-secondary">{entry.description}</p>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
