/**
 * Shared plumbing for domain modules: the actor passed to every read and write, and small
 * helpers. Domain functions are plain async functions; they never read request state themselves
 * (callers pass a `DomainContext`), so seeds, tests and route handlers reuse them.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import type { PulseContext } from '@/server/session';
import { db, type Executor, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { conflict, DomainError, invalid } from '@/server/errors';
import type { ActorKind } from '@/lib/constants';
import type { OrgRole } from '@/lib/permissions';
import { entryDateProblem, isTypedSource, type EntryDateKind } from '@/lib/entry-dates';

/** Who is acting, in which org. Built from the request (`toDomainContext`) or by scripts. */
export interface DomainContext {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly userId: string;
  readonly userName: string;
  readonly orgRole: OrgRole;
  /** `automation`, `integration` and `system` actors are treated as the workspace owner. */
  readonly actorKind: ActorKind;
}

export function toDomainContext(ctx: PulseContext): DomainContext {
  return {
    orgId: ctx.org.id,
    orgSlug: ctx.org.slug,
    userId: ctx.user.id,
    userName: ctx.user.name,
    orgRole: ctx.orgRole,
    actorKind: 'user',
  };
}

export const iso = (value: Date | string | null | undefined): string | null =>
  value ? (typeof value === 'string' ? new Date(value).toISOString() : value.toISOString()) : null;
export const isoRequired = (value: Date | string): string => (typeof value === 'string' ? new Date(value).toISOString() : value.toISOString());

/** Trim + collapse to null when empty. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "October" for 2026-10 or 2026-10-01. */
export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/**
 * The plain note for a month that is not over yet on month close and the month close pack (round
 * five, decision B): they count the whole month of company costs against the work so far, while
 * Home and Profit count only the days so far. Holds a month name, never money.
 */
export function fullMonthViewWords(month: string, hasCompanyCosts: boolean): string {
  const name = monthName(month);
  return hasCompanyCosts ? `Full month view: all of ${name}'s company costs, set against the work so far.` : `Full month view: ${name} is not over yet, so these are the numbers so far.`;
}

/** "October 2026" for 2026-10 or 2026-10-01: a month named with its year, so two Octobers never look alike. */
export function monthYear(month: string): string {
  return /^\d{4}-\d{2}/.test(month) ? `${monthName(month)} ${month.slice(0, 4)}` : monthName(month);
}
export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

/** The words every closed month refusal uses (SPEC 4.16). */
export function monthClosedError(month: string): DomainError {
  return conflict(`${monthYear(month)} is closed. Ask the owner to reopen it.`);
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
  cause?: unknown;
}

function pgError(error: unknown): PgErrorLike | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as PgErrorLike;
    if (typeof candidate.code === 'string' && candidate.code.length === 5) return candidate;
    current = candidate.cause;
  }
  return null;
}

const UNIQUE_MESSAGES: Readonly<Record<string, string>> = {
  production_entries_key: 'There is already an entry for this job, day, shift and labor class. Edit that one instead.',
  jobs_number_key: 'Another job already uses that number.',
  clients_code_key: 'Another client already uses that code.',
  clients_core_customer_key: 'Another client is already linked to that customer.',
  clients_crm_account_key: 'Another client is already linked to that CRM account.',
  job_types_code_key: 'Another job type already uses that code.',
  labor_classes_code_key: 'Another labor class already uses that code.',
  labor_rates_key: 'This labor class already has a rate that starts on that day. Edit that one instead.',
  items_sku_key: 'Another item already uses that SKU.',
  vas_services_code_key: 'Another service already uses that code.',
  sites_code_key: 'Another site already uses that code.',
  targets_key: 'There is already a goal for that scope, measure and month. Edit that one instead.',
  paid_hours_key: 'Paid hours are already entered for that day and labor class. Edit that row instead.',
  job_prices_job_from_key: 'This job already has a price that starts on that day.',
  job_links_job_target_key: 'This job is already linked to that record.',
  job_links_work_order_key: 'Another job is already linked to that work order.',
  job_links_project_time_key: 'Another job already imports time from that project.',
};

/** Turns database refusals (closed month, unique keys, bad references) into plain DomainErrors. */
export function toDomainError(error: unknown): unknown {
  if (error instanceof DomainError) return error;
  const pg = pgError(error);
  if (!pg) return error;
  if (pg.code === 'KP001') {
    const match = /month_closed:(\d{4}-\d{2})/.exec(pg.message ?? '');
    return monthClosedError(match?.[1] ?? '');
  }
  if (pg.code === '23505') {
    const message = pg.constraint ? UNIQUE_MESSAGES[pg.constraint] : undefined;
    if (pg.constraint?.endsWith('_source_ref_key')) return conflict('That row was already brought in from its source.');
    return conflict(message ?? 'That would create a duplicate. Check the code or number and try again.');
  }
  if (pg.code === '23503') return invalid('That points at a record that does not exist in this workspace.');
  if (pg.code === '23514') return invalid('One of the numbers is outside what Pulse can store. Check the amounts and try again.');
  if (pg.code === '22003') return invalid('One of the numbers is too large.');
  return error;
}

/** One transaction; database refusals come out as DomainErrors. Reuses `tx` when one is passed. */
export async function inTx<T>(fn: (tx: Transaction) => Promise<T>, existing?: Executor): Promise<T> {
  if (existing && existing !== db) return fn(existing as Transaction);
  try {
    return await db.transaction(fn);
  } catch (error) {
    throw toDomainError(error);
  }
}

