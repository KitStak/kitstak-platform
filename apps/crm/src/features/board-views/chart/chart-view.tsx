'use client';
/**
 * Chart view: 11 chart types from a thumbnail gallery, X by status / people / group / date
 * bucket, Y = count or sum/avg/min/max of any number column, stack by, sort, data labels,
 * legend, cumulative, goal line and free per-label colors — all in one live panel. Hover shows
 * value + % of total; clicking a bar or slice drills down into the matching items.
 */
import { useMemo, useRef, useState } from 'react';
import {
  ChartArea,
  ChartBar,
  ChartBarStacked,
  ChartColumnBig,
  ChartColumnStacked,
  ChartLine,
  ChartPie,
  ChartSpline,
  Layers,
  Donut,
  Download,
  Ellipsis,
  FileDown,
  ImageDown,
  Maximize2,
  Percent,
  type LucideIcon,
} from 'lucide-react';
import {
  Button,
  ColorPicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Switch,
  cn,
  type LabelColor,
  toast,
} from '@/components/ui';
import { columnOptions, FilteredEmpty, ResetSettings, SettingsSection, SettingsSelect, ViewCanvas, ViewError, ViewToolbar } from '../components/view-shell';
import { useElementSize, useReducedMotion, useViewConfig, useViewModel } from '../hooks';
import { buildChartData } from '../lib/chart';
import { CHART_AGGREGATES, chartSettings, DATE_BUCKETS, STACKED_TYPES, type ChartType } from '../lib/config';
import { columnCurrency, DATE_COLUMN_TYPES, formatCompact, formatFull, GROUP_KEY, LABEL_COLUMN_TYPES, NUMERIC_COLUMN_TYPES, pluralNoun } from '../lib/values';
import type { BoardViewProps } from '../types';
import { ChartCanvas, cssColor } from './chart-canvas';

const GALLERY: readonly { type: ChartType; label: string; icon: LucideIcon }[] = [
  { type: 'column', label: 'Column', icon: ChartColumnBig },
  { type: 'bar', label: 'Bar', icon: ChartBar },
  { type: 'stacked_column', label: 'Stacked column', icon: ChartColumnStacked },
  { type: 'stacked_bar', label: 'Stacked bar', icon: ChartBarStacked },
  { type: 'stacked_column_percent', label: '100% stacked', icon: Percent },
  { type: 'line', label: 'Line', icon: ChartLine },
  { type: 'smooth_line', label: 'Smooth line', icon: ChartSpline },
  { type: 'area', label: 'Area', icon: ChartArea },
  { type: 'stacked_area', label: 'Stacked area', icon: Layers },
  { type: 'pie', label: 'Pie', icon: ChartPie },
  { type: 'donut', label: 'Donut', icon: Donut },
];

const AGG_LABEL: Record<(typeof CHART_AGGREGATES)[number], string> = { count: 'Count', sum: 'Sum', average: 'Average', min: 'Minimum', max: 'Maximum' };

