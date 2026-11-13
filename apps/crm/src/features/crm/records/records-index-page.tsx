'use client';
/**
 * /crm/accounts and /crm/contacts index: a flat, searchable list of every record on the
 * primary board, each row linking into its 360 page. Chrome (PageFrame, breadcrumbs, the
 * "Open board" action) matches /crm/pipeline and /crm/duplicates.
 */
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, ExternalLink, UserRound } from 'lucide-react';
import {
  buttonVariants,
  EmptyState,
  SearchInput,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  cn,
} from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { PageFrame } from '@/features/shell/pages/page-frame';
import { routes } from '@/features/shell/routes';
import type { CrmRecordRowDto } from '@/server/services/crm-contracts';
import { useCrmRecords } from '../api';
import { ErrorBlock, SoftLabel, UserChip } from '../components/crm-ui';
import { initials, noun, plural, relativeDay } from '../lib/format';

export type RecordsKind = 'contacts' | 'accounts';

const COPY: Record<RecordsKind, { title: string; description: string; empty: string }> = {
  accounts: {
    title: 'Accounts',
    description: 'Every account with its owner and industry. Open one for the full 360 view',
    empty: 'Create an Accounts board from the CRM template to track the companies you sell to.',
  },
  contacts: {
    title: 'Contacts',
    description: 'Every contact with their account and owner. Open one for the full 360 view',
    empty: 'Create a Contacts board from the CRM template to track the people you work with.',
  },
};

