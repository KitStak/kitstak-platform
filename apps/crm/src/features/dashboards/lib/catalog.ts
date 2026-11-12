/**
 * Widget catalog: every widget kind with its gallery copy, category, default size, size limits
 * and smart default configuration (columns are auto-picked from the chosen boards so the live
 * preview shows real data immediately).
 */
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BatteryMedium,
  CalendarDays,
  Filter,
  GanttChartSquare,
  Hash,
  Heading,
  Hourglass,
  StickyNote,
  Table2,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';
import type { LabelColor } from '@/components/ui';
import type { ColumnDto } from '@/server/services/contracts/dto';
import type { DashboardSourceBoard, WidgetKind } from '@/server/services/contracts/dashboard-insights';
import type { SizeLimits } from './layout';

export type WidgetCategory = 'popular' | 'charts' | 'sales' | 'time' | 'content';

export const CATEGORY_LABELS: Readonly<Record<WidgetCategory, string>> = {
  popular: 'Popular',
  charts: 'Charts & reports',
  sales: 'Sales & pipeline',
  time: 'Time & people',
  content: 'Content',
};

export interface WidgetDefinition {
  readonly kind: WidgetKind;
  readonly label: string;
  readonly description: string;
  readonly categories: readonly WidgetCategory[];
  readonly icon: LucideIcon;
  readonly tone: LabelColor;
  readonly size: { readonly w: number; readonly h: number };
  readonly limits: SizeLimits;
  /** Reads board data (needs at least one connected board). */
  readonly needsBoards: boolean;
  /** Renders without the card chrome (section headers). */
  readonly chromeless?: boolean;
}

export const WIDGETS: readonly WidgetDefinition[] = [
  {
    kind: 'numbers',
    label: 'Numbers',
    description: 'One headline KPI with trend vs the previous period, sparkline and goal.',
    categories: ['popular', 'charts'],
    icon: Hash,
    tone: 'blue',
    size: { w: 3, h: 4 },
    limits: { minW: 2, minH: 3 },
    needsBoards: true,
  },
  {
    kind: 'chart',
    label: 'Chart',
    description: 'Bar, stacked, line, area, pie or donut over any column.',
    categories: ['popular', 'charts'],
    icon: BarChart3,
    tone: 'purple',
    size: { w: 6, h: 8 },
    limits: { minW: 3, minH: 5 },
    needsBoards: true,
  },
  {
    kind: 'battery',
    label: 'Battery',
    description: 'Progress at a glance: how items split across status labels.',
    categories: ['popular', 'charts'],
    icon: BatteryMedium,
    tone: 'green',
    size: { w: 6, h: 4 },
    limits: { minW: 3, minH: 3 },
    needsBoards: true,
  },
  {
    kind: 'table',
    label: 'Table',
    description: 'A filtered, sortable list of items across boards.',
    categories: ['popular', 'charts'],
    icon: Table2,
    tone: 'dark-blue',
    size: { w: 12, h: 10 },
    limits: { minW: 4, minH: 5 },
    needsBoards: true,
  },
  {
    kind: 'funnel',
    label: 'Funnel',
    description: 'Stage-by-stage conversion for a pipeline status column.',
    categories: ['sales', 'charts'],
    icon: Filter,
    tone: 'orange',
    size: { w: 4, h: 9 },
    limits: { minW: 3, minH: 6 },
    needsBoards: true,
  },
  {
    kind: 'forecast',
    label: 'Forecast',
    description: 'Pipeline, probability-weighted and won value by close month.',
    categories: ['sales', 'popular'],
    icon: TrendingUp,
    tone: 'teal',
    size: { w: 8, h: 9 },
    limits: { minW: 4, minH: 6 },
    needsBoards: true,
  },
  {
    kind: 'leaderboard',
    label: 'Leaderboard',
    description: 'Rank people by deals won, revenue or any number.',
    categories: ['sales', 'time'],
    icon: Trophy,
    tone: 'yellow',
    size: { w: 4, h: 9 },
    limits: { minW: 3, minH: 5 },
    needsBoards: true,
  },
  {
    kind: 'workload',
    label: 'Workload',
    description: 'Who has too much on their plate, week by week against capacity.',
    categories: ['time'],
    icon: Users,
    tone: 'pink',
    size: { w: 6, h: 8 },
    limits: { minW: 4, minH: 5 },
    needsBoards: true,
  },
  {
    kind: 'calendar',
    label: 'Calendar',
    description: 'Items on a month calendar by any date column.',
    categories: ['time'],
    icon: CalendarDays,
    tone: 'sky',
    size: { w: 6, h: 11 },
    limits: { minW: 4, minH: 8 },
    needsBoards: true,
  },
  {
    kind: 'timeline',
    label: 'Timeline',
    description: 'A Gantt-style summary of item timelines with a today line.',
    categories: ['time'],
    icon: GanttChartSquare,
    tone: 'indigo',
    size: { w: 12, h: 10 },
    limits: { minW: 5, minH: 6 },
    needsBoards: true,
  },
  {
    kind: 'countdown',
    label: 'Countdown',
    description: 'Days, hours and minutes to a quarter close or launch.',
    categories: ['content', 'time'],
    icon: Hourglass,
    tone: 'berry',
    size: { w: 4, h: 5 },
    limits: { minW: 3, minH: 3 },
    needsBoards: false,
  },
  {
    kind: 'text',
    label: 'Text',
    description: 'A note, link list or instructions for the team.',
    categories: ['content'],
    icon: StickyNote,
    tone: 'lime',
    size: { w: 4, h: 5 },
    limits: { minW: 2, minH: 2 },
    needsBoards: false,
  },
  {
    kind: 'section',
    label: 'Section header',
    description: 'A full-width heading that groups the widgets below it.',
    categories: ['content'],
    icon: Heading,
    tone: 'gray',
    size: { w: 12, h: 2 },
    limits: { minW: 3, minH: 1, maxH: 3 },
    needsBoards: false,
    chromeless: true,
  },
];

