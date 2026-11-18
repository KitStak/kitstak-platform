'use client';
/**
 * The audit log: every change in Pulse with who made it, when, and the value before and after.
 * Search and filters live in the address bar, and the same filters shape the CSV export.
 */
import { Fragment, useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, History, X } from 'lucide-react';
import { Button, IsoDatePicker, SearchInput, Select, Skeleton } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { Teach } from '@/components/pulse/teach';
import { fileLinks } from '@/features/imports/api';
import { SavedViewsBar } from '@/features/views/saved-views-bar';
import { When } from '@/features/imports/when';
import { useQueryState } from '@/features/profit/use-query-state';
import { apiGet, apiPath } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { usePeople } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import type { ActivityDTO, Page } from '@/lib/types';
import { actorLabel, auditChanges, auditSummary, thingLabel, verbLabel } from './audit-format';

const ANY = '__any__';

/** Record kinds a person can filter by, most used first. */
const RECORD_TYPES = ['job', 'production', 'indirect', 'paid_hours', 'material', 'cost', 'revenue', 'service_entry', 'plan', 'labor_rate', 'client', 'job_type', 'labor_class', 'item', 'service', 'site', 'standard', 'target', 'day', 'period', 'import', 'export', 'settings', 'member_role', 'alert', 'alert_rule', 'device_link', 'report_schedule', 'quote_scenario', 'view', 'sample', 'data'] as const;

const ACTION_GROUPS: readonly { value: string; label: string }[] = [
  { value: 'job.', label: 'Jobs' },
  { value: 'production.', label: 'Production entries' },
  { value: 'price.', label: 'Prices' },
  { value: 'plan.', label: 'Quotes and budgets' },
  { value: 'rate.', label: 'Labor rates' },
  { value: 'cost.', label: 'Costs' },
  { value: 'revenue.', label: 'Revenue' },
  { value: 'material.', label: 'Materials' },
  { value: 'day.', label: 'Day reviews' },
  { value: 'period.', label: 'Month close' },
  { value: 'import.', label: 'Imports' },
  { value: 'export.', label: 'Exports' },
  { value: 'settings.', label: 'Settings' },
  { value: 'role.', label: 'Roles' },
  { value: 'money_access.', label: 'Who sees money' },
  { value: 'sample.', label: 'Sample data' },
  { value: 'data.', label: 'Deleted data' },
];

