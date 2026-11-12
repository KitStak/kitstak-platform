/**
 * Human-readable board activity: verb phrases per action and before / after value text.
 * Pure and client-safe.
 */
import type { ActivityDto, ColumnDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { labelsOf } from './filter-model';

const VERBS: Readonly<Record<string, string>> = {
  'item.created': 'created',
  'item.archived': 'archived',
  'item.deleted': 'deleted',
  'item.restored': 'restored',
  'item.renamed': 'renamed',
  'item.moved': 'moved',
  'item.reordered': 'reordered',
  'subitem.created': 'added a subitem to',
  'update.created': 'posted an update on',
  'update.deleted': 'deleted an update on',
  'file.uploaded': 'uploaded a file to',
  'board.created': 'created this board',
  'board.renamed': 'renamed the board',
  'board.updated': 'updated board settings',
  'column.created': 'added a column',
  'column.deleted': 'deleted a column',
  'column.settings_changed': 'changed column settings',
  'group.created': 'added a group',
  'group.deleted': 'deleted a group',
  'automation.created': 'created an automation',
  'automation.deleted': 'deleted an automation',
  'automation.enabled': 'turned on an automation',
  'automation.disabled': 'turned off an automation',
  'crm.lead_converted': 'converted a lead',
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function describeActivity(entry: ActivityDto, columnsByKey: ReadonlyMap<string, ColumnDto>): string {
  if (entry.action === 'item.value_changed') {
    const title = entry.columnKey ? (columnsByKey.get(entry.columnKey)?.title ?? entry.columnKey) : 'a value';
    return `changed ${title} on`;
  }
  const verb = VERBS[entry.action];
  if (verb) {
    const named = record(entry.after) ?? record(entry.before);
    if (entry.action.startsWith('column.') && typeof named?.title === 'string') return `${verb} “${named.title}”`;
    if (entry.action.startsWith('automation.') && typeof named?.name === 'string') return `${verb} “${named.name}”`;
    return verb;
  }
  return entry.action.replace(/[._]/g, ' ');
}

/** Text of a before / after value. Only value changes and renames show chips. */
export function valueText(
  value: unknown,
  column: ColumnDto | undefined,
  users: ReadonlyMap<string, Pick<UserSummaryDto, 'name'>>,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toLocaleString('en-US');
  if (typeof value === 'boolean') return value ? 'Checked' : 'Unchecked';
  const raw = record(value);
  if (!raw || !column) return '';
  if (typeof raw.labelId === 'string') return labelsOf(column).find((label) => label.id === raw.labelId)?.name ?? '';
  if (Array.isArray(raw.labelIds)) {
    const labels = labelsOf(column);
    return raw.labelIds.map((id) => labels.find((label) => label.id === id)?.name ?? '').filter(Boolean).join(', ');
  }
  if (Array.isArray(raw.ids)) return raw.ids.map((id) => users.get(String(id))?.name ?? '').filter(Boolean).join(', ');
  if (typeof raw.date === 'string') return raw.date;
  if (typeof raw.from === 'string') return `${raw.from} → ${String(raw.to ?? '')}`;
  if (typeof raw.amount === 'number') return `${raw.amount.toLocaleString('en-US')} ${String(raw.currency ?? '')}`.trim();
  for (const key of ['email', 'phone', 'url', 'address', 'text']) if (typeof raw[key] === 'string') return raw[key] as string;
  if (Array.isArray(raw.tags)) return raw.tags.join(', ');
  return '';
}

export function shouldShowValues(entry: Pick<ActivityDto, 'action'>): boolean {
  return entry.action === 'item.value_changed' || entry.action === 'item.renamed';
}

const RELATIVE = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

export function formatWhen(iso: string, now: number = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3_600) return RELATIVE.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return RELATIVE.format(Math.round(diff / 3_600), 'hour');
  if (abs < 604_800) return RELATIVE.format(Math.round(diff / 86_400), 'day');
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
