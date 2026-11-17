/**
 * Shared plumbing for domain modules: the actor passed to every read and write, and small
 * helpers. Domain functions are plain async functions; they never read request state themselves
 * (callers pass a `DomainContext`), so seeds, tests and route handlers reuse them.
 */
import 'server-only';
import type { PulseContext } from '@/server/session';
import type { ActorKind } from '@/lib/constants';
import type { OrgRole } from '@/lib/permissions';

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

export const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);
export const isoRequired = (value: Date): string => value.toISOString();

/** Trim + collapse to null when empty. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