export function ChartSkeleton() {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading chart" className="flex flex-1 items-end gap-6 bg-panel p-10">
      {[45, 70, 30, 85, 55, 62].map((height, index) => (
        <Skeleton key={index} className="flex-1" height={`${height}%`} rounded="md" />
      ))}
    </div>
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Inline computed colors so an exported SVG renders outside the app. */
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = svg.querySelectorAll<SVGElement>('*');
  clone.querySelectorAll<SVGElement>('*').forEach((node, index) => {
    const computed = getComputedStyle(source[index] as Element);
    for (const property of ['fill', 'stroke', 'font-size', 'font-family', 'opacity', 'fill-opacity']) {
      node.style.setProperty(property, computed.getPropertyValue(property));
    }
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

export function ChartView({ boardId, view, onOpenItem, initialSettingsOpen, className }: BoardViewProps) {
  const model = useViewModel(boardId, view);
  const { columns, groups, users, items, allItems, noun } = model;
  const { save } = useViewConfig<Record<string, unknown>>(boardId, view, 'chartView');
  const settings = useMemo(() => chartSettings(view.config, columns), [view.config, columns]);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(initialSettingsOpen));
  const [drill, setDrill] = useState<{ title: string; itemIds: readonly string[] } | null>(null);
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const frame = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const data = useMemo(() => buildChartData(items, settings, { columns, groups, users }), [items, settings, columns, groups, users]);
  const yColumn = columns.find((column) => column.key === settings.yColumnKey);
  const xColumn = columns.find((column) => column.key === settings.xColumnKey);
  const stackColumn = columns.find((column) => column.key === settings.stackColumnKey);
  const currency = columnCurrency(yColumn);
  const format = (value: number) => (settings.yColumnKey ? formatCompact(value, currency) : formatCompact(value));
  const needsStack = STACKED_TYPES.has(settings.type) && !settings.stackColumnKey;
  const isPie = settings.type === 'pie' || settings.type === 'donut';
  const xLabel = settings.xColumnKey === GROUP_KEY ? 'Group' : (xColumn?.title ?? 'Category');
  const measure = settings.yColumnKey ? `${AGG_LABEL[settings.aggregate]} of ${yColumn?.title ?? 'value'}` : `Count of ${pluralNoun(noun, 2)}`;
  const title = settings.title || `${measure} by ${xLabel.toLowerCase()}`;
  const stackedLegend = !isPie && data.stacks.length > 0 && STACKED_TYPES.has(settings.type);
  // Category legend for single-series charts too: each entry is a button that opens the
  // drill-down, so every bar / slice is reachable from the keyboard.
  const legend: readonly { key: string; label: string; color: LabelColor; value: number | null }[] = stackedLegend
    ? data.stacks.map((stack) => ({ key: stack.key, label: stack.label, color: stack.color, value: null }))
    : data.points.filter((point) => point.value > 0).map((point) => ({ key: point.key, label: point.label, color: point.color, value: point.value }));
  const narrowChart = size.width > 0 && size.width < 480;
  // Phones: vertical columns turn into horizontal bars so every category label fits.
  const renderType: ChartType = narrowChart ? (settings.type === 'column' ? 'bar' : settings.type === 'stacked_column' ? 'stacked_bar' : settings.type) : settings.type;
  const selectLegend = (key: string) => {
    if (!stackedLegend) return select(key);
    const series = data.stacks.find((entry) => entry.key === key);
    const ids = data.points.flatMap((point) => point.stackItemIds[key] ?? []);
    setDrill({ title: series?.label ?? key, itemIds: ids });
  };

  const select = (pointKey: string, stackKey?: string) => {
    const point = data.points.find((entry) => entry.key === pointKey);
    if (!point) return;
    const ids = stackKey ? (point.stackItemIds[stackKey] ?? []) : point.itemIds;
    const series = stackKey ? data.stacks.find((entry) => entry.key === stackKey) : undefined;
    setDrill({ title: series ? `${point.label} · ${series.label}` : point.label, itemIds: ids });
  };

  const exportCsv = () => {
    const header = ['Category', ...(data.stacks.length ? data.stacks.map((stack) => stack.label) : []), measure, 'Items'];
    const rows = data.points.map((point) => [point.label, ...data.stacks.map((stack) => String(point.stacks[stack.key] ?? 0)), String(point.value), String(point.count)]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
    download(`${title}.csv`, new Blob([csv], { type: 'text/csv' }));
  };
  const exportImage = async (kind: 'svg' | 'png') => {
    const svg = frame.current?.querySelector<SVGSVGElement>('svg.recharts-surface');
    if (!svg) return toast.error("Couldn't export the chart", 'The chart is still drawing. Try again in a moment.');
    const markup = serializeSvg(svg);
    if (kind === 'svg') return download(`${title}.svg`, new Blob([markup], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = svg.clientWidth * scale;
      canvas.height = svg.clientHeight * scale;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = getComputedStyle(document.body).getPropertyValue('--surface-panel') || 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.scale(scale, scale);
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => blob && download(`${title}.png`, blob));
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  };

  const colorTargets = isPie || !STACKED_TYPES.has(settings.type) ? data.points : data.stacks;
  const settingsPanel = (
    <>
      <SettingsSection title="Chart type">
        <div role="radiogroup" aria-label="Chart type" className="grid grid-cols-4 gap-1.5" data-testid="chart-gallery">
          {GALLERY.map((entry) => {
            const Icon = entry.icon;
            const selected = settings.type === entry.type;
            return (
              <button
                key={entry.type}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={entry.label}
                title={entry.label}
                onClick={() => save({ type: entry.type })}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 rounded-md border px-1 text-icon transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-out',
                  'hover:border-border-strong hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus active:bg-pressed',
                  selected ? 'border-2 border-primary bg-primary-selected text-primary-text' : 'border-border-subtle',
                )}
              >
                <Icon aria-hidden className="size-5" />
                <span className={cn('w-full truncate text-center text-2xs leading-tight', selected ? 'font-semibold text-primary-text' : 'text-fg-secondary')}>{entry.label}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>
      <SettingsSection title="Data">
        <SettingsSelect
          label={isPie ? 'Slices' : 'X-axis'}
          testId="chart-x"
          value={settings.xColumnKey}
          onChange={(value) => save({ xColumnKey: value })}
          options={[
            ...columnOptions(columns, (column) => LABEL_COLUMN_TYPES.has(column.type) || column.type === 'people' || DATE_COLUMN_TYPES.has(column.type)),
            { value: GROUP_KEY, label: 'Group' },
          ]}
        />
        {xColumn && DATE_COLUMN_TYPES.has(xColumn.type) ? (
          <SettingsSelect label="Group dates by" value={settings.dateBucket} onChange={(value) => save({ dateBucket: value })} options={DATE_BUCKETS.map((bucket) => ({ value: bucket, label: bucket[0]?.toUpperCase() + bucket.slice(1) }))} />
        ) : null}
        <SettingsSelect
          label="Y-axis"
          testId="chart-y"
          value={settings.yColumnKey ?? 'count'}
          onChange={(value) => save({ yColumnKey: value === 'count' ? null : value })}
          options={[{ value: 'count', label: `Count ${pluralNoun(noun, 2)}` }, ...columnOptions(columns, (column) => NUMERIC_COLUMN_TYPES.has(column.type))]}
        />
        {settings.yColumnKey ? (
          <SettingsSelect label="Calculate" value={settings.aggregate} onChange={(value) => save({ aggregate: value })} options={CHART_AGGREGATES.filter((entry) => entry !== 'count').map((entry) => ({ value: entry, label: AGG_LABEL[entry] }))} />
        ) : null}
        {!isPie ? (
          <SettingsSelect
            label="Stack by"
            value={settings.stackColumnKey ?? 'none'}
            onChange={(value) => save({ stackColumnKey: value === 'none' ? null : value })}
            options={[{ value: 'none', label: 'Nothing' }, ...columnOptions(columns, (column) => (LABEL_COLUMN_TYPES.has(column.type) || column.type === 'people') && column.key !== settings.xColumnKey), { value: GROUP_KEY, label: 'Group' }]}
          />
        ) : null}
        {needsStack ? (
          <p role="alert" className="rounded-sm bg-danger-subtle px-2 py-1.5 text-xs font-medium text-danger-text">
            Choose a column to stack by.
          </p>
        ) : null}
        <SettingsSelect
          label="Sort"
          value={settings.sort}
          onChange={(value) => save({ sort: value })}
          options={[
            { value: 'label', label: 'Board order' },
            { value: 'value_desc', label: 'Value, high → low' },
            { value: 'value_asc', label: 'Value, low → high' },
            { value: 'name_asc', label: 'Name, A → Z' },
            { value: 'name_desc', label: 'Name, Z → A' },
          ]}
        />
        <Switch size="sm" label="Hide empty categories" checked={settings.hideEmpty} onCheckedChange={(checked) => save({ hideEmpty: checked })} />
      </SettingsSection>
      <SettingsSection title="Customize">
        <label className="flex flex-col gap-1 text-sm text-fg">
          Title
          <Input size="sm" defaultValue={settings.title ?? ''} placeholder={title} onChange={(event) => save({ title: event.target.value || null })} />
        </label>
        <Switch size="sm" label="Data labels" checked={settings.showValues} onCheckedChange={(checked) => save({ showValues: checked })} />
        <Switch size="sm" label="Legend" checked={settings.showLegend} onCheckedChange={(checked) => save({ showLegend: checked })} />
        {settings.type.includes('line') || settings.type.includes('area') ? (
          <Switch size="sm" label="Cumulative" checked={settings.cumulative} onCheckedChange={(checked) => save({ cumulative: checked })} />
        ) : null}
        {!isPie ? (
          <label className="flex items-center justify-between gap-3 text-sm text-fg">
            Goal line
            <Input
              size="sm"
              type="number"
              inputMode="decimal"
              containerClassName="w-32"
              defaultValue={settings.goal ?? ''}
              placeholder="None"
              onChange={(event) => save({ goal: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </label>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-sm text-fg">Colors</span>
          <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
            {colorTargets.map((target) => (
              <li key={target.key} className="flex h-8 items-center gap-2 rounded-sm px-1 hover:bg-hover">
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label={`Color for ${target.label}`} className="size-5 shrink-0 rounded-sm ring-1 ring-border-default ring-inset hover:scale-110 focus-visible:outline-2 focus-visible:outline-focus" style={{ background: cssColor(target.color) }} />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto">
                    <ColorPicker value={target.color} size="sm" label={`Color for ${target.label}`} onChange={(color) => save({ colors: { ...settings.colors, [target.key]: color } })} />
                  </PopoverContent>
                </Popover>
                <span className="min-w-0 flex-1 truncate text-sm">{target.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </SettingsSection>
      <ResetSettings onReset={() => save({ type: undefined, xColumnKey: undefined, yColumnKey: undefined, aggregate: undefined, stackColumnKey: undefined, sort: undefined, showValues: undefined, showLegend: undefined, hideEmpty: undefined, cumulative: undefined, goal: undefined, title: undefined, colors: {} }, { immediate: true })} />
    </>
  );

  const drillItems = drill ? drill.itemIds.map((id) => items.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item)) : [];
  let content;
  if (model.query.isError && !model.query.data) content = <ViewError onRetry={() => void model.query.refetch()} what="the chart" />;
  else if (!model.query.data) content = <ChartSkeleton />;
  else if (items.length === 0 && allItems.length > 0)
    content = (
      <div className="flex flex-1 items-center justify-center">
        <FilteredEmpty noun={pluralNoun(noun, 2)} onClear={model.clearSearch} />
      </div>
    );
  else if (data.points.every((point) => point.value === 0) || needsStack)
    content = (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          size="sm"
          title={needsStack ? 'Choose a column to stack by' : 'No data to display'}
          description={needsStack ? 'Stacked charts split each bar by a second column.' : `No ${pluralNoun(noun, 2)} have values for ${measure.toLowerCase()} yet.`}
          actions={
            <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
              Check your settings
            </Button>
          }
        />
      </div>
    );
  else
    content = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={measureRef} className="relative min-h-[280px] flex-1" data-testid="chart-canvas">
          <div className="absolute inset-0">
            <ChartCanvas
              type={renderType}
              points={data.points}
              stacks={STACKED_TYPES.has(settings.type) || settings.type.includes('line') || settings.type === 'area' ? (settings.stackColumnKey ? data.stacks : []) : []}
              width={size.width}
              height={size.height}
              total={data.total}
              showValues={settings.showValues}
              goal={settings.goal}
              format={format}
              reducedMotion={reducedMotion}
              onSelect={select}
            />
          </div>
          {settings.type === 'donut' && size.width > 0 ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" data-testid="chart-total">
              <span className="text-2xl font-semibold text-fg tabular-nums">{format(data.total)}</span>
              <span className="text-xs font-medium text-fg-muted ">Total</span>
            </div>
          ) : null}
        </div>
        {legend.length > 0 ? (
          // With Legend off it stays in the tab order but only appears while focused.
          <ul
            className={cn('flex shrink-0 flex-wrap justify-center gap-x-1 gap-y-1 pt-3', !settings.showLegend && 'sr-only focus-within:not-sr-only focus-within:flex')}
            aria-label={`${title}: open the ${pluralNoun(noun, 2)} for a category`}
            data-testid="chart-legend"
          >
            {legend.map((entry) => {
              const share = entry.value !== null && data.total > 0 ? Math.round((entry.value / data.total) * 100) : null;
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    onClick={() => selectLegend(entry.key)}
                    aria-label={entry.value !== null ? `${entry.label}: ${format(entry.value)}${share !== null ? `, ${share}%` : ''}. Show ${pluralNoun(noun, 2)}` : `${entry.label}. Show ${pluralNoun(noun, 2)}`}
                    data-testid="chart-legend-item"
                    className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-sm text-fg-secondary transition-colors duration-[var(--duration-fast)] ease-out hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
                  >
                    <span aria-hidden className="size-2.5 rounded-xs" style={{ background: cssColor(entry.color) }} />
                    {entry.label}
                    {entry.value !== null ? <span className="text-fg-muted tabular-nums">{format(entry.value)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {/* Accessible data table equivalent of the chart. */}
        <table className="sr-only">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{xLabel}</th>
              <th scope="col">{measure}</th>
            </tr>
          </thead>
          <tbody>
            {data.points.map((point) => (
              <tr key={point.key}>
                <th scope="row">{point.label}</th>
                <td>{formatFull(point.value, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <ViewCanvas testId="chart-view" busy={!model.query.data} className={className}>
      <ViewToolbar
        search={model.search}
        onSearch={model.setSearch}
        searchLabel={`Search ${pluralNoun(noun, 2)}`}
        settings={settingsPanel}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
        settingsTitle="Chart settings"
        end={
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label="Chart options" icon={<Ellipsis aria-hidden />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<ImageDown aria-hidden />} onSelect={() => void exportImage('png')}>
                Export PNG
              </DropdownMenuItem>
              <DropdownMenuItem icon={<FileDown aria-hidden />} onSelect={() => void exportImage('svg')}>
                Export SVG
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Download aria-hidden />} onSelect={exportCsv}>
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Maximize2 aria-hidden />} onSelect={() => void frame.current?.requestFullscreen?.()}>
                Full screen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <span className="text-sm text-fg-secondary tabular-nums">
          {items.length} {pluralNoun(noun, items.length)}
        </span>
      </ViewToolbar>
      <div ref={frame} className="flex min-h-0 flex-1 flex-col bg-sunken p-4 max-[480px]:p-2">
        <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border-subtle bg-panel p-5 shadow-xs max-[480px]:p-3" aria-label={title}>
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-fg" data-testid="chart-title">
              {title}
            </h2>
            {model.query.data && !needsStack ? (
              <span className="text-sm text-fg-muted tabular-nums">
                {settings.aggregate === 'average' ? 'Overall' : 'Total'} <span className="font-semibold text-fg">{formatFull(data.total, settings.yColumnKey ? currency : null)}</span>
                {stackColumn ? ` · by ${stackColumn.title.toLowerCase()}` : ''}
              </span>
            ) : null}
          </header>
          {content}
        </section>
      </div>
      <Dialog open={Boolean(drill)} onOpenChange={(openState) => !openState && setDrill(null)}>
        <DialogContent size="md" data-testid="chart-drilldown">
          <DialogHeader title={drill?.title ?? ''} description={`${drillItems.length} ${pluralNoun(noun, drillItems.length)}`} />
          <DialogBody className="pb-6">
            {drillItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-muted">Nothing here yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
                {drillItems.map((item) => {
                  const value = settings.yColumnKey ? item.values[settings.yColumnKey] ?? item.computed[settings.yColumnKey] : null;
                  const number = typeof value === 'number' ? value : (value as { amount?: number } | null)?.amount;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDrill(null);
                          onOpenItem?.(item.id);
                        }}
                        className="grid h-10 w-full grid-cols-[minmax(0,1fr)_minmax(0,9rem)_6.5rem] items-center gap-3 px-3 text-left text-sm text-fg hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus max-[480px]:grid-cols-[minmax(0,1fr)_5.5rem]"
                      >
                        <span className="min-w-0 truncate">{item.name}</span>
                        <span className="truncate text-xs text-fg-muted max-[480px]:hidden">{groups.find((group) => group.id === item.groupId)?.title ?? '—'}</span>
                        <span className={cn('text-right tabular-nums', typeof number === 'number' ? 'font-medium' : 'text-fg-disabled')}>
                          {typeof number === 'number' ? formatFull(number, currency) : settings.yColumnKey ? '—' : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </ViewCanvas>
  );
}
