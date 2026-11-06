'use client';

/**
 * Workload widget: people × weeks, each cell a load bubble against weekly capacity.
 * Rows stretch to fill the card (bigger bubbles when there is room); narrow cards show fewer
 * weeks so nothing is clipped at the edge.
 */
import { Avatar, Tooltip } from '@/components/ui';
import { cssColor, cssFg } from '../lib/colors';
import { fillRowHeight } from './pipeline-widgets';
import { NoDataState } from './shared';
import type { WidgetRenderProps } from './types';
import { useElementSize } from './use-element-size';

const HEADER_HEIGHT = 30;
const LEGEND_HEIGHT = 26;
const NAME_COLUMN = 0.34;
const MIN_WEEK_WIDTH = 48;

export function loadTone(count: number, capacity: number): 'green' | 'orange' | 'red' | null {
  if (count === 0) return null;
  const ratio = count / capacity;
  if (ratio > 1) return 'red';
  if (ratio >= 0.8) return 'orange';
  return 'green';
}

/** How many week columns fit a card of `width` px (at least 2, at most `available`). */
export function visibleWeeks(width: number, available: number): number {
  if (width <= 0) return available;
  const fit = Math.floor((width * (1 - NAME_COLUMN)) / MIN_WEEK_WIDTH);
  return Math.max(2, Math.min(available, fit));
}

export function WorkloadWidget({ insight, filtered, onConfigure }: WidgetRenderProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const workload = insight.workload;
  if (!workload || workload.rows.length === 0) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;
  const { rows, capacity } = workload;
  const weeks = visibleWeeks(size.width, workload.periods.length);
  const periods = workload.periods.slice(0, weeks);
  const rowHeight = fillRowHeight(size.height - HEADER_HEIGHT - LEGEND_HEIGHT, rows.length, 40, 64);
  const bubble = Math.min(Math.max(rowHeight - 10, 28), 44);
  const hidden = workload.periods.length - weeks;
  const compactNames = size.width > 0 && size.width < 480;
  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col" data-testid="workload-widget" data-weeks={weeks}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Items per person per week, capacity {capacity}</caption>
          <colgroup>
            <col style={{ width: `${NAME_COLUMN * 100}%` }} />
            {periods.map((period) => (
              <col key={period.key} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr style={{ height: HEADER_HEIGHT }}>
              <th scope="col" className="border-b border-border-subtle pr-2 text-left text-xs font-medium text-fg-muted">
                Person
              </th>
              {periods.map((period) => (
                <th key={period.key} scope="col" className="truncate border-b border-border-subtle px-0.5 text-center text-[11px] font-medium whitespace-nowrap text-fg-muted" title={`Week of ${period.label}`}>
                  {period.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="group" style={{ height: rowHeight }}>
                <th scope="row" className="border-b border-border-subtle pr-2 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={row.name} src={row.image} size={rowHeight >= 52 ? 'sm' : 'xs'} colorKey={row.id} />
                    <span className="truncate text-fg" title={row.name}>
                      {compactNames ? row.name.split(' ')[0] : row.name}
                    </span>
                  </span>
                </th>
                {row.cells.slice(0, weeks).map((count, index) => {
                  const tone = loadTone(count, capacity);
                  const scale = Math.min(0.6 + (count / capacity) * 0.4, 1);
                  return (
                    <td key={periods[index]?.key ?? index} className="border-b border-border-subtle px-0.5 text-center">
                      <Tooltip content={`${row.name} · week of ${periods[index]?.label}: ${count} of ${capacity}`}>
                        <span
                          tabIndex={0}
                          className="mx-auto flex items-center justify-center rounded-full text-xs font-semibold tabular-nums outline-none transition-transform duration-[var(--duration-fast)] ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                          style={{
                            width: bubble,
                            height: bubble,
                            ...(tone
                              ? { background: cssColor(tone), color: cssFg(tone), transform: `scale(${scale})` }
                              : { background: 'var(--surface-muted)', color: 'var(--text-muted)', transform: 'scale(0.62)' }),
                          }}
                        >
                          {count}
                        </span>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex shrink-0 flex-wrap items-center gap-3 pt-2 text-xs text-fg-muted" style={{ minHeight: LEGEND_HEIGHT }}>
        <span>Capacity {capacity}/week</span>
        {(['green', 'orange', 'red'] as const).map((tone) => (
          <span key={tone} className="flex items-center gap-1">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: cssColor(tone) }} />
            {tone === 'green' ? 'Under' : tone === 'orange' ? 'Near' : 'Over'}
          </span>
        ))}
        {hidden > 0 ? <span className="ml-auto">+{hidden} more {hidden === 1 ? 'week' : 'weeks'} in full screen</span> : null}
      </p>
    </div>
  );
}
