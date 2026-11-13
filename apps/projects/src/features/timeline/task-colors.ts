/** Bar / chip colors for the Timeline and Calendar: by workflow status or by priority. */
import { toLabelColor, type LabelColor } from '@/components/ui/label-color';
import type { Priority } from '@/lib/constants';
import type { StatusDTO, TaskSummary } from '@/lib/types';

export type ColorBy = 'status' | 'priority';

export const PRIORITY_LABEL_COLORS: Readonly<Record<Priority, LabelColor>> = {
  urgent: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'blue',
  none: 'gray',
};

export function taskColor(task: Pick<TaskSummary, 'statusId' | 'priority'>, colorBy: ColorBy, statusById: ReadonlyMap<string, StatusDTO>): LabelColor {
  if (colorBy === 'priority') return PRIORITY_LABEL_COLORS[task.priority];
  return toLabelColor(statusById.get(task.statusId)?.color, 'blue');
}

export function isClosed(task: Pick<TaskSummary, 'statusCategory'>): boolean {
  return task.statusCategory === 'done' || task.statusCategory === 'cancelled';
}
