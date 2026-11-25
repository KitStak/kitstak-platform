'use client';
/**
 * Daily units under the month chart (docs/programs/SPEC.md 5.6): one column per day, today's column
 * highlighted, planned future columns in a lighter tint. Hover or focus shows the day.
 */
import { formatCents, formatQty, unitLabel } from '@kitstak/programs-engine';
import { Tooltip, cn } from '@/components/ui';
import type { IsoDate, UnitLabel } from '@/lib/program-types';
import { weekdayDate } from './overview-model';

export interface DailyColumn {
  readonly date: IsoDate;
  readonly units: number;
  readonly planned: number;
  readonly future: boolean;
  readonly today: boolean;
  readonly revenueCents: string | null;
}

export function DailyColumns({ days, unit, moneyHidden }: { readonly days: readonly DailyColumn[]; readonly unit: UnitLabel; readonly moneyHidden: boolean }) {
  const max = Math.max(1, ...days.map((day) => (day.future ? day.planned : day.units)));
  const total = days.filter((day) => !day.future).reduce((sum, day) => sum + day.units, 0);
  const plannedAhead = days.filter((day) => day.future).reduce((sum, day) => sum + day.planned, 0);
  return (
    <figure className="flex flex-col gap-2" data-testid="daily-columns">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span className="font-medium text-fg-secondary">{`${unit.plural[0]?.toUpperCase() ?? ''}${unit.plural.slice(1)}`} a day</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-xs bg-[var(--chart-1)]" />
            Built
          </span>
          {plannedAhead > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-xs bg-[var(--chart-1)] opacity-30" />
              Planned
            </span>
          ) : null}
        </span>
      </figcaption>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`${unitLabel(String(Math.round(total)), unit)} built this month${plannedAhead > 0 ? `, ${unitLabel(String(Math.round(plannedAhead)), unit)} planned ahead` : ''}.`}>
        {days.map((day) => {
          const value = day.future ? day.planned : day.units;
          const height = value > 0 ? Math.max(4, (value / max) * 100) : 2;
          const label = day.future
            ? `${weekdayDate(day.date)} · ${unitLabel(String(day.planned), unit)} planned`
            : `${weekdayDate(day.date)} · ${unitLabel(String(day.units), unit)} built${day.planned > 0 ? ` of ${formatQty(String(day.planned))} planned` : ''}${!moneyHidden && day.revenueCents && day.revenueCents !== '0' ? ` · ${formatCents(day.revenueCents, { cents: true })}` : ''}`;
          return (
            <Tooltip key={day.date} content={label}>
              <span tabIndex={-1} className="flex h-full min-w-0 flex-1 items-end" aria-label={label}>
                <span
                  className={cn('w-full rounded-t-[2px]', value === 0 ? 'bg-border-subtle' : day.today ? 'bg-[var(--logo-ink)]' : 'bg-[var(--chart-1)]', day.future && value > 0 && 'opacity-30')}
                  style={{ height: `${height}%` }}
                />
              </span>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex justify-between text-2xs text-fg-muted tabular-nums" aria-hidden>
        <span>{days[0] ? Number(days[0].date.slice(8, 10)) : ''}</span>
        <span>{days[Math.floor(days.length / 2)] ? Number(days[Math.floor(days.length / 2)]!.date.slice(8, 10)) : ''}</span>
        <span>{days.at(-1) ? Number(days.at(-1)!.date.slice(8, 10)) : ''}</span>
      </div>
    </figure>
  );
}
