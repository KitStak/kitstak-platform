/**
 * Service context: every service function takes a `ServiceContext` as its first argument.
 * It carries the executor (db or transaction), the org scope and the acting user. Services
 * NEVER read org/user from anywhere else — this is what makes org isolation auditable.
 */
import { PgTransaction } from 'drizzle-orm/pg-core';
import { db as defaultDb, type Database, type Executor } from '@/server/db';
import type { OrgMembership } from '@/server/auth/session';
import type { OrgRole } from '@/server/rbac';

export interface AutomationActor {
  /** Automation currently executing (actions are attributed to it in the activity log). */
  readonly automationId: string;
  /** Nesting depth of automation-triggered mutations (loop guard). */
  readonly depth: number;
}

export interface ServiceContext {
  readonly db: Executor;
  readonly orgId: string;
  /** Acting user; `null` for system jobs (scheduled scans, seed). */
  readonly userId: string | null;
  readonly roles: readonly OrgRole[];
  readonly automation?: AutomationActor;
  /** When true, item events are not dispatched to the automations engine. */
  readonly skipAutomations?: boolean;
}

/** True for org roles that bypass board-level privacy (they can administer everything). */
export function isOrgAdmin(ctx: Pick<ServiceContext, 'roles'>): boolean {
  return ctx.roles.includes('owner') || ctx.roles.includes('admin');
}

export function isGuest(ctx: Pick<ServiceContext, 'roles'>): boolean {
  return ctx.roles.length > 0 && ctx.roles.every((role) => role === 'guest');
}

/** Build a service context from a `withApi` handler context. */
export function serviceContext(input: {
  readonly db?: Database;
  readonly org: OrgMembership;
  readonly user: { readonly id: string } | null;
}): ServiceContext {
  return {
    db: input.db ?? defaultDb,
    orgId: input.org.organization.id,
    userId: input.user?.id ?? null,
    roles: input.org.roles,
  };
}

/** Same context bound to a transaction executor. */
export function withExecutor(ctx: ServiceContext, executor: Executor): ServiceContext {
  return { ...ctx, db: executor };
}

/**
 * Run `fn` in a transaction. When the context is already inside a transaction, a SAVEPOINT
 * (nested transaction) is used so callers compose freely.
 */
export async function inTransaction<T>(
  ctx: ServiceContext,
  fn: (tx: ServiceContext) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction(async (tx) => fn(withExecutor(ctx, tx)));
}

type Thunks<T extends readonly unknown[]> = { readonly [K in keyof T]: () => PromiseLike<T[K]> };

/**
 * `Promise.all` that is safe on a transaction. A pooled executor runs the tasks concurrently
 * (separate connections), but a transaction owns a single connection, where overlapping
 * `client.query()` calls are deprecated in pg and will throw in pg@9 — so there the tasks run
 * one after another. Tasks are thunks because Drizzle builders start executing when awaited.
 */
export async function concurrently<T extends readonly unknown[]>(
  ctx: Pick<ServiceContext, 'db'>,
  tasks: readonly [...Thunks<T>],
): Promise<T> {
  if (!(ctx.db instanceof PgTransaction)) {
    return (await Promise.all(tasks.map((task) => task()))) as unknown as T;
  }
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as unknown as T;
}
