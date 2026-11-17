'use client';
/** Admin → Audit log: filterable, paginated, append-only security trail with CSV export. */
import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, Download } from 'lucide-react';
import { Avatar, Badge, Button, DatePicker, EmptyState, SearchInput, Select, cn, toast } from '@/components/ui';
import { toastError, useMembers, useOrgId } from '@/lib/hooks';
import { AUDIT_CATEGORIES, type AdminAuditEntryDto, type AuditCategory } from '@/server/services/admin-contracts';
import { describeAuditAction, humanizeAuditDetails, parseUserAgent } from '@/server/services/admin-policy';
import { downloadCsv, useAdminAudit, type AuditFilters } from '../api';
import { formatDateTime, formatIp, relativeTime } from '../format';
import { ErrorPanel, SectionHeader, SettingsCard, TABLE_CELL, TABLE_HEAD, TABLE_ROW, TableSkeleton } from '../ui';

const CATEGORY_LABEL: Readonly<Record<AuditCategory, string>> = {
  auth: 'Sign-in & access',
  member: 'Members',
  team: 'Teams',
  board: 'Boards',
  item: 'Items',
  org: 'Organization',
  api_token: 'API tokens',
  security: 'Security',
  data: 'Exports & imports',
  trash: 'Trash',
};

const TARGET_TYPE_LABEL: Readonly<Record<string, string>> = {
  board: 'Board',
  item: 'Item',
  automation: 'Automation',
  webhook: 'Webhook',
  api_token: 'API token',
  view: 'View',
  team: 'Team',
  member: 'Member',
  user: 'Person',
  invitation: 'Invitation',
  organization: 'Organization',
  permission: 'Permission',
  page: 'Page',
  audit_log: 'Audit log',
  trash: 'Trash',
};

function targetTypeLabel(type: string): string {
  return TARGET_TYPE_LABEL[type] ?? type.replace(/[_.]+/g, ' ').replace(/^./, (char) => char.toUpperCase());
}

function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function tone(action: string): 'danger' | 'warning' | 'info' | 'neutral' {
  if (/forbidden|failed|deleted|purged|revoked|removed|deactivated/.test(action)) return 'danger';
  if (/role_changed|policy|exported|owners/.test(action)) return 'warning';
  if (/created|invited|restored|reactivated/.test(action)) return 'info';
  return 'neutral';
}

const ANY = 'all';

type RangePreset = 'any' | '1' | '7' | '30' | '90' | 'custom';
const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range…' },
];

