/**
 * Authoritative permission checks (docs/crew/SPEC.md section 3). Every domain read and write
 * starts with `requireCrew`. The role rule itself is `resolveRole` in `@kitstak/crew-bridge`, so
 * Crew and every sibling app agree; this file only reads it for the current actor.
 */
import 'server-only';
import { cache } from 'react';
import { resolveCrewAccess, type CrewAccess } from '@kitstak/crew-bridge';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { forbidden } from '@/server/errors';
import { canCrew, canSelf, type CrewAction, type CrewRole } from '@/lib/permissions';
import type { DomainContext } from './_shared';

export type { CrewAccess };

/** Device, integration and system actors act as the workspace owner (Pulse rule). */
export const SYSTEM_ACCESS: CrewAccess = { role: 'owner', siteIds: null, canSeePay: true, canSeePrivate: true, source: 'explicit', linkedPersonId: null };

const resolve = cache((orgId: string, userId: string) => resolveCrewAccess(db, { orgId, userId }));

export const crewAccessFor = scoped(async function crewAccessFor(ctx: DomainContext): Promise<CrewAccess> {
  if (ctx.actorKind !== 'user') return SYSTEM_ACCESS;
  return resolve(ctx.orgId, ctx.userId);
});

/** Same as `crewAccessFor` with no per request memo (right after a claim or a role change). */
export const freshCrewAccess = scoped(async function freshCrewAccess(ctx: DomainContext): Promise<CrewAccess> {
  if (ctx.actorKind !== 'user') return SYSTEM_ACCESS;
  return resolveCrewAccess(db, { orgId: ctx.orgId, userId: ctx.userId });
});

export function accessDenied(role: CrewRole): Error {
  return forbidden(
    role === 'none'
      ? 'You do not have a Crew role yet. Ask an admin of your workspace to give you one.'
      : 'Your Crew role cannot do this. Ask an admin of your workspace if you need it.',
  );
}

/** Throws FORBIDDEN unless the actor may perform `action`. Returns the resolved access. */
export const requireCrew = scoped(async function requireCrew(ctx: DomainContext, action: CrewAction): Promise<CrewAccess> {
  const access = await crewAccessFor(ctx);
  if (!canCrew(access.role, action)) throw accessDenied(access.role);
  return access;
});

/** Self rights: any role, including none, when the user is linked to a live person (SPEC 3.3). */
/** Every self action (clock, read, request) needs the same thing, so there is one check. */
export const requireSelf = scoped(async function requireSelf(ctx: DomainContext): Promise<CrewAccess & { readonly linkedPersonId: string }> {
  const access = await crewAccessFor(ctx);
  if (!canSelf(access.linkedPersonId) || !access.linkedPersonId) throw forbidden('Your login is not linked to a person in Crew yet. Ask your supervisor to link it.');
  return { ...access, linkedPersonId: access.linkedPersonId };
});
