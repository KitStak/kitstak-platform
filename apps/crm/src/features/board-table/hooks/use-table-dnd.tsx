'use client';

/**
 * Row and group drag & drop (dnd-kit sensors + overlay). Drop targets are hit-tested from the
 * pointer (rows carry data-drop attributes) instead of per-row useDroppable: registering
 * thousands of droppables re-renders every mounted row on each scroll. Rows drop before/after another row, onto a group's
 * add-row (append) or a group header (prepend); several selected rows move together. Groups
 * reorder while every group is collapsed. Each drop persists one fractional position per
 * moved entity.
 */
import { useRef, useState } from 'react';
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from '@/components/ui';
import type { GroupDto, ItemDto } from '@/server/services/contracts/dto';
import type { TableActions } from './use-table-actions';
import { dropIndex, placementAt } from '../lib/ordering';
import type { TableStore } from '../state/table-store';

export interface DragGhost {
  readonly kind: 'item' | 'group';
  readonly label: string;
  readonly color: string;
  readonly count: number;
}

interface DndInput {
  readonly store: TableStore;
  readonly actions: TableActions;
  readonly items: readonly ItemDto[];
  readonly groups: readonly GroupDto[];
  readonly visibleIdsByGroup: ReadonlyMap<string, readonly string[]>;
  readonly sorted: boolean;
}

type DropData =
  | { type: 'item'; itemId: string; groupId: string; rowKey: string }
  | { type: 'group-end'; groupId: string; rowKey: string }
  | { type: 'group'; groupId: string; rowKey: string };

interface DropHit {
  readonly data: DropData;
  readonly side: 'before' | 'after';
}

function pointerOf(event: DragMoveEvent | DragEndEvent): { x: number; y: number } | null {
  const activator = event.activatorEvent as PointerEvent | MouseEvent | null;
  if (!activator || typeof activator.clientY !== 'number') return null;
  return { x: activator.clientX + event.delta.x, y: activator.clientY + event.delta.y };
}

/** The drop target under the pointer (`[data-drop]` row), with the half of it the pointer is in. */
export function hitTest(x: number, y: number): DropHit | null {
  if (typeof document === 'undefined') return null;
  for (const element of document.elementsFromPoint(x, y)) {
    const host = (element as HTMLElement).closest?.<HTMLElement>('[data-drop]');
    if (!host) continue;
    const { drop, groupId, itemId, rowKey } = host.dataset;
    if (!groupId || !rowKey) return null;
    const rect = host.getBoundingClientRect();
    const side = y < rect.top + rect.height / 2 ? 'before' : 'after';
    if (drop === 'item' && itemId) return { data: { type: 'item', itemId, groupId, rowKey }, side };
    if (drop === 'group-end') return { data: { type: 'group-end', groupId, rowKey }, side: 'before' };
    if (drop === 'group') return { data: { type: 'group', groupId, rowKey }, side };
    return null;
  }
  return null;
}

const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export function useTableDnd({ store, actions, items, groups, visibleIdsByGroup, sorted }: DndInput) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const moving = useRef<readonly string[]>([]);
  const hit = useRef<DropHit | null>(null);
  const [ghost, setGhost] = useState<DragGhost | null>(null);

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as
      { type?: string; itemId?: string; groupId?: string } | undefined;
    if (data?.type === 'group' && data.groupId) {
      const group = groups.find((entry) => entry.id === data.groupId);
      moving.current = [data.groupId];
      hit.current = null;
      store.getState().setDrag('group', null, moving.current);
      setGhost({ kind: 'group', label: group?.title ?? 'Group', color: group?.color ?? 'blue', count: 1 });
      return;
    }
    if (data?.type !== 'item' || !data.itemId) return;
    const { selected } = store.getState();
    let ids: string[] = [data.itemId];
    if (selected.has(data.itemId) && selected.size > 1) {
      const ordered = groups.flatMap((group) => visibleIdsByGroup.get(group.id) ?? []);
      ids = ordered.filter((id) => selected.has(id));
    }
    moving.current = ids;
    hit.current = null;
    const item = items.find((entry) => entry.id === data.itemId);
    const group = groups.find((entry) => entry.id === item?.groupId);
    store.getState().setDrag('item', null, ids);
    setGhost({ kind: 'item', label: item?.name ?? '', color: group?.color ?? 'blue', count: ids.length });
  };

  const onDragMove = (event: DragMoveEvent) => {
    const { setDrop, dragKind } = store.getState();
    const pointer = pointerOf(event);
    const found = pointer ? hitTest(pointer.x, pointer.y) : null;
    const valid =
      found &&
      (dragKind === 'group'
        ? found.data.type === 'group' && !moving.current.includes(found.data.groupId)
        : !(found.data.type === 'item' && moving.current.includes(found.data.itemId)));
    hit.current = valid ? found : null;
    if (!valid || !found) return setDrop(null);
    const side = found.data.type === 'group' && dragKind !== 'group' ? 'after' : found.side;
    return setDrop({ rowKey: found.data.rowKey, side });
  };

  const finish = () => {
    hit.current = null;
    store.getState().setDrag(null);
    setGhost(null);
    moving.current = [];
  };

  const onDragEnd = () => {
    const { dragKind } = store.getState();
    const ids = moving.current;
    const target = hit.current;
    finish();
    if (!target || !ids.length) return;
    const data = target.data;

    if (dragKind === 'group') {
      const group = groups.find((entry) => entry.id === ids[0]);
      if (!group || data.type !== 'group' || data.groupId === group.id) return;
      const movingSet = new Set([group.id]);
      const placement = placementAt(
        groups,
        movingSet,
        dropIndex(groups, movingSet, data.groupId, target.side),
      );
      if (placement) actions.reorderGroup(group, placement);
      return;
    }

    const movingSet = new Set(ids);
    const movingItems = ids
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is ItemDto => Boolean(item));
    const targetGroup = data.groupId;
    const siblings = items.filter((item) => item.groupId === targetGroup).sort(byPosition);
    const allSameGroup = movingItems.every((item) => item.groupId === targetGroup);
    if (sorted) {
      if (allSameGroup) toast.info('Sorting is on', 'Clear the sort to reorder rows by hand.');
      else
        actions.moveItems(
          movingItems.filter((item) => item.groupId !== targetGroup),
          targetGroup,
          null,
          null,
        );
      return;
    }
    let index: number;
    if (data.type === 'item') index = dropIndex(siblings, movingSet, data.itemId, target.side);
    else if (data.type === 'group-end') index = siblings.filter((item) => !movingSet.has(item.id)).length;
    else index = 0;
    const placement = placementAt(siblings, movingSet, index);
    if (!placement) return;
    const others = siblings.filter((item) => !movingSet.has(item.id));
    const upper = others[index]?.position ?? null;
    actions.moveItems(movingItems, targetGroup, placement, upper);
  };

  return { sensors, ghost, onDragStart, onDragMove, onDragEnd, onDragCancel: finish };
}
