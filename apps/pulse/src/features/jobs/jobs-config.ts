/**
 * What a jobs list view remembers (search, filters, sort, grouping, columns, layout) and how a
 * stored view is read back safely.
 */
import { PULSE_STATUSES, type PulseStatus } from '@/lib/constants';
import { DEFAULT_COLUMNS, JOB_COLUMNS, SORT_OPTIONS, type ColumnId, type SortKey } from './jobs-columns';

export type GroupKey = 'none' | 'client' | 'type' | 'site' | 'owner' | 'risk' | 'status';

export const GROUP_OPTIONS: readonly { readonly value: GroupKey; readonly label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'risk', label: 'Status' },
  { value: 'client', label: 'Client' },
  { value: 'type', label: 'Job type' },
  { value: 'site', label: 'Site' },
  { value: 'owner', label: 'Owner' },
  { value: 'status', label: 'Stage' },
];

/** Everything a saved view remembers. */
export interface JobsViewConfig {
  readonly q: string;
  readonly risk: readonly PulseStatus[];
  readonly clientId: string | null;
  readonly jobTypeId: string | null;
  readonly siteId: string | null;
  readonly ownerId: string | null;
  readonly dueFrom: string | null;
  readonly dueTo: string | null;
  readonly sort: SortKey;
  readonly dir: 'asc' | 'desc';
  readonly group: GroupKey;
  readonly columns: readonly ColumnId[];
  readonly layout: 'list' | 'board';
}

export const DEFAULT_VIEW: JobsViewConfig = { q: '', risk: [], clientId: null, jobTypeId: null, siteId: null, ownerId: null, dueFrom: null, dueTo: null, sort: 'worst', dir: 'asc', group: 'none', columns: DEFAULT_COLUMNS, layout: 'list' };

/** Reads a saved view (or anything shaped like one) into a full config, dropping what it does not know. */
export function toViewConfig(value: unknown): JobsViewConfig {
  const raw = (value ?? {}) as Partial<Record<keyof JobsViewConfig, unknown>>;
  const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const known = new Set<string>(JOB_COLUMNS.map((column) => column.id));
  const columns = Array.isArray(raw.columns) ? (raw.columns.filter((id) => typeof id === 'string' && known.has(id)) as ColumnId[]) : DEFAULT_VIEW.columns;
  return {
    q: typeof raw.q === 'string' ? raw.q : '',
    risk: Array.isArray(raw.risk) ? (raw.risk.filter((item) => (PULSE_STATUSES as readonly unknown[]).includes(item)) as PulseStatus[]) : [],
    clientId: text(raw.clientId),
    jobTypeId: text(raw.jobTypeId),
    siteId: text(raw.siteId),
    ownerId: text(raw.ownerId),
    dueFrom: text(raw.dueFrom),
    dueTo: text(raw.dueTo),
    sort: SORT_OPTIONS.some((option) => option.value === raw.sort) || known.has(String(raw.sort)) ? (raw.sort as SortKey) : 'worst',
    dir: raw.dir === 'desc' ? 'desc' : 'asc',
    group: GROUP_OPTIONS.some((option) => option.value === raw.group) ? (raw.group as GroupKey) : 'none',
    columns: columns.length > 0 ? columns : DEFAULT_VIEW.columns,
    layout: raw.layout === 'board' ? 'board' : 'list',
  };
}

