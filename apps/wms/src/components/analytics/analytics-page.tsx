'use client';

/**
 * Native analytics dashboard shell (BUILD_PLAN M13 §4). Date range + warehouse filters in
 * the URL, KPI tiles, chart cards. Gated by the app (activation card linking to Settings
 * → Apps instead of Logiwa's dead-end modal) and by permission (403 state).
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowUpRight, Info, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorReference } from '@/components/reports/error-reference';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MultiSelect } from '@/components/dashboard/filter-bar';
import { useApiQuery } from '@/lib/query-client';
import { useMe } from '@/lib/permissions-client';
import { cn } from '@/lib/utils';
import {
  ANALYTICS_TITLES,
  RANGE_ORDER_MESSAGE,
  type AnalyticsGate,
  type AnalyticsPayload,
  type LaborPage,
  type OperationalPage,
  type TimingShare,
} from '@/server/repositories/analytics-types';
import { AnalyticsChartCard } from './analytics-chart';
import { withBalancedWidths } from './chart-layout';

const PRESETS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Calendar day (YYYY-MM-DD) in `tz` (the warehouse zone the server reports), else the browser zone. */
const iso = (d: Date, tz?: string) => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
};
const back = (days: number, tz?: string) => {
  const today = iso(new Date(), tz);
  return new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
};

export function ActivationCard({ gate }: { readonly gate: AnalyticsGate }) {
  return (
    <div
      className="mx-auto mt-10 max-w-[560px] rounded-2xl border border-border bg-surface p-8 text-center shadow-sm"
      data-testid="activation-card"
    >
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold">Turn on {gate.appName}</h2>
      <p className="mt-2 text-sm leading-5 text-secondary">
        {gate.appName} is switched off for your company. Activate it in Apps and these dashboards fill in
        straight away from the work your team already records. No setup, no extra data.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Link
          href="/settings/apps"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-white shadow-xs hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Open Apps
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex h-9 items-center rounded-md border border-border-strong/70 px-4 text-sm font-medium text-body hover:bg-surface-sunken"
        >
          Back to dashboard
        </Link>
      </div>
      <p className="mt-4 text-2xs text-faint">
        Only users who can manage Apps can activate it. Ask your account admin if the button does not work for
        you.
      </p>
    </div>
  );
}

function Forbidden() {
  return (
    <div
      className="mx-auto mt-10 max-w-[520px] rounded-2xl border border-border bg-surface p-8 text-center"
      role="alert"
    >
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-danger/10 text-danger">
        <Lock className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold">You do not have access to this dashboard</h2>
      <p className="mt-2 text-sm text-secondary">
        Your role does not include this analytics permission. Ask your account admin to add it under Settings
        → Roles.
      </p>
    </div>
  );
}

