'use client';
/**
 * "By variant" on the Overview (docs/programs/SPEC.md 5.6): units per variant as bars in the
 * variant colors, and a table with units, average price, revenue, share of revenue and a 4 week
 * trend. Footer rows add fixed and one time charges so the table ends on the month total exactly.
 * Clicking a variant opens the Builds table filtered to it.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { addDays, eachDay, formatCents, formatQty, formatUnitPrice, ratioBp, unitLabel } from '@kitstak/programs-engine';
import { ProgressBar, Skeleton, cn } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { useProgramBuilds } from '@/lib/hooks/use-programs';
import { routes } from '@/lib/routes';
import type { ProgramSummaryDTO } from '@/lib/program-types';
import { StackedBars } from '@/features/dashboards/charts';
import { BUILD_FILTER_PARAM, DEFAULT_BUILD_FILTERS, formatBuildFilters } from '../builds/builds-model';
import { useCurrentProgram } from '../program-context';
import { OutputSparkline } from '../kit/numbers';
import { variantChartColor } from './overview-model';

function variantBuildsHref(key: string, variantId: string): string {
  const filter = formatBuildFilters({ ...DEFAULT_BUILD_FILTERS, variants: [variantId] });
  return `${routes.programBuilds(key, 'table')}?${BUILD_FILTER_PARAM}=${encodeURIComponent(filter)}`;
}

export function ByVariantPanel({ summary }: { readonly summary: ProgramSummaryDTO }) {
  const { key, unit, variants, moneyHidden, today } = useCurrentProgram();
  const from = addDays(today, -27);
  const builds = useProgramBuilds(key, { from, to: today, limit: 500 });
  const order = useMemo(() => new Map(variants.map((variant, index) => [variant.id, index])), [variants]);
  const rows = useMemo(() => [...summary.byVariant].sort((a, b) => (order.get(a.variantId ?? '') ?? 999) - (order.get(b.variantId ?? '') ?? 999)), [summary.byVariant, order]);
  const trend = useMemo(() => {
    const days = eachDay(from, today);
    const byVariant = new Map<string, Map<string, number>>();
    for (const item of builds.data?.items ?? []) {
      const variantId = item.build.variantId ?? 'none';
      const map = byVariant.get(variantId) ?? new Map<string, number>();
      map.set(item.build.buildDate, (map.get(item.build.buildDate) ?? 0) + Number(item.build.builtQty));
      byVariant.set(variantId, map);
    }
    return { days, byVariant };
  }, [builds.data, from, today]);
  const workTotal = rows.reduce((sum, row) => sum + BigInt(row.totalCents ?? '0'), BigInt(0));
  const maxShare = rows.reduce((best, row) => Math.max(best, row.totalCents && workTotal > BigInt(0) ? (ratioBp(row.totalCents, workTotal) ?? 0) : 0), 1);
  const total = summary.result.totalCents ? BigInt(summary.result.totalCents) : null;
  const fixedRow = total === null ? null : total - workTotal;
  const fixedParts: string[] = [];
  if (summary.result.fixed && BigInt(summary.result.fixed.monthlyFeeCents) !== BigInt(0)) fixedParts.push(`Monthly fee ${formatCents(summary.result.fixed.monthlyFeeCents, { cents: true })}`);
  if (summary.result.fixed && BigInt(summary.result.fixed.setupCents) !== BigInt(0)) fixedParts.push(`Setup ${formatCents(summary.result.fixed.setupCents, { cents: true })}`);
  if (summary.result.adjustments && BigInt(summary.result.adjustments.totalCents) !== BigInt(0)) fixedParts.push(`Adjustments ${formatCents(summary.result.adjustments.totalCents, { cents: true })}`);
  if (summary.result.minimum && BigInt(summary.result.minimum.topUpCents) !== BigInt(0)) fixedParts.push(`Minimum top up ${formatCents(summary.result.minimum.topUpCents, { cents: true })}`);
  const colorFor = (variantId: string | null) => {
    const index = order.get(variantId ?? '') ?? rows.length;
    const variant = variants.find((entry) => entry.id === variantId);
    return variantChartColor(variant?.color, index);
  };
  const bars = rows.map((row) => ({
    id: row.variantId ?? 'none',
    label: <span className="truncate">{row.name}</span>,
    text: `${row.name}: ${unitLabel(row.units, unit)}`,
    segments: [{ label: row.name, value: Number(row.units), color: colorFor(row.variantId) }],
    trailing: <span className="text-xs text-fg-secondary tabular-nums">{formatQty(row.units)}</span>,
  }));
  return (
    <Panel title="By variant" action={<span className="text-xs text-fg-muted">{rows.length === 1 ? '1 variant' : `${rows.length} variants`} this month</span>} bodyClassName="p-0">
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-muted">Nothing built this month yet. Output shows here by variant as soon as it is logged.</p>
      ) : (
        <div className="flex flex-col">
          <div className="grid gap-x-8 gap-y-2.5 border-b border-border-subtle p-4 md:grid-cols-2">
            <StackedBars rows={bars.slice(0, Math.ceil(bars.length / 2))} title={`${unit.plural} built by variant`} emptyText="Nothing built yet" />
            {bars.length > 1 ? <StackedBars rows={bars.slice(Math.ceil(bars.length / 2))} title={`${unit.plural} built by variant, continued`} emptyText="Nothing built yet" /> : null}
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" data-testid="by-variant-table">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-fg-muted">
                  <th scope="col" className="px-4 py-2 font-medium">Variant</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">{`${unit.plural[0]?.toUpperCase() ?? ''}${unit.plural.slice(1)}`}</th>
                  {moneyHidden ? null : (
                    <>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Avg price</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Revenue</th>
                      <th scope="col" className="w-24 px-2 py-2 font-medium">Share</th>
                    </>
                  )}
                  <th scope="col" className="w-24 px-4 py-2 font-medium">4 weeks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const share = row.totalCents && workTotal > BigInt(0) ? ratioBp(row.totalCents, workTotal) : null;
                  const points = trend.days.map((date) => ({ date, units: String(trend.byVariant.get(row.variantId ?? 'none')?.get(date) ?? 0) }));
                  return (
                    <tr key={row.variantId ?? 'none'} className="border-b border-border-subtle last:border-b-0 hover:bg-hover">
                      <td className="max-w-[180px] px-4 py-2">
                        {row.variantId ? (
                          <Link href={variantBuildsHref(key, row.variantId)} className="flex min-w-0 items-center gap-2 rounded-sm font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus" title={`See ${row.name} builds`}>
                            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: colorFor(row.variantId) }} />
                            <span className="truncate">{row.name}</span>
                          </Link>
                        ) : (
                          <span className="text-fg-muted">No variant</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-fg tabular-nums">{formatQty(row.units)}</td>
                      {moneyHidden ? null : (
                        <>
                          <td className="px-2 py-2 text-right text-fg-secondary tabular-nums">{formatUnitPrice(row.avgUnitPrice)}</td>
                          <td className="px-2 py-2 text-right font-medium text-fg tabular-nums">{formatCents(row.totalCents, { cents: true })}</td>
                          <td className="px-2 py-2">
                            {share === null ? null : (
                              <span className="flex items-center gap-1.5">
                                <ProgressBar value={(share / maxShare) * 100} size="sm" label={`${row.name} is ${Math.floor(share / 100)} percent of work revenue`} className="flex-1" />
                                <span className="w-8 text-right text-2xs text-fg-muted tabular-nums">{Math.floor(share / 100)}%</span>
                              </span>
                            )}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-2">{builds.isLoading ? <Skeleton height={20} /> : <OutputSparkline points={points} unit={unit} height={20} />}</td>
                    </tr>
                  );
                })}
              </tbody>
              {moneyHidden || fixedRow === null ? null : (
                <tfoot>
                  <tr className="border-t border-border-default text-sm">
                    <th scope="row" className="px-4 py-2 text-left font-medium text-fg-secondary" colSpan={3}>
                      Fixed and one time
                      {fixedParts.length ? <span className="block text-2xs font-normal text-fg-muted">{fixedParts.join(' · ')}</span> : null}
                    </th>
                    <td className="px-2 py-2 text-right font-medium text-fg tabular-nums">{formatCents(fixedRow, { cents: true })}</td>
                    <td colSpan={2} />
                  </tr>
                  <tr className={cn('border-t border-border-subtle bg-sunken/60 text-sm')}>
                    <th scope="row" className="px-4 py-2 text-left font-semibold text-fg" colSpan={3}>
                      Total
                    </th>
                    <td className="px-2 py-2 text-right font-semibold text-fg tabular-nums" data-testid="by-variant-total">
                      {formatCents(total, { cents: true })}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
