/**
 * Shared plumbing for domain modules: the actor passed to every read and write, and small helpers.
 * Domain functions are plain async functions; they never read request state themselves (callers
 * pass a `DomainContext`), so seeds, tests and route handlers reuse them. Pulse pattern.
 */
import 'server-only';
import type { SQL } from 'drizzle-orm';
import type { CrewContext } from '@/server/session';
import { db, type Executor, type Transaction } from '@/server/db';
import { conflict, DomainError, invalid } from '@/server/errors';
import type { ActorKind } from '@/lib/constants';
import type { OrgRole } from '@/lib/permissions';

/** Who is acting, in which org. Built from the request (`toDomainContext`) or by scripts. */
export interface DomainContext {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly userId: string;
  readonly userName: string;
  readonly orgRole: OrgRole;
  /** `device`, `integration` and `system` actors are treated as the workspace owner. */
  readonly actorKind: ActorKind;
}

export function toDomainContext(ctx: CrewContext): DomainContext {
  return { orgId: ctx.org.id, orgSlug: ctx.org.slug, userId: ctx.user.id, userName: ctx.user.name, orgRole: ctx.orgRole, actorKind: 'user' };
}

/** Trim + collapse to null when empty. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

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
  sites_code_key: 'Another site already uses that code.',
  areas_code_key: 'Another area at this site already uses that code.',
  labor_classes_code_key: 'Another labor class already uses that code.',
  people_number_key: 'Another person already uses that number.',
  people_user_key: 'That login is already linked to another person.',
  people_badge_key: 'Another person already has that badge.',
  vendors_org_name_unique: 'Another vendor already has that name.',
};

/** Turns database refusals (unique keys, bad references, checks) into plain DomainErrors. */
export function toDomainError(error: unknown): unknown {
  if (error instanceof DomainError) return error;
  const pg = pgError(error);
  if (!pg) return error;
  if (pg.code === '23505') {
    const message = pg.constraint ? UNIQUE_MESSAGES[pg.constraint] : undefined;
    if (pg.constraint?.endsWith('_source_ref_key')) return conflict('That row was already brought in from its source.');
    return conflict(message ?? 'That would create a duplicate. Check the code or number and try again.');
  }
  if (pg.code === '23503') return invalid('That points at a record that does not exist in this workspace.');
  if (pg.code === '23514') return invalid('One of the values is outside what Crew can store. Check it and try again.');
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

/** Rows of a raw `execute`. */
export async function rows<T = Record<string, unknown>>(executor: Executor, query: SQL): Promise<T[]> {
  const result = await executor.execute(query);
  return result.rows as unknown as T[];
}

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
