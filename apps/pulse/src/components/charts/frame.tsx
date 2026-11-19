'use client';
/**
 * Shared shell for every Pulse chart: measured width, title and description, legend, loading,
 * empty and error states, the hover and focus tooltip, the live region that reads the focused
 * point, and the data table for screen readers (which a "Show table" button can also show).
 */
import { ScrollX } from '@/components/ui/scroll-x';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BarChart3, CircleAlert, Table2 } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import './charts.css';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Width of an element, kept in sync with a ResizeObserver. `fixed` skips measuring (tests, print). */
export function useChartWidth<T extends HTMLElement>(fixed?: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fixed ?? 0);
  useIsoLayoutEffect(() => {
    if (fixed !== undefined) return;
    const node = ref.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fixed]);
  return [ref, fixed ?? width] as const;
}

export interface RovingOptions {
  /** Where focus lands first: the newest point on a time line, the first bar on a ranking. */
  readonly start?: 'first' | 'last';
  /** Columns in a grid (heatmap). Up and down then move by one row. */
  readonly move?: (index: number, key: string) => number | undefined;
}

/**
 * One tab stop for a whole chart. Arrow keys walk the points, Home and End jump to the ends,
 * Escape clears. Hover and focus share the same `active` index, so both show the same tooltip.
 */
export function useRoving(count: number, options: RovingOptions = {}) {
  const [active, setActive] = useState<number | null>(null);
  const [byKeyboard, setByKeyboard] = useState(false);
  const { start = 'last', move } = options;
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (count === 0) return;
      const current = active ?? (start === 'last' ? count - 1 : 0);
      let next: number | null | undefined;
      const custom = move?.(current, event.key);
      if (custom !== undefined) next = custom;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = active === null ? current : Math.min(count - 1, current + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = active === null ? current : Math.max(0, current - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = count - 1;
      else if (event.key === 'Escape') next = null;
      if (next === undefined) return;
      event.preventDefault();
      setByKeyboard(true);
      setActive(next === null ? null : Math.max(0, Math.min(count - 1, next)));
    },
    [active, count, move, start],
  );
  const onFocus = useCallback(() => {
    setByKeyboard(true);
    setActive((current) => current ?? (count === 0 ? null : start === 'last' ? count - 1 : 0));
  }, [count, start]);
  const onBlur = useCallback(() => {
    setByKeyboard(false);
    setActive(null);
  }, []);
  const hover = useCallback((index: number | null) => {
    setByKeyboard(false);
    setActive(index);
  }, []);
  const safeActive = active !== null && active < count ? active : null;
  return { active: safeActive, byKeyboard, hover, onKeyDown, onFocus, onBlur };
}

// --- Legend -------------------------------------------------------------------------------

export interface LegendItem {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  /** `line` for lines, `box` for bars and areas, `dash` for targets, `dot` for points. */
  readonly shape?: 'box' | 'line' | 'dash' | 'dot';
  readonly value?: ReactNode;
}

export function LegendSwatch({ color, shape = 'box' }: { readonly color: string; readonly shape?: LegendItem['shape'] }) {
  if (shape === 'line') return <span aria-hidden className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: color }} />;
  if (shape === 'dash') return <span aria-hidden className="h-0 w-3.5 shrink-0 border-t-2 border-dashed" style={{ borderColor: color }} />;
  if (shape === 'dot') return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
  return <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
}

export function ChartLegend({ items, className }: { readonly items: readonly LegendItem[]; readonly className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary', className)}>
      {items.map((item) => (
        <li key={item.id} className="inline-flex min-w-0 items-center gap-1.5">
          <LegendSwatch color={item.color} shape={item.shape} />
          <span className="truncate">{item.label}</span>
          {item.value !== undefined ? <strong className="font-semibold text-fg tabular-nums">{item.value}</strong> : null}
        </li>
      ))}
    </ul>
  );
}

// --- Tooltip ------------------------------------------------------------------------------

export interface TooltipRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly color?: string;
  readonly shape?: LegendItem['shape'];
  /** Dimmed rows (context such as a total or a target). */
  readonly muted?: boolean;
}

export interface TooltipModel {
  /** Anchor inside the chart box, in pixels. */
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly rows: readonly TooltipRow[];
  readonly note?: string;
}