export function AnalyticsPage({
  group,
  page,
}: {
  readonly group: 'labor' | 'operational';
  readonly page: LaborPage | OperationalPage;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = useMe();
  const meta = ANALYTICS_TITLES[page];
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const wh = (params.get('wh') ?? '').split(',').filter(Boolean);
  const cl = (params.get('cl') ?? '').split(',').filter(Boolean);

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const s = p.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const rangeInvalid = DAY_RE.test(from) && DAY_RE.test(to) && from > to;
  const qs = new URLSearchParams();
  if (DAY_RE.test(from)) qs.set('from', from);
  if (DAY_RE.test(to)) qs.set('to', to);
  if (wh.length) qs.set('wh', wh.join(','));
  if (cl.length) qs.set('cl', cl.join(','));
  const q = useApiQuery<AnalyticsPayload>(
    ['analytics', group, page, qs.toString()],
    `/api/analytics/${group}/${page}`,
    { query: qs.toString(), placeholderData: (prev) => prev, retry: false, enabled: !rangeInvalid },
  );
  const data = q.data?.data;
  const range = data?.range;
  const tz = range?.timeZone;
  const activePreset =
    !from && !to
      ? 30
      : PRESETS.find((p) => from === back(p.days, tz) && (!to || to === iso(new Date(), tz)))?.days;
  const warehouses = (me.data?.data.contextOptions.warehouses ?? []).map((w) => ({
    id: w.id,
    label: w.code && !w.name.startsWith(w.code) ? `${w.code} - ${w.name}` : w.name,
  }));
  const ctxWh = me.data?.data.context.warehouseId;
  const clients = (me.data?.data.contextOptions.clients ?? []).map((c) => ({ id: c.id, label: c.name }));

  const filters = (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-3" role="group" aria-label="Dashboard filters">
      <div
        className="inline-flex rounded-md border border-border bg-surface p-0.5"
        role="group"
        aria-label="Quick ranges"
      >
        {PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            aria-pressed={activePreset === p.days}
            onClick={() => set({ from: back(p.days, tz), to: null })}
            className={cn(
              'h-7 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              activePreset === p.days ? 'bg-primary/10 text-primary' : 'text-secondary hover:text-foreground',
            )}
          >
            Last {p.label}
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-1.5 text-xs text-secondary">
        From
        <Input
          type="date"
          className={cn('h-8 w-[150px]', rangeInvalid && 'border-danger focus-visible:ring-danger/30')}
          value={from || range?.from || ''}
          max={to || range?.to}
          onChange={(e) =>
            set({ from: e.target.value || null, ...(!to && range?.to ? { to: range.to } : {}) })
          }
          aria-label="From date"
          aria-invalid={rangeInvalid || undefined}
          aria-describedby={rangeInvalid ? 'analytics-range-error' : undefined}
        />
      </label>
      <label className="inline-flex items-center gap-1.5 text-xs text-secondary">
        To
        <Input
          type="date"
          className={cn('h-8 w-[150px]', rangeInvalid && 'border-danger focus-visible:ring-danger/30')}
          value={to || range?.to || ''}
          min={from || range?.from}
          onChange={(e) =>
            set({ to: e.target.value || null, ...(!from && range?.from ? { from: range.from } : {}) })
          }
          aria-label="To date"
          aria-invalid={rangeInvalid || undefined}
          aria-describedby={rangeInvalid ? 'analytics-range-error' : undefined}
        />
      </label>
      {rangeInvalid ? (
        <span
          id="analytics-range-error"
          role="alert"
          className="inline-flex items-center gap-2 text-xs font-medium text-danger"
          data-testid="range-error"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {RANGE_ORDER_MESSAGE}.
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            onClick={() => set({ from: to, to: from })}
          >
            Swap dates
          </button>
        </span>
      ) : null}
      <MultiSelect
        label="Warehouse"
        options={warehouses}
        value={wh.length ? wh : ctxWh ? [ctxWh] : []}
        onApply={(ids) => set({ wh: ids.length ? ids.join(',') : null })}
      />
      <MultiSelect
        label="Client"
        options={clients}
        value={cl}
        onApply={(ids) => set({ cl: ids.length ? ids.join(',') : null })}
      />
      {tz ? (
        <span
          className="text-2xs text-faint"
          title="Day boundaries and daily buckets use the warehouse time zone"
        >
          Days in {tz.replace(/_/g, ' ')}
        </span>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        className="ml-auto"
        aria-label="Refresh"
        title="Refresh"
        onClick={() => void q.refetch()}
        disabled={q.isFetching}
      >
        <RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} aria-hidden />
      </Button>
    </div>
  );

  let body: React.ReactNode;
  if (rangeInvalid) {
    body = (
      <div className="mx-6 mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface py-12 text-center">
        <p className="text-base font-semibold">Pick a valid date range</p>
        <p className="text-xs text-secondary">
          The From date ({from}) is after the To date ({to}). Swap them or choose new dates to load the
          dashboard.
        </p>
        <Button variant="secondary" onClick={() => set({ from: to, to: from })}>
          Swap dates
        </Button>
      </div>
    );
  } else if (q.error?.status === 403) body = <Forbidden />;
  else if (q.error && !data) {
    body = (
      <div
        role="alert"
        className="mx-6 mt-6 flex flex-col items-center gap-3 rounded-xl border border-border bg-surface py-12 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
        <p className="text-base font-semibold">This dashboard could not load</p>
        <p className="text-xs text-secondary">{q.error.message}</p>
        <ErrorReference error={q.error} />
        <Button onClick={() => void q.refetch()}>Retry</Button>
      </div>
    );
  } else if (!data) {
    body = (
      <div className="space-y-4 px-6 pt-4" aria-busy="true" aria-label="Loading dashboard">
        <SlowLoadNotice active={q.isFetching} onRetry={() => void q.refetch()} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[84px]" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[340px] lg:col-span-2" />
          <Skeleton className="h-[340px]" />
          <Skeleton className="h-[340px]" />
        </div>
      </div>
    );
  } else if (data.gate) body = <ActivationCard gate={data.gate} />;
  else {
    body = (
      <div className={cn('space-y-4 px-6 pt-4 transition-opacity', q.isFetching && 'opacity-80')}>
        {data.notice ? (
          <div
            role="note"
            data-testid="analytics-notice"
            data-kind={data.notice.kind}
            className="flex items-start gap-2.5 rounded-lg border border-info/25 bg-info-soft/60 px-3.5 py-2.5"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
            <div className="min-w-0 text-sm leading-5">
              <p className="font-semibold text-foreground">{data.notice.title}</p>
              <p className="mt-0.5 text-secondary">{data.notice.message}</p>
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.kpis.map((k) => {
            const inner = (
              <>
                <div className="text-xs font-medium text-secondary">{k.label}</div>
                <div className="mt-1 truncate text-xl font-semibold tracking-[-0.01em] text-foreground tabular-nums">
                  {k.value}
                </div>
                {k.hint ? <div className="mt-0.5 truncate text-2xs text-faint">{k.hint}</div> : null}
              </>
            );
            return k.href ? (
              <Link
                key={k.label}
                href={k.href}
                className="group rounded-xl border border-border bg-surface px-4 py-3 shadow-xs transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {inner}
              </Link>
            ) : (
              <div key={k.label} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-xs">
                {inner}
              </div>
            );
          })}
        </div>
        {data.timing && data.timing.total > 0 ? <TimingBasis timing={data.timing} /> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {withBalancedWidths(data.charts).map((c) => (
            <AnalyticsChartCard
              key={c.id}
              chart={c}
              fileStem={`${meta.title} ${data.range.from} to ${data.range.to}`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-10">
      <PageHeader title={meta.title} helper={meta.helper} />
      {data?.gate || q.error?.status === 403 ? null : filters}
      {body}
    </div>
  );
}

/** "82 %" with no decimals; "<1 %" for a non-zero sliver. */
export function sharePct(part: number, total: number): string {
  if (total <= 0 || part <= 0) return '0 %';
  const pct = (part * 100) / total;
  return pct < 1 ? '<1 %' : `${Math.round(pct)} %`;
}

/**
 * Where the task durations behind the page come from: start → finish scans (timed), the gap
 * since the associate's previous task (inferred), or nothing (left out of speeds). A stacked
 * bar plus counts, so a reader knows how much of the page is measured.
 */
export function TimingBasis({ timing }: { readonly timing: TimingShare }) {
  const parts = [
    {
      key: 'timed',
      label: 'Timed (start → finish scan)',
      n: timing.timed,
      color: 'var(--color-success, #17874D)',
    },
    {
      key: 'inferred',
      label: 'Inferred from the gap since the previous task',
      n: timing.inferred,
      color: 'var(--color-warning, #B07F00)',
    },
    {
      key: 'none',
      label: 'No duration evidence (left out of speeds)',
      n: timing.none,
      color: 'var(--color-faint, #9CA3AF)',
    },
  ] as const;
  return (
    <section
      aria-label="Task timing basis"
      data-testid="timing-basis"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-2.5 shadow-xs"
    >
      <div className="text-xs font-semibold text-foreground">
        Task timing{' '}
        <span className="font-normal text-secondary">· {timing.total.toLocaleString('en-US')} tasks</span>
      </div>
      <div
        className="flex h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={parts.map((p) => `${p.label}: ${sharePct(p.n, timing.total)}`).join(', ')}
      >
        {parts.map((p) =>
          p.n > 0 ? (
            <span key={p.key} style={{ width: `${(p.n * 100) / timing.total}%`, backgroundColor: p.color }} />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary">
        {parts.map((p) => (
          <li key={p.key} data-timing={p.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="font-semibold tabular-nums text-foreground">{sharePct(p.n, timing.total)}</span>
            {p.label} <span className="tabular-nums text-faint">({p.n.toLocaleString('en-US')})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Wait before offering a retry on a dashboard that is still loading. */
export const SLOW_LOAD_MS = 12_000;

/**
 * Shown over the skeleton once a load runs past SLOW_LOAD_MS, so a slow or stuck request
 * (a cold server, another module's build error) never leaves an endless skeleton.
 */
function SlowLoadNotice({ active, onRetry }: { readonly active: boolean; readonly onRetry: () => void }) {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => {
      window.clearTimeout(id);
      setSlow(false);
    };
  }, [active]);
  if (!slow && active) return null;
  return (
    <div
      role="status"
      data-testid="analytics-slow"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft/60 px-3.5 py-2.5 text-sm"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1 text-secondary">
        {active
          ? 'This dashboard is taking longer than usual to load.'
          : 'The dashboard did not finish loading.'}
      </span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
