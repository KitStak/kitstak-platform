'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Download, KeyRound } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, Checkbox, SearchInput, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, type SelectOption } from '@/components/ui';
import { bulkUpdatePeopleAction } from '@/server/actions/people';
import type { PersonListItemDto } from '@/server/domain/people-dto';
import { formatDate } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { KIND_LABELS, NONE, OptionalSelect, STATUS_LABELS, STATUS_TONE, useRun } from './bits';
import { PinSlipsButton } from './pin-slips';
import type { PeopleSearch } from './people-page';

const ALL = '__all__';

interface Options {
  readonly sites: readonly SelectOption[];
  readonly agencies: readonly SelectOption[];
  readonly laborClasses: readonly SelectOption[];
  readonly leads: readonly SelectOption[];
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function FilterBar({ search, options }: { readonly search: PeopleSearch; readonly options: Options }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(search.q ?? '');
  const go = (patch: Partial<Record<keyof PeopleSearch, string | null>>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { ...search, q, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value && value !== ALL) next.set(key, value);
    router.push(next.size > 0 ? `${pathname}?${next.toString()}` : pathname);
  };
  const pick = (key: keyof PeopleSearch, label: string, list: readonly SelectOption[]) => (
    <div className="w-44">
      <Select aria-label={label} value={search[key] ?? ALL} onValueChange={(value) => go({ [key]: value })} options={[{ value: ALL, label }, ...list]} data-testid={`filter-${key}`} />
    </div>
  );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        go({ q });
      }}
    >
      <div className="w-64">
        <SearchInput value={q} onValueChange={setQ} placeholder="Name, number or agency id" aria-label="Search people" data-testid="people-search" />
      </div>
      {pick('site', 'All sites', options.sites)}
      {pick('kind', 'All kinds', Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })))}
      {pick('status', 'Active and on leave', [...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })), { value: 'all', label: 'Every status' }])}
      {options.agencies.length > 0 ? pick('agency', 'All agencies', options.agencies) : null}
      {options.laborClasses.length > 0 ? pick('class', 'All labor classes', options.laborClasses) : null}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

function BulkBar({ ids, options, onDone }: { readonly ids: readonly string[]; readonly options: Options; readonly onDone: () => void }) {
  const { run, pending } = useRun();
  const [site, setSite] = useState<string | null>(null);
  const [lead, setLead] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(NONE);
  const apply = async (key: string, patch: Parameters<typeof bulkUpdatePeopleAction>[0]['patch'], success: string) => {
    const done = await run(key, () => bulkUpdatePeopleAction({ personIds: [...ids], patch }), { success, failure: 'Could not change those people' });
    if (done) onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-sunken p-2" data-testid="bulk-bar">
      <span className="px-1 text-sm font-medium text-fg">{ids.length} picked</span>
      <div className="w-44">
        <OptionalSelect value={site} onChange={setSite} options={options.sites} noneLabel="Set site" ariaLabel="Set site" />
      </div>
      <Button size="sm" variant="secondary" disabled={!site} loading={pending === 'site'} onClick={() => site && void apply('site', { homeSiteId: site }, 'Site set')}>
        Apply
      </Button>
      <div className="w-52">
        <OptionalSelect value={lead} onChange={setLead} options={options.leads} noneLabel="Set lead" ariaLabel="Set lead" />
      </div>
      <Button size="sm" variant="secondary" disabled={!lead} loading={pending === 'lead'} onClick={() => lead && void apply('lead', { leadPersonId: lead }, 'Lead set')}>
        Apply
      </Button>
      <div className="w-40">
        <Select aria-label="Set status" value={status} onValueChange={setStatus} options={[{ value: NONE, label: 'Set status' }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label: label === 'Ended' ? 'Ended today' : label }))]} />
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={status === NONE}
        loading={pending === 'status'}
        onClick={() => void apply('status', { status: status as 'active', ...(status === 'ended' ? { endDate: todayLocal() } : {}) }, 'Status set')}
      >
        Apply
      </Button>
      <PinSlipsButton personIds={ids} />
    </div>
  );
}

export function PeopleView({ items, privateHidden, options, search, canManage, canExport }: { readonly items: readonly PersonListItemDto[]; readonly privateHidden: boolean; readonly options: Options; readonly search: PeopleSearch; readonly canManage: boolean; readonly canExport: boolean }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) if (value) params.set(key, value);
    return `/api/v1/export/people.csv${params.size > 0 ? `?${params.toString()}` : ''}`;
  }, [search]);
  const allPicked = items.length > 0 && items.every((item) => picked.has(item.id));
  const toggle = (id: string, on: boolean) => setPicked((current) => {
    const next = new Set(current);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <FilterBar search={search} options={options} />
        {canExport ? (
          <a href={exportHref} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-muted" data-testid="people-export">
            <Download aria-hidden className="size-4" />
            Export CSV
          </a>
        ) : null}
      </div>
      {canManage && picked.size > 0 ? <BulkBar ids={[...picked]} options={options} onDone={() => setPicked(new Set())} /> : null}
      <Panel bodyClassName="p-0">
        <Table data-testid="people-table">
          <TableHead>
            <TableRow>
              {canManage ? (
                <TableHeaderCell className="w-10">
                  <Checkbox aria-label="Pick everyone shown" checked={allPicked} onCheckedChange={(on) => setPicked(on === true ? new Set(items.map((item) => item.id)) : new Set())} />
                </TableHeaderCell>
              ) : null}
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Number</TableHeaderCell>
              <TableHeaderCell>Kind</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Site</TableHeaderCell>
              <TableHeaderCell>Area</TableHeaderCell>
              <TableHeaderCell>Lead</TableHeaderCell>
              <TableHeaderCell>Agency</TableHeaderCell>
              <TableHeaderCell>Start</TableHeaderCell>
              {privateHidden ? null : <TableHeaderCell>Phone</TableHeaderCell>}
              <TableHeaderCell>Clock</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-sm text-fg-muted">
                  Nobody matches these filters.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id} data-testid="person-row">
                  {canManage ? (
                    <TableCell>
                      <Checkbox aria-label={`Pick ${item.displayName}`} checked={picked.has(item.id)} onCheckedChange={(on) => toggle(item.id, on === true)} />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Link href={routes.person(item.id)} className="font-medium text-fg-link hover:underline">
                      {item.displayName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">{item.number}</TableCell>
                  <TableCell>{KIND_LABELS[item.kind] ?? item.kind}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>{STATUS_LABELS[item.status] ?? item.status}</Badge>
                  </TableCell>
                  <TableCell>{item.homeSiteName}</TableCell>
                  <TableCell>{item.usualAreaName}</TableCell>
                  <TableCell>{item.leadName}</TableCell>
                  <TableCell>{item.agencyName}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(item.startDate)}</TableCell>
                  {privateHidden ? null : <TableCell className="tabular-nums">{item.phone}</TableCell>}
                  <TableCell>
                    {item.hasPin ? (
                      <Badge tone="success" icon={<KeyRound aria-hidden className="size-3" />}>
                        PIN set
                      </Badge>
                    ) : (
                      <Badge tone="neutral">No PIN</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>
      <p className="text-xs text-fg-muted">
        {items.length} {items.length === 1 ? 'person' : 'people'} shown.
      </p>
    </div>
  );
}