/** The quick list shown in the "Add widget" split-button menu. */
export const QUICK_WIDGETS: readonly WidgetKind[] = ['numbers', 'chart', 'battery', 'table', 'forecast', 'text'];

export function widgetDefinition(kind: WidgetKind): WidgetDefinition {
  return WIDGETS.find((entry) => entry.kind === kind) ?? (WIDGETS[0] as WidgetDefinition);
}

export function searchWidgets(query: string, category: WidgetCategory | 'all'): WidgetDefinition[] {
  const q = query.trim().toLowerCase();
  return WIDGETS.filter((entry) => {
    if (category !== 'all' && !entry.categories.includes(category)) return false;
    if (!q) return true;
    return `${entry.label} ${entry.description} ${entry.kind}`.toLowerCase().includes(q);
  });
}

// ------------------------------------------------------------------------------------------------
// Smart defaults
// ------------------------------------------------------------------------------------------------

function firstOf(columns: readonly ColumnDto[], ...types: string[]): ColumnDto | undefined {
  for (const type of types) {
    const match = columns.find((column) => column.type === type);
    if (match) return match;
  }
  return undefined;
}

function labelIdsMatching(column: ColumnDto | undefined, pattern: RegExp): string[] {
  const labels = (column?.settings as { labels?: { id: string; name: string }[] } | undefined)?.labels ?? [];
  return labels.filter((label) => pattern.test(label.name)).map((label) => label.id);
}

function endOfQuarter(today: Date): string {
  const q = Math.floor(today.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(today.getUTCFullYear(), q + 3, 0)).toISOString().slice(0, 10);
}

