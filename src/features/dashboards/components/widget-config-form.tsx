'use client';

/**
 * Widget configuration form shared by the Add-widget wizard and the settings side panel.
 * Every change calls `onChange` immediately so the caller can live-preview and autosave.
 */
import { useMemo, type CSSProperties } from 'react';
import {
  BarChart3,
  BarChartHorizontal,
  ChartArea,
  ChartLine,
  ChartPie,
  Donut,
  Layers,
} from 'lucide-react';
import {
  ColorPicker,
  Field,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  cn,
  isLabelColor,
  toLabelColor,
  type SelectOption,
} from '@/components/ui';
import type { ColumnDto } from '@/server/services/contracts/dto';
import {
  GROUP_BY_BOARD,
  GROUP_BY_DATE,
  GROUP_BY_GROUP,
  parseWidgetSettings,
  type ChartType,
  type DashboardSourceBoard,
  type InsightDto,
  type WidgetKind,
} from '@/server/services/contracts/dashboard-insights';
import { cssColor, seriesColor } from '../lib/colors';
import { KPI_ICON_OPTIONS } from '../lib/kpi-icons';
import {
  BoardChecklist,
  FormSection,
  FormattedNumberField,
  MultiColumnField,
  NumberField,
  SelectField,
  TextField,
  ToggleField,
} from './config-fields';

export interface WidgetConfigFormProps {
  readonly kind: WidgetKind;
  readonly title: string;
  readonly config: Record<string, unknown>;
  readonly boards: readonly DashboardSourceBoard[];
  readonly dashboardBoardIds: readonly string[];
  readonly preview?: InsightDto;
  readonly onTitleChange: (title: string) => void;
  readonly onChange: (config: Record<string, unknown>) => void;
}

const AGGREGATE_OPTIONS: SelectOption[] = [
  { value: 'count', label: 'Count items' },
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'median', label: 'Median' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
];

const CHART_TILES: readonly { value: ChartType; label: string; icon: typeof BarChart3 }[] = [
  { value: 'bar', label: 'Column', icon: BarChart3 },
  { value: 'horizontal_bar', label: 'Bar', icon: BarChartHorizontal },
  { value: 'stacked_bar', label: 'Stacked', icon: Layers },
  { value: 'line', label: 'Line', icon: ChartLine },
  { value: 'area', label: 'Area', icon: ChartArea },
  { value: 'pie', label: 'Pie', icon: ChartPie },
  { value: 'donut', label: 'Donut', icon: Donut },
];

const NUMERIC = ['number', 'currency', 'rating', 'formula', 'mirror', 'progress'];
const GROUPABLE = ['status', 'dropdown', 'people', 'text', 'country', 'tags', 'checkbox', 'rating'];

function optionsOf(columns: readonly ColumnDto[], types: readonly string[]): SelectOption[] {
  return columns.filter((column) => types.includes(column.type)).map((column) => ({ value: column.key, label: column.title }));
}

function labelOptions(column: ColumnDto | undefined): { id: string; name: string; color: string }[] {
  const labels = (column?.settings as { labels?: { id: string; name: string; color: string; isDefault?: boolean }[] } | undefined)?.labels ?? [];
  return labels.filter((label) => !label.isDefault && label.name);
}

