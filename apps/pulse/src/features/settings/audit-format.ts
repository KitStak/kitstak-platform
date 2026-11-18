/**
 * Plain words for the audit log: what each recorded action is called, what kind of record it
 * touched, and how a before or after value reads. Pure: the page and the CSV export share it.
 */
import type { ActivityDTO } from '@/lib/types';

const THING: Readonly<Record<string, string>> = {
  alert: 'alert',
  alert_rule: 'alert rule',
  client: 'client',
  cost: 'cost',
  day: 'day',
  device: 'device link',
  device_link: 'device link',
  export: 'export',
  import: 'import',
  indirect: 'time not on a job',
  item: 'item',
  job: 'job',
  job_type: 'job type',
  labor_class: 'labor class',
  labor_rate: 'labor rate',
  link: 'link',
  material: 'material row',
  member_role: 'role',
  money_access: 'money access',
  note: 'note',
  paid_hours: 'paid hours',
  period: 'month',
  plan: 'plan',
  price: 'price',
  production: 'production entry',
  quote_scenario: 'quote',
  rate: 'labor rate',
  report: 'report',
  report_run: 'report',
  report_schedule: 'report schedule',
  revenue: 'revenue row',
  role: 'role',
  sample: 'sample data',
  scenario: 'quote',
  schedule: 'report schedule',
  service: 'extra service',
  service_entry: 'service entry',
  settings: 'settings',
  shared: 'shared cost',
  site: 'site',
  standard: 'target pace',
  target: 'goal',
  time_punch: 'time punch',
  view: 'saved view',
  data: 'data',
};

const DID: Readonly<Record<string, string>> = {
  created: 'Added',
  added: 'Added',
  logged: 'Logged',
  updated: 'Changed',
  edited: 'Changed',
  changed: 'Changed',
  revised: 'Changed',
  deleted: 'Deleted',
  removed: 'Removed',
  restored: 'Brought back',
  duplicated: 'Copied',
  status_changed: 'Changed the status of',
  completed: 'Marked complete',
  approved: 'Approved',
  sent_back: 'Sent back',
  closed: 'Closed',
  reopened: 'Reopened',
  committed: 'Saved',
  undone: 'Undid',
  run: 'Ran',
  downloaded: 'Downloaded',
  exported: 'Exported',
  revoked: 'Turned off',
  moved: 'Moved',
  loaded: 'Loaded',
  cleared: 'Removed',
  purged: 'Deleted all',
  became_job: 'Made a job from',
};

const SPECIAL: Readonly<Record<string, string>> = {
  'export.run': 'Downloaded a CSV file',
  'import.committed': 'Saved an import',
  'import.undone': 'Undid an import',
  'day.completed': 'Marked a day complete',
  'day.approved': 'Approved a day',
  'day.sent_back': 'Sent a day back',
  'period.closed': 'Closed a month',
  'period.reopened': 'Reopened a month',
  'role.changed': 'Changed a role',
  'money_access.changed': 'Changed who can see money',
  'settings.changed': 'Changed settings',
  'shared.moved': 'Shared cost moved',
  'note.added': 'Added a note',
  'sample.loaded': 'Loaded sample data',
  'sample.cleared': 'Removed sample data',
  'data.purged': 'Deleted all data',
  'price.changed': 'Changed a price',
  'rate.changed': 'Changed a labor rate',
  'plan.revised': 'Changed a plan',
  'job.status_changed': 'Changed a job status',
};

const article = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : word.endsWith('s') || word === 'time not on a job' || word === 'sample data' || word === 'money access' || word === 'shared cost' ? word : `a ${word}`);

/** What a kind of record is called, for example `job_type` reads "job type". */
export function thingLabel(entityType: string): string {
  return THING[entityType] ?? entityType.replace(/_/g, ' ');
}

/** "Changed a job", "Logged a production entry", "Closed a month". */
export function verbLabel(verb: string): string {
  const special = SPECIAL[verb];
  if (special) return special;
  const [thing = '', action = ''] = verb.split('.');
  const did = DID[action] ?? `${action.charAt(0).toUpperCase()}${action.slice(1).replace(/_/g, ' ')}`;
  return `${did} ${article(thingLabel(thing))}`.trim();
}

/** `unitsGood` reads "Units good", `default_labor_class_id` reads "Default labor class". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b(id|bp|cents)\b$/i, '')
    .trim()
    .toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : key;
}

/** A stored value as short plain text. Money (keys ending in Cents) reads as dollars and cents. */
export function valueText(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number' && /cents$/i.test(key)) return (value / 100).toFixed(2);
  if (typeof value === 'number' && /bp$/i.test(key)) return `${(value / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  if (typeof value === 'object') return JSON.stringify(value);
  // Stored decimals come with padding zeros ("31.5000"): show them the way a person types them.
  if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) return value.replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

export interface AuditChange {
  readonly key: string;
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The before and after of an audit row, field by field. */
export function auditChanges(row: Pick<ActivityDTO, 'before' | 'after'>): AuditChange[] {
  const before = asRecord(row.before);
  const after = asRecord(row.after);
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys.map((key) => ({
    key,
    label: fieldLabel(key),
    before: before && key in before ? valueText(key, before[key]) : null,
    after: after && key in after ? valueText(key, after[key]) : null,
  }));
}

/** One line that sums up the change: "Units good: 720 to 800". */
export function auditSummary(row: Pick<ActivityDTO, 'before' | 'after' | 'body' | 'meta' | 'verb'>): string {
  if (row.body) return row.body;
  const changes = auditChanges(row);
  if (changes.length === 0) {
    const meta = asRecord(row.meta);
    if (row.verb === 'export.run' && meta) return [meta.stream ? `File: ${String(meta.stream)}` : null, typeof meta.rows === 'number' ? `${meta.rows} rows` : null, meta.withMoney === false ? 'no money columns' : null].filter(Boolean).join(', ');
    return '';
  }
  return changes
    .slice(0, 4)
    .map((change) => (change.before !== null && change.after !== null ? `${change.label}: ${change.before} to ${change.after}` : `${change.label}: ${change.after ?? change.before ?? ''}`))
    .join('. ')
    .concat(changes.length > 4 ? `. And ${changes.length - 4} more.` : '');
}

/** Who did it, in words: a person, the system, a connected app, a rule or a shared screen. */
export function actorLabel(row: Pick<ActivityDTO, 'actor' | 'actorKind'>): string {
  if (row.actor?.name) return row.actor.name;
  if (row.actorKind === 'system') return 'Pulse';
  if (row.actorKind === 'integration') return 'A connected app';
  if (row.actorKind === 'automation') return 'An alert rule';
  if (row.actorKind === 'device') return 'A shared screen';
  return 'Someone who has left';
}

export const AUDIT_CSV_HEADERS = ['when', 'who', 'what', 'record_type', 'record_id', 'field', 'before', 'after', 'note'] as const;

/** One audit row as CSV cells, in the order of `AUDIT_CSV_HEADERS`. */
export function auditCsvRow(row: ActivityDTO): string[] {
  const before = asRecord(row.before);
  const after = asRecord(row.after);
  const side = (value: Record<string, unknown> | null): string =>
    value
      ? Object.entries(value)
          .map(([key, inner]) => `${fieldLabel(key)}: ${valueText(key, inner)}`)
          .join('; ')
      : '';
  return [row.createdAt, actorLabel(row), verbLabel(row.verb), thingLabel(row.entityType), row.entityId ?? '', row.field ?? '', side(before), side(after), row.body ?? ''];
}
