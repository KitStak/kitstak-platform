import Link from 'next/link';
import { ChevronRight, FileSpreadsheet, FileText, SearchX, TextSearch } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { NAV_ICONS } from '@/features/shell/nav-icons';
import { routes } from '@/lib/routes';
import { searchPulse, type SearchHit, type SearchKind } from '@/lib/search';
import { pulsePage } from '@/server/page';
import { SearchForm } from './search-form';

const KIND_LABELS: Readonly<Record<SearchKind, string>> = { page: 'Pages', report: 'Reports', stream: 'Data files' };
const KINDS: readonly SearchKind[] = ['page', 'report', 'stream'];

function HitIcon({ hit }: { readonly hit: SearchHit }) {
  if (hit.kind === 'page' && hit.nav) {
    const Icon = NAV_ICONS[hit.nav];
    return <Icon aria-hidden className="size-[18px]" />;
  }
  return hit.kind === 'report' ? <FileText aria-hidden className="size-[18px]" /> : <FileSpreadsheet aria-hidden className="size-[18px]" />;
}

/** Search: `/search?q=`. Finds pages, reports and data files; the command palette sends people here. */
export async function SearchPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).q;
  const query = ((Array.isArray(raw) ? raw[0] : raw) ?? '').trim().slice(0, 120);
  const page = await pulsePage(routes.search(query || undefined));
  if (page.blocked) return <PageBlocked title="Search" role={page.access.role} />;
  const hits = searchPulse(query, { role: page.access.role, seesMoney: page.access.seesMoney });
  return (
    <Page title="Search" subtitle="Find a page, a report or a data file." width="narrow">
      <div className="flex flex-col gap-5">
        <SearchForm key={query} initial={query} />
        {query.length === 0 ? (
          <Panel>
            <Teach
              size="sm"
              icon={TextSearch}
              title="What are you looking for?"
              why="Type a word or two, like margin, payroll or scrap. You can also press the search key anywhere in Pulse to jump straight to a page."
            />
          </Panel>
        ) : hits.length === 0 ? (
          <Panel>
            <Teach
              size="sm"
              testId="search-empty"
              icon={SearchX}
              title={`Nothing matches “${query}”`}
              why="Try a shorter word, or one from the menu, like jobs, labor, profit or import."
            />
          </Panel>
        ) : (
          KINDS.map((kind) => {
            const rows = hits.filter((hit) => hit.kind === kind);
            if (rows.length === 0) return null;
            return (
              <Panel key={kind} title={`${KIND_LABELS[kind]} (${rows.length})`} bodyClassName="p-1.5">
                <ul>
                  {rows.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <Link href={hit.href} data-testid="search-hit" className="group flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-icon-strong">
                          <HitIcon hit={hit} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-fg">{hit.title}</span>
                          <span className="block truncate text-sm text-fg-muted">{hit.detail}</span>
                        </span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })
        )}
      </div>
    </Page>
  );
}
