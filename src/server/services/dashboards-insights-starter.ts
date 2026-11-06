/**
 * Starter widget sets for the dashboard creation flow. Pure: derives widget configs from the
 * columns of the chosen boards (a CRM deals board gets a full sales cockpit).
 */
import type { ColumnDto, WidgetType } from './contracts/dto';
import {
  widgetTypeForKind,
  type DashboardSourceBoard,
  type WidgetKind,
} from './contracts/dashboard-insights';

export interface StarterWidget {
  readonly type: WidgetType;
  readonly title: string;
  readonly config: Record<string, unknown>;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function widget(
  kind: WidgetKind,
  title: string,
  config: Record<string, unknown>,
  layout: { x: number; y: number; w: number; h: number },
): StarterWidget {
  return { type: widgetTypeForKind(kind), title, config: { kind, ...config }, ...layout };
}

function first(columns: readonly ColumnDto[], type: string): ColumnDto | undefined {
  return columns.find((column) => column.type === type);
}

function labelIds(column: ColumnDto | undefined, predicate: (label: { id: string; name: string; isDone?: boolean }) => boolean): string[] {
  const labels = (column?.settings as { labels?: { id: string; name: string; isDone?: boolean }[] } | undefined)?.labels ?? [];
  return labels.filter(predicate).map((label) => label.id);
}

/** Full sales cockpit for a deals-like board; falls back to a generic overview. */
export function starterWidgets(boards: readonly DashboardSourceBoard[]): StarterWidget[] {
  const deals = boards.find((board) => board.kind === 'deals');
  if (!deals) return genericStarter(boards);
  const cols = deals.columns;
  const stage = first(cols, 'status');
  const value = first(cols, 'currency') ?? first(cols, 'number');
  const probability = cols.find((column) => column.type === 'number' && /prob/i.test(column.title));
  const close = first(cols, 'date');
  const owner = first(cols, 'people');
  const weighted = first(cols, 'formula');
  const won = labelIds(stage, (label) => Boolean(label.isDone));
  const lost = labelIds(stage, (label) => /lost/i.test(label.name));
  const closed = [...won, ...lost];
  const base = { boardIds: [deals.id] };
  const open = stage ? { filter: { columnKey: stage.key, labelIds: closed, exclude: true } } : {};
  const money = { valueColumnKey: value?.key, format: 'currency', aggregate: 'sum', dateColumnKey: close?.key };
  return [
    widget('numbers', 'Open pipeline', { ...base, ...open, ...money }, { x: 0, y: 0, w: 3, h: 4 }),
    widget('numbers', 'Weighted forecast', { ...base, ...open, ...money, valueColumnKey: (weighted ?? value)?.key }, { x: 3, y: 0, w: 3, h: 4 }),
    widget('numbers', 'Closed won', { ...base, ...money, ...(stage ? { filter: { columnKey: stage.key, labelIds: won, exclude: false } } : {}) }, { x: 6, y: 0, w: 3, h: 4 }),
    widget('numbers', 'Average deal size', { ...base, ...money, aggregate: 'average', ...(stage ? { filter: { columnKey: stage.key, labelIds: lost, exclude: true } } : {}) }, { x: 9, y: 0, w: 3, h: 4 }),
    widget('forecast', 'Forecast by close month', { ...base, groupByColumnKey: stage?.key, valueColumnKey: value?.key, probabilityColumnKey: probability?.key, dateColumnKey: close?.key, excludeLabelIds: lost, months: 6 }, { x: 0, y: 4, w: 8, h: 9 }),
    widget('funnel', 'Pipeline funnel', { ...base, groupByColumnKey: stage?.key, valueColumnKey: value?.key, aggregate: 'sum', excludeLabelIds: lost }, { x: 8, y: 4, w: 4, h: 9 }),
    widget('battery', 'Deal stage mix', { ...base, groupByColumnKey: stage?.key }, { x: 0, y: 13, w: 12, h: 4 }),
    widget('leaderboard', 'Top performers', { ...base, groupByColumnKey: owner?.key, valueColumnKey: value?.key, aggregate: 'sum', format: 'currency', ...(stage ? { filter: { columnKey: stage.key, labelIds: won, exclude: false } } : {}) }, { x: 0, y: 17, w: 4, h: 9 }),
    widget('chart', 'Pipeline by owner and stage', { ...base, ...open, chartType: 'stacked_bar', groupByColumnKey: owner?.key, stackByColumnKey: stage?.key, valueColumnKey: value?.key, aggregate: 'sum', format: 'currency' }, { x: 4, y: 17, w: 8, h: 9 }),
    widget('table', 'Largest open deals', { ...base, ...open, valueColumnKey: value?.key, sortBy: 'value_desc', limit: 25, columnKeys: [stage?.key, owner?.key, value?.key, close?.key].filter(Boolean) }, { x: 0, y: 26, w: 12, h: 10 }),
  ];
}

function genericStarter(boards: readonly DashboardSourceBoard[]): StarterWidget[] {
  const board = boards[0];
  if (!board) return [];
  const status = first(board.columns, 'status');
  const base = { boardIds: [board.id] };
  return [
    widget('numbers', `Total ${board.itemTerminology.toLowerCase()}s`, { ...base, aggregate: 'count' }, { x: 0, y: 0, w: 4, h: 4 }),
    widget('battery', 'Progress', { ...base, groupByColumnKey: status?.key }, { x: 4, y: 0, w: 8, h: 4 }),
    widget('chart', 'By status', { ...base, chartType: 'donut', groupByColumnKey: status?.key }, { x: 0, y: 4, w: 6, h: 9 }),
    widget('table', 'Items', { ...base }, { x: 6, y: 4, w: 6, h: 9 }),
  ];
}