/** Default title and config for a new widget of `kind` on `boards`. */
export function defaultWidget(
  kind: WidgetKind,
  boards: readonly DashboardSourceBoard[],
  today: Date = new Date(),
): { title: string; config: Record<string, unknown> } {
  const board = boards.find((entry) => entry.kind === 'deals') ?? boards[0];
  const columns = board?.columns ?? [];
  const status = firstOf(columns, 'status');
  const money = firstOf(columns, 'currency', 'number', 'formula');
  const date = firstOf(columns, 'date', 'timeline');
  const people = firstOf(columns, 'people');
  const lost = labelIdsMatching(status, /lost|cancel/i);
  const boardIds = board ? [board.id] : [];
  const noun = board?.itemTerminology ? `${board.itemTerminology.toLowerCase()}s` : 'items';
  const base: Record<string, unknown> = { kind, ...(boardIds.length ? { boardIds } : {}) };
  switch (kind) {
    case 'numbers':
      return money && money.type !== 'formula'
        ? { title: `Total ${money.title.toLowerCase()}`, config: { ...base, valueColumnKey: money.key, aggregate: 'sum', format: money.type === 'currency' ? 'currency' : 'number', dateColumnKey: date?.key } }
        : { title: `Total ${noun}`, config: { ...base, aggregate: 'count', dateColumnKey: date?.key } };
    case 'chart':
      return { title: status ? `${noun[0]?.toUpperCase()}${noun.slice(1)} by ${status.title.toLowerCase()}` : 'Chart', config: { ...base, chartType: 'bar', groupByColumnKey: status?.key ?? '$group', aggregate: 'count' } };
    case 'battery':
      return { title: status ? `${status.title} progress` : 'Progress', config: { ...base, groupByColumnKey: status?.key } };
    case 'table':
      return { title: `${board?.name ?? 'Items'} list`, config: { ...base, limit: 25 } };
    case 'workload':
      return { title: 'Team workload', config: { ...base, groupByColumnKey: people?.key, dateColumnKey: date?.key, capacity: 5 } };
    case 'calendar':
      return { title: `${board?.name ?? 'Items'} calendar`, config: { ...base, dateColumnKey: firstOf(columns, 'date')?.key ?? date?.key, colorByColumnKey: status?.key } };
    case 'timeline':
      return { title: `${board?.name ?? 'Items'} timeline`, config: { ...base, dateColumnKey: firstOf(columns, 'timeline', 'date')?.key, colorByColumnKey: status?.key } };
    case 'leaderboard':
      return { title: 'Leaderboard', config: { ...base, groupByColumnKey: people?.key, ...(money && money.type !== 'formula' ? { valueColumnKey: money.key, aggregate: 'sum', format: money.type === 'currency' ? 'currency' : 'number' } : { aggregate: 'count' }) } };
    case 'funnel':
      return { title: 'Pipeline funnel', config: { ...base, groupByColumnKey: status?.key, ...(money ? { valueColumnKey: money.key, aggregate: 'sum' } : {}), excludeLabelIds: lost } };
    case 'forecast': {
      const probability = columns.find((column) => column.type === 'number' && /prob/i.test(column.title));
      return { title: 'Forecast by close month', config: { ...base, groupByColumnKey: status?.key, valueColumnKey: firstOf(columns, 'currency', 'number')?.key, probabilityColumnKey: probability?.key, dateColumnKey: firstOf(columns, 'date')?.key, excludeLabelIds: lost, months: 6 } };
    }
    case 'countdown':
      return { title: 'Quarter close', config: { kind, targetDate: endOfQuarter(today), targetTime: '17:00', color: 'berry' } };
    case 'text':
      return { title: 'Notes', config: { kind, text: 'Pipeline review every Monday at 9:00.\n\n- Update next steps on every open deal\n- Flag deals slipping past their close date' } };
    case 'section':
      return { title: 'Section', config: { kind, description: '' } };
  }
}

/** Grid size for the Add-widget size presets (M is the widget's default size). */
export function presetSize(kind: WidgetKind, preset: 'S' | 'M' | 'L' = 'M'): { w: number; h: number } {
  const { size, limits } = widgetDefinition(kind);
  if (preset === 'M') return { ...size };
  if (preset === 'S') {
    return { w: Math.max(limits.minW, Math.round(size.w * 0.67)), h: Math.max(limits.minH, size.h - 2) };
  }
  return { w: Math.min(12, Math.round(size.w * 1.5)), h: Math.min(limits.maxH ?? 48, size.h + 3) };
}
