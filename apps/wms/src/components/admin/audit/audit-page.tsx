'use client';

/**
 * Audit Log (`/settings/audit`): security events — sign-ins (success/failure), CSRF
 * rejects, permission denials, user and role changes, session revocations — with the full
 * grid toolkit (filters, saved views, Export As Excel) and 24 h counters on top.
 */
import * as React from 'react';
import { DataGrid, DateCell, GridToolbar, useGrid, type GridColumnDef } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';
import { useApiQuery } from '@/lib/query-client';
import { useFormat } from '@/lib/format';
import { Skeleton } from '@/components/ui/skeleton';
import { AUDIT_FIELDS, AUDIT_GRID_KEY, kpiFilters, type AuditCategory } from '@/lib/grid-defs/admin/audit';
import type { AuditRow } from '@/server/repositories/audit';
import { DetailList, Muted, toFilterFields, useAdminOptions } from '../admin-shared';

const CATEGORY_TONE: Readonly<Record<AuditCategory, 'success' | 'info' | 'warning' | 'danger' | 'neutral'>> =
  {
    'Sign-in': 'info',
    Session: 'neutral',
    Password: 'warning',
    'CSRF rejected': 'danger',
    'Permission denied': 'danger',
    'User change': 'info',
    'Role change': 'info',
    'Settings change': 'info',
    Other: 'neutral',
  };

const hidden = { defaultVisible: false } as const;

/** "direct" is the legacy marker for a request with no trusted client address (REQ-R6-2). */
function IpCell({ ip }: { readonly ip: string | null }) {
  if (!ip || ip === 'direct')
    return (
      <span className="text-xs text-faint" title="No client address was captured for this request">
        Not captured
      </span>
    );
  return <code className="font-mono text-xs text-secondary">{ip}</code>;
}