/** The floating readout. Values lead and names follow; it never takes pointer events. */
export function ChartTooltip({ model, boxWidth }: { readonly model: TooltipModel | null; readonly boxWidth: number }) {
  if (!model) return null;
  const flip = model.x > boxWidth / 2;
  const narrow = boxWidth < 280;
  return (
    <div
      role="presentation"
      className="pc-tip pointer-events-none absolute top-0 left-0 z-10 w-max rounded-md border border-border-default bg-raised px-2.5 py-2 text-xs shadow-popover"
      style={{
        maxWidth: Math.max(140, Math.min(260, boxWidth - 16)),
        transform: narrow
          ? `translate(${Math.max(4, Math.min(boxWidth - 150, model.x - 70))}px, ${Math.max(0, model.y + 14)}px)`
          : `translate(${flip ? model.x - 12 : model.x + 12}px, ${Math.max(0, model.y - 8)}px) translateX(${flip ? '-100%' : '0'})`,
      }}
    >
      <div className="mb-1 font-medium text-fg-secondary">{model.title}</div>
      <ul className="flex flex-col gap-0.5">
        {model.rows.map((row) => (
          <li key={row.id} className={cn('flex items-center justify-between gap-4', row.muted && 'opacity-70')}>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-secondary">
              {row.color ? <LegendSwatch color={row.color} shape={row.shape ?? 'line'} /> : null}
              <span className="truncate">{row.label}</span>
            </span>
            <strong className="font-semibold whitespace-nowrap text-fg tabular-nums">{row.value}</strong>
          </li>
        ))}
      </ul>
      {model.note ? <div className="mt-1 text-2xs text-fg-muted">{model.note}</div> : null}
    </div>
  );
}

/** Plain words for the live region, built from the same model as the tooltip. */
export function tooltipText(model: TooltipModel | null): string {
  if (!model) return '';
  return `${model.title}. ${model.rows.map((row) => `${row.label}: ${row.value}`).join('. ')}${model.note ? `. ${model.note}` : ''}`;
}

// --- Data table ---------------------------------------------------------------------------