/** Local calendar day as YYYY-MM-DD. */
function toIsoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function AuditSection() {
  const orgId = useOrgId();
  const members = useMembers();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>(ANY);
  const [actorId, setActorId] = useState<string>(ANY);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState<RangePreset>('any');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [tz] = useState(viewerTimeZone);
  const deferredQ = useDeferredValue(q);

  const filters: AuditFilters = useMemo(
    () => ({
      q: deferredQ.trim() || undefined,
      category: category === ANY ? undefined : (category as AuditCategory),
      actorId: actorId === ANY ? undefined : actorId,
      from: from || undefined,
      to: to || undefined,
      tz: from || to ? tz : undefined,
      order,
    }),
    [deferredQ, category, actorId, from, to, tz, order],
  );
  const dateError = from && to && from > to ? 'The start date is after the end date' : null;
  const audit = useAdminAudit(dateError ? { ...filters, from: undefined, to: undefined } : filters);
  const rows = audit.data?.pages.flatMap((page) => page.items) ?? [];
  const active = Boolean(q || category !== ANY || actorId !== ANY || from || to);

  const applyRange = (preset: RangePreset) => {
    setRange(preset);
    if (preset === 'custom') return;
    setTo('');
    if (preset === 'any') {
      setFrom('');
      return;
    }
    const start = new Date();
    start.setDate(start.getDate() - Number(preset));
    setFrom(toIsoDay(start));
  };

  const reset = () => {
    setRange('any');
    setQ('');
    setCategory(ANY);
    setActorId(ANY);
    setFrom('');
    setTo('');
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const query = Object.fromEntries(
        Object.entries(filters).filter(([key, value]) => key !== 'order' && value),
      ) as Record<string, string>;
      await downloadCsv(orgId, '/admin/audit/export', query);
      toast.success('Audit log exported', active ? 'Only entries matching your filters' : 'All entries');
    } catch (error) {
      toastError(error, 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <SectionHeader
        title="Audit log"
        description="Entries can’t be edited or removed."
        actions={
          <Button variant="secondary" leadingIcon={<Download aria-hidden />} loading={exporting} onClick={() => void exportCsv()} data-testid="audit-export">
            Export CSV
          </Button>
        }
      />
      <SettingsCard padded={false} testId="audit-card">
        <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2" data-testid="audit-filters">
            <SearchInput
              value={q}
              onValueChange={setQ}
              placeholder="Search action, person, target or IP"
              containerClassName="w-full min-w-[200px] sm:w-auto sm:flex-1 xl:max-w-[340px]"
              aria-label="Search audit log"
              data-testid="audit-search"
            />
            <Select
              aria-label="Filter by category"
              className="w-[calc(50%-4px)] sm:w-44"
              value={category}
              onValueChange={setCategory}
              options={[{ value: ANY, label: 'All events' }, ...AUDIT_CATEGORIES.map((key) => ({ value: key, label: CATEGORY_LABEL[key] }))]}
            />
            <Select
              aria-label="Filter by person"
              className="w-[calc(50%-4px)] sm:w-40"
              value={actorId}
              onValueChange={setActorId}
              options={[{ value: ANY, label: 'Anyone' }, ...(members.data ?? []).map((entry) => ({ value: entry.userId, label: entry.name }))]}
            />
            <Select
              aria-label="Date range"
              className="w-[calc(50%-4px)] sm:w-40"
              value={range}
              onValueChange={(value) => applyRange(value as RangePreset)}
              options={RANGE_OPTIONS}
            />
            {range === 'custom' ? (
              <>
                <DatePicker
                  aria-label="From date"
                  className="w-[calc(50%-4px)] sm:w-36"
                  placeholder="From"
                  value={from ? new Date(`${from}T00:00:00`) : null}
                  onChange={(date) => setFrom(date ? toIsoDay(date) : '')}
                />
                <DatePicker
                  aria-label="To date"
                  className="w-[calc(50%-4px)] sm:w-36"
                  placeholder="To"
                  value={to ? new Date(`${to}T00:00:00`) : null}
                  onChange={(date) => setTo(date ? toIsoDay(date) : '')}
                />
              </>
            ) : null}
            {active ? (
              <Button variant="ghost" size="sm" onClick={reset}>
                Clear filters
              </Button>
            ) : null}
          </div>
          {dateError ? (
            <p role="alert" className="text-sm text-danger-text">
              {dateError}
            </p>
          ) : null}
        </div>
        {audit.isPending ? (
          <TableSkeleton rows={8} columns={4} />
        ) : audit.isError ? (
          <ErrorPanel title="Couldn't load the audit log" onRetry={() => void audit.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            size="sm"
            illustration="search"
            title={active ? 'No events match these filters' : 'No events yet'}
            description={active ? 'Widen the date range or clear a filter.' : 'Security-relevant actions will appear here as they happen.'}
            actions={active ? <Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button> : undefined}
          />
        ) : (
          <div className={cn('overflow-x-auto transition-opacity', audit.isFetching && !audit.isFetchingNextPage && 'opacity-70')} aria-busy={audit.isFetching || undefined}>
            <table className="w-full min-w-[720px] text-base" data-testid="audit-table">
              <thead className="border-b border-border-subtle bg-sunken/60">
                <tr>
                  <th className={cn(TABLE_HEAD, 'w-8 pr-0')}>
                    <span className="sr-only">Details</span>
                  </th>
                  <th scope="col" aria-sort={order === 'desc' ? 'descending' : 'ascending'} className={TABLE_HEAD}>
                    <button
                      type="button"
                      onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
                      data-testid="audit-sort-time"
                      className="-mx-1.5 inline-flex h-7 items-center gap-1 rounded-sm px-1.5 text-fg transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
                    >
                      When
                      {order === 'desc' ? <ArrowDown aria-hidden className="size-3.5" /> : <ArrowUp aria-hidden className="size-3.5" />}
                      <span className="sr-only">{order === 'desc' ? '(newest first)' : '(oldest first)'}</span>
                    </button>
                  </th>
                  <th className={TABLE_HEAD}>Who</th>
                  <th className={TABLE_HEAD}>Action</th>
                  <th className={cn(TABLE_HEAD, 'hidden lg:table-cell')}>Target</th>
                  <th className={cn(TABLE_HEAD, 'hidden 2xl:table-cell')}>IP address</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    open={expanded === entry.id}
                    onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {audit.hasNextPage ? (
          <div className="flex justify-center border-t border-border-subtle px-5 py-3">
            <Button variant="secondary" size="sm" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
              Load older events
            </Button>
          </div>
        ) : rows.length > 0 ? (
          <p className="border-t border-border-subtle px-5 py-2.5 text-center text-sm text-fg-muted">
            {order === 'desc' ? 'That’s the beginning of the log.' : 'You’re up to date.'}
          </p>
        ) : null}
      </SettingsCard>
    </>
  );
}

function AuditTarget({ entry }: { readonly entry: AdminAuditEntryDto }) {
  if (!entry.targetType && !entry.targetLabel) return <span className="text-fg-muted">None</span>;
  const type = entry.targetType ? targetTypeLabel(entry.targetType) : null;
  if (entry.targetState === 'deleted') {
    return <span className="text-fg-muted italic">Deleted {type ? type.toLowerCase() : 'item'}</span>;
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-fg" title={entry.targetLabel ?? undefined}>
        {entry.targetLabel ?? type}
      </span>
      {type && entry.targetLabel ? <span className="text-xs text-fg-muted">{type}</span> : null}
    </span>
  );
}

function RawPayload({ entry }: { readonly entry: AdminAuditEntryDto }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(
    { action: entry.action, targetType: entry.targetType, targetId: entry.targetId, metadata: entry.metadata },
    null,
    2,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      toast.success('Payload copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy', 'Select the text and copy it manually.');
    }
  };
  return (
    <details className="group/raw mt-3 rounded-md border border-border-subtle bg-panel" data-testid="audit-raw">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-fg-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3.5 transition-transform duration-[var(--duration-fast)] group-open/raw:rotate-90" />
        Raw payload
      </summary>
      <div className="relative border-t border-border-subtle">
        <Button
          size="sm"
          variant="ghost"
          className="absolute top-2 right-2"
          leadingIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <pre className="max-h-72 overflow-auto px-3 py-2.5 pr-24 font-mono text-xs leading-relaxed text-fg">{json}</pre>
      </div>
    </details>
  );
}

function AuditRow({ entry, open, onToggle }: { readonly entry: AdminAuditEntryDto; readonly open: boolean; readonly onToggle: () => void }) {
  const details = humanizeAuditDetails(entry.metadata);
  return (
    <Fragment>
      <tr className={cn(TABLE_ROW, 'cursor-pointer', open && 'bg-hover')} onClick={onToggle} data-testid="audit-row" data-action={entry.action}>
        <td className={cn(TABLE_CELL, 'w-8 pr-0')}>
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'Hide details' : 'Show details'}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className="inline-flex size-6 items-center justify-center rounded-sm text-icon hover:bg-pressed hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <ChevronRight aria-hidden className={cn('size-4 transition-transform duration-[var(--duration-fast)]', open && 'rotate-90')} />
          </button>
        </td>
        <td className={cn(TABLE_CELL, 'text-sm whitespace-nowrap text-fg-secondary')} title={formatDateTime(entry.createdAt)}>
          <span className="block text-fg">{relativeTime(entry.createdAt)}</span>
          <span className="block text-xs text-fg-muted">{formatDateTime(entry.createdAt)}</span>
        </td>
        <td className={TABLE_CELL}>
          {entry.actorName ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={entry.actorName} size="sm" />
              <span className="truncate text-fg">{entry.actorName}</span>
            </span>
          ) : (
            <span className="text-fg-muted">System</span>
          )}
        </td>
        <td className={TABLE_CELL}>
          <span className="flex flex-col items-start gap-0.5">
            <Badge tone={tone(entry.action)}>{describeAuditAction(entry.action)}</Badge>
            <code className="font-mono text-2xs text-fg-muted">{entry.action}</code>
          </span>
        </td>
        <td className={cn(TABLE_CELL, 'hidden max-w-[240px] text-sm lg:table-cell')} data-testid="audit-target">
          <AuditTarget entry={entry} />
        </td>
        <td className={cn(TABLE_CELL, 'hidden font-mono text-xs text-fg-secondary 2xl:table-cell')}>{formatIp(entry.ipAddress)}</td>
      </tr>
      {open ? (
        <tr className="border-b border-border-subtle bg-sunken/50" data-testid="audit-details">
          <td />
          <td colSpan={5} className="px-4 py-3">
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-fg-muted">Event</dt>
              <dd className="text-fg">{describeAuditAction(entry.action)}</dd>
              <dt className="text-fg-muted">Target</dt>
              <dd className="text-fg">
                {entry.targetType
                  ? entry.targetState === 'deleted'
                    ? `Deleted ${targetTypeLabel(entry.targetType).toLowerCase()}`
                    : `${targetTypeLabel(entry.targetType)}${entry.targetLabel ? ` · ${entry.targetLabel}` : ''}`
                  : 'None'}
              </dd>
              <dt className="text-fg-muted">IP address</dt>
              <dd className="font-mono text-xs text-fg">{formatIp(entry.ipAddress)}</dd>
              <dt className="text-fg-muted">Device</dt>
              <dd className="text-fg" title={entry.userAgent ?? undefined}>
                {entry.userAgent ? `${parseUserAgent(entry.userAgent).browser} on ${parseUserAgent(entry.userAgent).os}` : 'None'}
              </dd>
              {details.map((row) => (
                <Fragment key={row.key}>
                  <dt className="text-fg-muted">{row.label}</dt>
                  <dd className="break-words text-fg">{row.value}</dd>
                </Fragment>
              ))}
            </dl>
            <RawPayload entry={entry} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
