/**
 * Notification center model (bell + /notifications): effective severity, copy clean-up, type
 * groups and the list filters. Producers in other modules sometimes mark a wave with shortages as
 * "success"; the center never shows a green check for something that needs attention. PURE.
 */
import { z } from 'zod';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/** "1 jobs" -> "1 job", "19 shortage" -> "19 shortages" for the nouns producers use. */
const NOUNS = [
  'job',
  'unit',
  'order',
  'line',
  'item',
  'SKU',
  'task',
  'wave',
  'shortage',
  'pick',
  'LP',
  'location',
  'row',
  'record',
  'return',
  'error',
  'exception',
  'file',
  'label',
  'package',
] as const;
const SINGULAR_BY_PLURAL = new Map<string, string>(NOUNS.map((n) => [`${n}s`.toLowerCase(), n]));
const NOUN_SET = new Set<string>(NOUNS.map((n) => n.toLowerCase()));

export function fixPlurals(text: string): string {
  return text.replace(/\b(\d[\d,]*)\s+([A-Za-z]+)\b/g, (match, num: string, word: string) => {
    const n = Number(num.replace(/,/g, ''));
    const lower = word.toLowerCase();
    if (n === 1 && SINGULAR_BY_PLURAL.has(lower)) {
      const singular = word.slice(0, -1);
      return `${num} ${singular}`;
    }
    if (n !== 1 && NOUN_SET.has(lower)) return `${num} ${word}s`;
    return match;
  });
}

const ATTENTION =
  /\b([1-9][\d,]*)\s+(?:[A-Za-z]+\s+)?(?:shortages?|short|skipped|failed|failures?|exceptions?|errors?|rejected|missing|blocked)\b/i;
const ATTENTION_WORDS = /\b(?:could not|couldn't|unable to|failed to|no reserve stock|out of stock)\b/i;

/** Severity to show: success/info is raised to warning when the copy reports shortages, skips or failures. */
export function effectiveSeverity(
  severity: NotificationSeverity,
  title: string,
  body: string | null,
): NotificationSeverity {
  if (severity === 'warning' || severity === 'error') return severity;
  const text = `${title} ${body ?? ''}`;
  return ATTENTION.test(text) || ATTENTION_WORDS.test(text) ? 'warning' : severity;
}

/** "wave.completed" -> "wave"; the type filter groups by the first segment. */
export function kindGroup(kind: string): string {
  return (kind.split('.')[0] ?? kind).toLowerCase();
}

const GROUP_LABELS: Readonly<Record<string, string>> = {
  wave: 'Waves',
  return: 'Returns',
  import: 'Imports',
  export: 'Exports',
  feedback: 'Feedback',
  job: 'Jobs',
  order: 'Orders',
  receiving: 'Receiving',
  receipt: 'Receiving',
  count: 'Counts',
  integration: 'Integrations',
  shipment: 'Shipping',
  billing: 'Billing',
  system: 'System',
  eod: 'End of day',
  'work-order': 'Work orders',
  work_order: 'Work orders',
  workorder: 'Work orders',
  locations: 'Locations',
  location: 'Locations',
  replenishment: 'Replenishment',
  automation: 'Automation',
  workflow: 'Workflows',
  inventory: 'Inventory',
  kit: 'Kitting',
  cycle: 'Counts',
};

/** Fallback for an unlisted group slug: "cycle-count" reads "Cycle count", never a raw slug. */
function humanizeSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  if (!words) return 'Other';
  // Short all-letter slugs are acronyms ("sla" -> "SLA").
  if (/^[a-z]{2,3}$/i.test(words) && !/[aeiou]/i.test(words)) return words.toUpperCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function kindGroupLabel(group: string): string {
  return GROUP_LABELS[group] ?? GROUP_LABELS[group.toLowerCase()] ?? humanizeSlug(group);
}

export const NOTIFICATION_SEVERITY_FILTERS = ['all', 'attention', 'success', 'info'] as const;
export const NOTIFICATION_DATE_FILTERS = ['all', 'today', '7d', '30d'] as const;
export type NotificationDateFilter = (typeof NOTIFICATION_DATE_FILTERS)[number];

export const notificationFilterSchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  type: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z0-9_-]*$/i)
    .default(''),
  severity: z.enum(NOTIFICATION_SEVERITY_FILTERS).default('all'),
  since: z.enum(NOTIFICATION_DATE_FILTERS).default('all'),
});
export type NotificationFilter = z.output<typeof notificationFilterSchema>;

/** ISO lower bound for a date filter, or null for "all". */
export function sinceIso(since: NotificationDateFilter, now: Date = new Date()): string | null {
  if (since === 'all') return null;
  if (since === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  return new Date(now.getTime() - (since === '7d' ? 7 : 30) * 86_400_000).toISOString();
}

export function matchesSeverity(
  filter: NotificationFilter['severity'],
  severity: NotificationSeverity,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return severity === 'warning' || severity === 'error';
  return severity === filter;
}

export const notificationDeleteSchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(1000).optional(),
    /** Clear every read notification. */
    read: z.literal(true).optional(),
  })
  .refine((b) => (b.ids === undefined) !== (b.read === undefined), 'Send either ids or read: true');
export type NotificationDeleteSchemaOut = z.output<typeof notificationDeleteSchema>;
