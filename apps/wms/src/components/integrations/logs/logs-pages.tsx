'use client';

/**
 * Channel Logs (spec 06 §8–§11): left sub-nav Methods / History / Orders and Shipments /
 * Products and Inventory. Methods shows a live NEXT RUN countdown and per-row Run; History opens
 * a Show Details modal with the right title per method and real dates; call logs are exportable.
 */
import * as React from 'react';
import { pauseLabel } from '@/lib/grid-defs/integrations/monitoring';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, ListChecks, Play } from 'lucide-react';
import { DataGrid, GridToolbar, useGrid, type GridColumnDef, type RowAction } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason, Tooltip } from '@/components/ui/tooltip';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import {
  HISTORY_FIELDS,
  HISTORY_GRID_KEY,
  METHOD_FIELDS,
  METHODS_GRID_KEY,
  ORDER_ITEM_FIELDS,
  ORDER_ITEMS_GRID_KEY,
  PRODUCT_ITEM_FIELDS,
  PRODUCT_ITEMS_GRID_KEY,
  RUN_DETAIL_TITLE,
  DEMO_FEED_NOTE,
} from '@/lib/grid-defs/integrations/logs';
import type { CallLogRow, MethodRow, RunItemRow, RunRow } from '@/server/repositories/integration-logs';
import type { RunSummary } from '@/server/integrations/runtime/channel-runtime';
import {
  DateTimeText,
  Muted,
  NO_PERMISSION,
  StatRow,
  toFilterFields,
  useModuleDates,
  usePagePerms,
  useStableGroupTabs,
  YesNo,
  integrationDomain,
} from '@/components/integrations/shared/shared';
import { brandText } from '@/lib/grid-defs/integrations/common';
import { ProviderCell, ProviderLogo, providerOptions } from '@/components/integrations/shared/logos';
import { SubNavLayout } from '@/components/integrations/shared/sub-nav';

const NAV = [
  { key: 'methods', label: 'Channel Methods', href: '/integrations/logs/methods' },
  { key: 'history', label: 'Channel History', href: '/integrations/logs/history' },
  { key: 'orders', label: 'Orders and Shipments', href: '/integrations/logs/orders' },
  { key: 'products', label: 'Products and Inventory', href: '/integrations/logs/products' },
];

function Shell({ children }: { readonly children: React.ReactNode }) {
  const integrationTabs = useStableGroupTabs('integrations');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Integration Management" tabs={integrationTabs} helpHref="/integrations/help#logs" />
      <SubNavLayout ariaLabel="Channel logs" items={NAV} asideClassName="w-48">
        {children}
      </SubNavLayout>
    </div>
  );
}

