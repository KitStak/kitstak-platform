'use client';

/**
 * Count accuracy (Count Plan › Accuracy): inventory record accuracy from real count entries over
 * 30 / 90 / 180 / 365 days. KPI tiles, a weekly accuracy trend, and the SKUs, locations and
 * counters with the largest variances.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { useApiQuery } from '@/lib/query-client';
import { COUNT_QUERY_TIMEOUT_MS } from './counts-client';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { SkeletonText } from '@/components/ui/skeleton';
import { StatTile } from '@kitstak/ui/dashboard';
import { Tooltip } from '@/components/ui/tooltip';
import { DeltaBadge } from './count-badges';

interface Row {
  readonly key: string;
  readonly label: string;
  readonly sub: string | null;
  readonly buckets: number;
  readonly exactBuckets: number;
  readonly absVarianceUnits: number;
  readonly netVarianceUnits: number;
}
interface Accuracy {
  readonly days: number;
  readonly totals: {
    readonly buckets: number;
    readonly exactBuckets: number;
    readonly lines: number;
    readonly plans: number;
    readonly systemUnits: number;
    readonly countedUnits: number;
    readonly absVarianceUnits: number;
    readonly netVarianceUnits: number;
  };
  readonly bySku: readonly Row[];
  readonly byLocation: readonly Row[];
  readonly byUser: readonly Row[];
  readonly weekly: readonly {
    readonly week: string;
    readonly buckets: number;
    readonly exactBuckets: number;
  }[];
}

const PERIODS = [30, 90, 180, 365] as const;
const pct = (exact: number, total: number): string =>
  total === 0 ? 'None' : `${Math.round((exact / total) * 1000) / 10}%`;

export function CountAccuracyDrawer({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Count accuracy" width={60}>
      {open ? <Body /> : null}
    </Drawer>
  );
}

function Body() {
  const [days, setDays] = React.useState<(typeof PERIODS)[number]>(90);
  const q = useApiQuery<Accuracy>(['count-accuracy', days], '/api/counts/accuracy', {
    query: { days },
    timeoutMs: COUNT_QUERY_TIMEOUT_MS,
  });
  const d = q.data?.data;
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Period" className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={days === p}
            onClick={() => setDays(p)}
            className={cn(
              'h-7 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              days === p
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border bg-surface text-secondary hover:text-foreground',
            )}
          >
            Last {p} days
          </button>
        ))}
      </div>
      {q.isPending ? (
        <SkeletonText lines={8} />
      ) : q.error ? (
        <Callout
          variant="error"
          title="Accuracy could not be loaded"
          action={
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
              Retry
            </Button>
          }
        >
          {q.error.message}
        </Callout>
      ) : d && d.totals.buckets === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-10 text-center text-sm text-secondary">
          No counts were recorded in the last {days} days. Accuracy appears here once count lines are counted.
        </p>
      ) : d ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Record accuracy"
              value={pct(d.totals.exactBuckets, d.totals.buckets)}
              href={null}
              caption={`${d.totals.exactBuckets.toLocaleString()} of ${d.totals.buckets.toLocaleString()} buckets matched`}
            />
            <StatTile
              label="Counted"
              value={d.totals.lines.toLocaleString()}
              href={null}
              caption={`lines in ${d.totals.plans.toLocaleString()} ${d.totals.plans === 1 ? 'plan' : 'plans'}`}
            />
            <StatTile
              label="Unit accuracy"
              value={
                d.totals.systemUnits
                  ? `${Math.max(0, Math.round((1 - d.totals.absVarianceUnits / d.totals.systemUnits) * 1000) / 10)}%`
                  : 'None'
              }
              href={null}
              caption={`${d.totals.absVarianceUnits.toLocaleString()} units off of ${d.totals.systemUnits.toLocaleString()}`}
            />
            <StatTile
              label="Net variance"
              value={
                <span className="tabular-nums">
                  {d.totals.netVarianceUnits > 0 ? '+' : d.totals.netVarianceUnits < 0 ? '−' : ''}
                  {Math.abs(d.totals.netVarianceUnits).toLocaleString()}
                </span>
              }
              href={null}
              caption="counted minus system units"
            />
          </div>
          <WeeklyChart weekly={d.weekly} />
          <div className="grid grid-cols-1 gap-3">
            <Breakdown title="SKUs with the largest variance" first="SKU" rows={d.bySku} />
            <Breakdown title="Locations with the largest variance" first="Location" rows={d.byLocation} />
            <Breakdown title="Counters" first="Counted by" rows={d.byUser} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Inventory record accuracy (IRA) target: weeks below it are flagged red, the rest stay neutral. */
export const IRA_TARGET_PCT = 95;
const Y_TICKS = [0, 25, 50, 75, 100] as const;
const CHART_H = 160;

/** Bar tone for a week: neutral at or above the IRA target, red below it (red is reserved for misses). */
export function weekBelowTarget(exact: number, buckets: number, target = IRA_TARGET_PCT): boolean {
  return buckets > 0 && (exact / buckets) * 100 < target;
}

