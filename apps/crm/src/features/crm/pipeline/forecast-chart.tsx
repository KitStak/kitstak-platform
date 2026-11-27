'use client';
import { useRef, useState, type KeyboardEvent } from 'react';
import { CalendarClock, Info } from 'lucide-react';
import { Tooltip, cn } from '@/components/ui';
import type { ForecastMonthDto } from '@/server/services/crm-contracts';
import { formatExactMoney, formatMonth, formatMoney } from '../lib/format';

const CHART_HEIGHT = 168;
/** Two gridlines above the baseline: half and full scale, both round numbers from niceMax. */
const GRID_STEPS = 2;

/** Round a max up to a "nice" axis bound (1, 2, 2.5, 5 × 10^n). */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => normalized <= candidate) ?? 10;
  return step * magnitude;
}

/**
 * Forecast by close month: won (green) + weighted open (blue) stacked, best case as a dashed
 * ghost bar behind, value labels above each stack and light gridlines with axis labels. Bars
 * are a roving-tabindex group (←/→/Home/End), each opening its breakdown tooltip on focus.
 */
export function ForecastChart({
  months,
  currency,
}: {
  readonly months: readonly ForecastMonthDto[];
  readonly currency: string;
}) {
  const visible = months.filter((month) => month.month !== 'overdue' || month.bestCase > 0);
  const rawMax = Math.max(0, ...visible.map((month) => Math.max(month.bestCase + month.won, month.weighted + month.won)));
  const axisMax = niceMax(rawMax);
  const total = visible.reduce(
    (sum, month) => ({ won: sum.won + month.won, weighted: sum.weighted + month.weighted }),
    { won: 0, weighted: 0 },
  );
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const isEmpty = rawMax === 0;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = visible.length - 1;
    const next =
      event.key === 'ArrowRight' ? Math.min(last, index + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="crm-forecast">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-hidden>
          {/* Weighted is informational blue (from the stage palette), never brand red: red is
              reserved for risk / lost / overdue on this page. */}
          <Legend swatch="bg-[var(--label-green)]" label="Won" />
          <Legend swatch="bg-[var(--label-blue)]" label="Weighted" />
          <Legend swatch="border border-dashed border-[var(--label-blue)] bg-[var(--label-blue-subtle)]" label="Best case" />
        </span>
        <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
          Commit <strong className="font-semibold text-fg">{formatMoney(total.won + total.weighted, currency)}</strong>
          <Tooltip content="Commit = won + weighted open pipeline (value × stage probability) closing in these months. Best case counts every open deal at full value.">
            <button
              type="button"
              aria-label="What is commit?"
              className="inline-flex size-5 items-center justify-center rounded-sm text-icon outline-none transition-colors duration-[var(--duration-fast)] hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Info aria-hidden className="size-3.5" />
            </button>
          </Tooltip>
        </span>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md bg-sunken px-4 py-10 text-center" data-testid="crm-forecast-empty">
          <CalendarClock aria-hidden className="size-6 text-icon" />
          <p className="text-base font-medium text-fg">No deals close in the next six months</p>
          <p className="text-sm text-fg-secondary">Add a close date to open deals to see them here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          {/* Y axis */}
          <div className="relative w-10 text-right text-2xs tabular-nums text-fg-muted" style={{ height: CHART_HEIGHT + 18 }} aria-hidden>
            {Array.from({ length: GRID_STEPS + 1 }, (_, step) => (
              <span
                key={step}
                className="absolute right-0 -translate-y-1/2"
                style={{ top: 18 + CHART_HEIGHT - (CHART_HEIGHT * step) / GRID_STEPS }}
              >
                {formatMoney((axisMax * step) / GRID_STEPS, currency)}
              </span>
            ))}
          </div>
          <div className="relative min-w-0">
            {/* Gridlines */}
            <div className="pointer-events-none absolute inset-x-0" style={{ top: 18, height: CHART_HEIGHT }} aria-hidden>
              {Array.from({ length: GRID_STEPS + 1 }, (_, step) => (
                <span
                  key={step}
                  className={cn('absolute inset-x-0 border-t', step === 0 ? 'border-border-default' : 'border-dashed border-border-subtle')}
                  style={{ bottom: (CHART_HEIGHT * step) / GRID_STEPS }}
                />
              ))}
            </div>
            <div role="group" aria-label="Forecast by month. Use arrow keys to move between months" className="relative flex items-end gap-2 sm:gap-3">
              {visible.map((month, index) => {
                const scale = (value: number) => Math.round((value / axisMax) * CHART_HEIGHT);
                const overdue = month.month === 'overdue';
                const commit = month.won + month.weighted;
                const label = `${formatMonth(month.month)}: won ${formatExactMoney(month.won, currency)}, weighted ${formatExactMoney(month.weighted, currency)}, best case ${formatExactMoney(month.bestCase, currency)}, ${month.count} open`;
                return (
                  <Tooltip
                    key={month.month}
                    side="top"
                    content={
                      <span className="flex flex-col gap-0.5 tabular-nums">
                        <strong>{formatMonth(month.month)}</strong>
                        <span>Won {formatExactMoney(month.won, currency)}</span>
                        <span>Weighted {formatExactMoney(month.weighted, currency)}</span>
                        <span>
                          Best case {formatExactMoney(month.bestCase, currency)} · {month.count} open
                        </span>
                      </span>
                    }
                  >
                    <button
                      ref={(node) => {
                        refs.current[index] = node;
                      }}
                      type="button"
                      tabIndex={index === active ? 0 : -1}
                      aria-label={label}
                      onFocus={() => setActive(index)}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      data-testid="crm-forecast-bar"
                      className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <span className="relative flex w-full max-w-12 flex-col justify-end" style={{ height: CHART_HEIGHT + 18 }}>
                        <span
                          className={cn(
                            'absolute inset-x-0 bottom-0 rounded-t-sm border border-dashed transition-colors duration-[var(--duration-fast)]',
                            overdue
                              ? 'border-danger bg-danger-subtle'
                              : 'border-[var(--label-blue)] bg-[var(--label-blue-subtle)] group-hover:bg-[var(--label-blue-light-subtle)]',
                          )}
                          style={{ height: scale(month.bestCase + month.won) }}
                        />
                        <span className="relative flex flex-col items-center justify-end">
                          <span
                            className={cn('mb-1 whitespace-nowrap text-2xs font-semibold tabular-nums', overdue ? 'text-danger-text' : 'text-fg-secondary')}
                          >
                            {commit > 0 ? formatMoney(commit, currency) : ''}
                          </span>
                          <span className={cn('w-full rounded-t-sm', overdue ? 'bg-danger' : 'bg-[var(--label-blue)]')} style={{ height: scale(month.weighted) }} />
                          <span className="w-full bg-[var(--label-green)]" style={{ height: scale(month.won) }} />
                        </span>
                      </span>
                      <span className={cn('text-xs font-medium', overdue ? 'text-danger-text' : 'text-fg-secondary')}>{formatMonth(month.month, true)}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <table className="sr-only">
        <caption>Forecast by close month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Won</th>
            <th scope="col">Weighted</th>
            <th scope="col">Best case</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((month) => (
            <tr key={month.month}>
              <th scope="row">{formatMonth(month.month)}</th>
              <td>{formatExactMoney(month.won, currency)}</td>
              <td>{formatExactMoney(month.weighted, currency)}</td>
              <td>{formatExactMoney(month.bestCase, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend({ swatch, label }: { readonly swatch: string; readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-xs', swatch)} />
      {label}
    </span>
  );
}
