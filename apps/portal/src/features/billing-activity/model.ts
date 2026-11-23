/**
 * The billing activity page, in words (docs/billing/SPEC.md section 8.6). PURE: no database, no
 * React. Which filter an action belongs to, how days are grouped, and how a row reads.
 */
import type { AuditAction } from '@kitstak/billing/server';

export type ActivityFilter = 'all' | 'payments' | 'plan' | 'emails';
export type ActivityKind = Exclude<ActivityFilter, 'all'>;

export const ACTIVITY_FILTERS: readonly { readonly id: ActivityFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'payments', label: 'Payments' },
  { id: 'plan', label: 'Plan changes' },
  { id: 'emails', label: 'Emails' },
];

/** Every audit action sits in exactly one group. A test below keeps this list complete. */
export const ACTION_KIND: Readonly<Record<AuditAction, ActivityKind>> = {
  'payment.succeeded': 'payments',
  'payment.failed': 'payments',
  'payment.retried': 'payments',
  'card.updated': 'payments',
  'payment.credit_used': 'payments',
  'checkout.duplicate_refunded': 'payments',
  'trial.started': 'plan',
  'trial.products_changed': 'plan',
  'cart.saved': 'plan',
  'checkout.started': 'plan',
  'checkout.expired': 'plan',
  'plan.started': 'plan',
  'plan.changed': 'plan',
  'cancel.scheduled': 'plan',
  'cancel.undone': 'plan',
  'pause.scheduled': 'plan',
  'pause.undone': 'plan',
  'plan.paused': 'plan',
  'plan.resumed': 'plan',
  'plan.ended': 'plan',
  'profile.updated': 'plan',
  'manager.added': 'plan',
  'manager.removed': 'plan',
  'signup.guided_requested': 'plan',
  'account.email_changed': 'plan',
  'test.tool': 'plan',
  'email.sent': 'emails',
};

export function isActivityFilter(value: string | undefined): value is ActivityFilter {
  return value === 'all' || value === 'payments' || value === 'plan' || value === 'emails';
}

export function actionsFor(filter: ActivityFilter): readonly AuditAction[] | null {
  if (filter === 'all') return null;
  return (Object.keys(ACTION_KIND) as AuditAction[]).filter((action) => ACTION_KIND[action] === filter);
}

/** An action this page does not know yet (a newer writer) still shows, as a plan change. */
export function kindOf(action: string): ActivityKind {
  return (ACTION_KIND as Readonly<Record<string, ActivityKind>>)[action] ?? 'plan';
}

export type ActivityTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

/** The color of a row's icon. Never color alone: the sentence carries the meaning. */
export function toneOf(action: string): ActivityTone {
  switch (action) {
    case 'payment.succeeded':
    case 'payment.retried':
    case 'plan.started':
    case 'plan.resumed':
    case 'cancel.undone':
    case 'pause.undone':
      return 'success';
    case 'payment.failed':
    case 'plan.ended':
      return 'danger';
    case 'cancel.scheduled':
    case 'pause.scheduled':
    case 'plan.paused':
    case 'checkout.expired':
      return 'warning';
    case 'email.sent':
    case 'test.tool':
      return 'neutral';
    default:
      return 'info';
  }
}

/** The invoice a row points at, when it is about one. */
export function invoiceIdOf(data: Readonly<Record<string, unknown>>): string | null {
  const value = data.invoiceId;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,120}$/.test(value) ? value : null;
}

/** 'YYYY-MM-DD' of a moment in a time zone. The key rows are grouped by. */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 'Today', 'Yesterday', or 'Dec 7, 2026'. */
export function dayLabel(date: Date, now: Date, timeZone: string): string {
  const key = dayKey(date, timeZone);
  if (key === dayKey(now, timeZone)) return 'Today';
  if (key === dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

/** '3:42 PM'. */
export function timeLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
}

export interface ActivityItem {
  readonly id: string;
  readonly at: Date;
  readonly actorLabel: string;
  readonly action: string;
  readonly summary: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ActivityDay {
  readonly key: string;
  readonly label: string;
  readonly items: readonly ActivityItem[];
}

/** Rows arrive newest first. Days keep that order. */
export function groupByDay(items: readonly ActivityItem[], now: Date, timeZone: string): ActivityDay[] {
  const days: { key: string; label: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.at, timeZone);
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(item);
    else days.push({ key, label: dayLabel(item.at, now, timeZone), items: [item] });
  }
  return days;
}

/** A cell for a CSV file. Quoted, and never able to start a formula in a spreadsheet. */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export const EMPTY_COPY: Readonly<Record<ActivityFilter, { title: string; body: string }>> = {
  all: { title: 'Nothing here yet.', body: 'Billing events will show up as they happen.' },
  payments: { title: 'No payments yet.', body: 'Payments, failed tries and card changes will show up here.' },
  plan: { title: 'No plan changes yet.', body: 'Trials, plan changes, pauses and cancels will show up here.' },
  emails: { title: 'No emails yet.', body: 'Every billing email we send will be listed here.' },
};
