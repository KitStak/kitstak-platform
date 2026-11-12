/**
 * Flat row model for the virtualized table. Every visual row (group header, column header,
 * item, subitem block rows, add-item, footer, collapsed group, gaps) is one entry with a
 * fixed height, so TanStack Virtual can position 5k+ rows without measuring.
 */
import type { CellDensity } from '@/features/cells';
import type { GroupDto, ItemDto } from '@/server/services/contracts/dto';

export const ROW_HEIGHTS: Readonly<Record<CellDensity, number>> = {
  compact: 32,
  default: 36,
  comfortable: 40,
};

export const LAYOUT = {
  gutter: 32,
  stripe: 6,
  check: 36,
  addColumn: 48,
  groupHeader: 44,
  columnHeader: 36,
  footer: 36,
  collapsed: 60,
  gapFirst: 12,
  gap: 32,
  subHeader: 32,
  subRow: 32,
  subIndent: 28,
  subCheck: 32,
  bulkPadding: 104,
} as const;

export type SubitemState = readonly ItemDto[] | 'loading' | 'error';

export type TableRow =
  | { readonly kind: 'gap'; readonly key: string; readonly height: number }
  | { readonly kind: 'group-header'; readonly key: string; readonly height: number; readonly groupId: string }
  | {
      readonly kind: 'column-header';
      readonly key: string;
      readonly height: number;
      readonly groupId: string;
    }
  | {
      readonly kind: 'item';
      readonly key: string;
      readonly height: number;
      readonly groupId: string;
      readonly item: ItemDto;
      readonly isLastItem: boolean;
    }
  | {
      readonly kind: 'sub-header';
      readonly key: string;
      readonly height: number;
      readonly groupId: string;
      readonly parentId: string;
    }
  | {
      readonly kind: 'subitem';
      readonly key: string;
      readonly height: number;
      readonly groupId: string;
      readonly parentId: string;
      readonly item: ItemDto;
    }
  | {
      readonly kind: 'sub-status';
      readonly key: string;
      readonly height: number;
      readonly groupId: string;
      readonly parentId: string;
      readonly status: 'loading' | 'error';
    }
  | {
      readonly kind: 'sub-add';
      readonly key: string;
      readonly height: number;
      readonly groupId: string;
      readonly parentId: string;
    }
  | { readonly kind: 'add-item'; readonly key: string; readonly height: number; readonly groupId: string }
  | { readonly kind: 'footer'; readonly key: string; readonly height: number; readonly groupId: string }
  | { readonly kind: 'collapsed'; readonly key: string; readonly height: number; readonly groupId: string }
  | { readonly kind: 'empty-group'; readonly key: string; readonly height: number; readonly groupId: string };

export type TableRowKind = TableRow['kind'];

export interface GroupRange {
  readonly groupId: string;
  /** Index of the group-header row (or the collapsed row). */
  readonly headerIndex: number;
  /** Index of the last row of the group (footer). */
  readonly endIndex: number;
  readonly collapsed: boolean;
}

export interface RowModel {
  readonly rows: readonly TableRow[];
  readonly ranges: readonly GroupRange[];
  /** Row index by row key (focus restoration, scroll-to). */
  readonly indexByKey: ReadonlyMap<string, number>;
}

export interface RowModelInput {
  readonly groups: readonly GroupDto[];
  readonly itemsByGroup: ReadonlyMap<string, readonly ItemDto[]>;
  readonly collapsedGroupIds: ReadonlySet<string>;
  readonly expandedItemIds: ReadonlySet<string>;
  readonly subitems: ReadonlyMap<string, SubitemState>;
  readonly density: CellDensity;
  /** Collapse every group (group drag in progress). */
  readonly collapseAll?: boolean;
  /** Hide groups without matching items (a filter or search is active). */
  readonly hideEmptyGroups?: boolean;
  readonly canEdit?: boolean;
  /** Extra space at the bottom while the bulk bar is open. */
  readonly bottomPadding?: number;
}

export const itemRowKey = (itemId: string) => `item:${itemId}`;
export const subitemRowKey = (itemId: string) => `sub:${itemId}`;
export const addRowKey = (groupId: string) => `add:${groupId}`;

