'use client';

/**
 * Live dashboard (BUILD_PLAN M13 §1). Filter selection in the URL (`?wh=&cl=`), defaults
 * to the header context; auto-refresh every 60 s plus a manual refresh with an
 * "Updated hh:mm" stamp. Every widget reacts to the filter.
 */
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronDown, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Count, DashboardFrame, DashboardHeader } from '@kitstak/ui/dashboard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiQuery } from '@/lib/query-client';
import { useMe } from '@/lib/permissions-client';
import { cn } from '@/lib/utils';
import type { LiveDashboard } from '@/server/repositories/dashboard-live';
import { ErrorReference } from '@/components/reports/error-reference';
import { DashboardFilterBar, type FilterOption } from './filter-bar';
import {
  JobsCard,
  PanelFreshnessContext,
  ProgressTodayCard,
  RankCard,
  SnapshotGapAlert,
  StatusBreakdownCard,
  UnfulfilledCard,
  type PanelFreshness,
} from './widgets';
import { CustomizeDashboard, useDashboardLayout, type DashboardCardId } from './dashboard-layout';

/** Grid span per card in the 12-column dashboard grid (default order reproduces the classic layout). */
export const CARD_SPAN: Readonly<Record<DashboardCardId, string>> = {
  progress: 'lg:col-span-4',
  unfulfilled: 'lg:col-span-8',
  breakdown: 'lg:col-span-12',
  channels: 'md:col-span-6 xl:col-span-3',
  clients: 'md:col-span-6 xl:col-span-3',
  carriers: 'md:col-span-6 xl:col-span-3',
  countries: 'md:col-span-6 xl:col-span-3',
  jobs: 'lg:col-span-12',
};

/**
 * Spans for the visible cards. A Progress / Unfulfilled card whose partner is hidden or not
 * next to it takes the full row, so hiding a card never leaves a hole.
 */
export function cardSpans(visible: readonly DashboardCardId[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  visible.forEach((id, i) => {
    const prev = visible[i - 1];
    const next = visible[i + 1];
    if (id === 'progress') out[id] = next === 'unfulfilled' ? CARD_SPAN.progress : 'lg:col-span-12';
    else if (id === 'unfulfilled') out[id] = prev === 'progress' ? CARD_SPAN.unfulfilled : 'lg:col-span-12';
    else out[id] = CARD_SPAN[id];
  });
  return out;
}

export const DASHBOARD_REFRESH_MS = 60_000;

const list = (v: string | null): readonly string[] => (v ? v.split(',').filter(Boolean) : []);

/** "Tue, Nov 10" for a YYYY-MM-DD business day (calendar date, no zone shift). */
export function businessDayLabel(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : day;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[300px]" />
        <Skeleton className="h-[300px] lg:col-span-2" />
      </div>
      <Skeleton className="h-[150px]" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[240px]" />
        ))}
      </div>
      <Skeleton className="h-[220px]" />
    </div>
  );
}

/** Server-rendered first payload (page.tsx) for the selection `qs`, so cards paint without a client round trip. */
export interface DashboardInitial {
  readonly qs: string;
  readonly data: LiveDashboard;
}

