'use client';

/** Battery, Funnel and Leaderboard widgets. */
import { Avatar, Tooltip, cn, toLabelColor } from '@/components/ui';
import { cssColor, cssFg, seriesColor } from '../lib/colors';
import { formatCompact, formatExact, formatPercent, resolveFormat } from '../lib/format';
import { Legend, NoDataState } from './shared';
import type { WidgetRenderProps } from './types';
import { useElementSize } from './use-element-size';

export function BatteryWidget({ insight, settings, filtered, onConfigure }: WidgetRenderProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const points = insight.series.filter((point) => point.count > 0);
  const total = points.reduce((sum, point) => sum + point.count, 0);
  if (total === 0) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;
  const color = (index: number) => seriesColor(points[index]?.color, index, settings.colorOverrides, points[index]?.key);
  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col justify-center gap-3" data-testid="battery-widget">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-medium tabular-nums text-fg">
          {insight.doneRatio === null ? '—' : formatPercent(insight.doneRatio)}
        </span>
        <span className="text-sm text-fg-secondary">done</span>
        <span className="ml-auto text-xs text-fg-muted tabular-nums">{total.toLocaleString('en-US')} items</span>
      </div>
      <div className="flex h-7 w-full shrink-0 overflow-hidden rounded-sm bg-muted" role="img" aria-label={points.map((point) => `${point.label} ${point.count}`).join(', ')}>
        {points.map((point, index) => (
          <Tooltip key={point.key} content={`${point.label}: ${point.count} (${formatPercent(point.count / total, 1)})`}>
            <span
              tabIndex={0}
              className="h-full origin-left outline-none transition-[filter] duration-[var(--duration-instant)] hover:brightness-110 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ks-dash-grow-x"
              style={{ width: `${(point.count / total) * 100}%`, background: cssColor(color(index)) }}
            />
          </Tooltip>
        ))}
      </div>
      {size.height >= BATTERY_BREAKDOWN_MIN ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2" data-testid="battery-breakdown">
          {points.map((point, index) => (
            <li key={point.key} className="flex min-w-0 flex-col rounded-md border border-border-subtle px-2.5 py-1.5">
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: cssColor(color(index)) }} />
                <span className="truncate">{point.label}</span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-lg font-medium tabular-nums text-fg">{point.count.toLocaleString('en-US')}</span>
                <span className="text-xs text-fg-muted tabular-nums">{formatPercent(point.count / total)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Legend
          entries={points.map((point, index) => ({
            key: point.key,
            label: point.label,
            color: color(index),
            detail: formatPercent(point.count / total),
          }))}
        />
      )}
    </div>
  );
}

/** Row height for a list that should fill its card without stretching thin content. */
export function fillRowHeight(available: number, rows: number, min: number, max: number): number {
  if (rows <= 0 || available <= 0) return min;
  return Math.max(min, Math.min(max, Math.floor(available / rows)));
}

const FUNNEL_ROW_MAX = 56;
const FUNNEL_CONNECTOR = 18;

