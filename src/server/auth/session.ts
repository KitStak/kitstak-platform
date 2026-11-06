/**
 * Session & membership helpers for Server Components, Route Handlers and Server Actions.
 *
 * - `getSession()`         → session or null (memoized per request)
 * - `requireSession()`     → session or throws UnauthenticatedError (API) — use
 *                            `requirePageSession()` in pages to redirect to /login instead
 * - `requireOrgMember()`   → resolves the organization by id or slug and the caller's
 *                            membership, or throws NotFound (no existence leak) / Forbidden
 */
import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { member, organization } from '@/server/db/schema';
import { NotFoundError, UnauthenticatedError } from '@/server/http/errors';
import { clientIp } from '@/server/http/request';
import { type OrgRole, parseRoles, permissionsFor, primaryRole, type Permission } from '@/server/rbac';
import { auth, type AuthSession } from './auth';

export type Session = AuthSession;

export interface OrgMembership {
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly logo: string | null;
  };
  readonly memberId: string;
  readonly roles: readonly OrgRole[];
  readonly role: OrgRole;
  readonly permissions: readonly Permission[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Session from an explicit header set (route handlers pass `request.headers`). */
export async function getSessionFromHeaders(requestHeaders: Headers): Promise<Session | null> {
  return auth.api.getSession({ headers: requestHeaders });
}

/** Current request's session (memoized for the duration of a React server render). */
export const getSession = cache(async (): Promise<Session | null> => getSessionFromHeaders(await headers()));

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

/** For pages/layouts: redirects to /login (preserving the target) instead of throwing. */
export async function requirePageSession(returnTo?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return session;
}

/** Look up a user's membership of an org addressed by uuid or slug. Returns null when absent. */
export async function findOrgMembership(userId: string, orgIdOrSlug: string): Promise<OrgMembership | null> {
  const key = orgIdOrSlug.trim();
  const byId = isUuid(key);
  if (!byId && !SLUG_RE.test(key)) return null;

  const rows = await db
    .select({
      orgId: organization.id,
      orgName: organization.name,
      orgSlug: organization.slug,
      orgLogo: organization.logo,
      memberId: member.id,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), byId ? eq(organization.id, key) : eq(organization.slug, key)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const roles = parseRoles(row.role);
  const role = primaryRole(roles);
  if (!role) return null; // unknown role string: fail closed
  return {
    organization: { id: row.orgId, name: row.orgName, slug: row.orgSlug, logo: row.orgLogo },
    memberId: row.memberId,
    roles,
    role,
    permissions: permissionsFor(roles),
  };
}

/**
 * Require that the session user belongs to the organization. Non-members get NotFound so
 * that org ids/slugs cannot be probed.
 */
export async function requireOrgMember(
  orgIdOrSlug: string,
  session?: Session,
): Promise<{ session: Session; membership: OrgMembership }> {
  const current = session ?? (await requireSession());
  const membership = await findOrgMembership(current.user.id, orgIdOrSlug);
  if (!membership) throw new NotFoundError('Organization');
  return { session: current, membership };
}

/** Memoized per-render variant for layouts/pages (redirects when signed out, 404s on non-member). */
export const getPageOrgMembership = cache(
  async (orgSlug: string): Promise<{ session: Session; membership: OrgMembership } | null> => {
    const session = await getSession();
    if (!session) return null;
    const membership = await findOrgMembership(session.user.id, orgSlug);
    if (!membership) return null;
    // Org IP allow-list applies to pages as well as /api/v1 (throws ForbiddenError when blocked).
    const { enforceNetworkPolicy } = await import('@/server/services/admin-org');
    await enforceNetworkPolicy(membership.organization.id, clientIp(await headers()));
    return { session, membership };
  },
);
