'use client';

/**
 * Unfulfilled orders: a donut in the WMS data color (open vs in progress), the counts table and the
 * backlog by order age. Every number opens its orders, the donut total included.
 */
import * as React from 'react';
import Link from 'next/link';
import { Legend, Meter, Pill } from '@kitstak/ui/dashboard';
import { cn } from '@/lib/utils';
import type { LiveDashboard, Metric } from '@/server/repositories/dashboard-live';
import { Panel, ROW_LINK, fmt, pctOf } from './panel';

/** Teal family (the WMS data color): open in full strength, in progress a lighter step of it. */
const SERIES = [
  { key: 'open', label: 'Open', color: 'var(--chart-2)' },
  { key: 'inProgress', label: 'In progress', color: 'color-mix(in oklab, var(--chart-2) 45%, var(--surface-panel))' },
] as const;

export interface DonutArc {
  readonly key: string;
  readonly length: number;
  readonly offset: number;
}

/**
 * Static donut geometry (stroke-dasharray arcs on one circle): no client measurement, so the
 * ring paints in the server HTML before hydration. A 1-slice ring has no gap; with several
 * slices each gets `gap` px of spacing (never more than half its own length).
 */
export function donutArcs(
  values: readonly { readonly key: string; readonly value: number }[],
  circumference: number,
  gap = 3,
): DonutArc[] {
  const total = values.reduce((a, v) => a + Math.max(0, v.value), 0);
  if (total <= 0) return [];
  const visible = values.filter((v) => v.value > 0);
  let start = 0;
  return visible.map((v) => {
    const full = (v.value / total) * circumference;
    const g = visible.length > 1 ? Math.min(gap, full / 2) : 0;
    const arc = { key: v.key, length: Math.max(full - g, 0), offset: -start };
    start += full;
    return arc;
  });
}

const DONUT_SIZE = 168;
const DONUT_STROKE = 20;
const DONUT_R = (DONUT_SIZE - DONUT_STROKE) / 2 - 2;
const DONUT_C = 2 * Math.PI * DONUT_R;

interface Slice {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly value: number;
}

function UnfulfilledDonut({ slices, total }: { readonly slices: readonly Slice[]; readonly total: Metric }) {
  const [hover, setHover] = React.useState<string | null>(null);
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const arcs = donutArcs(slices, DONUT_C);
  const active = slices.find((s) => s.key === hover);
  const mid = DONUT_SIZE / 2;
  return (
    <div className="relative shrink-0" style={{ width: DONUT_SIZE, height: DONUT_SIZE }} data-testid="unfulfilled-donut">
      <svg
        viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
        width={DONUT_SIZE}
        height={DONUT_SIZE}
        role="img"
        aria-label={`Unfulfilled orders: ${slices.map((s) => `${s.label} ${fmt(s.value)}`).join(', ') || 'none'}`}
      >
        <circle cx={mid} cy={mid} r={DONUT_R} fill="none" stroke="var(--border-subtle)" strokeWidth={DONUT_STROKE} />
        <g transform={`rotate(-90 ${mid} ${mid})`}>
          {arcs.map((a) => {
            const s = slices.find((x) => x.key === a.key);
            if (!s) return null;
            return (
              <circle
                key={a.key}
                cx={mid}
                cy={mid}
                r={DONUT_R}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === a.key ? DONUT_STROKE + 4 : DONUT_STROKE}
                strokeDasharray={`${a.length} ${DONUT_C}`}
                strokeDashoffset={a.offset}
                className="transition-[stroke-width,opacity] duration-150"
                opacity={hover && hover !== a.key ? 0.45 : 1}
                onMouseEnter={() => setHover(a.key)}
                onMouseLeave={() => setHover(null)}
                data-slice={a.key}
              >
                <title>{`${s.label}: ${fmt(s.value)} orders (${pctOf(s.value, sum)}%)`}</title>
              </circle>
            );
          })}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-live="polite">
        {active ? (
          <div>
            <div className="text-2xs text-faint">{active.label}</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(active.value)}</div>
            <div className="text-2xs tabular-nums text-faint">{pctOf(active.value, sum)}%</div>
          </div>
        ) : (
          <Link
            href={total.href}
            className={cn('pointer-events-auto block px-2 py-1 hover:underline', ROW_LINK)}
            aria-label={`Total unfulfilled orders: ${fmt(total.count)}. Open them`}
            data-testid="unfulfilled-donut-total"
          >
            <span className="block text-2xs text-faint">Total orders</span>
            <span className="block text-xl font-semibold tabular-nums text-foreground">{fmt(total.count)}</span>
          </Link>
        )}
      </div>
    </div>
  );
}