export function FunnelWidget({ insight, settings, filtered, onConfigure }: WidgetRenderProps) {
  const [ref, size] = useElementSize<HTMLOListElement>();
  const stages = insight.series;
  const top = Math.max(...stages.map((stage) => stage.count), 0);
  if (stages.length === 0 || top === 0) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;
  const format = resolveFormat(settings, insight.valueColumn, settings.valueColumnKey ? settings.aggregate : 'count');
  const last = stages[stages.length - 1];
  const connectors = Math.max(stages.length - 1, 0) * FUNNEL_CONNECTOR;
  const rowHeight = fillRowHeight(size.height - connectors, stages.length, 30, FUNNEL_ROW_MAX);
  const barHeight = Math.min(Math.max(rowHeight - 10, 24), 40);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="funnel-widget">
      <ol ref={ref} className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
        {stages.map((stage, index) => {
          const color = seriesColor(stage.color, index, settings.colorOverrides, stage.key);
          const width = Math.max((stage.count / top) * 100, 6);
          const previous = stages[index - 1];
          return (
            <li key={stage.key} className="flex flex-col">
              {index > 0 ? (
                <span className="flex items-center gap-1.5 pl-3" style={{ height: FUNNEL_CONNECTOR }}>
                  <span aria-hidden className="h-full w-px bg-border-default" />
                  {stage.conversion !== null && stage.conversion !== undefined ? (
                    <span
                      className="rounded-full border border-border-subtle bg-panel px-1.5 text-2xs leading-4 font-semibold text-fg-secondary tabular-nums"
                      aria-label={`${formatPercent(stage.conversion)} converted from ${previous?.label ?? 'the previous stage'}`}
                    >
                      {formatPercent(stage.conversion)}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <div className="flex min-w-0 items-center gap-3" style={{ height: rowHeight }}>
                <Tooltip content={`${stage.label}: ${stage.count} reached · ${(stage.stack?.current ?? 0).toLocaleString('en-US')} here now · ${formatExact(stage.value, format)}`}>
                  <span
                    tabIndex={0}
                    className="flex shrink-0 items-center justify-end rounded-sm px-2 text-sm font-semibold tabular-nums outline-none transition-[width,filter] duration-[var(--duration-slower)] ease-out hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    style={{ width: `calc((100% - 150px) * ${(width / 100).toFixed(4)})`, minWidth: 36, height: barHeight, background: cssColor(color), color: cssFg(color) }}
                    aria-label={`${stage.label}: ${stage.count} reached, ${formatCompact(stage.value, format)} in stage now`}
                  >
                    {stage.count}
                  </span>
                </Tooltip>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-medium text-fg" title={stage.label}>
                    {stage.label}
                  </span>
                  <span className="truncate text-xs text-fg-muted tabular-nums">
                    <span className="font-medium text-fg-secondary">{formatCompact(stage.value, format)}</span> in stage now
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {last && top > 0 ? (
        <p className="border-t border-border-subtle pt-2 text-xs text-fg-muted">
          <span className="hidden @[420px]/widget:inline">Bars: deals that reached each stage · </span>Overall conversion <span className="font-semibold text-fg tabular-nums">{formatPercent(last.count / top, 1)}</span> from {stages[0]?.label} to {last.label}
        </p>
      ) : null}
    </div>
  );
}

const MEDALS = ['yellow', 'gray', 'brown'] as const;
const LEADER_GAP = 12;
/** Battery cards at least this tall add a per-stage breakdown below the bar. */
const BATTERY_BREAKDOWN_MIN = 150;

export function LeaderboardWidget({ insight, settings, filtered, onConfigure }: WidgetRenderProps) {
  const [ref, size] = useElementSize<HTMLOListElement>();
  const rows = insight.series;
  if (rows.length === 0) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;
  const format = resolveFormat(settings, insight.valueColumn, settings.valueColumnKey ? settings.aggregate : 'count');
  const max = Math.max(...rows.map((row) => row.value), 1);
  const accent = cssColor(toLabelColor(settings.color, 'blue'));
  // Rows grow to fill spare height (up to a comfortable maximum) and stay top-aligned under
  // the header with an even 12px rhythm.
  const rowHeight = fillRowHeight(size.height - LEADER_GAP * (rows.length - 1), rows.length, 52, 76);
  const roomy = rowHeight >= 66;
  return (
    <ol ref={ref} className="flex h-full min-h-0 flex-col justify-start gap-3 overflow-y-auto pr-1" data-testid="leaderboard-widget">
      {rows.map((row, index) => {
        const medal = MEDALS[index];
        return (
          <li
            key={row.key}
            className="flex shrink-0 items-center gap-3 rounded-md px-2 transition-colors duration-[var(--duration-instant)] hover:bg-hover"
            style={{ minHeight: rowHeight }}
          >
            <span
              className={cn('flex shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums', roomy ? 'size-7' : 'size-6')}
              style={medal ? { background: cssColor(medal), color: cssFg(medal) } : undefined}
              aria-label={`Rank ${index + 1}`}
            >
              <span className={medal ? undefined : 'text-fg-muted'}>{index + 1}</span>
            </span>
            <Avatar name={row.label} src={row.image ?? null} size={roomy ? 'md' : 'sm'} colorKey={row.key} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn('truncate font-medium text-fg', roomy ? 'text-base' : 'text-sm')}>{row.label}</span>
                <span className={cn('shrink-0 font-semibold tabular-nums text-fg', roomy ? 'text-md' : 'text-sm')} title={formatExact(row.value, format)}>
                  {formatCompact(row.value, format)}
                </span>
              </div>
              <div className={cn('mt-1 overflow-hidden rounded-full bg-muted', roomy ? 'h-2' : 'h-1.5')}>
                <div className="h-full rounded-full transition-[width] duration-[var(--duration-slower)] ease-out" style={{ width: `${(row.value / max) * 100}%`, background: accent }} />
              </div>
              <span className="text-2xs text-fg-muted tabular-nums">{row.count} {row.count === 1 ? 'item' : 'items'}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