/** Optimistic lock: the caller sends the version it read (SPEC section 5, "V"). */
export function assertVersion(current: number, expected: number | null | undefined): void {
  if (expected === null || expected === undefined) return;
  if (current !== expected) throw conflict('Someone else changed this row. Here is the new one.');
}

/** Cents for the wire: a JS number after a safe integer check (fails loudly otherwise). */
export function centsOut(value: bigint | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) throw new DomainError('INTERNAL', 'A money total is too large to show.');
  return n;
}

/** Cents for the wire, or null when the reader may not see money. */
export function moneyOut(show: boolean, value: bigint | number | string | null | undefined): number | null {
  return show ? centsOut(value) : null;
}

/** A decimal string for the wire, or null when hidden. */
export const hideUnless = <T>(show: boolean, value: T | null | undefined): T | null => (show ? (value ?? null) : null);

/** Today (YYYY-MM-DD) in an IANA time zone. Falls back to UTC for an unknown zone. */
export function todayInZone(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** `col = ANY(ARRAY[...]::uuid[])` with a safe empty case. */
export function uuidIn(column: SQL, ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`false`;
  return sql`${column} = ANY(${sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`})`;
}

/** A Postgres uuid[] literal from ids (empty array allowed). */
export function uuidArray(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}

export function dateArray(dates: readonly string[]): SQL {
  if (dates.length === 0) return sql`ARRAY[]::date[]`;
  return sql`ARRAY[${sql.join(
    dates.map((date) => sql`${date}`),
    sql`, `,
  )}]::date[]`;
}

/** Rows of a raw `execute`. */
export async function rows<T = Record<string, unknown>>(executor: Executor, query: SQL): Promise<T[]> {
  const result = await executor.execute(query);
  return result.rows as unknown as T[];
}

/** Keys that changed between two flat records (for activity before and after). */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const next = (after as Record<string, unknown>)[key];
    if (next === undefined) continue;
    const prev = before[key];
    if (normal(prev) !== normal(next)) {
      b[key] = jsonSafe(prev);
      a[key] = jsonSafe(next);
    }
  }
  return Object.keys(a).length > 0 ? { before: b, after: a } : null;
}

function normal(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return String(Number(value));
  return String(value);
}

/** Makes a row safe for a jsonb column (bigint to number or string, Date to ISO). */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = jsonSafe(inner);
    return out;
  }
  return value ?? null;
}

/** Drops `undefined` keys so a patch only touches what was sent. */
export function defined<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) out[key] = value;
  return out as Partial<T>;
}

/** The unit word for one unit: "kits" gives "kit", "boxes" gives "box", "assemblies" gives "assembly". */
export function singular(unitLabel: string | null | undefined): string {
  const word = (unitLabel ?? '').trim();
  if (!word) return 'unit';
  if (/ies$/i.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(xes|ses|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 2) return word.slice(0, -1);
  return word;
}

/**
 * Extra service entries with no price: work that earned nothing on paper. This is the one count
 * behind Home "Things to fix" and the month close checklist, so the two never disagree. It counts
 * entries on a job and entries put on a client with no job (most warehouse entries), and leaves
 * out deleted entries and the entries of a deleted job. With `from` and `to` it counts those days.
 * Without them it counts every month that is still open, because a closed month cannot be fixed.
 */
export const countServiceEntriesNoPrice = scoped(async function countServiceEntriesNoPrice(executor: Executor, orgId: string, scope: { readonly from?: string; readonly to?: string; readonly siteId?: string | null } = {}): Promise<number> {
  const dated = scope.from && scope.to;
  const [row] = await rows<{ n: number }>(
    executor,
    sql`SELECT count(*)::int AS n
          FROM pulse.vas_entries v LEFT JOIN pulse.jobs j ON j.id = v.job_id
         WHERE v.org_id = ${orgId} AND v.deleted_at IS NULL AND v.amount_cents IS NULL AND (v.job_id IS NULL OR j.deleted_at IS NULL)
           ${scope.siteId ? sql`AND v.site_id = ${scope.siteId}` : sql``}
           ${
             dated
               ? sql`AND v.work_date BETWEEN ${scope.from}::date AND ${scope.to}::date`
               : sql`AND NOT EXISTS (SELECT 1 FROM pulse.periods p WHERE p.org_id = v.org_id AND p.status = 'closed' AND p.period_month = date_trunc('month', v.work_date)::date)`
           }`,
  );
  return row?.n ?? 0;
}, 1);

/**
 * The one date rule for typed entries (`@/lib/entry-dates`): not after today at the site and not
 * more than 10 years before it. Checked when a row is new or its date changes (`before` is the
 * date the row has now), so an old row can still be fixed. Rows from another app keep their dates.
 * Throws VALIDATION with the note on `field`.
 */
export function assertEntryDate(kind: EntryDateKind, timezone: string, date: string, options: { readonly field?: string; readonly source?: string | null; readonly before?: string | null } = {}): void {
  if (!isTypedSource(options.source)) return;
  if (options.before && options.before === date) return;
  const problem = entryDateProblem(kind, date, todayInZone(timezone));
  if (problem) throw invalid(problem.message, { [options.field ?? 'workDate']: problem.field });
}