/** Unfulfilled backlog by order age: one meter per bucket (they add up to the total), each a drilldown. */
function UnfulfilledAge({ buckets }: { readonly buckets: readonly Metric[] }) {
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const oldestIndex = buckets.length - 1;
  const oldest = buckets[oldestIndex];
  return (
    <section
      aria-label="Unfulfilled orders by order age"
      className="mt-3 border-t border-border pt-3"
      data-testid="unfulfilled-age"
    >
      <h3 className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-secondary">
        By order age
        {oldest && oldest.count > 0 ? (
          <Pill tone="caution" data-testid="unfulfilled-age-oldest">
            {fmt(oldest.count)} waiting 7+ days
          </Pill>
        ) : null}
      </h3>
      <ul className="flex flex-col gap-0.5">
        {buckets.map((b, i) => (
          <li key={b.label}>
            <Link
              href={b.href}
              className={cn('group -mx-1 grid grid-cols-[96px_1fr_44px] items-center gap-2 px-1 py-1', ROW_LINK)}
              aria-label={`${b.label}: ${b.count} orders`}
            >
              <span className="text-xs text-secondary group-hover:text-foreground">{b.label}</span>
              <Meter
                value={b.count > 0 ? Math.max(b.count / max, 0.03) : 0}
                label={`${b.label}: ${fmt(b.count)} orders`}
                tone={i === oldestIndex && b.count > 0 ? 'caution' : 'data'}
              />
              <span
                className={cn(
                  'text-right text-sm font-semibold tabular-nums',
                  b.count === 0 ? 'text-faint' : 'text-foreground',
                )}
              >
                {fmt(b.count)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function UnfulfilledCard({ data }: { readonly data: LiveDashboard }) {
  const u = data.unfulfilled;
  const slices: readonly Slice[] = SERIES.map((s) => ({ ...s, value: u[s.key].count }));
  const rows: readonly { readonly m: Metric; readonly color?: string }[] = [
    { m: u.total },
    { m: u.open, color: SERIES[0].color },
    { m: u.inProgress, color: SERIES[1].color },
  ];
  return (
    <Panel title="Unfulfilled orders" description="Orders with no action taken yet, of any age">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <UnfulfilledDonut slices={slices} total={u.total} />
          <Legend items={SERIES.map((s) => ({ label: s.label, color: s.color }))} />
        </div>
        <div className="w-full min-w-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs text-faint">
                <th className="py-1 font-semibold">
                  <span className="sr-only">Orders</span>
                </th>
                <th className="py-1 text-right font-semibold">Total orders</th>
                <th className="py-1 text-right font-semibold">Total pack qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, color }) => (
                <tr key={m.label} className="border-t border-border">
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {color ? (
                        <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: color }} />
                      ) : null}
                      {m.label === 'In Progress' ? 'In progress' : m.label}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    <Link className="font-semibold text-foreground hover:underline" href={m.href}>
                      {fmt(m.count)}
                    </Link>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-secondary">{fmt(m.packQty ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <UnfulfilledAge buckets={data.unfulfilledAge ?? []} />
        </div>
      </div>
    </Panel>
  );
}
