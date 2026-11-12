'use client';

/**
 * Live dashboard (BUILD_PLAN M13 §1). Filter selection in the URL (`?wh=&cl=`), defaults
 * to the header context; auto-refresh every 60 s plus a manual refresh with an
 * "Updated hh:mm" stamp. Every widget reacts to the filter.
 */
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronDown, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
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

export function DashboardView({ initial = null }: { readonly initial?: DashboardInitial | null } = {}) {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-10">
      <PageHeader
        title="Dashboard"
        helper="Live fulfillment picture for the warehouses and clients you pick. Click any number to open those items."
        actions={
          <div className="flex items-center gap-2">
            {data?.businessDay ? (
              <span
                className="hidden text-2xs text-faint tabular-nums md:inline"
                data-testid="business-day"
                title={
                  data.businessDay.mixedZones
                    ? `The selected warehouses are in different time zones; "today" uses ${data.businessDay.zoneWarehouse ?? 'the first warehouse'}'s zone (${data.businessDay.timeZone}). Select one warehouse for its own day.`
                    : `"Today" and "Tomorrow" are warehouse days in ${data.businessDay.timeZone}.`
                }
              >
                {businessDayLabel(data.businessDay.date)} ·{' '}
                {data.businessDay.timeZone.split('/').pop()?.replace(/_/g, ' ')} time
                {data.businessDay.mixedZones ? '*' : ''}
              </span>
            ) : null}
            <span className="text-2xs text-faint tabular-nums" aria-live="polite">
              {updated ? `Updated ${updated}` : ''}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh dashboard"
              title="Refresh now (auto every 60 s)"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
            >
              <RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} aria-hidden />
            </Button>
          </div>
        }
      />
      <div className="px-6 pt-3">
        {/* Phones: ~300px of filter chrome would push every KPI below the fold, so the whole
            row collapses behind one "Filters" toggle (selection count shown); >=768px unchanged. */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-controls="dashboard-filters"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-secondary transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:hidden"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          Filters
          {shownWh.length + shownCl.length > 0 ? (
            <span className="rounded-full bg-primary-soft px-1.5 text-2xs font-semibold text-primary">
              {shownWh.length + shownCl.length}
            </span>
          ) : null}
          <ChevronDown
            className={cn('h-3.5 w-3.5 text-faint transition-transform', filtersOpen && 'rotate-180')}
            aria-hidden
          />
        </button>
        <div
          id="dashboard-filters"
          className={cn(
            'flex-wrap items-center justify-end gap-2 max-md:mt-2 md:flex',
            filtersOpen ? 'flex' : 'hidden',
          )}
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
      </div>
      <div className={cn('space-y-4 px-6 pt-4 transition-opacity', q.isFetching && data && 'opacity-80')}>
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
              className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-12"
              data-testid="dashboard-cards"
            >
              {visibleCards.map((id) => {
                let card: React.ReactNode;
                if (id === 'progress') card = <ProgressTodayCard data={data} />;
                else if (id === 'unfulfilled') card = <UnfulfilledCard data={data} />;
                else if (id === 'breakdown') card = <StatusBreakdownCard data={data} />;
                else if (id === 'channels')
                  card = (
                    <RankCard
                      icon="store"
                      title="Channels"
                      description="Order details coming from channels"
                      rows={data.ranks.channels}
                    />
                  );
                else if (id === 'clients')
                  card = (
                    <RankCard
                      icon="users"
                      title="Clients"
                      description="Client order details and rank"
                      rows={data.ranks.clients}
                    />
                  );
                else if (id === 'carriers') {
                  card = (
                    <RankCard
                      icon="truck"
                      title="Carriers"
                      description="Ranking of carriers to which orders are shipped"
                      rows={data.ranks.carriers}
                      modes={[
                        {
                          key: 'shipped',
                          label: 'Shipped 7 days',
                          description: 'Orders shipped per carrier in the last 7 days',
                          rows: data.ranks.carriersShipped ?? [],
                          empty: 'No orders shipped in the last 7 days.',
                        },
                        {
                          key: 'backlog',
                          label: 'Backlog',
                          description: 'Backlog orders per assigned carrier',
                          rows: data.ranks.carriers,
                          empty: 'No backlog orders in this selection.',
                        },
                      ]}
                    />
                  );
                } else if (id === 'countries')
                  card = (
                    <RankCard
                      icon="globe"
                      title="Order By Country"
                      description="Rank of the regions where orders are shipped"
                      rows={data.ranks.countries}
                    />
                  );
                else card = <JobsCard data={data} />;
                return (
                  <div
                    key={id}
                    data-card={id}
                    className={cn('col-span-1 flex min-w-0 md:col-span-12 [&>*]:flex-1', spans[id])}
                  >
                    {card}
                  </div>
                );
              })}
            </div>
          </PanelFreshnessContext.Provider>
        )}
      </div>
    </div>
  );
}
