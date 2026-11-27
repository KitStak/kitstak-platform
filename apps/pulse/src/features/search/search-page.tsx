import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight, FileSpreadsheet, FileText, SearchX, TextSearch } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { NAV_ICONS } from '@/features/shell/nav-icons';
import { routes } from '@/lib/routes';
import { searchPulse, type SearchHit, type SearchKind } from '@/lib/search';
import type { SearchHitDTO } from '@/lib/types';
import { searchAll } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { RECORD_KINDS, RECORD_KIND_ORDER } from './record-kinds';
import { SearchForm } from './search-form';

const KIND_LABELS: Readonly<Record<SearchKind, string>> = {
  page: 'Pages',
  report: 'Reports',
  stream: 'Data files',
};
const KINDS: readonly SearchKind[] = ['page', 'report', 'stream'];
const RECORD_LIMIT = 10;

function HitIcon({ hit }: { readonly hit: SearchHit }) {
  if (hit.kind === 'page' && hit.nav) {
    const Icon = NAV_ICONS[hit.nav];
    return <Icon aria-hidden className="size-[18px]" />;
  }
  return hit.kind === 'report' ? (
    <FileText aria-hidden className="size-[18px]" />
  ) : (
    <FileSpreadsheet aria-hidden className="size-[18px]" />
  );
}

interface HitRowProps {
  readonly href: string;
  readonly kind: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail: string | null;
  /** The kind of record, shown as a small tag. */
  readonly tag?: string;
}

function HitRow({ href, kind, icon, title, detail, tag }: HitRowProps) {
  return (
    <li>
      <Link
        href={href}
        data-testid="search-hit"
        data-kind={kind}
        className="group flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-icon-strong">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{title}</span>
          {detail ? <span className="block truncate text-sm text-fg-muted">{detail}</span> : null}
        </span>
        {tag ? (
          <span className="hidden shrink-0 rounded-sm bg-sunken px-1.5 py-0.5 text-xs text-fg-secondary sm:inline">
            {tag}
          </span>
        ) : null}
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

function RecordPanels({ records }: { readonly records: readonly SearchHitDTO[] }) {
  return RECORD_KIND_ORDER.map((kind) => {
    const rows = records.filter((hit) => hit.type === kind);
    if (rows.length === 0) return null;
    const info = RECORD_KINDS[kind];
    const Icon = info.icon;
    return (
      <Panel key={kind} title={`${info.plural} (${rows.length})`} bodyClassName="p-1.5">
        <ul>
          {rows.map((hit) => (
            <HitRow
              key={`${hit.type}-${hit.id}`}
              href={hit.href}
              kind={hit.type}
              icon={<Icon aria-hidden className="size-[18px]" />}
              title={hit.title}
              detail={hit.subtitle}
              tag={info.label}
            />
          ))}
        </ul>
      </Panel>
    );
  });
}

function PagePanels({ hits }: { readonly hits: readonly SearchHit[] }) {
  return KINDS.map((kind) => {
    const rows = hits.filter((hit) => hit.kind === kind);
    if (rows.length === 0) return null;
    return (
      <Panel key={kind} title={`${KIND_LABELS[kind]} (${rows.length})`} bodyClassName="p-1.5">
        <ul>
          {rows.map((hit) => (
            <HitRow
              key={`${hit.kind}-${hit.id}`}
              href={hit.href}
              kind={hit.kind}
              icon={<HitIcon hit={hit} />}
              title={hit.title}
              detail={hit.detail}
            />
          ))}
        </ul>
      </Panel>
    );
  });
}

/** Search: `/search?q=`. Finds jobs, clients, job types, extra services, pages, reports and data files. The command palette sends people here. */
export async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).q;
  const query = ((Array.isArray(raw) ? raw[0] : raw) ?? '').trim().slice(0, 120);
  const page = await pulsePage(routes.search(query || undefined));
  if (page.blocked) return <PageBlocked title="Search" role={page.access.role} />;
  const hits = searchPulse(query, { role: page.access.role, seesMoney: page.access.seesMoney });
  // Records come on top of pages: if that lookup fails, the page results still show.
  const records: readonly SearchHitDTO[] = query
    ? await searchAll(page.ctx, query, RECORD_LIMIT).catch((error: unknown) => {
        console.error('[pulse] record search failed', { orgId: page.ctx.orgId, error });
        return [];
      })
    : [];
  return (
    <Page title="Search" subtitle="Find a job, a client, a page or a report." width="narrow">
      <div className="flex flex-col gap-5">
        <SearchForm key={query} initial={query} />
        {query.length === 0 ? (
          <Panel>
            <Teach
              size="sm"
              icon={TextSearch}
              title="What are you looking for?"
              why="Type a job number like J-1026, a client name, or a word like margin or payroll. You can also press Ctrl K anywhere in Pulse to search as you type."
            />
          </Panel>
        ) : hits.length + records.length === 0 ? (
          <Panel>
            <Teach
              size="sm"
              testId="search-empty"
              icon={SearchX}
              title={`Nothing matches “${query}”`}
              why="Try a shorter word, a job number, part of a client name, or a word from the menu like jobs, labor or profit."
            />
          </Panel>
        ) : (
          <>
            <RecordPanels records={records} />
            <PagePanels hits={hits} />
          </>
        )}
      </div>
    </Page>
  );
}
