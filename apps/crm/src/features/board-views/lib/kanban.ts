/** Pure Kanban model: lanes from a status/dropdown column or the board groups, ordering, totals. */
import { toLabelColor, type LabelColor } from '@/components/ui/label-color';
import type { ColumnDto, GroupDto, ItemDto } from '@/server/services/contracts/dto';
import { cellOf, columnLabels, dropdownLabelIds, GROUP_KEY, numericValue, statusLabelId } from './values';

export const EMPTY_LANE = '__empty';

export interface Lane {
  readonly id: string;
  readonly title: string;
  readonly color: LabelColor;
  /** Status/dropdown label id or group id written when a card lands here (null = clear). */
  readonly value: string | null;
  readonly isDone?: boolean;
}

/** Lanes in display order (saved per-view order first, then board order). */
export function buildLanes(
  groupBy: string,
  columns: readonly ColumnDto[],
  groups: readonly GroupDto[],
  laneOrder: readonly string[] = [],
): Lane[] {
  let lanes: Lane[];
  if (groupBy === GROUP_KEY) {
    lanes = groups
      .filter((group) => !group.archivedAt)
      .map((group) => ({ id: group.id, title: group.title, color: toLabelColor(group.color, 'blue'), value: group.id }));
  } else {
    const column = columns.find((entry) => entry.key === groupBy);
    const labels = columnLabels(column).filter((label) => !label.isDefault);
    lanes = [
      ...labels.map((label) => ({
        id: label.id,
        title: label.name || 'Untitled',
        color: label.color,
        value: label.id,
        ...(label.isDone && { isDone: true }),
      })),
      { id: EMPTY_LANE, title: `No ${column?.title.toLowerCase() ?? 'value'}`, color: 'gray' as LabelColor, value: null },
    ];
  }
  if (laneOrder.length === 0) return lanes;
  const rank = new Map(laneOrder.map((id, index) => [id, index]));
  return lanes
    .map((lane, index) => ({ lane, index }))
    .sort((a, b) => (rank.get(a.lane.id) ?? 1000 + a.index) - (rank.get(b.lane.id) ?? 1000 + b.index))
    .map((entry) => entry.lane);
}

export function laneIdForItem(item: ItemDto, groupBy: string, column: ColumnDto | undefined): string {
  if (groupBy === GROUP_KEY) return item.groupId;
  const raw = cellOf(item, groupBy);
  const id = column?.type === 'dropdown' ? dropdownLabelIds(raw)[0] : statusLabelId(raw);
  if (!id) return EMPTY_LANE;
  const known = columnLabels(column).some((label) => label.id === id && !label.isDefault);
  return known ? id : EMPTY_LANE;
}

const byPosition = (a: ItemDto, b: ItemDto) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/** Cards per lane, honouring the per-view manual order and falling back to board position. */
export function groupIntoLanes(
  items: readonly ItemDto[],
  lanes: readonly Lane[],
  groupBy: string,
  columns: readonly ColumnDto[],
  cardOrder: Readonly<Record<string, readonly string[]>> = {},
): Map<string, ItemDto[]> {
  const column = columns.find((entry) => entry.key === groupBy);
  const result = new Map<string, ItemDto[]>(lanes.map((lane) => [lane.id, []]));
  for (const item of items) {
    const laneId = laneIdForItem(item, groupBy, column);
    const bucket = result.get(laneId) ?? result.get(EMPTY_LANE);
    bucket?.push(item);
  }
  for (const [laneId, bucket] of result) {
    const order = cardOrder[laneId];
    const rank = new Map((order ?? []).map((id, index) => [id, index]));
    bucket.sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return byPosition(a, b);
    });
  }
  return result;
}

export interface LaneTotals {
  readonly count: number;
  readonly sum: number | null;
  readonly weighted: number | null;
}

/** Σ value and Σ(value × probability%) for a lane. */
export function laneTotals(items: readonly ItemDto[], sumKey: string | null, weightKey: string | null): LaneTotals {
  if (!sumKey) return { count: items.length, sum: null, weighted: null };
  let sum = 0;
  let weighted = 0;
  for (const item of items) {
    const value = numericValue(cellOf(item, sumKey)) ?? 0;
    sum += value;
    if (weightKey) weighted += (value * (numericValue(cellOf(item, weightKey)) ?? 0)) / 100;
  }
  return { count: items.length, sum, weighted: weightKey ? weighted : null };
}

/** Move `itemId` to `index` inside `order` (removing it from anywhere else first). */
export function moveInOrder(order: readonly string[], itemId: string, index: number): string[] {
  const rest = order.filter((id) => id !== itemId);
  const clamped = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, clamped), itemId, ...rest.slice(clamped)];
}

/**
 * New per-view card order after a card moves from one lane to another (or within a lane).
 * `targetIds` are the current card ids of the target lane in display order.
 */
export function applyCardMove(
  cardOrder: Readonly<Record<string, readonly string[]>>,
  input: { itemId: string; fromLane: string; toLane: string; targetIds: readonly string[]; index: number },
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [lane, ids] of Object.entries(cardOrder)) next[lane] = ids.filter((id) => id !== input.itemId);
  next[input.toLane] = moveInOrder(input.targetIds, input.itemId, input.index).slice(0, 1000);
  if (input.fromLane !== input.toLane && next[input.fromLane]?.length === 0) delete next[input.fromLane];
  return next;
}

/** Move a lane one step left (-1) or right (+1) in a full lane id list. */
export function shiftLane(order: readonly string[], laneId: string, delta: -1 | 1): string[] {
  const index = order.indexOf(laneId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  next.splice(index, 1);
  next.splice(target, 0, laneId);
  return next;
}

/** Cell value stored when a card lands in `lane`. */
export function laneCellValue(lane: Lane, column: ColumnDto | undefined): unknown {
  if (lane.value === null) return null;
  return column?.type === 'dropdown' ? { labelIds: [lane.value] } : { labelId: lane.value };
}
