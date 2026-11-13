'use client';

/**
 * Channel Monitoring › Health Overview (channel radio cards, Filter by Client, grid with header
 * tooltips, setup-name link) and › Setup Details (setup dropdown + empty state, then 6 cards:
 * order volume chart, success donut and four "Show all" tables). Spec 06 §12–§13.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { AlertTriangle, Info, Settings2 } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataGrid, GridToolbar, useGrid, type GridColumnDef } from '@/components/grid';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoTip } from '@/components/ui/info-tip';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { StatusPill } from '@/components/ui/status-pill';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { volumeShape, pauseLabel } from '@/lib/grid-defs/integrations/monitoring';
import { HEALTH_FIELDS, HEALTH_GRID_KEY, LOW_PERFORMING_PCT } from '@/lib/grid-defs/integrations/monitoring';
import type { HealthCard, HealthRow, SetupDetails } from '@/server/repositories/monitoring';
import {
  DateTimeText,
  Muted,
  toFilterFields,
  useClientOptions,
  useModuleDates,
  useViewerTimeZone,
} from '@/components/integrations/shared/shared';
import { brandText } from '@/lib/grid-defs/integrations/common';
import { niceTicks } from '@/lib/grid-defs/integrations/time';
import {
  ProviderCell,
  ProviderLogo,
  providerMeta,
  providerOptions,
} from '@/components/integrations/shared/logos';
import { MonitoringHeader } from './monitoring-review-pages';

const TIPS = {
  status:
    'Whether Download Orders is Active or Passive. Paused means it is switched on but cannot run (hover for the reason).',
  rate: 'Orders imported successfully vs. orders that hit an error in the last 24 hours. Setups with no calls in 24 hours show No data and are not counted as low performing.',
  orders: 'Orders downloaded through this setup in the last 24 hours.',
  lines: 'Order lines downloaded through this setup in the last 24 hours.',
  last: 'When Download Orders last ran successfully.',
};

function Head({ label, tip }: { readonly label: string; readonly tip: string }) {
  // Header cells live inside the sort button, so no nested interactive tooltip trigger here.
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={tip}>
      {label}
      <Info className="h-3 w-3 opacity-60" aria-hidden />
    </span>
  );
}

function RateCell({ value }: { readonly value: number | null }) {
  if (value === null)
    return (
      <span className="text-faint" title="No calls in the last 24 hours">
        <span className="text-2xs">No data</span>
      </span>
    );
  const low = value < LOW_PERFORMING_PCT;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-semibold tabular-nums',
        low ? 'text-danger' : 'text-success',
      )}
    >
      {low ? <AlertTriangle className="h-3.5 w-3.5" aria-label="Low performing" /> : null}
      {value}%
    </span>
  );
}

export function HealthOverviewPage() {
  const router = useRouter();
  const params = useSearchParams();

  const clients = useClientOptions();
  const [clientId, setClientId] = React.useState<string | null>(null);
  const cards = useApiQuery<HealthCard[]>(['health-cards', clientId ?? ''], '/api/monitoring/health/cards', {
    query: { clientId: clientId ?? undefined },
  });
  const fields = React.useMemo(
    () => toFilterFields(HEALTH_FIELDS, { provider: providerOptions('channel'), clientId: clients }),
    [clients],
  );
  const g = useGrid<HealthRow>({ gridKey: HEALTH_GRID_KEY, path: '/api/monitoring/health', fields });
  const providerFilter = g.grid.query.filters.find((f) => f.field === 'provider');
  const selected = providerFilter && 'values' in providerFilter ? providerFilter.values[0] : undefined;
  void params;
  const pick = (provider: string | null) => {
    const rest = g.grid.query.filters.filter((f) => f.field !== 'provider' && f.field !== 'clientId');
    const next = [
      ...rest,
      ...(provider ? [{ field: 'provider', op: 'in' as const, values: [provider] }] : []),
      ...(clientId ? [{ field: 'clientId', op: 'in' as const, values: [clientId] }] : []),
    ];
    g.grid.setQuery({ ...g.grid.query, filters: next as typeof g.grid.query.filters, page: 1 });
  };
  React.useEffect(() => {
    pick(selected ?? null); /* sync client filter */
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const COLUMNS: GridColumnDef<HealthRow>[] = [
    {
      id: 'provider',
      header: 'Channel',
      size: 170,
      cell: ({ row }) => (
        <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} />
      ),
    },
    {
      id: 'storeName',
      header: 'Setup name',
      size: 170,
      meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <Link
          className="font-medium text-primary hover:underline"
          href={`/integrations/monitoring/setup?id=${row.original.id}`}
        >
          {row.original.storeName}
        </Link>
      ),
    },
    {
      id: 'clientName',
      header: 'Client',
      size: 170,
      cell: ({ row }) => (
        <span className="block truncate" title={row.original.clientName ?? undefined}>
          {row.original.clientName}
        </span>
      ),
    },
    {
      id: 'downloadStatus',
      header: () => <Head label="Download status" tip={TIPS.status} />,
      size: 170,
      cell: ({ row }) =>
        row.original.downloadStatus === 'Paused' ? (
          <Tooltip content={row.original.pauseReason ?? 'Paused'}>
            <span
              tabIndex={0}
              className="inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
            >
              <Badge size="sm" shape="pill" tone={pauseLabel(row.original.pauseReason)?.tone ?? 'warning'}>
                {pauseLabel(row.original.pauseReason)?.label ?? 'Paused'}
              </Badge>
            </span>
          </Tooltip>
        ) : (
          <StatusPill status={row.original.downloadStatus} domain="active" />
        ),
    },
    {
      id: 'successRate',
      header: () => <Head label="Success rate" tip={TIPS.rate} />,
      size: 120,
      cell: ({ row }) => (
        <span title={`${row.original.successes24h} ok · ${row.original.errors24h} failed`}>
          <RateCell value={row.original.successRate} />
        </span>
      ),
    },
    {
      id: 'orders24h',
      header: () => <Head label="Orders (24h)" tip={TIPS.orders} />,
      size: 110,
      meta: { align: 'right' },
      cell: ({ row }) => <div className="text-right tabular-nums">{row.original.orders24h}</div>,
    },
    {
      id: 'lines24h',
      header: () => <Head label="Lines (24h)" tip={TIPS.lines} />,
      size: 100,
      meta: { align: 'right' },
      cell: ({ row }) => <div className="text-right tabular-nums">{row.original.lines24h}</div>,
    },
    {
      id: 'lastSuccessAt',
      header: () => <Head label="Last successful call" tip={TIPS.last} />,
      size: 170,
      minSize: 150,
      cell: ({ row }) => <DateTimeText value={row.original.lastSuccessAt} empty="Never" />,
    },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonitoringHeader />
      <div className="flex flex-col gap-3 px-6">
        <div className="flex items-center gap-3">
          <p className="flex items-center gap-1 text-sm text-secondary">
            Selected channel:{' '}
            <span className="font-semibold text-foreground">
              {selected ? providerMeta('channel', selected).name : 'All channels'}
            </span>
            <InfoTip content="Pick a channel card to filter the grid. Low-performing setups are below 80% success in 24 hours." />
          </p>
          <div className="ml-auto w-64">
            <Combobox
              aria-label="Filter by client"
              options={clients}
              value={clientId}
              onChange={setClientId}
              placeholder="Filter by client"
              clearable
            />
          </div>
        </div>
        <div role="radiogroup" aria-label="Channels" className="flex gap-3 overflow-x-auto pb-1">
          {cards.isPending
            ? Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-24 w-56 shrink-0 rounded-xl" />
              ))
            : (cards.data?.data ?? []).map((c) => {
                const active = (selected ?? null) === c.provider;
                return (
                  <button
                    key={c.provider ?? 'all'}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pick(c.provider)}
                    className={cn(
                      'flex w-64 shrink-0 flex-col gap-2 rounded-xl border-2 bg-surface px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      active ? 'border-primary shadow-sm' : 'border-border hover:border-border-strong',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {c.provider ? <ProviderLogo kind="channel" provider={c.provider} /> : null}
                      {c.provider ? providerMeta('channel', c.provider).name : 'All channels'}
                      <span className="ml-auto text-2xs font-normal text-faint">
                        {c.setups} setup{c.setups === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="grid grid-cols-2 gap-2">
                      <span>
                        <span className="block text-2xs text-faint">Avg. success rate</span>
                        {c.avgSuccess === null ? (
                          <span
                            className="text-lg font-semibold text-faint"
                            title="No calls in the last 24 hours"
                          >
                            None
                          </span>
                        ) : (
                          <span
                            className={cn(
                              'text-lg font-semibold tabular-nums',
                              c.avgSuccess >= LOW_PERFORMING_PCT ? 'text-success' : 'text-danger',
                            )}
                          >
                            {c.avgSuccess}%
                          </span>
                        )}
                      </span>
                      <span>
                        <span className="block text-2xs text-faint">Low-performing</span>
                        <span
                          className={cn(
                            'text-lg font-semibold tabular-nums',
                            c.lowPerforming > 0 ? 'text-danger' : 'text-foreground',
                          )}
                        >
                          {c.lowPerforming}
                        </span>
                      </span>
                    </span>
                    {c.avgSuccess !== null && c.setups > 0 ? (
                      <span className="text-2xs text-secondary">
                        Based on {c.setups - c.noData} of {c.setups} setup{c.setups === 1 ? '' : 's'} with
                        calls in 24h{c.setups - c.noData < 3 ? ' (small sample)' : ''}
                      </span>
                    ) : c.noData > 0 ? (
                      <span className="text-2xs text-faint">{c.noData} with no calls in 24h</span>
                    ) : null}
                  </button>
                );
              })}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col pb-4">
        <GridToolbar {...g.toolbarProps} searchPlaceholder="Search setup or client" />
        <DataGrid<HealthRow>
          {...g.gridProps}
          columns={COLUMNS}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/integrations/monitoring/setup?id=${r.id}`)}
          emptyTitle="No channel setups"
          emptyDescription="Connect a store in Channel Integrations to monitor it here."
        />
      </div>
    </div>
  );
}

const optionsSchema = z.array(
  z.object({ id: z.string(), storeName: z.string(), provider: z.string(), clientName: z.string() }),
);

function CardShell({
  title,
  tip,
  href,
  count,
  children,
}: {
  readonly title: string;
  readonly tip: string;
  readonly href?: string;
  readonly count?: number;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-[220px] flex-col rounded-xl border border-border bg-surface p-4">
      <header className="mb-2 flex items-center gap-1.5">
        <h3 className="text-xs font-semibold text-secondary">{title}</h3>
        <InfoTip content={tip} />
        {count !== undefined ? (
          <Badge size="sm" tone={count > 0 ? 'danger' : 'neutral'} className="ml-1">
            {count}
          </Badge>
        ) : null}
        {href ? (
          <Link href={href} className="ml-auto text-xs font-medium text-primary hover:underline">
            Show all
          </Link>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function HeaderFact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="mb-1 text-2xs font-medium text-secondary">{label}</span>
      <span className="flex h-9 items-center text-sm text-foreground">{children}</span>
    </div>
  );
}

/** "2026-11-09" (a local-day key) → "11/09" for chart axes. */
const dayLabel = (key: string) => `${key.slice(5, 7)}/${key.slice(8, 10)}`;

/** 14-day volume: area chart when the series has shape; grouped bars + totals when it is sparse (≤3 active days). */
function VolumeChart({ volume }: { readonly volume: SetupDetails['volume'] }) {
  const shape = volumeShape(volume);
  const data = volume.map((v) => ({ ...v, label: dayLabel(v.day) }));
  const axis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #E4E7EC)" vertical={false} />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
      <YAxis
        allowDecimals={false}
        domain={[0, shape.yMax]}
        ticks={[...shape.yTicks]}
        interval={0}
        tick={{ fontSize: 11 }}
        tickLine={false}
        axisLine={false}
      />
      <ChartTooltip />
      <Legend wrapperStyle={{ fontSize: 11 }} />
    </>
  );
  return (
    <div>
      <p className="mb-2 text-xs text-secondary">
        <span className="font-semibold tabular-nums text-foreground">
          {shape.channelTotal.toLocaleString('en-US')}
        </span>{' '}
        channel orders ·{' '}
        <span className="font-semibold tabular-nums text-foreground">
          {shape.kitstaksTotal.toLocaleString('en-US')}
        </span>{' '}
        created in KitStak
        {shape.activeDays === 0
          ? ': no orders in the last 14 days'
          : shape.sparse
            ? `: activity on ${shape.activeDays} of ${volume.length} days`
            : ''}
      </p>
      <div className="h-44">
        {shape.activeDays === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-faint">
            No order activity in the last 14 days
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {shape.sparse ? (
              <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barGap={2}>
                {axis}
                <Bar
                  dataKey="channel"
                  name="Channel orders created"
                  fill="var(--chart-4)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={18}
                />
                <Bar
                  dataKey="kitstaks"
                  name="KitStak orders created"
                  fill="var(--chart-2)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={18}
                />
              </BarChart>
            ) : (
              <AreaChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                {axis}
                <Area
                  type="monotone"
                  dataKey="channel"
                  name="Channel orders created"
                  stroke="var(--chart-4)"
                  fill="var(--chart-4)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="kitstaks"
                  name="KitStak orders created"
                  stroke="var(--chart-2)"
                  fill="var(--chart-2)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function MiniTable({
  heads,
  rows,
}: {
  readonly heads: readonly string[];
  readonly rows: readonly (readonly React.ReactNode[])[];
}) {
  if (rows.length === 0) return <p className="py-8 text-center text-xs text-faint">Nothing to display</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-2xs text-faint">
        <tr>
          {heads.map((h) => (
            <th key={h} className="px-1.5 py-1 text-left font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className="max-w-[180px] truncate px-1.5 py-1.5">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MethodTable({ methods }: { readonly methods: SetupDetails['methods'] }) {
  return (
    <MiniTable
      heads={['Method', 'Status', 'Last call', 'Last success', 'Calls (14d)', 'Success rate']}
      rows={methods.map((m) => [
        <span key="m" className="font-medium">
          {m.method}
        </span>,
        <StatusPill key="s" status={m.status} domain="active" />,
        <DateTimeText key="l" value={m.lastCallAt} empty="Never" />,
        <DateTimeText key="ls" value={m.lastSuccessAt} empty="Never" />,
        <span key="c" className="tabular-nums">
          {m.calls14d}
          {m.errors14d > 0 ? <span className="text-danger"> ({m.errors14d} failed)</span> : null}
        </span>,
        <RateCell key="r" value={m.successRate} />,
      ])}
    />
  );
}

export function SetupDetailsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const dates = useModuleDates();
  const tz = useViewerTimeZone();
  const id = params.get('id');
  const opts = useApiQuery<unknown>(['channel-options'], '/api/channels/options', { staleTime: 60_000 });
  const parsed = optionsSchema.safeParse(opts.data?.data);
  const options = parsed.success ? parsed.data : [];
  const def = useApiQuery<{ id: string | null }>(['setup-default'], id ? null : '/api/monitoring/setup', {
    staleTime: 30_000,
  });
  const defaultId = def.data?.data?.id ?? null;
  React.useEffect(() => {
    if (!id && defaultId) router.replace(`/integrations/monitoring/setup?id=${defaultId}`);
  }, [id, defaultId, router]);
  const q = useApiQuery<SetupDetails>(
    ['setup-details', id ?? '', tz],
    id ? `/api/monitoring/setup/${id}` : null,
    { staleTime: 10_000, query: { tz: tz || undefined } },
  );
  const trendAxis = React.useMemo(
    () => niceTicks(Math.max(0, ...(q.data?.data?.callTrend ?? []).map((x) => x.ok + x.errors))),
    [q.data],
  );
  const d = q.data?.data;
  const donut = d
    ? [
        { name: 'Successful', value: d.successes24h },
        { name: 'Errors', value: d.errors24h },
      ].filter((x) => x.value > 0)
    : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonitoringHeader />
      <div className="flex flex-col gap-4 px-6 pb-6">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="w-72">
            <label
              htmlFor="setup-select"
              className="mb-1 flex items-center gap-1 text-2xs font-medium text-secondary"
            >
              Setup name
              <InfoTip content="Select a setup from your store integrations" />
            </label>
            <Combobox
              id="setup-select"
              aria-label="Setup name"
              value={id}
              options={options.map((o) => ({ value: o.id, label: o.storeName, description: o.clientName }))}
              placeholder="Select a setup"
              emptyText={opts.isPending ? 'Loading setups…' : 'No store connections yet'}
              onChange={(v) =>
                router.replace(
                  v ? `/integrations/monitoring/setup?id=${v}` : '/integrations/monitoring/setup',
                )
              }
            />
          </div>
          {d ? (
            <>
              <HeaderFact label="Channel">
                <ProviderCell kind="channel" provider={d.provider} isSandbox={d.isSandbox} />
              </HeaderFact>
              <HeaderFact label="Client">
                <span className="font-semibold">{d.clientName}</span>
              </HeaderFact>
              <HeaderFact label="Warehouses">
                {d.warehouses.join(', ') || <Muted>Not linked</Muted>}
              </HeaderFact>
            </>
          ) : null}
        </div>
        {!id && def.isError ? (
          <EmptyState
            title="Couldn't load your setups"
            description={def.error?.message ?? "The server didn't answer."}
            action={<Button onClick={() => void def.refetch()}>Retry</Button>}
          />
        ) : !id && (def.isPending || defaultId) ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : !id ? (
          <EmptyState
            icon={Settings2}
            title="No store connections yet"
            description="Connect a store in Channel Integrations to see its call history here."
            action={
              <Link className={buttonVariants({ variant: 'primary' })} href="/integrations/channels">
                Go to channel integrations
              </Link>
            }
          />
        ) : // A failed first attempt shows the error with Retry instead of skeletons while the query backs off.
        q.isPending && q.failureCount > 0 ? (
          <EmptyState
            title="Couldn't load this setup"
            description={q.failureReason?.message ?? "The server didn't answer. Retrying automatically."}
            action={<Button onClick={() => void q.refetch()}>Retry now</Button>}
          />
        ) : q.isPending ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : !d ? (
          <EmptyState
            title="Couldn't load this setup"
            description={q.error?.message}
            action={<Button onClick={() => void q.refetch()}>Retry</Button>}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CardShell
                title="Shipment order volumes"
                tip="Orders seen on the channel vs. orders created in KitStak per day (14 days). A gap means orders are failing. Check Missing Shipment Orders."
              >
                <VolumeChart volume={d.volume} />
              </CardShell>
            </div>
            <CardShell title="Success rate" tip="Successful vs. failed order downloads in the last 24 hours.">
              {d.successes24h + d.errors24h === 0 ? (
                // No ring at all when there is nothing to chart: a muted placeholder circle with the text inside it.
                <div className="flex h-48 items-center justify-center">
                  <div className="flex h-36 w-36 flex-col items-center justify-center gap-1 rounded-full border-[10px] border-border px-3 text-center">
                    <span className="text-lg font-semibold text-faint">None</span>
                    <span className="text-2xs leading-tight text-secondary">
                      No downloads in the last 24 hours
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donut}
                        dataKey="value"
                        innerRadius={52}
                        outerRadius={72}
                        paddingAngle={donut.length > 1 ? 2 : 0}
                        stroke="none"
                      >
                        {donut.map((x) => (
                          <Cell
                            key={x.name}
                            fill={x.name === 'Successful' ? 'var(--success)' : 'var(--danger)'}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  {d.successRate === null ? null : (
                    <span
                      className={cn(
                        'pointer-events-none absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums',
                        d.successRate >= LOW_PERFORMING_PCT ? 'text-success' : 'text-danger',
                      )}
                    >
                      {d.successRate}%
                    </span>
                  )}
                </div>
              )}
            </CardShell>
            <div className="lg:col-span-2">
              <CardShell
                title="Integration methods"
                tip="Each scheduled method for this setup: status, last call, last successful call and 14-day success rate."
              >
                <MethodTable methods={d.methods} />
              </CardShell>
            </div>
            <CardShell
              title="Call results (14 days)"
              tip="Successful vs. failed records processed by all methods per day."
            >
              <div className="h-48">
                {d.callTrend.every((x) => x.ok + x.errors === 0) ? (
                  <p className="flex h-full items-center justify-center text-xs text-faint">
                    No calls in the last 14 days
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={d.callTrend.map((v) => ({ ...v, label: dayLabel(v.day) }))}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border, #E4E7EC)"
                        vertical={false}
                      />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis
                        allowDecimals={false}
                        domain={[0, trendAxis.max]}
                        ticks={[...trendAxis.ticks]}
                        interval={0}
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="ok" name="Successful" stackId="a" fill="var(--chart-2)" />
                      <Bar dataKey="errors" name="Errors" stackId="a" fill="var(--chart-6)" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardShell>
            <CardShell
              title="Missing shipment orders"
              tip="Store orders that failed to download."
              count={d.counts.missing}
              href={`/integrations/monitoring/missing-orders?f.connectionId=in:${d.id}`}
            >
              <MiniTable
                heads={['Order code', 'Order date', 'Last error code']}
                rows={d.missing.map((m) => [
                  m.orderCode,
                  dates.date(m.orderDate),
                  <Tooltip key="e" content={brandText(m.lastErrorCode)}>
                    <span
                      tabIndex={0}
                      className="line-clamp-2 whitespace-normal break-words text-danger focus-visible:outline-none focus-visible:underline"
                    >
                      {brandText(m.lastErrorCode)}
                    </span>
                  </Tooltip>,
                ])}
              />
            </CardShell>
            <CardShell
              title="Workflow blocked shipment orders"
              tip="Orders stopped by an automation rule."
              count={d.counts.blocked}
              href={`/integrations/monitoring/workflow-blocked?f.storeName=eq:${encodeURIComponent(d.storeName)}`}
            >
              <MiniTable
                heads={['Order code', 'Block', 'Workflow']}
                rows={d.blocked.map((b) => [b.orderCode, b.blockType, b.workflowName ?? 'None'])}
              />
            </CardShell>
            <CardShell
              title="Product listing exceptions"
              tip="SKU mismatches and multi-listings that can cause sync errors and overselling."
              count={d.counts.listingExceptions}
              href="/integrations/monitoring/listing-exceptions"
            >
              <MiniTable
                heads={['KitStak SKU', 'Seller SKU', 'Issue']}
                rows={d.listingExceptions.map((e) => [e.sku, e.sellerSkus, e.issueType])}
              />
            </CardShell>
            <div className="lg:col-span-3">
              <CardShell
                title="Recent errors"
                tip="Order download errors in the past two weeks, grouped by error type."
                count={d.counts.recentErrors}
                href={`/integrations/monitoring/recent-errors?f.connectionId=in:${d.id}`}
              >
                <MiniTable
                  heads={['Error reason', 'Occurrence qty', 'Affected order qty', 'Last occurrence']}
                  rows={d.recentErrors.map((e) => [
                    brandText(e.errorReason),
                    e.occurrences,
                    e.affectedOrders,
                    <DateTimeText key="t" value={e.lastOccurrence} />,
                  ])}
                />
              </CardShell>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
