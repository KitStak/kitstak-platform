/**
 * Keyboard drag for Kanban: ArrowLeft / ArrowRight jump the picked-up card to the previous /
 * next lane (lane droppables have ids `lane:<id>`); ArrowUp / ArrowDown keep the sortable
 * behaviour of moving between cards in the lane. Modelled on dnd-kit's
 * multipleContainersKeyboardCoordinates example.
 */
import { KeyboardCode, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

export interface LaneSpan {
  readonly id: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
}

/** Pure: the lane to jump to from a card whose horizontal centre is `centerX`. */
export function nextLaneSpan(lanes: readonly LaneSpan[], centerX: number, direction: 1 | -1): LaneSpan | null {
  const sorted = [...lanes].sort((a, b) => a.left - b.left);
  let current = sorted.findIndex((lane) => centerX >= lane.left && centerX <= lane.right);
  if (current < 0) {
    // Between lanes (gap): treat the nearest lane to the left as current.
    current = sorted.reduce((found, lane, index) => (lane.right < centerX ? index : found), -1);
    if (direction === -1) current += 1;
  }
  return sorted[current + direction] ?? null;
}

export const laneKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) return sortableKeyboardCoordinates(event, args);
  const { collisionRect, droppableRects, droppableContainers } = args.context;
  if (!collisionRect) return undefined;
  event.preventDefault();
  const lanes: LaneSpan[] = [];
  for (const container of droppableContainers.getEnabled()) {
    const id = String(container.id);
    if (!id.startsWith('lane:')) continue;
    const rect = droppableRects.get(container.id);
    if (rect) lanes.push({ id, left: rect.left, right: rect.left + rect.width, top: rect.top, width: rect.width });
  }
  const target = nextLaneSpan(lanes, collisionRect.left + collisionRect.width / 2, event.code === KeyboardCode.Right ? 1 : -1);
  if (!target) return undefined;
  return { x: target.left + Math.max(0, (target.width - collisionRect.width) / 2), y: target.top + 8 };
};