export function buildRowModel(input: RowModelInput): RowModel {
  const rows: TableRow[] = [];
  const ranges: GroupRange[] = [];
  const itemHeight = ROW_HEIGHTS[input.density];
  const canEdit = input.canEdit ?? true;
  let first = true;

  for (const group of input.groups) {
    const items = input.itemsByGroup.get(group.id) ?? [];
    if (input.hideEmptyGroups && items.length === 0) continue;
    rows.push({ kind: 'gap', key: `gap:${group.id}`, height: first ? LAYOUT.gapFirst : LAYOUT.gap });
    first = false;
    const collapsed = Boolean(input.collapseAll) || input.collapsedGroupIds.has(group.id);
    if (collapsed) {
      const index = rows.length;
      rows.push({
        kind: 'collapsed',
        key: `collapsed:${group.id}`,
        height: LAYOUT.collapsed,
        groupId: group.id,
      });
      ranges.push({ groupId: group.id, headerIndex: index, endIndex: index, collapsed: true });
      continue;
    }
    const headerIndex = rows.length;
    rows.push({
      kind: 'group-header',
      key: `group:${group.id}`,
      height: LAYOUT.groupHeader,
      groupId: group.id,
    });
    rows.push({
      kind: 'column-header',
      key: `cols:${group.id}`,
      height: LAYOUT.columnHeader,
      groupId: group.id,
    });
    items.forEach((item, index) => {
      rows.push({
        kind: 'item',
        key: itemRowKey(item.id),
        height: itemHeight,
        groupId: group.id,
        item,
        isLastItem: index === items.length - 1,
      });
      if (input.expandedItemIds.has(item.id)) pushSubitems(rows, input, group.id, item.id);
    });
    if (canEdit)
      rows.push({ kind: 'add-item', key: addRowKey(group.id), height: itemHeight, groupId: group.id });
    else if (items.length === 0)
      rows.push({ kind: 'empty-group', key: `empty:${group.id}`, height: itemHeight, groupId: group.id });
    rows.push({ kind: 'footer', key: `footer:${group.id}`, height: LAYOUT.footer, groupId: group.id });
    ranges.push({ groupId: group.id, headerIndex, endIndex: rows.length - 1, collapsed: false });
  }
  if (rows.length)
    rows.push({ kind: 'gap', key: 'gap:end', height: LAYOUT.gap + (input.bottomPadding ?? 0) });

  const indexByKey = new Map<string, number>();
  rows.forEach((row, index) => indexByKey.set(row.key, index));
  return { rows, ranges, indexByKey };
}

function pushSubitems(rows: TableRow[], input: RowModelInput, groupId: string, parentId: string): void {
  const state = input.subitems.get(parentId) ?? 'loading';
  rows.push({ kind: 'sub-header', key: `subhead:${parentId}`, height: LAYOUT.subHeader, groupId, parentId });
  if (state === 'loading' || state === 'error') {
    rows.push({
      kind: 'sub-status',
      key: `substatus:${parentId}`,
      height: LAYOUT.subRow,
      groupId,
      parentId,
      status: state,
    });
  } else {
    for (const sub of state) {
      rows.push({
        kind: 'subitem',
        key: subitemRowKey(sub.id),
        height: LAYOUT.subRow,
        groupId,
        parentId,
        item: sub,
      });
    }
  }
  if (input.canEdit ?? true)
    rows.push({ kind: 'sub-add', key: `subadd:${parentId}`, height: LAYOUT.subRow, groupId, parentId });
}

/** Rows the keyboard grid can focus, in order. */
export function isNavigableRow(row: TableRow): row is Extract<TableRow, { kind: 'item' | 'subitem' }> {
  return row.kind === 'item' || row.kind === 'subitem';
}

/**
 * Sticky group overlay: which group's header should be pinned for a scroll offset, and how
 * far it is pushed up by the end of its group. `offsets[i]` = start of row i.
 */
export function stickyGroupAt(
  model: RowModel,
  offsets: readonly number[],
  scrollTop: number,
  overlayHeight: number,
): { groupId: string; push: number } | null {
  for (const range of model.ranges) {
    if (range.collapsed) continue;
    const start = offsets[range.headerIndex] ?? 0;
    const endRow = model.rows[range.endIndex];
    const end = (offsets[range.endIndex] ?? 0) + (endRow?.height ?? 0);
    if (scrollTop > start && scrollTop < end) {
      return { groupId: range.groupId, push: Math.min(0, end - scrollTop - overlayHeight) };
    }
  }
  return null;
}

export function rowOffsets(rows: readonly TableRow[]): number[] {
  const out: number[] = [];
  let top = 0;
  for (const row of rows) {
    out.push(top);
    top += row.height;
  }
  return out;
}