export interface ChartTableModel {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export function ChartDataTable({ caption, table, visible }: { readonly caption: string; readonly table: ChartTableModel; readonly visible: boolean }) {
  const body = (
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={`${column}-${index}`} scope="col" className={cn('sticky top-0 border-b border-border-subtle bg-sunken px-3 py-1.5 font-medium text-fg-secondary', index > 0 && 'text-right')}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border-subtle last:border-0">
              {row.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row" className="px-3 py-1.5 font-normal text-fg">
                    {cell}
                  </th>
                ) : (
                  <td key={index} className="px-3 py-1.5 text-right text-fg tabular-nums">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
  );
  // Shown: a region that scrolls both ways, with a tab stop and a name when it does. Hidden: for screen readers only.
  return visible ? (
    <ScrollX label={caption} className="mt-3 overflow-hidden rounded-md border border-border-subtle" scrollerClassName="max-h-72 overflow-y-auto">
      {body}
    </ScrollX>
  ) : (
    <div className="sr-only">{body}</div>
  );
}

// --- Frame --------------------------------------------------------------------------------

/** Props every chart takes. */
export interface ChartBaseProps {
  /** What the chart shows, in a few plain words. Always read by screen readers. */
  readonly title: string;
  /** One sentence that says how to read it. Becomes the SVG `<desc>`. */
  readonly description?: string;
  /** Draw the title and description above the chart. Off by default: cards carry their own header. */
  readonly showTitle?: boolean;
  /** Height of the plot in pixels. */
  readonly height?: number;
  /** First load: a skeleton the size of the chart. */
  readonly loading?: boolean;
  /** Refetch with data on screen: the chart dims and keeps its place. */
  readonly refreshing?: boolean;
  /** A plain sentence when the data could not load. */
  readonly error?: string | null;
  /** Called by the "Try again" button in the error state. */
  readonly onRetry?: () => void;
  readonly emptyTitle?: string;
  readonly emptyHint?: string;
  /** A button or link under the empty text ("Log today's work"). */
  readonly emptyAction?: ReactNode;
  readonly hideLegend?: boolean;
  /** Adds a "Show table" button that shows the same numbers as a table. */
  readonly tableToggle?: boolean;
  /** Skip measuring and draw at this width (tests, print, exports). */
  readonly width?: number;
  readonly className?: string;
}

export interface ChartFrameProps extends ChartBaseProps {
  readonly empty: boolean;
  readonly legend?: readonly LegendItem[];
  readonly table: ChartTableModel;
  /** Extra controls on the legend row. */
  readonly aside?: ReactNode;
  readonly defaultHeight: number;
  readonly children: (size: { width: number; height: number; titleId: string; descId: string }) => ReactNode;
}

export function ChartSkeleton({ height, label = 'Loading chart' }: { readonly height: number; readonly label?: string }) {
  return (
    <div role="status" aria-busy="true" className="flex w-full items-end gap-2" style={{ height }}>
      <span className="sr-only">{label}</span>
      {[46, 72, 58, 88, 64, 78, 52, 94, 70, 60].map((percent, index) => (
        <span key={index} aria-hidden className={cn('ks-skeleton block flex-1 rounded-t-sm', index > 5 && 'max-sm:hidden')} style={{ height: `${percent}%` }} />
      ))}
    </div>
  );
}

export function ChartMessage({
  height,
  tone = 'empty',
  title,
  hint,
  action,
}: {
  readonly height: number;
  readonly tone?: 'empty' | 'error';
  readonly title: string;
  readonly hint?: string;
  readonly action?: ReactNode;
}) {
  const Icon = tone === 'error' ? CircleAlert : BarChart3;
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className="flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border-default px-4 text-center" style={{ minHeight: Math.max(96, height) }}>
      <Icon aria-hidden className={cn('size-5', tone === 'error' ? 'text-danger-text' : 'text-fg-muted')} />
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-fg-muted">{hint}</p> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

export function ChartFrame(props: ChartFrameProps) {
  const { title, description, showTitle, loading, refreshing, error, onRetry, empty, legend, table, aside, tableToggle, hideLegend, className, children } = props;
  const height = props.height ?? props.defaultHeight;
  const [ref, width] = useChartWidth<HTMLDivElement>(props.width);
  const [tableOpen, setTableOpen] = useState(false);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const showChart = !loading && !error && !empty;
  const legendItems = showChart && !hideLegend ? (legend ?? []) : [];
  const hasToolbar = legendItems.length > 0 || aside || (tableToggle && showChart);

  return (
    <figure className={cn('pulse-chart m-0 min-w-0', className)} aria-labelledby={titleId} aria-describedby={description ? descId : undefined}>
      <figcaption className={showTitle ? 'mb-3' : 'sr-only'}>
        <span id={titleId} className={showTitle ? 'block text-sm font-semibold text-fg' : undefined}>
          {title}
        </span>
        {description ? (
          <span id={descId} className={showTitle ? 'mt-0.5 block text-xs text-fg-muted' : undefined}>
            {description}
          </span>
        ) : null}
      </figcaption>
      {hasToolbar ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ChartLegend items={legendItems} />
          <div className="ml-auto flex items-center gap-2">
            {aside}
            {tableToggle && showChart ? (
              <button
                type="button"
                aria-pressed={tableOpen}
                onClick={() => setTableOpen((open) => !open)}
                className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-fg-secondary hover:bg-hover hover:text-fg"
              >
                <Table2 aria-hidden className="size-3.5" />
                {tableOpen ? 'Hide table' : 'Show table'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div ref={ref} className={cn('pc-mark relative w-full', refreshing && showChart && 'opacity-60')} style={{ minHeight: showChart ? height : undefined }} aria-busy={refreshing || undefined}>
        {loading ? (
          <ChartSkeleton height={height} label={`Loading ${title}`} />
        ) : error ? (
          <ChartMessage
            height={height}
            tone="error"
            title="We could not load this chart"
            hint={error}
            action={
              onRetry ? (
                <button type="button" onClick={onRetry} className="inline-flex h-7 items-center rounded-md border border-border-default bg-panel px-2.5 text-xs font-medium text-fg hover:bg-hover">
                  Try again
                </button>
              ) : undefined
            }
          />
        ) : empty ? (
          <ChartMessage height={height} title={props.emptyTitle ?? 'Nothing to chart yet'} hint={props.emptyHint ?? 'Numbers show up here once there is data for these dates.'} action={props.emptyAction} />
        ) : width > 0 ? (
          children({ width, height, titleId, descId })
        ) : null}
      </div>
      {showChart ? <ChartDataTable caption={title} table={table} visible={tableOpen} /> : null}
    </figure>
  );
}

/** Screen reader only live text for the focused point. */
export function ChartLive({ text }: { readonly text: string }) {
  return (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </span>
  );
}

/** The `<title>` and `<desc>` every chart SVG starts with. */
export function SvgLabels({ titleId, descId, title, description, hint }: { readonly titleId: string; readonly descId: string; readonly title: string; readonly description?: string; readonly hint?: string }) {
  return (
    <>
      <title id={`${titleId}-svg`}>{title}</title>
      <desc id={`${descId}-svg`}>{[description, hint].filter(Boolean).join(' ')}</desc>
    </>
  );
}

export const KEY_HINT = 'Use the arrow keys to move between points.';
