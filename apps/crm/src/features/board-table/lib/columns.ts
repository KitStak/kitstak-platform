/**
 * Column layout: which columns show, in which order, at which width, plus auto-fit.
 * Pure.
 */
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import type { ColumnType } from '@/server/db/schema/cell-values';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { cellText, columnLabels, type UsersById } from './cell-text';
import { LAYOUT } from './rows';
import { clampWidth, type TableViewState } from './view-state';

export const COLLAPSED_COLUMN_WIDTH = 32;
/** The name column is the row's identity: never let it shrink below a readable width. */
export const NAME_MIN_WIDTH = 280;
/** Default name width when the view has not chosen one (the registry default). */
const NAME_DEFAULT_WIDTH = Math.max(COLUMN_TYPE_REGISTRY.name?.defaultWidth ?? 520, NAME_MIN_WIDTH);
const CELL_PADDING = 24;
/** Header padding + reveal-on-hover menu button around the title text. */
const HEADER_CHROME = 48;

export interface ColumnLayout {
  readonly column: ColumnDto;
  readonly width: number;
  readonly collapsed: boolean;
  /** Left offset from the start of the scrolling columns area. */
  readonly left: number;
}

export interface TableLayout {
  readonly name: ColumnDto | null;
  readonly nameWidth: number;
  readonly columns: readonly ColumnLayout[];
  /** Width of the sticky block (gutter + stripe + checkbox + name). */
  readonly stickyWidth: number;
  readonly totalWidth: number;
}

const byPosition = (a: ColumnDto, b: ColumnDto) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export function minWidthFor(type: ColumnType): number {
  return type === 'name' ? NAME_MIN_WIDTH : Math.max(60, COLUMN_TYPE_REGISTRY[type]?.minWidth ?? 60);
}

export function columnWidth(
  column: ColumnDto,
  state: Pick<TableViewState, 'columnWidths'>,
  live?: Readonly<Record<string, number>>,
): number {
  const explicit = live?.[column.key] ?? state.columnWidths[column.key];
  if (explicit !== undefined) return clampWidth(explicit, minWidthFor(column.type));
  // Older templates stored narrower name defaults (260–300px) that truncate real names
  // around 18 characters while other columns have slack: floor the name column at the
  // registry default until the view picks an explicit width.
  if (column.type === 'name') {
    return clampWidth(Math.max(column.width ?? NAME_DEFAULT_WIDTH, NAME_DEFAULT_WIDTH), NAME_MIN_WIDTH);
  }
  // A stored column width is a deliberate default (templates pick narrow widths for dense
  // numeric columns like "Close probability"): honor it so those columns stop hoarding row
  // width. Only width-less columns fall back to the registry default, widened so the header
  // title never truncates (board creation bakes the title fit into the stored width).
  if (column.width != null) return clampWidth(column.width, minWidthFor(column.type));
  const base = COLUMN_TYPE_REGISTRY[column.type]?.defaultWidth ?? 160;
  return clampWidth(Math.max(base, headerTitleWidth(column.title)), minWidthFor(column.type));
}

/** Header width that shows the whole title plus the grip / menu affordances. */
export function headerTitleWidth(title: string, measure: TextMeasure = approxMeasure): number {
  return Math.ceil(measure(title) + HEADER_CHROME);
}

/** Visible columns of one scope, ordered, with resolved widths and offsets. */
export function computeLayout(
  allColumns: readonly ColumnDto[],
  state: Pick<TableViewState, 'columnWidths' | 'hiddenColumnKeys' | 'collapsedColumnKeys'>,
  options: {
    readonly scope?: 'item' | 'subitem';
    readonly live?: Readonly<Record<string, number>>;
    /** Cap for the sticky name column (narrow viewports keep room for other columns). */
    readonly maxNameWidth?: number;
  } = {},
): TableLayout {
  const scope = options.scope ?? 'item';
  const hidden = new Set(state.hiddenColumnKeys);
  const collapsed = new Set(state.collapsedColumnKeys);
  const scoped = allColumns.filter((column) => column.scope === scope).sort(byPosition);
  const name = scoped.find((column) => column.type === 'name') ?? null;
  const rawName = name ? columnWidth(name, state, options.live) : 360;
  const nameWidth = options.maxNameWidth ? Math.max(150, Math.min(rawName, options.maxNameWidth)) : rawName;
  let left = 0;
  const columns: ColumnLayout[] = [];
  for (const column of scoped) {
    if (column.type === 'name' || column.hidden || hidden.has(column.key)) continue;
    const isCollapsed = collapsed.has(column.key);
    const width = isCollapsed ? COLLAPSED_COLUMN_WIDTH : columnWidth(column, state, options.live);
    columns.push({ column, width, collapsed: isCollapsed, left });
    left += width;
  }
  const stickyWidth = LAYOUT.gutter + LAYOUT.stripe + LAYOUT.check + nameWidth;
  return { name, nameWidth, columns, stickyWidth, totalWidth: stickyWidth + left + LAYOUT.addColumn };
}

export type TextMeasure = (text: string) => number;

/** Average-glyph fallback measure (tests / SSR). */
export const approxMeasure: TextMeasure = (text) => text.length * 7.4;

/** Content-fitted width for a column over the given items (double-click on the divider). */
export function autoFitWidth(
  column: ColumnDto,
  items: readonly ItemDto[],
  users: UsersById,
  measure: TextMeasure = approxMeasure,
): number {
  const header = measure(column.title) + 56; // grip + menu affordances
  let content = 0;
  const sample = items.length > 3_000 ? items.slice(0, 3_000) : items;
  switch (column.type) {
    case 'status':
      content = Math.max(0, ...columnLabels(column).map((label) => measure(label.name))) + 32;
      break;
    case 'people': {
      const most = Math.max(
        0,
        ...sample.map(
          (item) => ((item.values[column.key] as { ids?: string[] } | undefined)?.ids ?? []).length,
        ),
      );
      content = Math.min(4, Math.max(1, most)) * 20 + 28;
      break;
    }
    case 'checkbox':
      content = 48;
      break;
    case 'rating':
      content = ((column.settings as { max?: number }).max ?? 5) * 20 + 20;
      break;
    default:
      for (const item of sample)
        content = Math.max(content, measure(cellText(column, item, users)) + CELL_PADDING);
  }
  if (column.type === 'name') content += 96; // open button + updates bubble
  return clampWidth(Math.max(header, content), minWidthFor(column.type));
}