export function DashboardView({
  initial = null,
  setup = null,
}: {
  readonly initial?: DashboardInitial | null;
  /** "Get set up" panel (server-decided), rendered as the first content block. */
  readonly setup?: React.ReactNode;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // `?wh=all` / `?cl=all` = the viewer explicitly chose every warehouse / client, which
  // overrides a saved "Open on" default (an empty URL falls back to that default).
  const allWh = params.get('wh') === 'all';
  const allCl = params.get('cl') === 'all';
  const urlWh = allWh ? [] : list(params.get('wh'));
  const urlCl = allCl ? [] : list(params.get('cl'));
  const me = useMe();
  const opts = me.data?.data.contextOptions;
  const ctx = me.data?.data.context;

  const warehouses: FilterOption[] = React.useMemo(
    () =>
      (opts?.warehouses ?? []).map((w) => ({
        id: w.id,
        label: w.code && !w.name.startsWith(w.code) ? `${w.code} - ${w.name}` : w.name,
      })),
    [opts],
  );
  const clients: FilterOption[] = React.useMemo(
    () => (opts?.clients ?? []).map((c) => ({ id: c.id, label: c.name })),
    [opts],
  );
  const { layout, loaded: layoutLoaded, save: saveLayout } = useDashboardLayout();
  // The viewer's saved "Open on" defaults apply when the URL names no warehouse / client
  // (and only ids the viewer can still see).
  const savedWh = layout.defaultWarehouseIds.filter(
    (id) => !opts || opts.warehouses.some((w) => w.id === id),
  );
  const savedCl = layout.defaultClientIds.filter((id) => !opts || opts.clients.some((c) => c.id === id));
  const effWh = urlWh.length || allWh ? urlWh : savedWh;
  const effCl = urlCl.length || allCl ? urlCl : savedCl;
  // Shown selection: URL first, then the saved default, then the header context.
  const shownWh = effWh.length ? effWh : ctx?.warehouseId ? [ctx.warehouseId] : [];
  const shownCl = effCl.length ? effCl : ctx?.clientId ? [ctx.clientId] : [];

  const query = new URLSearchParams();
  if (effWh.length) query.set('wh', effWh.join(','));
  if (effCl.length) query.set('cl', effCl.join(','));
  const qs = query.toString();
  // Wait for the saved layout only when the URL leaves the selection open (it may name a default).
  const waitForDefaults =
    !params.get('wh') && !params.get('cl') && !layoutLoaded && !(initial && initial.qs === qs);
  const q = useApiQuery<LiveDashboard>(['dashboard', qs], '/api/dashboard', {
    query: qs,
    refetchInterval: DASHBOARD_REFRESH_MS,
    placeholderData: (prev) => prev,
    enabled: !waitForDefaults,
    ...(initial && initial.qs === qs
      ? { initialData: { data: initial.data }, initialDataUpdatedAt: Date.now(), staleTime: 15_000 }
      : {}),
  });
  const data = q.data?.data;

  const onChange = (next: { warehouseIds: readonly string[]; clientIds: readonly string[] }) => {
    const p = new URLSearchParams();
    if (next.warehouseIds.length) p.set('wh', next.warehouseIds.join(','));
    else if (savedWh.length) p.set('wh', 'all');
    if (next.clientIds.length) p.set('cl', next.clientIds.join(','));
    else if (savedCl.length) p.set('cl', 'all');
    const s = p.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  // Phones only: the filter row starts collapsed behind the "Filters" toggle.
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  // The stamp is browser-local time: render it only after mount so SSR and hydration agree.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const updated =
    mounted && q.dataUpdatedAt
      ? new Date(q.dataUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : null;
  // Per-card "Updated hh:mm" stamps: the payload's compute time, aged on a 30 s client tick.
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [q.dataUpdatedAt]);
  const freshness = React.useMemo<PanelFreshness>(
    () => ({
      asOf: data?.asOf ?? null,
      refreshing: q.isFetching && Boolean(data),
      intervalMs: DASHBOARD_REFRESH_MS,
      now: mounted ? now : null,
    }),
    [data, q.isFetching, mounted, now],
  );
  const visibleCards = layout.order.filter((id) => !layout.hidden.includes(id));
  const spans = cardSpans(visibleCards);

  const day = data?.businessDay;
  return (
    <DashboardFrame app="wms" className="flex-1 px-6 pt-4 pb-10">
      <DashboardHeader
        title="Dashboard"
        eyebrow={
          day ? (
            <span
              className="tabular-nums"
              data-testid="business-day"
              title={
                day.mixedZones
                  ? `The selected warehouses are in different time zones; "today" uses ${day.zoneWarehouse ?? 'the first warehouse'}'s zone (${day.timeZone}). Select one warehouse for its own day.`
                  : `"Today" and "Tomorrow" are warehouse days in ${day.timeZone}.`
              }
            >
              {businessDayLabel(day.date)} · {day.timeZone.split('/').pop()?.replace(/_/g, ' ')} time
              {day.mixedZones ? '*' : ''}
            </span>
          ) : undefined
        }
        subtitle={
          <span className="inline-flex items-center gap-1">
            <span className="tabular-nums" aria-live="polite">
              {updated ? `Updated ${updated}, refreshes every minute` : 'Live warehouse activity'}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh dashboard"
              title="Refresh now (auto every 60 s)"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', q.isFetching && 'animate-spin')} aria-hidden />
            </Button>
          </span>
        }
        controls={
          <>
            {/* Phones: ~300px of filter chrome would push every card below the fold, so the whole
                row collapses behind one "Filters" toggle (selection count shown); >=768px unchanged. */}
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              aria-controls="dashboard-filters"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-secondary transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:hidden"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Filters
              <Count value={shownWh.length + shownCl.length} label="selected" />
              <ChevronDown
                className={cn('h-3.5 w-3.5 text-faint transition-transform', filtersOpen && 'rotate-180')}
                aria-hidden
              />
            </button>
            <div
              id="dashboard-filters"
              className={cn('w-full flex-wrap items-center gap-2 md:flex md:w-auto', filtersOpen ? 'flex' : 'hidden')}
            >
              <DashboardFilterBar
                warehouses={warehouses}
                clients={clients}
                warehouseIds={shownWh}
                clientIds={shownCl}
                onChange={onChange}
              />
              <CustomizeDashboard
                layout={layout}
                onSave={(next) => void saveLayout(next)}
                warehouses={warehouses}
                clients={clients}
              />
            </div>
          </>
        }
      />
      {setup}
      {q.error && !data ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface py-12 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
          <p className="text-base font-semibold">The dashboard could not load</p>
          <p className="text-xs text-secondary">{q.error.message}</p>
          <ErrorReference error={q.error} />
          <Button onClick={() => void q.refetch()}>Retry</Button>
        </div>
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        <PanelFreshnessContext.Provider value={freshness}>
          <SnapshotGapAlert gaps={data.snapshotGaps ?? []} />
          <div
            className={cn(
              'grid grid-cols-1 items-stretch gap-[var(--dash-gap)] transition-opacity md:grid-cols-12',
              q.isFetching && 'opacity-80',
            )}
            data-testid="dashboard-cards"
          >
            {visibleCards.map((id) => (
              <div
                key={id}
                data-card={id}
                className={cn('col-span-1 flex min-w-0 md:col-span-12 [&>*]:flex-1', spans[id])}
              >
                <DashboardCard id={id} data={data} />
              </div>
            ))}
          </div>
        </PanelFreshnessContext.Provider>
      )}
    </DashboardFrame>
  );
}

/** One card by id. Empty rank modes name their next step. */
function DashboardCard({ id, data }: { readonly id: DashboardCardId; readonly data: LiveDashboard }) {
  switch (id) {
    case 'progress':
      return <ProgressTodayCard data={data} />;
    case 'unfulfilled':
      return <UnfulfilledCard data={data} />;
    case 'breakdown':
      return <StatusBreakdownCard data={data} />;
    case 'channels':
      return <RankCard title="Channels" rows={data.ranks.channels} />;
    case 'clients':
      return <RankCard title="Clients" rows={data.ranks.clients} />;
    case 'carriers':
      return (
        <RankCard
          title="Carriers"
          rows={data.ranks.carriers}
          modes={[
            {
              key: 'shipped',
              label: 'Shipped 7 days',
              description: 'Orders shipped per carrier in the last 7 days',
              rows: data.ranks.carriersShipped ?? [],
              empty: 'No orders shipped in the last 7 days.',
              emptyAction: { label: 'Shipments', href: '/shipments' },
            },
            {
              key: 'backlog',
              label: 'Backlog',
              description: 'Backlog orders per assigned carrier',
              rows: data.ranks.carriers,
              empty: 'No backlog orders in this selection.',
              emptyAction: { label: 'All orders', href: '/orders' },
            },
          ]}
        />
      );
    case 'countries':
      return <RankCard title="Order by country" rows={data.ranks.countries} />;
    default:
      return <JobsCard data={data} />;
  }
}
