/**
 * The 17 CSV data streams (docs/pulse/SPEC.md section 7). Every stream can be imported from a
 * spreadsheet and exported in the same columns, so Pulse works with nothing else installed.
 * Pure catalog: ids, file names, on screen names and the needed columns. The engine lives in
 * src/lib/csv.ts and src/server/domain/imports.ts.
 */

export const STREAM_IDS = [
  'clients',
  'job_types',
  'jobs',
  'job_plans',
  'production',
  'labor_rates',
  'indirect_time',
  'paid_hours',
  'time_punches',
  'materials',
  'items',
  'costs',
  'revenue',
  'services',
  'services_done',
  'target_pace',
  'goals',
] as const;
export type StreamId = (typeof STREAM_IDS)[number];

export type StreamGroup = 'setup' | 'daily' | 'money';

export interface StreamInfo {
  readonly id: StreamId;
  /** Template and export file name. */
  readonly file: string;
  readonly name: string;
  /** One plain sentence: what one row of this file is. */
  readonly description: string;
  readonly group: StreamGroup;
  /** Columns a row cannot be saved without. */
  readonly needed: readonly string[];
  /** Carries money columns (dropped from exports for readers who cannot see money). */
  readonly hasMoney: boolean;
}

export const STREAM_GROUP_LABELS: Readonly<Record<StreamGroup, string>> = {
  setup: 'Set up once',
  daily: 'Every day',
  money: 'Money in and out',
};

export const STREAMS: readonly StreamInfo[] = [
  { id: 'clients', file: 'clients.csv', name: 'Clients', description: 'One row per client you do work for.', group: 'setup', needed: ['client_code', 'name'], hasMoney: true },
  { id: 'job_types', file: 'job_types.csv', name: 'Job types', description: 'One row per kind of work, like kitting or relabeling.', group: 'setup', needed: ['job_type_code', 'name'], hasMoney: true },
  { id: 'jobs', file: 'jobs.csv', name: 'Jobs', description: 'One row per job, with its client, price and planned units.', group: 'setup', needed: ['job_number', 'name', 'client_code'], hasMoney: true },
  { id: 'job_plans', file: 'job_plans.csv', name: 'Quotes and budgets', description: 'What you quoted or budgeted for a job, as totals or line by line.', group: 'setup', needed: ['job_number', 'plan'], hasMoney: true },
  { id: 'labor_rates', file: 'labor_rates.csv', name: 'Labor rates', description: 'The wage and extra costs behind the real cost of an hour, by labor class and start date.', group: 'setup', needed: ['labor_class_code', 'effective_from', 'wage_per_hour'], hasMoney: true },
  { id: 'items', file: 'items.csv', name: 'Items', description: 'One row per part or material, with its unit cost.', group: 'setup', needed: ['item_sku', 'name'], hasMoney: true },
  { id: 'services', file: 'services.csv', name: 'Services', description: 'One row per extra service you sell, with its price and target pace.', group: 'setup', needed: ['service_code', 'name'], hasMoney: true },
  { id: 'target_pace', file: 'target_pace.csv', name: 'Target pace', description: 'How many units one person should finish in an hour, by job type, client or service.', group: 'setup', needed: ['units_per_labor_hour', 'effective_from'], hasMoney: false },
  { id: 'goals', file: 'goals.csv', name: 'Goals', description: 'A target for margin, profit, revenue or pace, by month.', group: 'setup', needed: ['scope', 'metric', 'value'], hasMoney: true },
  { id: 'production', file: 'production.csv', name: 'Production', description: 'What got finished on a job on one day: units, people and hours.', group: 'daily', needed: ['work_date', 'job_number', 'units_good'], hasMoney: false },
  { id: 'indirect_time', file: 'indirect_time.csv', name: 'Other time', description: 'Paid time that was not on a job: meetings, cleanup, waiting.', group: 'daily', needed: ['work_date', 'reason', 'labor_hours'], hasMoney: false },
  { id: 'paid_hours', file: 'paid_hours.csv', name: 'Paid hours', description: 'Total hours you paid for on a day, from payroll.', group: 'daily', needed: ['work_date', 'paid_hours'], hasMoney: true },
  { id: 'time_punches', file: 'time_punches.csv', name: 'Time punches', description: 'One row per person per day from your time clock.', group: 'daily', needed: ['employee_id', 'work_date', 'hours'], hasMoney: true },
  { id: 'materials', file: 'materials.csv', name: 'Materials', description: 'Parts used or scrapped on a job on one day.', group: 'daily', needed: ['usage_date', 'job_number', 'item_sku', 'quantity_used', 'unit_cost'], hasMoney: true },
  { id: 'services_done', file: 'services_done.csv', name: 'Service entries', description: 'An extra service done for a client on one day.', group: 'daily', needed: ['work_date', 'client_code', 'service_code', 'quantity'], hasMoney: true },
  { id: 'costs', file: 'costs.csv', name: 'Costs', description: 'Any other cost for a job, a client or the company: freight, supplies, rent.', group: 'money', needed: ['cost_date', 'category', 'amount'], hasMoney: true },
  { id: 'revenue', file: 'revenue.csv', name: 'Revenue', description: 'Invoices, fees, adjustments and credits.', group: 'money', needed: ['revenue_date', 'kind', 'amount'], hasMoney: true },
];

const BY_ID: ReadonlyMap<string, StreamInfo> = new Map(STREAMS.map((stream) => [stream.id, stream]));

export function isStreamId(value: unknown): value is StreamId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function streamInfo(id: string): StreamInfo | null {
  return BY_ID.get(id) ?? null;
}