function useAudit(filters: Record<string, string | null>) {
  return useInfiniteQuery({
    queryKey: ['activity', 'audit', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiGet<Page<ActivityDTO>>(apiPath('activity', { ...filters, cursor: pageParam, limit: 50 })),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
  });
}

export function AuditView({ canExport }: { readonly canExport: boolean }) {
  const state = useQueryState();
  const people = usePeople();
  const [search, setSearch] = useState(state.get('q') ?? '');
  const debounced = useDebouncedValue(search, 300);
  const [open, setOpen] = useState<string | null>(null);
  const q = state.get('q');
  useEffect(() => {
    const next = debounced.trim();
    if ((q ?? '') !== next) state.set({ q: next || null });
    // Only when the typed text settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const filters = { q: q, actor: state.get('actor'), entityType: state.get('type'), verb: state.get('action'), from: state.get('from'), to: state.get('to') };
  const audit = useAudit(filters);
  const rows = audit.data?.pages.flatMap((page) => page.items) ?? [];
  const active = Object.values(filters).filter(Boolean).length;
  const badRange = Boolean(filters.from && filters.to && filters.to < filters.from);

  return (
    <div className="flex flex-col gap-4">
      <SavedViewsBar page="audit" />
      <div className="rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary sm:col-span-2 lg:col-span-1">
            Search
            <SearchInput value={search} onValueChange={setSearch} placeholder="A job number, a name, a value" aria-label="Search the audit log" data-testid="audit-search" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
            Who
            <Select aria-label="Who made the change" value={filters.actor ?? ANY} onValueChange={(value) => state.set({ actor: value === ANY ? null : value })} options={[{ value: ANY, label: 'Anyone' }, ...(people.data ?? []).map((person) => ({ value: person.id, label: person.name }))]} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
            What kind of change
            <Select aria-label="What kind of change" value={filters.verb ?? ANY} onValueChange={(value) => state.set({ action: value === ANY ? null : value })} options={[{ value: ANY, label: 'Any change' }, ...ACTION_GROUPS]} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
            From
            <IsoDatePicker value={filters.from} onChange={(value) => state.set({ from: value })} aria-label="From date" clearable placeholder="The start" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
            To
            <IsoDatePicker value={filters.to} onChange={(value) => state.set({ to: value })} aria-label="To date" clearable placeholder="Today" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-fg-secondary">
              Record
              <span className="w-44">
                <Select size="sm" aria-label="Kind of record" value={filters.entityType ?? ANY} onValueChange={(value) => state.set({ type: value === ANY ? null : value })} options={[{ value: ANY, label: 'Any record' }, ...RECORD_TYPES.map((type) => ({ value: type, label: thingLabel(type).replace(/^./, (char) => char.toUpperCase()) }))]} />
              </span>
            </label>
            {active > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={<X aria-hidden className="size-3.5" />}
                onClick={() => {
                  setSearch('');
                  state.replaceAll({});
                }}
                data-testid="audit-clear"
              >
                Clear {active} {active === 1 ? 'filter' : 'filters'}
              </Button>
            ) : null}
          </div>
          {canExport ? (
            <a
              href={badRange ? undefined : fileLinks.auditCsv({ q: filters.q, actor: filters.actor, entityType: filters.entityType, verb: filters.verb, from: filters.from, to: filters.to })}
              download
              data-testid="audit-export"
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', badRange && 'pointer-events-none opacity-50')}
            >
              <Download aria-hidden className="size-4" />
              Export CSV
            </a>
          ) : null}
        </div>
        {badRange ? (
          <p role="alert" className="mt-2 text-sm text-danger-text">
            The end date is before the start date. Pick a later end date.
          </p>
        ) : null}
      </div>

      <Panel bodyClassName="p-0">
        {audit.isError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center" role="alert">
            <p className="text-sm text-fg-secondary">We could not load the audit log. {audit.error instanceof Error ? audit.error.message : ''}</p>
            <Button variant="secondary" onClick={() => void audit.refetch()}>
              Try again
            </Button>
          </div>
        ) : audit.isLoading ? (
          <div className="p-4" data-testid="audit-loading">
            <Skeleton height={320} />
          </div>
        ) : rows.length === 0 ? (
          <Teach
            testId="audit-empty"
            icon={History}
            title={active > 0 ? 'Nothing matches those filters' : 'No changes recorded yet'}
            why={active > 0 ? 'Try a wider date range, another person, or clear the filters.' : 'Every change in Pulse is written down: who did it, when, and what the value was before and after. Nothing here can be edited or deleted.'}
            points={active > 0 ? undefined : ['Search by job number, name or value', 'See the before and after of any change', 'Export the log as a CSV file']}
            actions={
              active > 0 ? (
                <Button
                  onClick={() => {
                    setSearch('');
                    state.replaceAll({});
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => (window.location.href = routes.settings())}>
                  Back to settings
                </Button>
              )
            }
          />
        ) : (
          <>
            <table className="w-full border-collapse text-left text-sm" data-testid="audit-table">
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-border-subtle bg-sunken text-xs text-fg-muted">
                  <th scope="col" className="w-8 px-2 py-2">
                    <span className="sr-only">Details</span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Who
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    What
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const changes = auditChanges(row);
                  const expanded = open === row.id;
                  const canOpen = changes.length > 0;
                  return (
                    <Fragment key={row.id}>
                      <tr className={cn('flex flex-col border-b border-border-subtle px-3 py-2 md:table-row md:px-0 md:py-0', expanded && 'bg-sunken')} data-testid="audit-row" data-verb={row.verb}>
                        <td className="hidden w-8 px-2 py-2 align-top md:table-cell">
                          {canOpen ? (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={expanded ? 'Hide the before and after' : 'Show the before and after'}
                              onClick={() => setOpen(expanded ? null : row.id)}
                              className="flex size-6 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                            >
                              {expanded ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
                            </button>
                          ) : null}
                        </td>
                        <td className="align-top text-xs text-fg-muted md:px-3 md:py-2 md:text-sm md:text-fg-secondary">
                          <When iso={row.createdAt} />
                        </td>
                        <td className="align-top font-medium text-fg md:px-3 md:py-2 md:font-normal">{actorLabel(row)}</td>
                        <td className="align-top text-fg md:px-3 md:py-2">{verbLabel(row.verb)}</td>
                        <td className="max-w-[520px] align-top text-fg-secondary md:px-3 md:py-2">
                          <span className="line-clamp-2 break-words">{auditSummary(row)}</span>
                          {canOpen ? (
                            <button type="button" className="mt-1 text-xs font-medium text-fg-link hover:underline md:hidden" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.id)}>
                              {expanded ? 'Hide before and after' : 'Show before and after'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-b border-border-subtle bg-sunken" data-testid="audit-detail">
                          <td colSpan={5} className="px-3 pb-3 md:pl-12">
                            <table className="w-full max-w-2xl border-collapse text-left text-xs">
                              <thead>
                                <tr className="text-fg-muted">
                                  <th scope="col" className="py-1 pr-3 font-semibold">
                                    Field
                                  </th>
                                  <th scope="col" className="py-1 pr-3 font-semibold">
                                    Before
                                  </th>
                                  <th scope="col" className="py-1 font-semibold">
                                    After
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {changes.map((change) => (
                                  <tr key={change.key} className="border-t border-border-subtle align-top">
                                    <th scope="row" className="py-1 pr-3 font-medium text-fg">
                                      {change.label}
                                    </th>
                                    <td className="max-w-[240px] py-1 pr-3 break-words text-fg-secondary">{change.before ?? 'not recorded'}</td>
                                    <td className="max-w-[240px] py-1 break-words text-fg">{change.after ?? 'not recorded'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-fg-muted">
              <span role="status">
                Showing {rows.length} {rows.length === 1 ? 'change' : 'changes'}
                {audit.hasNextPage ? '' : '. That is all of them.'}
              </span>
              {audit.hasNextPage ? (
                <Button variant="secondary" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()} data-testid="audit-more">
                  Show older changes
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