function matches(row: CrmRecordRowDto, query: string): boolean {
  const haystack = [row.name, row.email, row.title, row.account, row.domain, row.owner?.name, row.label?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export function RecordsIndexPage({ kind }: { readonly kind: RecordsKind }) {
  const { org } = useOrg();
  const records = useCrmRecords(kind);
  const [search, setSearch] = useState('');
  const data = records.data;
  const copy = COPY[kind];
  const query = search.trim().toLowerCase();
  const rows = useMemo(() => (query ? (data?.rows ?? []).filter((row) => matches(row, query)) : (data?.rows ?? [])), [data?.rows, query]);
  const term = data?.board?.itemTerminology ?? (kind === 'contacts' ? 'Contact' : 'Account');

  return (
    <PageFrame
      width="wide"
      title={copy.title}
      icon={kind === 'contacts' ? <UserRound aria-hidden /> : <Building2 aria-hidden />}
      description={data?.board ? `${data.board.name} · ${plural(data.board.itemCount, noun(term))}` : copy.description}
      breadcrumbs={[
        { label: 'Home', href: routes.home(org.slug) },
        { label: 'CRM', href: `/${org.slug}/crm/pipeline` },
        { label: copy.title },
      ]}
      actions={
        data?.board ? (
          <Link href={routes.board(org.slug, data.board.id)} className={buttonVariants({ variant: 'secondary' })}>
            <ExternalLink aria-hidden />
            Open board
          </Link>
        ) : null
      }
    >
      <div className="flex flex-col gap-4" data-testid={`crm-${kind}-index`}>
        {records.isError && !data ? (
          <ErrorBlock error={records.error} title={`Couldn’t load ${copy.title.toLowerCase()}`} onRetry={() => void records.refetch()} />
        ) : !data ? (
          <RecordsSkeleton />
        ) : !data.board ? (
          <EmptyState
            title={`No ${kind} board yet`}
            description={copy.empty}
            actions={
              <Link href={routes.templates(org.slug)} className={buttonVariants({ variant: 'primary' })}>
                Browse CRM templates
              </Link>
            }
          />
        ) : data.rows.length === 0 ? (
          <EmptyState
            title={`No ${noun(term, 2)} yet`}
            description={`${noun(term, 2).replace(/^./, (c) => c.toUpperCase())} added to ${data.board.name} show up here.`}
            actions={
              <Link href={routes.board(org.slug, data.board.id)} className={buttonVariants({ variant: 'primary' })}>
                Open {data.board.name}
              </Link>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3" role="toolbar" aria-label={`${copy.title} filters`}>
              <SearchInput
                className="w-full sm:w-72"
                value={search}
                onValueChange={setSearch}
                placeholder={`Search ${noun(term, 2)}`}
                aria-label={`Search ${noun(term, 2)}`}
              />
              <span className="text-sm text-fg-muted" aria-live="polite">
                {query ? `${plural(rows.length, noun(term))} match` : plural(rows.length, noun(term))}
              </span>
            </div>
            {rows.length === 0 ? (
              <EmptyState
                size="sm"
                illustration="search"
                title={`No ${noun(term, 2)} match “${search.trim()}”`}
                description="Try a different name, email or owner."
              />
            ) : (
              <RecordsTable kind={kind} rows={rows} orgSlug={org.slug} term={term} />
            )}
          </>
        )}
      </div>
    </PageFrame>
  );
}

function RecordsTable({
  kind,
  rows,
  orgSlug,
  term,
}: {
  readonly kind: RecordsKind;
  readonly rows: readonly CrmRecordRowDto[];
  readonly orgSlug: string;
  readonly term: string;
}) {
  const router = useRouter();
  const href = (id: string) => `/${orgSlug}/crm/${kind}/${id}`;
  // The whole row is a convenient click target; the name link carries keyboard and a11y.
  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if (event.defaultPrevented || (event.target as HTMLElement).closest('a, button')) return;
    router.push(href(id));
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle bg-panel shadow-xs">
      <Table data-testid={`crm-${kind}-table`}>
        <TableHead>
          <TableRow className="hover:bg-transparent">
            <TableHeaderCell>{term}</TableHeaderCell>
            {kind === 'contacts' ? (
              <>
                <TableHeaderCell>Title</TableHeaderCell>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
              </>
            ) : (
              <>
                <TableHeaderCell>Website</TableHeaderCell>
                <TableHeaderCell>Industry</TableHeaderCell>
              </>
            )}
            <TableHeaderCell>Owner</TableHeaderCell>
            <TableHeaderCell>{kind === 'contacts' ? 'Last contacted' : 'Updated'}</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer" data-testid="crm-record-row" onClick={(event) => onRowClick(event, row.id)}>
              <TableCell className="max-w-72">
                <Link href={href(row.id)} className="group/record flex min-w-0 items-center gap-2.5 rounded-sm py-0.5 outline-none focus-visible:outline-2 focus-visible:outline-focus">
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center bg-primary-subtle text-2xs font-semibold text-primary-text',
                      kind === 'contacts' ? 'rounded-full' : 'rounded-md',
                    )}
                  >
                    {initials(row.name)}
                  </span>
                  <span className="truncate font-medium text-fg underline-offset-2 group-hover/record:underline" title={row.name}>
                    {row.name}
                  </span>
                </Link>
              </TableCell>
              {kind === 'contacts' ? (
                <>
                  <TableCell className="max-w-48">
                    <Cell>{row.title}</Cell>
                  </TableCell>
                  <TableCell className="max-w-48">
                    <Cell>{row.account}</Cell>
                  </TableCell>
                  <TableCell className="max-w-56">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="block truncate rounded-sm text-fg-link underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                        title={row.email}
                      >
                        {row.email}
                      </a>
                    ) : (
                      <Cell>{null}</Cell>
                    )}
                  </TableCell>
                </>
              ) : (
                <>
                  <TableCell className="max-w-56">
                    <Cell>{row.domain}</Cell>
                  </TableCell>
                  <TableCell>{row.label ? <SoftLabel label={row.label} /> : <Cell>{null}</Cell>}</TableCell>
                </>
              )}
              <TableCell className="max-w-48">
                <UserChip user={row.owner} size="xs" />
              </TableCell>
              <TableCell className="whitespace-nowrap text-fg-secondary">
                {relativeDay(kind === 'contacts' ? row.lastContacted : row.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Cell({ children }: { readonly children: ReactNode }) {
  return children ? <span className="block truncate text-fg-secondary">{children}</span> : <span className="text-fg-muted">None</span>;
}

function RecordsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading" data-skeleton>
      <Skeleton height={36} width={288} rounded="md" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} height={40} rounded="md" style={{ opacity: 1 - index * 0.1 }} />
        ))}
      </div>
    </div>
  );
}
