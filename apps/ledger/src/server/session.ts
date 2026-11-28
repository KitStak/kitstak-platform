/**
 * Request context for pages, server actions and route handlers: the signed-in user, their
 * active organization (session.activeOrganizationId when still a member, else the first org)
 * and their org role. Memoized per server render with React `cache`.
 *
 *  - `getContext()`            → LedgerContext | null (never redirects)
 *  - `requirePageContext(path)`→ redirects to /login?next=… when signed out, /no-workspace when org-less
 *  - `requireActionContext()`  → throws DomainError('UNAUTHENTICATED') (server actions)
 *  - `getApiContext(request)`  → same as getContext but from explicit headers (route handlers)
 */
import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { member, organization } from '@kitstak/db/schema';
import { auth, type AuthSession } from '@/server/auth';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';
import { DomainError } from '@/server/errors';
import { parseOrgRole, type OrgRole } from '@/lib/permissions';

export type Session = AuthSession;

export interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly role: OrgRole;
  /** The raw `core.member.role` string (a comma list), as billing reads it. */
  readonly roleString: string;
}

export interface ContextUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

export interface LedgerContext {
  readonly session: Session;
  readonly user: ContextUser;
  readonly org: OrgSummary;
  readonly orgRole: OrgRole;
  /** Every org the user is an active member of (org switcher). */
  readonly orgs: readonly OrgSummary[];
}

export async function getSessionFromHeaders(requestHeaders: Headers): Promise<Session | null> {
  return auth.api.getSession({ headers: requestHeaders });
}

export const getSession = cache(async (): Promise<Session | null> => getSessionFromHeaders(await headers()));

/** Active memberships, alphabetical (deactivated members excluded). */
export async function listUserOrgs(userId: string): Promise<OrgSummary[]> {
  // Runs before any workspace is known: it is how the workspace is found.
  const rows = await asSystem('sign in: list the workspaces of a person', () =>
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, userId))
      .orderBy(asc(organization.name)),
  );
  const out: OrgSummary[] = [];
  for (const row of rows) {
    const role = parseOrgRole(row.role);
    if (role) out.push({ id: row.id, name: row.name, slug: row.slug, logo: row.logo, role, roleString: row.role });
  }
  return out;
}

async function buildContext(session: Session | null): Promise<LedgerContext | null> {
  if (!session) return null;
  const orgs = await listUserOrgs(session.user.id);
  if (orgs.length === 0) return null;
  const activeId = session.session.activeOrganizationId;
  const org = orgs.find((candidate) => candidate.id === activeId) ?? orgs[0];
  return {
    session,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    org,
    orgRole: org.role,
    orgs,
  };
}

/** Current request's context, or null when signed out / not in any organization. */
export const getContext = cache(async (): Promise<LedgerContext | null> => buildContext(await getSession()));

/** Route handlers: context from the request's own headers (cookie). */
export async function getApiContext(request: Request): Promise<LedgerContext | null> {
  return buildContext(await getSessionFromHeaders(request.headers));
}

/** Pages/layouts: redirect to sign-in (preserving the target) or to the no-workspace screen. */
export async function requirePageContext(returnTo?: string): Promise<LedgerContext> {
  const session = await getSession();
  if (!session) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  const context = await getContext();
  if (!context) redirect('/no-workspace');
  return context;
}

/** Server actions: throw instead of redirecting (the action wrapper turns it into a result). */
export async function requireActionContext(): Promise<LedgerContext> {
  const context = await getContext();
  if (!context) throw new DomainError('UNAUTHENTICATED', 'Your session ended. Sign in again to keep working.');
  return context;
}