function useNow(ms = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Countdown({ at, status }: { readonly at: string | null; readonly status: string }) {
  const now = useNow();
  if (status !== 'Active' || !at) return <Muted />;
  const diff = Math.max(0, Math.floor((Date.parse(at) - now) / 1000));
  if (diff === 0) return <span className="font-medium text-primary">Due now</span>;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return (
    <span className="font-mono tabular-nums">
      {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  );
}

/** One-line text that ellipsizes at the column width (table cells grow otherwise) with the full value on hover. */
function TruncText({
  text,
  width,
  className,
}: {
  readonly text: string;
  readonly width: number;
  readonly className?: string;
}) {
  return (
    <span
      className={`block truncate ${className ?? ''}`}
      style={{ maxWidth: Math.max(40, width - 24) }}
      title={text}
    >
      {text}
    </span>
  );
}

/** "Waiting For Next Run" → "Waiting" (full text in the tooltip) so the column fits at 1440. */
const shortJobStatus = (s: string) => (/^waiting/i.test(s) ? 'Waiting' : s);

const DEMO_NOTE_KEY = 'ks.integrations.demoFeedNote.dismissed';
const demoTitle = (n: number) =>
  n === 1 ? '1 store runs on the KitStak demo feed' : `${n} stores run on the KitStak demo feed`;

const every = (min: number) =>
  min >= 1440 ? `${Math.round(min / 1440)} day` : min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`;

export function ChannelMethodsPage() {
  const perms = usePagePerms('integrations.integrations', ['edit_setup', 'create_setup'] as const);
  const fields = React.useMemo(
    () => toFilterFields(METHOD_FIELDS, { provider: providerOptions('channel') }),
    [],
  );
  const g = useGrid<MethodRow>({ gridKey: METHODS_GRID_KEY, path: '/api/integration-logs/methods', fields });
  const qc = useQueryClient();
  const [running, setRunning] = React.useState<string | null>(null);
  const canRun = perms.edit_setup || perms.create_setup;
  const [demoNoteHidden, setDemoNoteHidden] = React.useState(false);
  React.useEffect(() => {
    try {
      setDemoNoteHidden(window.localStorage.getItem(DEMO_NOTE_KEY) === '1');
    } catch {
      /* storage blocked: keep showing */
    }
  }, []);
  const hideDemoNote = () => {
    setDemoNoteHidden(true);
    try {
      window.localStorage.setItem(DEMO_NOTE_KEY, '1');
    } catch {
      /* per-viewer convenience only */
    }
  };
  const run = async (row: MethodRow, simulateError = false) => {
    setRunning(row.id);
    try {
      const { data } = await apiRequest<RunSummary>(`/api/integration-logs/methods/${row.id}/run`, {
        method: 'POST',
        body: simulateError ? { simulateError: true } : {},
      });
      const fn = simulateError
        ? toast.info
        : data.status === 'Successful' || data.status === 'No Data'
          ? toast.success
          : data.status === 'Partially Successful'
            ? toast.warning
            : toast.error;
      fn(
        simulateError ? `Simulated error run · ${data.status}` : `${data.method} · ${data.status}`,
        simulateError
          ? `${data.storeName}: ${data.success} imported · ${data.error} failed on purpose (unknown SKU). Open Missing Orders to try Retry Download.`
          : (data.message ??
              `${data.storeName}: ${data.success} succeeded · ${data.error} failed of ${data.total}`),
      );
      g.refetch();
      void qc.invalidateQueries({ queryKey: ['grid', HISTORY_GRID_KEY] });
    } catch (error) {
      toast.error('Run failed', isApiError(error) ? error.message : 'Something went wrong');
    } finally {
      setRunning(null);
    }
  };
  const COLUMNS: GridColumnDef<MethodRow>[] = [
    {
      id: 'method',
      header: 'Method',
      size: 146,
      meta: { alwaysVisible: true },
      cell: ({ row }) => <span className="whitespace-nowrap font-medium">{row.original.method}</span>,
    },
    // The channel logo leads the store name (store names already carry the channel), so the default layout fits at 1440 without truncation; the Channel column stays available in Columns.
    {
      id: 'storeName',
      header: 'Store name',
      size: 206,
      cell: ({ row, column }) => (
        <span
          className="inline-flex min-w-0 max-w-full items-center gap-1.5"
          style={{ maxWidth: column.getSize() - 24 }}
        >
          <ProviderLogo kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} />
          <Link
            className="truncate text-primary hover:underline"
            title={row.original.storeName}
            href={`/integrations/channels/${row.original.provider}`}
          >
            {row.original.storeName}
          </Link>
        </span>
      ),
    },
    {
      id: 'provider',
      header: 'Channel',
      size: 120,
      meta: { defaultVisible: false },
      cell: ({ row }) => (
        <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      size: 90,
      cell: ({ row }) => <StatusPill status={row.original.status} domain="active" />,
    },
    {
      id: 'jobStatus',
      header: 'Job status',
      size: 104,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.pauseReason ? (
          <Tooltip content={row.original.pauseReason}>
            <span tabIndex={0}>
              <Badge tone={pauseLabel(row.original.pauseReason)?.tone ?? 'warning'}>
                {pauseLabel(row.original.pauseReason)?.label ?? 'Paused'}
              </Badge>
            </span>
          </Tooltip>
        ) : (
          <span className="block truncate text-secondary" title={row.original.jobStatus}>
            {shortJobStatus(row.original.jobStatus)}
          </span>
        ),
    },
    {
      id: 'intervalMinutes',
      header: 'Every',
      size: 72,
      meta: { defaultVisible: false },
      cell: ({ row }) => every(row.original.intervalMinutes),
    },
    {
      id: 'nextRunAt',
      header: 'Next run',
      size: 100,
      cell: ({ row }) => (
        <span title={`Runs every ${every(row.original.intervalMinutes)}`}>
          <Countdown
            at={row.original.nextRunAt}
            status={row.original.pauseReason ? 'Paused' : row.original.status}
          />
        </span>
      ),
    },
    {
      id: 'lastRunAt',
      header: 'Last run',
      size: 170,
      cell: ({ row }) => <DateTimeText value={row.original.lastRunAt} empty="Never" />,
    },
    {
      id: 'lastRunStatus',
      header: 'Result',
      size: 112,
      enableSorting: false,
      meta: { clip: false },
      cell: ({ row }) =>
        row.original.lastRunStatus ? (
          <StatusPill
            size="sm"
            status={row.original.lastRunStatus}
            domain={integrationDomain(row.original.lastRunStatus)}
          />
        ) : (
          <Muted />
        ),
    },
    {
      id: 'run',
      header: 'Run',
      size: 132,
      enableSorting: false,
      enableResizing: false,
      meta: { alwaysVisible: true, sticky: 'right', label: 'Run' },
      cell: ({ row }) => (
        // Secondary, not a wall of red CTAs. Sandbox and demo-feed stores run on simulated traffic, so Run always works.
        <DisabledReason reason={!canRun ? NO_PERMISSION : running === row.original.id ? 'Running…' : null}>
          <span className="inline-flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={!canRun || running !== null}
              onClick={(e) => {
                e.stopPropagation();
                void run(row.original);
              }}
            >
              {running === row.original.id ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run
            </Button>
            {row.original.canSimulateError ? (
              <Tooltip
                content={
                  canRun
                    ? 'Simulate error: run once with one unknown-SKU order, to demo Missing Orders and Retry Download. Scheduled runs never fail on purpose.'
                    : NO_PERMISSION
                }
              >
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Simulate error run"
                  disabled={!canRun || running !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    void run(row.original, true);
                  }}
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
            ) : null}
          </span>
        </DisabledReason>
      ),
    },
  ];
  return (
    <Shell>
      {g.rows.some((r) => r.demoFeed) && !demoNoteHidden ? (
        <Callout
          variant="info"
          className="mb-2 lg:mr-6"
          onDismiss={hideDemoNote}
          title={demoTitle(new Set(g.rows.filter((r) => r.demoFeed).map((r) => r.storeName)).size)}
        >
          No store credentials are saved for them yet, so they sync simulated orders for each client’s real
          SKUs. Run, Simulate error (flask icon) and the schedule work exactly as with a live store. Add a
          store’s access token in Channel Integrations to switch it to live syncing.
        </Callout>
      ) : null}
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search store name" />
      <DataGrid<MethodRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        emptyTitle="No channel methods yet"
        emptyDescription="Connect a store; its four methods appear here."
      />
    </Shell>
  );
}

function RunDetailDialog({ run, onClose }: { readonly run: RunRow | null; readonly onClose: () => void }) {
  const dates = useModuleDates();
  const [page, setPage] = React.useState(1);
  const [filter, setFilter] = React.useState<'all' | 'errors'>('all');
  React.useEffect(() => {
    setPage(1);
    setFilter(run && run.errorCount > 0 ? 'errors' : 'all');
  }, [run]);
  const q = useApiQuery<{ run: RunRow; items: RunItemRow[]; total: number }>(
    ['run-detail', run?.id ?? '', page, filter],
    run ? `/api/integration-logs/runs/${run.id}` : null,
    { query: { page, ps: 25, errors: filter === 'errors' ? 'true' : 'false' }, placeholderData: (p) => p },
  );
  const d = q.data?.data;
  const pages = Math.max(1, Math.ceil((d?.total ?? 0) / 25));
  const title = run ? (RUN_DETAIL_TITLE[run.method as keyof typeof RUN_DETAIL_TITLE] ?? 'Run Details') : '';
  const props = (raw: string) => {
    try {
      return Object.entries(JSON.parse(raw) as Record<string, unknown>)
        .map(
          ([k, v]) => `${k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}: ${String(v)}`,
        )
        .join(' · ');
    } catch {
      return raw;
    }
  };
  return (
    <Dialog open={run !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader title={title} description={run ? `${run.storeName} · ${run.method}` : undefined} />
        <DialogBody className="flex flex-col gap-4">
          {run ? (
            <StatRow
              stats={[
                { label: 'Success qty', value: run.successCount, tone: 'success' },
                {
                  label: 'Error qty',
                  value: run.errorCount,
                  tone: run.errorCount > 0 ? 'danger' : undefined,
                },
                { label: 'Total qty', value: run.totalCount },
                {
                  label: 'Status',
                  value: <StatusPill status={run.status} domain={integrationDomain(run.status)} />,
                },
              ]}
            />
          ) : null}
          {run ? (
            <p className="text-xs text-secondary">
              Started {dates.dateTime(run.startedAt)} ·{' '}
              {run.endedAt
                ? `ended ${dates.dateTime(run.endedAt)} (${Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000))} s)`
                : 'still running'}
            </p>
          ) : null}
          <SegmentedControl
            size="sm"
            ariaLabel="Show"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'All rows' },
              { value: 'errors', label: 'Errors only' },
            ]}
          />
          {q.isPending ? (
            <SkeletonTable rows={5} columns={3} />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-sunken text-2xs text-secondary">
                  <tr>
                    <th className="w-20 px-3 py-2 text-left">Success</th>
                    <th className="px-3 py-2 text-left">Properties</th>
                    <th className="px-3 py-2 text-left">Error message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(d?.items ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-faint">
                        Nothing to display.
                      </td>
                    </tr>
                  ) : (
                    (d?.items ?? []).map((i) => (
                      <tr key={i.id} className="align-top">
                        <td className="px-3 py-2">
                          <YesNo value={i.success} />
                        </td>
                        <td className="px-3 py-2">
                          {i.orderId ? (
                            <Link className="text-primary hover:underline" href={`/orders/${i.orderId}`}>
                              {props(i.properties)}
                            </Link>
                          ) : (
                            props(i.properties)
                          )}
                        </td>
                        <td className="px-3 py-2 text-danger">
                          {i.errorMessage ? brandText(i.errorMessage) : <Muted />}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-xs text-secondary">Total: {d?.total ?? 0}</span>
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-xs tabular-nums">
            {page} / {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChannelHistoryPage() {
  const fields = React.useMemo(
    () => toFilterFields(HISTORY_FIELDS, { provider: providerOptions('channel') }),
    [],
  );
  const g = useGrid<RunRow>({ gridKey: HISTORY_GRID_KEY, path: '/api/integration-logs/history', fields });
  const [detail, setDetail] = React.useState<RunRow | null>(null);
  const COLUMNS: GridColumnDef<RunRow>[] = [
    {
      id: 'storeName',
      header: 'Store name',
      size: 170,
      meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <span className="block truncate font-medium" title={row.original.storeName}>
          {row.original.storeName}
        </span>
      ),
    },
    { id: 'method', header: 'Method', size: 160, cell: ({ row }) => row.original.method },
    {
      id: 'startedAt',
      header: 'Date',
      size: 180,
      cell: ({ row }) => <DateTimeText value={row.original.startedAt} />,
    },
    {
      id: 'status',
      header: 'Status',
      size: 190,
      meta: { clip: false },
      cell: ({ row }) => (
        <StatusPill status={row.original.status} domain={integrationDomain(row.original.status)} />
      ),
    },
    {
      id: 'errorCount',
      header: 'Error',
      size: 80,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <div
          className={`text-right tabular-nums ${row.original.errorCount > 0 ? 'font-semibold text-danger' : 'text-faint'}`}
        >
          {row.original.errorCount}
        </div>
      ),
    },
    {
      id: 'totalCount',
      header: 'Total',
      size: 80,
      meta: { align: 'right' },
      cell: ({ row }) => <div className="text-right tabular-nums">{row.original.totalCount}</div>,
    },
    {
      id: 'successCount',
      header: 'Success',
      size: 90,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-success">{row.original.successCount}</div>
      ),
    },
    {
      id: 'provider',
      header: 'Channel',
      size: 200,
      cell: ({ row }) => (
        <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} />
      ),
    },
  ];
  const rowActions = (row: RunRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: ListChecks, onSelect: () => setDetail(row) },
  ];
  return (
    <Shell>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search store name" />
      <DataGrid<RunRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={setDetail}
        emptyTitle="No runs yet"
        emptyDescription="Runs appear here each time a channel method runs."
      />
      <RunDetailDialog run={detail} onClose={() => setDetail(null)} />
    </Shell>
  );
}

export function CallLogsPage({ kind }: { readonly kind: 'orders' | 'products' }) {
  const fields = React.useMemo(
    () =>
      toFilterFields(kind === 'orders' ? ORDER_ITEM_FIELDS : PRODUCT_ITEM_FIELDS, {
        provider: providerOptions('channel'),
      }),
    [kind],
  );
  const extraQuery = React.useMemo(() => ({ kind }), [kind]);
  const g = useGrid<CallLogRow>({
    gridKey: kind === 'orders' ? ORDER_ITEMS_GRID_KEY : PRODUCT_ITEMS_GRID_KEY,
    path: '/api/integration-logs/items',
    fields,
    extraQuery,
  });
  // Fits 1440 (about 1160px of grid): Successful sits right after Call method (Logiwa's key column), and the
  // wide, left-aligned Error message is last so the header's column-chooser gear never covers a label.
  const orders = kind === 'orders';
  const COLUMNS: GridColumnDef<CallLogRow>[] = [
    {
      id: 'provider',
      header: 'Channel',
      size: 140,
      cell: ({ row }) => (
        <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} />
      ),
    },
    {
      id: 'storeName',
      header: 'Store name',
      size: orders ? 160 : 150,
      cell: ({ row, column }) => <TruncText text={row.original.storeName} width={column.getSize()} />,
    },
    {
      id: 'method',
      header: 'Call method',
      size: orders ? 150 : 140,
      cell: ({ row, column }) => <TruncText text={row.original.method} width={column.getSize()} />,
    },
    {
      id: 'success',
      header: 'Successful',
      size: 100,
      meta: { clip: false },
      cell: ({ row }) => <YesNo value={row.original.success} />,
    },
    { id: 'at', header: 'Call date', size: 170, cell: ({ row }) => <DateTimeText value={row.original.at} /> },
    ...(orders
      ? [
          {
            id: 'storeOrderNumber',
            header: 'Store order no',
            size: 130,
            cell: ({ row, column }) =>
              row.original.storeOrderNumber ? (
                <TruncText text={row.original.storeOrderNumber} width={column.getSize()} />
              ) : (
                <Muted />
              ),
          } satisfies GridColumnDef<CallLogRow>,
        ]
      : [
          {
            id: 'sellerSku',
            header: 'Seller SKU',
            size: 140,
            cell: ({ row, column }) =>
              row.original.sellerSku ? (
                <TruncText text={row.original.sellerSku} width={column.getSize()} />
              ) : (
                <Muted />
              ),
          } satisfies GridColumnDef<CallLogRow>,
          {
            id: 'qty',
            header: 'Qty',
            size: 64,
            meta: { align: 'right' },
            cell: ({ row }) => <div className="text-right tabular-nums">{row.original.qty ?? <Muted />}</div>,
          } satisfies GridColumnDef<CallLogRow>,
        ]),
    {
      id: 'errorMessage',
      header: 'Error message',
      size: orders ? 300 : 250,
      enableSorting: false,
      cell: ({ row, column }) =>
        row.original.errorMessage ? (
          <TruncText
            className="text-danger"
            text={brandText(row.original.errorMessage)}
            width={column.getSize()}
          />
        ) : (
          <Muted />
        ),
    },
  ];
  return (
    <Shell>
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder={kind === 'orders' ? 'Search order number or store' : 'Search seller SKU or store'}
      />
      <DataGrid<CallLogRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        emptyTitle="No calls recorded yet"
        emptyDescription={
          kind === 'orders'
            ? 'Order downloads and shipment updates appear here.'
            : 'Product downloads and inventory syncs appear here.'
        }
      />
    </Shell>
  );
}
