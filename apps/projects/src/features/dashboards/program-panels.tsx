'use client';
/**
 * The Programs section of Dashboards (docs/programs/SPEC.md 5.19): "Program revenue by month"
 * (stacked columns by program, last 12 months), "Units by variant" (the top 10 variants this month
 * across programs) and "Programs vs target" (each forecast as a % of target with the 100 percent
 * line). Money stays whole cents; bar sizes are ratios only. People without money access see
 * units instead of revenue.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatCents, formatPercentBp, formatQty, fromScaled, quantityToScaled, unitLabel } from '@kitstak/programs-engine';
import { ToggleGroup, Tooltip, cn } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import type { IsoMonth, UnitLabel } from '@/lib/program-types';
import { ProgramIcon, TargetChip, VariantDot, paletteColor, programHref, programsHref } from '@/features/programs/kit';
import { monthLabel } from '@/features/programs/trends/trends-model';

export interface ProgramsDashboardData {
  readonly months: readonly IsoMonth[];
  readonly month: IsoMonth;
  readonly moneyHidden: boolean;
  readonly programs: readonly {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly color: string | null;
    readonly icon: string | null;
    readonly unit: UnitLabel;
    readonly cells: readonly { readonly month: IsoMonth; readonly units: string; readonly revenueCents: string | null }[];
    readonly forecastCents: string | null;
    readonly targetCents: string | null;
    readonly targetBp: number | null;
  }[];
  readonly variants: readonly { readonly programKey: string; readonly name: string; readonly color: string | null; readonly units: string; readonly unit: UnitLabel; readonly revenueCents: string | null }[];
}

const big = (value: string | null | undefined): bigint => {
  try {
    return value ? BigInt(value) : BigInt(0);
  } catch {
    return BigInt(0);
  }
};
const qty = (value: string | null | undefined): bigint => {
  try {
    return value ? quantityToScaled(value) : BigInt(0);
  } catch {
    return BigInt(0);
  }
};
/** A 0 to 1 ratio for drawing only. */
const ratio = (part: bigint, whole: bigint): number => (whole > BigInt(0) ? Number((part * BigInt(10000)) / whole) / 10000 : 0);

const SERIES_TONES = ['blue', 'green', 'orange', 'purple', 'teal', 'pink'] as const;

/**
 * One distinct tone per program for the stacked chart: a program keeps its own color unless an
 * earlier program already took it, then it gets the next free tone so two stacks never look alike.
 */
function seriesTones(programs: readonly { readonly id: string; readonly color: string | null }[]): ReadonlyMap<string, string> {
  const used = new Set<string>();
  const tones = new Map<string, string>();
  programs.forEach((program, index) => {
    let tone: string = paletteColor(program.color, SERIES_TONES[index % SERIES_TONES.length]);
    if (used.has(tone)) tone = SERIES_TONES.find((candidate) => !used.has(candidate)) ?? tone;
    used.add(tone);
    tones.set(program.id, `var(--label-${tone})`);
  });
  return tones;
}

