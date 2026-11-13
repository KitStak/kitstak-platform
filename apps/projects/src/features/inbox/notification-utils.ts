/** Pure helpers for inbox notifications (shared by Inbox and the Home inbox preview). */
import type { NotificationKind } from '@/lib/constants';
import { addDaysIso, startOfWeekIso, toIsoDate } from '@/lib/dates';
import type { NotificationDTO } from '@/lib/types';

/** `/p/OPS/42` (optionally with a query/hash) → `OPS-42`, so the task opens in the drawer. */
export function taskKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^\/p\/([^/?#]+)\/(\d+)(?:[/?#]|$)/.exec(url);
  if (!match) return null;
  return `${decodeURIComponent(match[1]!).toUpperCase()}-${match[2]}`;
}

export const KIND_LABEL: Readonly<Record<NotificationKind, string>> = {
  mention: 'Mentioned you',
  assigned: 'Assigned to you',
  comment: 'New comment',
  status_changed: 'Status changed',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  watching: 'Update',
  automation: 'Automation',
  integration: 'Linked app',
  project: 'Project update',
};

export type InboxDateGroup = 'Today' | 'Yesterday' | 'Earlier this week' | 'Last week' | 'Older';

/** Group label for a notification's local creation date. */
export function inboxDateGroup(createdAt: string, now: Date = new Date()): InboxDateGroup {
  const day = toIsoDate(new Date(createdAt));
  const today = toIsoDate(now);
  if (day >= today) return 'Today';
  if (day === addDaysIso(today, -1)) return 'Yesterday';
  const week = startOfWeekIso(today);
  if (day >= week) return 'Earlier this week';
  if (day >= addDaysIso(week, -7)) return 'Last week';
  return 'Older';
}

/** Splits notifications into ordered date groups (input is newest first). */
export function groupByDate(items: readonly NotificationDTO[], now: Date = new Date()): { label: InboxDateGroup; items: NotificationDTO[] }[] {
  const groups: { label: InboxDateGroup; items: NotificationDTO[] }[] = [];
  for (const item of items) {
    const label = inboxDateGroup(item.createdAt, now);
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