function columns(onOpen: (r: AuditRow) => void): GridColumnDef<AuditRow>[] {
  return [
    {
      id: 'at',
      header: 'Date',
      size: 158,
      meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <button type="button" onClick={() => onOpen(row.original)} className="text-primary hover:underline">
          <DateCell value={row.original.at} />
        </button>
      ),
    },
    {
      id: 'category',
      header: 'Event type',
      size: 122,
      cell: ({ row }) => <Badge tone={CATEGORY_TONE[row.original.category]}>{row.original.category}</Badge>,
    },
    {
      id: 'action',
      header: 'Action',
      size: 200,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-body">{row.original.actionLabel}</span>
          {row.original.repeatCount > 1 ? (
            <Badge tone="neutral" title={`${row.original.repeatCount} identical events on this day`}>
              ×{row.original.repeatCount}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'outcome',
      header: 'Outcome',
      size: 92,
      cell: ({ row }) =>
        row.original.outcome === 'success' ? (
          <Badge tone="success">Success</Badge>
        ) : (
          <Badge tone="danger">Failure</Badge>
        ),
    },
    {
      id: 'userName',
      header: 'User',
      size: 150,
      cell: ({ row }) =>
        row.original.userName ? (
          <span className="truncate">{row.original.userName}</span>
        ) : row.original.userEmail ? (
          <span className="truncate text-secondary">{row.original.userEmail}</span>
        ) : (
          <Muted>Not signed in</Muted>
        ),
    },
    {
      id: 'entityLabel',
      header: 'Target',
      size: 170,
      cell: ({ row }) => (
        <span className="block truncate text-body" title={row.original.entityLabel ?? undefined}>
          {row.original.entityLabel ?? 'None'}
        </span>
      ),
    },
    {
      id: 'summary',
      header: 'Details',
      size: 250,
      cell: ({ row }) =>
        row.original.summary ? (
          <button
            type="button"
            onClick={() => onOpen(row.original)}
            className="line-clamp-2 block w-full whitespace-normal break-words text-left text-xs leading-4 text-secondary hover:text-body"
            title={`${row.original.summary} (click for full details)`}
          >
            {row.original.summary}
          </button>
        ) : (
          <Muted />
        ),
    },
    { id: 'ip', header: 'IP address', size: 112, cell: ({ row }) => <IpCell ip={row.original.ip} /> },
    {
      id: 'userAgent',
      header: 'Device',
      size: 260,
      meta: hidden,
      cell: ({ row }) => <span className="truncate text-faint">{row.original.userAgent ?? 'None'}</span>,
    },
  ];
}

interface Stats {
  readonly signIns: number;
  readonly failedSignIns: number;
  readonly denied: number;
  readonly csrf: number;
}

function StatTiles({
  onFilter,
}: {
  readonly onFilter: (category: AuditCategory, outcome?: 'failure') => void;
}) {
  const q = useApiQuery<Stats>(['audit-stats'], '/api/audit/stats', { staleTime: 30_000 });
  const s = q.data?.data;
  const tiles = [
    {
      key: 'in',
      label: 'Sign-ins',
      value: s?.signIns,
      onClick: () => onFilter('Sign-in'),
    },
    {
      key: 'fail',
      label: 'Failed sign-ins',
      value: s?.failedSignIns,
      onClick: () => onFilter('Sign-in', 'failure'),
    },
    {
      key: 'deny',
      label: 'Permission denials',
      value: s?.denied,
      onClick: () => onFilter('Permission denied'),
    },
    {
      key: 'csrf',
      label: 'CSRF rejects',
      value: s?.csrf,
      onClick: () => onFilter('CSRF rejected'),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 px-6 pt-3 md:grid-cols-4">
      {tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={t.onClick}
          className="flex items-center rounded-xl border border-border-subtle bg-panel px-3 py-2.5 text-left transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 active:bg-muted"
        >
          <span className="min-w-0">
            <span className="block text-2xs text-faint">{t.label} · last 24 h</span>
            {q.isPending ? (
              <Skeleton className="mt-1 h-6 w-12" />
            ) : (
              <span
                className="block text-lg font-semibold tabular-nums text-foreground"
                title={q.isError ? "Couldn't load these counts" : undefined}
              >
                {t.value ?? (q.isError ? '!' : '0')}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function EventDrawer({ row, onClose }: { readonly row: AuditRow | null; readonly onClose: () => void }) {
  const fmt = useFormat();
  let pretty: string | null = null;
  try {
    pretty = row?.detail ? JSON.stringify(JSON.parse(row.detail), null, 2) : null;
  } catch {
    pretty = row?.detail ?? null;
  }
  return (
    <Drawer
      open={row !== null}
      onOpenChange={(o) => !o && onClose()}
      width={45}
      title={row?.actionLabel ?? 'Event'}
      description={row ? fmt.gridDateTime(row.at) : undefined}
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {row ? (
        <div className="flex flex-col gap-4">
          <DetailList
            items={[
              { label: 'Event type', value: row.category },
              { label: 'Outcome', value: row.outcome === 'success' ? 'Success' : 'Failure' },
              { label: 'User', value: row.userName ?? row.userEmail ?? 'Not signed in' },
              { label: 'Target', value: row.entityLabel },
              { label: 'IP address', value: <IpCell ip={row.ip} /> },
              { label: 'Action key', value: <code className="font-mono text-xs">{row.action}</code> },
              { label: 'Device', value: row.userAgent, wide: true },
            ]}
          />
          {pretty ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-secondary">Details</h3>
              <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-surface-sunken p-3 font-mono text-xs text-body">
                {pretty}
              </pre>
            </section>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

export function AuditPage() {
  const options = useAdminOptions();
  const fields = React.useMemo(
    () =>
      toFilterFields(AUDIT_FIELDS, { userId: options.users.map((u) => ({ value: u.id, label: u.name })) }),
    [options.users],
  );
  // Repeated identical events (same action/user/IP/detail within a day) collapse to one row with a ×N badge.
  const [groupRepeats, setGroupRepeats] = React.useState(true);
  const extraQuery = React.useMemo(() => (groupRepeats ? undefined : { group: '0' }), [groupRepeats]);
  const g = useGrid<AuditRow>({ gridKey: AUDIT_GRID_KEY, path: '/api/audit', fields, extraQuery });
  const [open, setOpen] = React.useState<AuditRow | null>(null);
  const cols = React.useMemo(() => columns(setOpen), []);
  // One setFilters call: upsertFilter + removeFilter in a row both read the same stale query, so
  // the second call silently dropped the first and the tile appeared to do nothing.
  const filterTo = (category: AuditCategory, outcome?: 'failure') => {
    g.grid.setFilters(kpiFilters(g.grid.query.filters, category, outcome));
  };
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Audit Log" />
      <StatTiles onFilter={filterTo} />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search by email, action or IP"
        trailing={
          <Switch
            size="sm"
            checked={groupRepeats}
            onCheckedChange={(v) => setGroupRepeats(Boolean(v))}
            label="Group repeats"
            aria-label="Group repeated events"
          />
        }
      />
      <DataGrid<AuditRow>
        {...g.gridProps}
        columns={cols}
        getRowId={(r) => r.id}
        onRowClick={(r) => setOpen(r)}
        emptyTitle={filtered ? 'No events match these filters' : 'No security events yet'}
        emptyDescription={
          filtered
            ? 'Widen the date range or clear a filter.'
            : 'Sign-ins and access changes are recorded here.'
        }
      />
      <EventDrawer row={open} onClose={() => setOpen(null)} />
    </div>
  );
}