function RevenueByMonth({ data }: { readonly data: ProgramsDashboardData }) {
  const [metric, setMetric] = useState<'revenue' | 'units'>(data.moneyHidden ? 'units' : 'revenue');
  // Units are only added within one unit label: the chart shows the label most programs use.
  const unitGroups = useMemo(() => [...new Set(data.programs.map((program) => program.unit.plural))], [data.programs]);
  const [unitPick, setUnitPick] = useState(unitGroups[0] ?? 'kits');
  const programs = metric === 'units' ? data.programs.filter((program) => program.unit.plural === unitPick) : data.programs;
  const value = (cell: { units: string; revenueCents: string | null }) => (metric === 'revenue' ? big(cell.revenueCents) : qty(cell.units));
  const allTotals = data.months.map((_, index) => programs.reduce((sum, program) => sum + value(program.cells[index] ?? { units: '0', revenueCents: '0' }), BigInt(0)));
  // Start at the first month with output (at least six months stay in view), so a new program does
  // not sit beside a row of empty months.
  const firstWithData = allTotals.findIndex((total) => total > BigInt(0));
  const start = firstWithData < 0 ? 0 : Math.max(0, Math.min(firstWithData, data.months.length - 6));
  const months = data.months.slice(start);
  const totals = allTotals.slice(start);
  const cellAt = (program: ProgramsDashboardData['programs'][number], index: number) => program.cells[start + index] ?? { units: '0', revenueCents: '0' };
  const max = totals.reduce((best, total) => (total > best ? total : best), BigInt(0));
  const tones = seriesTones(programs);
  const tone = (id: string) => tones.get(id) ?? 'var(--chart-1)';
  const text = (amount: bigint) => (metric === 'revenue' ? formatCents(amount) : `${formatQty(fromScaled(amount, 3))} ${unitPick}`);
  const height = 180;
  return (
    <Panel
      title={metric === 'revenue' ? 'Program revenue by month' : 'Program units by month'}
      action={
        <div className="flex items-center gap-2">
          {metric === 'units' && unitGroups.length > 1 ? <ToggleGroup size="sm" label="Unit" value={unitPick} onValueChange={setUnitPick} options={unitGroups.map((unit) => ({ value: unit, label: unit.charAt(0).toUpperCase() + unit.slice(1) }))} /> : null}
          {data.moneyHidden ? null : <ToggleGroup size="sm" label="Show" value={metric} onValueChange={setMetric} options={[{ value: 'revenue', label: 'Revenue' }, { value: 'units', label: 'Units' }]} />}
        </div>
      }
    >
      {firstWithData < 0 ? (
        <p className="py-12 text-center text-sm text-fg-muted" data-testid="program-revenue-empty">No output logged in the last 12 months yet. Log a day of output and it shows here.</p>
      ) : (
      <div className="flex flex-col gap-3" data-testid="program-revenue-chart">
        <div className="relative flex items-end gap-1.5 border-b border-border-subtle" style={{ height }} role="img" aria-label={`${metric === 'revenue' ? 'Revenue' : 'Units'} by month: ${months.map((month, index) => `${monthLabel(month)} ${text(totals[index] ?? BigInt(0))}`).join(', ')}`}>
          {months.map((month, index) => {
            const total = totals[index] ?? BigInt(0);
            return (
              <Tooltip key={month} content={<span className="flex flex-col gap-0.5"><span className="font-semibold">{monthLabel(month)} · {text(total)}</span>{programs.map((program) => { const v = value(cellAt(program, index)); return v > BigInt(0) ? <span key={program.id}>{program.key} {text(v)}</span> : null; })}</span>}>
                <div tabIndex={0} className={cn('relative flex h-full min-w-0 flex-1 flex-col-reverse rounded-t-sm outline-none focus-visible:outline-2 focus-visible:outline-focus', month === data.month && 'bg-sunken/60')} aria-label={`${monthLabel(month)} ${text(total)}`}>
                  {total > BigInt(0) ? <span className="absolute inset-x-0 text-center text-2xs font-semibold whitespace-nowrap text-fg tabular-nums" style={{ bottom: `${ratio(total, max) * (height - 28) + 4}px` }}>{metric === 'revenue' ? formatCents(total, { compact: true }) : formatQty(fromScaled(total, 3))}</span> : null}
                  {programs.map((program) => {
                    const v = value(cellAt(program, index));
                    if (v <= BigInt(0)) return null;
                    return <span key={program.id} style={{ height: `${ratio(v, max) * (height - 28)}px`, background: tone(program.id) }} className="w-full first:rounded-b-none last:rounded-t-sm" />;
                  })}
                </div>
              </Tooltip>
            );
          })}
        </div>
        <div className="flex gap-1.5 text-2xs text-fg-muted">
          {months.map((month) => (
            <span key={month} className={cn('min-w-0 flex-1 text-center', month === data.month && 'font-semibold text-fg')}>
              <span className="sm:hidden">{monthLabel(month, true).charAt(0)}</span>
              <span className="hidden sm:inline">{monthLabel(month, true)}</span>
            </span>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
          {programs.map((program) => (
            <li key={program.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: tone(program.id) }} />
              {program.name}
            </li>
          ))}
        </ul>
        {start > 0 ? (
          <p className="text-xs text-fg-muted">No output was logged before {monthLabel(data.months[firstWithData]!)}. The chart starts {months.length} months back.</p>
        ) : null}
      </div>
      )}
    </Panel>
  );
}

function UnitsByVariant({ data }: { readonly data: ProgramsDashboardData }) {
  const top = data.variants.slice(0, 10);
  const max = top.reduce((best, variant) => (qty(variant.units) > best ? qty(variant.units) : best), BigInt(0));
  // A variant with no color of its own takes its program's color, so the dot matches the program chip.
  const programColor = new Map(data.programs.map((program) => [program.key, program.color]));
  const colorOf = (variant: (typeof top)[number]) => paletteColor(variant.color ?? programColor.get(variant.programKey) ?? null);
  return (
    <Panel title="Units by variant">
      {top.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No output logged this month yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="units-by-variant">
          {top.map((variant) => (
            <li key={`${variant.programKey}-${variant.name}`} className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm">
                <VariantDot color={colorOf(variant)} />
                <span className="min-w-0 flex-1 truncate text-fg" title={variant.name}>{variant.name}</span>
                <span className="shrink-0 font-key text-2xs text-fg-muted">{variant.programKey}</span>
                <span className="w-24 shrink-0 text-right text-xs font-medium text-fg tabular-nums">{unitLabel(variant.units, variant.unit)}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(2, ratio(qty(variant.units), max) * 100)}%`, background: `var(--label-${colorOf(variant)})` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-fg-muted">Up to 10 variants with the most units this month, across programs.</p>
    </Panel>
  );
}

function VersusTarget({ data }: { readonly data: ProgramsDashboardData }) {
  const rows = data.programs.filter((program) => program.targetBp !== null).sort((a, b) => (b.targetBp ?? 0) - (a.targetBp ?? 0));
  const maxBp = Math.max(12000, ...rows.map((row) => row.targetBp ?? 0));
  return (
    <Panel title="Programs vs target">
      {data.moneyHidden ? (
        <p className="py-8 text-center text-sm text-fg-muted">Money is hidden for your role.</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No program has a monthly target yet. Set one in a program&apos;s Settings.</p>
      ) : (
        <div className="relative grid grid-cols-[minmax(0,124px)_minmax(48px,1fr)_auto] items-center gap-x-3 gap-y-3" data-testid="programs-vs-target">
          {rows.map((row) => {
            const href = programHref(row.key);
            const bp = row.targetBp ?? 0;
            const tone = bp >= 10000 ? 'var(--success)' : bp >= 9000 ? 'var(--warning)' : 'var(--danger)';
            const label = (
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                <ProgramIcon icon={row.icon} color={row.color} size={16} />
                <span className="truncate text-fg" title={row.name}>{row.name}</span>
              </span>
            );
            return (
              <div key={row.id} className="contents">
                {href ? <Link href={href} className="min-w-0 rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">{label}</Link> : label}
                <span className="relative h-3 min-w-0 rounded-sm bg-sunken">
                  <span className="block h-full rounded-sm" style={{ width: `${Math.min(100, (bp / maxBp) * 100)}%`, background: tone }} />
                  <span aria-hidden className="absolute -top-1 -bottom-1 border-l-2 border-dashed border-fg" style={{ left: `${(10000 / maxBp) * 100}%` }} />
                </span>
                <span className="flex shrink-0 justify-end whitespace-nowrap"><TargetChip targetBp={bp} /></span>
              </div>
            );
          })}
          <p className="col-span-3 text-xs text-fg-muted">Forecast for {monthLabel(data.month)} against each target. The dashed line is 100%. {formatPercentBp(10000)} or more is on track.</p>
        </div>
      )}
    </Panel>
  );
}

export function ProgramsSection({ data }: { readonly data: ProgramsDashboardData }) {
  if (data.programs.length === 0) return null;
  const directory = programsHref();
  return (
    <section className="flex flex-col gap-4" aria-labelledby="programs-section-title" data-testid="dashboard-programs">
      <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-5">
        <h2 id="programs-section-title" className="text-lg font-semibold text-fg">Programs</h2>
        {directory ? <Link href={directory} className="text-sm font-medium text-fg-secondary hover:text-fg hover:underline">Open Programs</Link> : null}
      </div>
      <RevenueByMonth data={data} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <UnitsByVariant data={data} />
        <VersusTarget data={data} />
      </div>
    </section>
  );
}
