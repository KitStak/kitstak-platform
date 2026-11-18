/**
 * The alert inbox, as pure functions: which tab an alert sits in, what a change does to it (so
 * the list can update before the server answers), and the change that undoes it.
 */
import { addDays, weekday } from '@/lib/profit/calendar';
import type { AlertDTO } from '@/lib/types';

export type InboxTab = 'open' | 'mine' | 'snoozed' | 'done';
export const INBOX_TABS: readonly { readonly id: InboxTab; readonly label: string }[] = [
  { id: 'open', label: 'Needs you' },
  { id: 'mine', label: 'Assigned to me' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'done', label: 'Done' },
];

export type InboxChange =
  | { readonly action: 'snooze'; readonly until: string }
  | { readonly action: 'unsnooze' }
  | { readonly action: 'dismiss' }
  | { readonly action: 'resolve' }
  | { readonly action: 'reopen' }
  | { readonly action: 'assign'; readonly userId: string | null };

/** The list an alert is stored in: `open`, `snoozed` or `done` (resolved and dismissed together). */
export function bucketOf(alert: Pick<AlertDTO, 'status'>): 'open' | 'snoozed' | 'done' {
  return alert.status === 'open' ? 'open' : alert.status === 'snoozed' ? 'snoozed' : 'done';
}

export function inTab(alert: AlertDTO, tab: InboxTab, meId: string): boolean {
  if (tab === 'mine') return alert.status === 'open' && alert.assignedTo === meId;
  return bucketOf(alert) === tab;
}

/** The alert as it will look after `change`. */
export function applyChange(alert: AlertDTO, change: InboxChange, now: string): AlertDTO {
  switch (change.action) {
    case 'snooze':
      return { ...alert, status: 'snoozed', snoozedUntil: change.until };
    case 'unsnooze':
    case 'reopen':
      return { ...alert, status: 'open', snoozedUntil: null, resolvedAt: null, resolution: null };
    case 'dismiss':
      return { ...alert, status: 'dismissed', resolvedAt: now };
    case 'resolve':
      return { ...alert, status: 'resolved', resolution: 'manual', resolvedAt: now };
    case 'assign':
      return { ...alert, assignedTo: change.userId };
  }
}

/** The change that puts an alert back the way it was before `change`. */
export function inverseChange(before: AlertDTO, change: InboxChange): InboxChange {
  if (change.action === 'assign') return { action: 'assign', userId: before.assignedTo };
  if (before.status === 'snoozed' && before.snoozedUntil) return { action: 'snooze', until: before.snoozedUntil };
  if (before.status === 'resolved') return { action: 'resolve' };
  if (before.status === 'dismissed') return { action: 'dismiss' };
  return change.action === 'snooze' ? { action: 'unsnooze' } : { action: 'reopen' };
}

/** What the toast says after a change to `count` alerts. */
export function changeMessage(change: InboxChange, count: number, personName?: string | null): string {
  const what = count === 1 ? 'Alert' : `${count} alerts`;
  switch (change.action) {
    case 'snooze':
      return `${what} snoozed`;
    case 'unsnooze':
      return `${what} back in the inbox`;
    case 'reopen':
      return `${what} opened again`;
    case 'dismiss':
      return `${what} dismissed`;
    case 'resolve':
      return `${what} marked done`;
    case 'assign':
      return change.userId ? `${what} handed to ${personName ?? 'a teammate'}` : `${what} handed to no one`;
  }
}

/** Snooze choices, counted from today in the workspace's time zone. */
export function snoozeChoices(today: string): readonly { readonly label: string; readonly until: string }[] {
  const toMonday = ((8 - weekday(today)) % 7) || 7;
  return [
    { label: 'Until tomorrow', until: addDays(today, 1) },
    { label: 'For 3 days', until: addDays(today, 3) },
    { label: 'Until next Monday', until: addDays(today, toMonday) },
    { label: 'For 2 weeks', until: addDays(today, 14) },
  ];
}

/** Words for the link of an alert, from where it points. */
export function linkLabel(alert: Pick<AlertDTO, 'entityType' | 'url'>): string {
  const url = alert.url ?? '';
  if (url.startsWith('/jobs')) return 'Open the job';
  if (url.startsWith('/clients')) return 'Open the client';
  if (url.startsWith('/services')) return 'Open the service';
  if (url.startsWith('/settings/close')) return 'Open month close';
  if (url.startsWith('/settings/apps')) return 'Open connected apps';
  if (url.startsWith('/labor')) return 'Open labor';
  if (url.startsWith('/import')) return 'Open the import';
  if (url.startsWith('/log')) return 'Open the work log';
  return 'Open it';
}

/** True when the text of an alert holds every word of the search. */
export function matchesSearch(alert: AlertDTO, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${alert.title} ${alert.body} ${alert.entityLabel ?? ''} ${alert.nextStep ?? ''}`.toLowerCase();
  return words.every((word) => hay.includes(word));
}
