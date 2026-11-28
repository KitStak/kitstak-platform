/**
 * Shared plumbing for domain modules: the actor passed to every read and write. Domain functions
 * never read request state themselves (callers pass a `DomainContext`), so seeds, tests and route
 * handlers reuse them. Every export of a domain module is wrapped in `scoped(...)`.
 */
import 'server-only';
import type { LedgerContext } from '@/server/session';
import type { OrgRole } from '@/lib/permissions';

export type ActorKind = 'user' | 'system' | 'integration' | 'automation' | 'customer';

/** Who is acting, in which org. Built from the request (`toDomainContext`) or by scripts. */
export interface DomainContext {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly userId: string;
  readonly userName: string;
  readonly orgRole: OrgRole;
  readonly actorKind: ActorKind;
}

export function toDomainContext(ctx: LedgerContext): DomainContext {
  return {
    orgId: ctx.org.id,
    orgSlug: ctx.org.slug,
    userId: ctx.user.id,
    userName: ctx.user.name,
    orgRole: ctx.orgRole,
    actorKind: 'user',
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/** The actor's user id for `*_by` columns: null for system actors (no user row). */
export function actorUserId(ctx: Pick<DomainContext, 'actorKind' | 'userId'>): string | null {
  return ctx.actorKind === 'user' && isUuid(ctx.userId) ? ctx.userId : null;
}

interface PgErrorLike {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly cause?: unknown;
}

/** The Postgres error code and constraint of an error (Drizzle wraps the driver error in `cause`). */
export function pgError(error: unknown): { code: string | null; constraint: string | null } {
  const raw = error as PgErrorLike | null;
  const found = (raw && typeof raw.code === 'string' ? raw : (raw?.cause as PgErrorLike | undefined)) ?? raw;
  return {
    code: typeof found?.code === 'string' ? found.code : null,
    constraint: typeof found?.constraint === 'string' ? found.constraint : null,
  };
}

/** Trims text and turns an empty string into null, for optional text columns. */
export function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