function LabelChips({
  column,
  selected,
  onChange,
}: {
  readonly column: ColumnDto | undefined;
  readonly selected: readonly string[];
  readonly onChange: (ids: string[]) => void;
}) {
  const labels = labelOptions(column);
  if (labels.length === 0) return <p className="text-sm text-fg-muted">This column has no labels.</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${column?.title ?? 'Column'} labels`}>
      {labels.map((label) => {
        const active = selected.includes(label.id);
        const color = toLabelColor(label.color);
        return (
          <button
            key={label.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? selected.filter((id) => id !== label.id) : [...selected, label.id])}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-sm outline-none transition-colors duration-[var(--duration-instant)]',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
              active ? 'border-transparent text-[var(--lc-fg)]' : 'border-border-input text-fg hover:bg-hover',
            )}
            style={active ? ({ background: cssColor(color), '--lc-fg': `var(--label-${color}-fg)` } as CSSProperties) : undefined}
          >
            {!active ? <span aria-hidden className="size-2 rounded-full" style={{ background: cssColor(color) }} /> : null}
            {label.name}
          </button>
        );
      })}
    </div>
  );
}

export function WidgetConfigForm({ kind, title, config, boards, dashboardBoardIds, preview, onTitleChange, onChange }: WidgetConfigFormProps) {
  const settings = parseWidgetSettings(config);
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const ownBoards = settings.boardIds;
  const selectedBoards = useMemo(
    () => (ownBoards && ownBoards.length > 0 ? ownBoards : [...dashboardBoardIds]),
    [ownBoards, dashboardBoardIds],
  );
  const columns = useMemo(() => {
    const seen = new Map<string, ColumnDto>();
    for (const board of boards) {
      if (!selectedBoards.includes(board.id)) continue;
      for (const column of board.columns) if (!seen.has(column.key) && column.type !== 'name') seen.set(column.key, column);
    }
    return [...seen.values()];
  }, [boards, selectedBoards]);
  const column = (key: string | undefined) => columns.find((entry) => entry.key === key);
  const statusOptions = optionsOf(columns, ['status']);
  const numericOptions = optionsOf(columns, NUMERIC);
  const peopleOptions = optionsOf(columns, ['people']);
  const dateOptions = optionsOf(columns, ['date', 'timeline', 'creation_log', 'last_updated']);
  const valueIsCurrency = columns.some((column) => column.key === settings.valueColumnKey && column.type === 'currency');
  const needsBoards = !['text', 'countdown', 'section'].includes(kind);

  const measure = (
    <div className="grid grid-cols-2 gap-3">
      <SelectField label="Calculation" value={settings.valueColumnKey ? settings.aggregate : 'count'} options={AGGREGATE_OPTIONS} onChange={(value) => set({ aggregate: value ?? 'count', ...(value === 'count' ? { valueColumnKey: undefined } : {}) })} />
      <SelectField
        label="Column"
        value={settings.valueColumnKey}
        options={numericOptions}
        allowNone
        noneLabel="Items (count)"
        onChange={(value) => set({ valueColumnKey: value, aggregate: value ? (settings.aggregate === 'count' ? 'sum' : settings.aggregate) : 'count', ...(value && column(value)?.type === 'currency' ? { format: 'currency' } : {}) })}
      />
    </div>
  );

  return (
    <div className="flex flex-col" data-testid="widget-config-form">
      <FormSection title="General">
        <TextField label={kind === 'section' ? 'Heading' : 'Title'} value={title} maxLength={255} onChange={onTitleChange} />
        {kind !== 'text' ? <TextField label="Subtitle" value={settings.description} maxLength={280} placeholder="Optional" onChange={(value) => set({ description: value || undefined })} /> : null}
      </FormSection>

      {needsBoards ? (
        <FormSection title="Data source" aside={<span className="text-xs text-fg-muted">{selectedBoards.length} selected</span>}>
          <BoardChecklist boards={boards} selected={selectedBoards} highlight={dashboardBoardIds} onChange={(ids) => set({ boardIds: ids })} />
        </FormSection>
      ) : null}

      {kind === 'numbers' ? (
        <FormSection title="Number">
          {measure}
          <div className="grid grid-cols-3 gap-3">
            <SelectField label="Format" value={settings.format} options={[{ value: 'number', label: 'Number' }, { value: 'currency', label: 'Currency' }, { value: 'percent', label: 'Percent' }]} onChange={(value) => set({ format: value ?? 'number' })} />
            <TextField label="Prefix" value={settings.prefix} maxLength={10} onChange={(value) => set({ prefix: value || undefined })} />
            <TextField label="Suffix" value={settings.suffix} maxLength={10} onChange={(value) => set({ suffix: value || undefined })} />
          </div>
          <FormattedNumberField
            label="Goal"
            value={settings.goal}
            placeholder="Optional target"
            prefix={settings.prefix ?? (settings.format === 'currency' || valueIsCurrency ? '$' : undefined)}
            suffix={settings.format === 'percent' ? '%' : settings.suffix}
            onChange={(value) => set({ goal: value && value > 0 ? value : undefined })}
          />
          <SelectField label="Icon" value={typeof settings.icon === 'string' ? settings.icon : undefined} options={KPI_ICON_OPTIONS} allowNone noneLabel="Default" onChange={(value) => set({ icon: value })} />
          <SelectField label="Trend date column" value={settings.dateColumnKey} options={dateOptions} allowNone noneLabel="Created date" onChange={(value) => set({ dateColumnKey: value })} hint="Used for the period comparison and sparkline." />
          <ToggleField label="Compare with previous period" checked={settings.compare} onChange={(value) => set({ compare: value })} />
          <ToggleField label="Show sparkline" checked={settings.showSparkline} onChange={(value) => set({ showSparkline: value })} />
          <AccentPicker value={settings.color} onChange={(color) => set({ color })} />
        </FormSection>
      ) : null}

      {kind === 'chart' ? (
        <FormSection title="Chart">
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Chart type">
            {CHART_TILES.map((tile) => {
              const Icon = tile.icon;
              const active = settings.chartType === tile.value;
              return (
                <button
                  key={tile.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set({ chartType: tile.value })}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-2xs font-medium outline-none transition-colors duration-[var(--duration-instant)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus [&_svg]:size-5',
                    active ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-subtle text-fg-secondary hover:border-border-input hover:bg-hover',
                  )}
                >
                  <Icon aria-hidden />
                  {tile.label}
                </button>
              );
            })}
          </div>
          <SelectField
            label="X-axis (group by)"
            value={settings.groupByColumnKey}
            options={[
              ...optionsOf(columns, GROUPABLE),
              { value: GROUP_BY_GROUP, label: 'Board group' },
              { value: GROUP_BY_BOARD, label: 'Board' },
              { value: GROUP_BY_DATE, label: 'Date' },
            ]}
            onChange={(value) => set({ groupByColumnKey: value })}
          />
          {settings.groupByColumnKey === GROUP_BY_DATE ? (
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Date column" value={settings.dateColumnKey} options={dateOptions} allowNone noneLabel="Created date" onChange={(value) => set({ dateColumnKey: value })} />
              <SelectField label="Bucket" value={settings.dateBucket} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }]} onChange={(value) => set({ dateBucket: value ?? 'month' })} />
            </div>
          ) : null}
          {measure}
          {settings.chartType === 'stacked_bar' ? (
            <SelectField label="Stack by" value={settings.stackByColumnKey} options={optionsOf(columns, ['status', 'dropdown', 'people'])} hint={settings.stackByColumnKey ? undefined : 'Choose a column to stack by.'} onChange={(value) => set({ stackByColumnKey: value })} />
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Sort" value={settings.sortBy} options={[{ value: 'default', label: 'Label order' }, { value: 'value_desc', label: 'Value, high to low' }, { value: 'value_asc', label: 'Value, low to high' }, { value: 'label', label: 'Alphabetical' }]} onChange={(value) => set({ sortBy: value ?? 'default' })} />
            <NumberField label="Show top" value={settings.limit} placeholder="All" min={1} max={200} onChange={(value) => set({ limit: value })} />
          </div>
          <ToggleField label="Show legend" checked={settings.showLegend} onChange={(value) => set({ showLegend: value })} />
          <ToggleField label="Show values on bars" checked={settings.showValues} onChange={(value) => set({ showValues: value })} />
        </FormSection>
      ) : null}

      {kind === 'battery' ? (
        <FormSection title="Battery">
          <SelectField label="Status column" value={settings.groupByColumnKey} options={statusOptions} onChange={(value) => set({ groupByColumnKey: value })} hint="Labels marked as done count toward the percentage." />
        </FormSection>
      ) : null}

      {kind === 'leaderboard' ? (
        <FormSection title="Leaderboard">
          <SelectField label="Rank people from" value={settings.groupByColumnKey} options={peopleOptions} onChange={(value) => set({ groupByColumnKey: value })} />
          {measure}
          <NumberField label="Show top" value={settings.limit} placeholder="10" min={1} max={50} onChange={(value) => set({ limit: value })} />
        </FormSection>
      ) : null}

      {kind === 'workload' ? (
        <FormSection title="Workload">
          <SelectField label="People column" value={settings.groupByColumnKey} options={peopleOptions} onChange={(value) => set({ groupByColumnKey: value })} />
          <SelectField label="Date or timeline column" value={settings.dateColumnKey} options={dateOptions} onChange={(value) => set({ dateColumnKey: value })} />
          <NumberField label="Capacity per person per week" value={settings.capacity} min={1} max={500} onChange={(value) => set({ capacity: value ?? 5 })} />
        </FormSection>
      ) : null}

      {kind === 'calendar' || kind === 'timeline' ? (
        <FormSection title={kind === 'calendar' ? 'Calendar' : 'Timeline'}>
          <SelectField label={kind === 'calendar' ? 'Date column' : 'Timeline or date column'} value={settings.dateColumnKey} options={dateOptions} onChange={(value) => set({ dateColumnKey: value })} />
          <SelectField label="Color by" value={settings.colorByColumnKey} options={statusOptions} allowNone onChange={(value) => set({ colorByColumnKey: value })} />
        </FormSection>
      ) : null}

      {kind === 'table' ? (
        <FormSection title="Table">
          <MultiColumnField label="Columns" columns={columns} value={settings.columnKeys ?? []} onChange={(keys) => set({ columnKeys: keys })} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Sort by" value={settings.valueColumnKey} options={numericOptions} allowNone noneLabel="Board order" onChange={(value) => set({ valueColumnKey: value, sortBy: value ? 'value_desc' : 'default' })} />
            <NumberField label="Rows" value={settings.limit} placeholder="50" min={1} max={200} onChange={(value) => set({ limit: value })} />
          </div>
        </FormSection>
      ) : null}

      {kind === 'funnel' || kind === 'forecast' ? (
        <FormSection title={kind === 'funnel' ? 'Funnel' : 'Forecast'}>
          <SelectField label="Stage column" value={settings.groupByColumnKey} options={statusOptions} onChange={(value) => set({ groupByColumnKey: value })} />
          <SelectField label="Value column" value={settings.valueColumnKey} options={numericOptions} allowNone noneLabel="Count items" onChange={(value) => set({ valueColumnKey: value, aggregate: value ? 'sum' : 'count' })} />
          {kind === 'forecast' ? (
            <>
              <SelectField label="Probability column (%)" value={settings.probabilityColumnKey} options={optionsOf(columns, ['number', 'formula'])} allowNone noneLabel="By stage order" onChange={(value) => set({ probabilityColumnKey: value })} />
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Close date column" value={settings.dateColumnKey} options={dateOptions} onChange={(value) => set({ dateColumnKey: value })} />
                <NumberField label="Months" value={settings.months} min={1} max={24} onChange={(value) => set({ months: value ?? 6 })} />
              </div>
            </>
          ) : null}
          <Field label="Leave out stages">
            {() => <LabelChips column={column(settings.groupByColumnKey)} selected={settings.excludeLabelIds ?? []} onChange={(ids) => set({ excludeLabelIds: ids })} />}
          </Field>
        </FormSection>
      ) : null}

      {kind === 'text' ? (
        <FormSection title="Text">
          <Field label="Content" hint="Supports **bold**, _italic_, - lists, # headings and [links](https://example.com).">
            {({ inputId, describedBy }) => (
              <Textarea id={inputId} aria-describedby={describedBy} rows={8} value={settings.text ?? ''} onChange={(event) => set({ text: event.target.value })} />
            )}
          </Field>
        </FormSection>
      ) : null}

      {kind === 'countdown' ? (
        <FormSection title="Countdown">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target date">
              {({ inputId }) => (
                <input id={inputId} type="date" value={settings.targetDate ?? ''} onChange={(event) => set({ targetDate: event.target.value || undefined })} className="h-8 rounded-sm border border-border-input bg-panel px-2 text-base text-fg outline-none hover:border-border-input-hover focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-focus [color-scheme:inherit]" />
              )}
            </Field>
            <Field label="Time">
              {({ inputId }) => (
                <input id={inputId} type="time" value={settings.targetTime ?? '00:00'} onChange={(event) => set({ targetTime: event.target.value || undefined })} className="h-8 rounded-sm border border-border-input bg-panel px-2 text-base text-fg outline-none hover:border-border-input-hover focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-focus" />
              )}
            </Field>
          </div>
          <AccentPicker value={settings.color} onChange={(color) => set({ color })} />
        </FormSection>
      ) : null}

      {needsBoards && kind !== 'funnel' && kind !== 'forecast' ? (
        <FormSection title="Filter">
          <SelectField label="Only items where" value={settings.filter?.columnKey} options={statusOptions} allowNone noneLabel="No filter" onChange={(value) => set({ filter: value ? { columnKey: value, labelIds: [], exclude: false } : undefined })} />
          {settings.filter ? (
            <>
              <SelectField label="Condition" value={settings.filter.exclude ? 'exclude' : 'include'} options={[{ value: 'include', label: 'is any of' }, { value: 'exclude', label: 'is none of' }]} onChange={(value) => set({ filter: { ...settings.filter, exclude: value === 'exclude' } })} />
              <LabelChips column={column(settings.filter.columnKey)} selected={settings.filter.labelIds} onChange={(ids) => set({ filter: { ...settings.filter, labelIds: ids } })} />
            </>
          ) : null}
        </FormSection>
      ) : null}

      {kind === 'chart' && preview && preview.series.length > 0 && settings.chartType !== 'line' && settings.chartType !== 'area' ? (
        <FormSection title="Colors">
          <SeriesColors
            entries={(settings.chartType === 'stacked_bar' && preview.stacks.length > 0 ? preview.stacks : preview.series).map((entry) => ({ key: entry.key, label: entry.label, color: entry.color }))}
            overrides={settings.colorOverrides}
            onChange={(overrides) => set({ colorOverrides: overrides })}
          />
        </FormSection>
      ) : null}
    </div>
  );
}

function AccentPicker({ value, onChange }: { readonly value: string | undefined; readonly onChange: (color: string) => void }) {
  return (
    <Field label="Accent color">
      {() => <ColorPicker value={isLabelColor(value) ? value : null} onChange={onChange} size="sm" columns={12} label="Accent color" />}
    </Field>
  );
}

function SeriesColors({
  entries,
  overrides,
  onChange,
}: {
  readonly entries: readonly { key: string; label: string; color?: string }[];
  readonly overrides: Readonly<Record<string, string>> | undefined;
  readonly onChange: (overrides: Record<string, string>) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {entries.slice(0, 24).map((entry, index) => {
        const color = seriesColor(entry.color, index, overrides, entry.key);
        return (
          <li key={entry.key} className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Color for ${entry.label}`}
                  className="size-6 shrink-0 rounded-sm border border-border-subtle outline-none hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus transition-transform duration-[var(--duration-instant)]"
                  style={{ background: cssColor(color) }}
                />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-3">
                <ColorPicker value={color} onChange={(next) => onChange({ ...(overrides ?? {}), [entry.key]: next })} size="sm" label={`Color for ${entry.label}`} />
              </PopoverContent>
            </Popover>
            <span className="truncate text-sm text-fg">{entry.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