/**
 * Weekly record accuracy: y axis 0–100 % with gridlines, a dashed IRA target line, neutral bars
 * (red only for weeks below target), value labels, and a keyboard-focusable tooltip per week.
 */
function WeeklyChart({ weekly }: { readonly weekly: Accuracy['weekly'] }) {
  const below = weekly.filter((w) => weekBelowTarget(w.exactBuckets, w.buckets)).length;
  return (
    <section
      aria-label="Weekly record accuracy"
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-faint">Weekly record accuracy</h3>
        <span className="flex items-center gap-3 text-2xs text-secondary">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-info/70" aria-hidden />
            At or above target
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-danger" aria-hidden />
            Below target
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 border-t-2 border-dashed border-success" aria-hidden />
            {IRA_TARGET_PCT}% target
          </span>
        </span>
      </div>
      {weekly.length === 0 ? (
        <p className="py-6 text-center text-xs text-secondary">No weekly data in this period.</p>
      ) : (
        <div className="mt-3 flex gap-2">
          {/* y axis */}
          <div
            className="relative w-8 shrink-0 text-right text-2xs tabular-nums text-faint"
            style={{ height: CHART_H }}
            aria-hidden
          >
            {Y_TICKS.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - t}%` }}>
                {t}%
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative" style={{ height: CHART_H }}>
              {Y_TICKS.map((t) => (
                <span
                  key={t}
                  className="absolute inset-x-0 border-t border-border"
                  style={{ top: `${100 - t}%` }}
                  aria-hidden
                />
              ))}
              <span
                className="absolute inset-x-0 z-10 border-t-2 border-dashed border-success"
                style={{ top: `${100 - IRA_TARGET_PCT}%` }}
                aria-hidden
              />
              <ol className="absolute inset-0 flex items-end gap-2 px-1">
                {weekly.map((w) => {
                  const share = w.buckets ? w.exactBuckets / w.buckets : 0;
                  const miss = weekBelowTarget(w.exactBuckets, w.buckets);
                  const label = `Week of ${w.week}: ${pct(w.exactBuckets, w.buckets)} record accuracy (${w.exactBuckets} of ${w.buckets} buckets exact)${miss ? `, below the ${IRA_TARGET_PCT}% target` : ''}`;
                  return (
                    <li
                      key={w.week}
                      className="flex h-full min-w-[18px] max-w-[48px] flex-1 flex-col items-center justify-end"
                    >
                      <Tooltip content={label}>
                        <span
                          tabIndex={0}
                          aria-label={label}
                          className="relative flex h-full w-full flex-col items-center justify-end rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <span
                            className={cn(
                              'absolute text-2xs font-semibold tabular-nums',
                              miss ? 'text-danger' : 'text-secondary',
                            )}
                            style={{ bottom: `calc(${share * 100}% + 2px)` }}
                          >
                            {Math.round(share * 100)}%
                          </span>
                          <span
                            className={cn(
                              'w-full rounded-t transition-opacity hover:opacity-80',
                              miss ? 'bg-danger' : 'bg-info/70',
                            )}
                            style={{ height: `${Math.max(1.5, share * 100)}%` }}
                          />
                        </span>
                      </Tooltip>
                    </li>
                  );
                })}
              </ol>
            </div>
            <ol className="flex gap-2 px-1 pt-1" aria-hidden>
              {weekly.map((w) => (
                <li key={w.week} className="min-w-[18px] max-w-[48px] flex-1 text-center text-2xs text-faint">
                  {w.week.slice(5)}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      <p className="text-2xs text-secondary">
        {below === 0
          ? `Every week met the ${IRA_TARGET_PCT}% target.`
          : `${below} of ${weekly.length} ${weekly.length === 1 ? 'week' : 'weeks'} below the ${IRA_TARGET_PCT}% target.`}{' '}
        Accuracy = buckets counted exactly ÷ buckets counted.
      </p>
    </section>
  );
}

function Breakdown({
  title,
  first,
  rows,
}: {
  readonly title: string;
  readonly first: string;
  readonly rows: readonly Row[];
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-lg border border-border">
      <h3 className="px-3 pt-3 text-xs font-semibold text-faint">{title}</h3>
      <table className="w-full border-collapse text-xs">
        <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
          <tr>
            <th scope="col" className="px-3 py-1.5">
              {first}
            </th>
            <th scope="col" className="px-3 py-1.5 text-right">
              Buckets
            </th>
            <th scope="col" className="px-3 py-1.5 text-right">
              Accuracy
            </th>
            <th scope="col" className="px-3 py-1.5 text-right">
              Net
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-secondary">
                No data
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="px-3 py-1.5">
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold text-foreground">{r.label}</span>
                    {r.sub ? <span className="truncate text-2xs text-secondary">{r.sub}</span> : null}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.buckets}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.exactBuckets, r.buckets)}</td>
                <td className="px-3 py-1.5 text-right">
                  <DeltaBadge value={r.netVarianceUnits} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
