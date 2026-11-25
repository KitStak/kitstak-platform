/**
 * Who is asking, for which org, and what they may do in billing (docs/billing/CONTRACTS.md section
 * 16.2). Every billing page and server action starts here. The org is always the session's active
 * org, never an id from the browser.
 */
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { member } from '@kitstak/db/schema';
import {
  getBillingAccess,
  type BillingAccess,
  type BillingActor,
  type BillingRuntime,
} from '@kitstak/billing/server';
import { billingRuntime } from '@/server/billing/runtime';
import { db } from '@/server/db';
import { resolveActiveOrg, type OrgSummary } from '@/server/orgs';
import { getSession, signInRedirectPath, type Session } from '@/server/session';

export interface BillingContext {
  readonly rt: BillingRuntime;
  readonly session: Session;
  /** The session's active org, never an id from the client. */
  readonly org: OrgSummary;
  readonly access: BillingAccess;
  readonly actor: BillingActor;
  readonly emailVerified: boolean;
  /** user.timezone or 'UTC'. */
  readonly timeZone: string;
}

function safeTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

/** null when signed out or when the user has no org. React cache()d per request. */
export const getBillingContext = cache(async (): Promise<BillingContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const org = await resolveActiveOrg(session);
  if (!org) return null;

  // `OrgSummary.role` is only the first role. Access rules need the whole stored string.
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, session.user.id)));
  if (!membership) return null;

  const rt = billingRuntime();
  const access = await getBillingAccess(rt.db, { orgId: org.id, userId: session.user.id, role: membership.role });
  return {
    rt,
    session,
    org,
    access,
    actor: { userId: session.user.id, label: session.user.name?.trim() || session.user.email },
    emailVerified: session.user.emailVerified === true,
    timeZone: safeTimeZone((session.user as { timezone?: unknown }).timezone),
  };
});

/** For pages: redirects to /login?next= or to /welcome when there is no org. */
export async function requireBillingContext(returnTo: string): Promise<BillingContext> {
  const session = await getSession();
  // The page that was asked for, with its query (`?fix=payment`, `?add=projects`), not only `returnTo`.
  if (!session) redirect(await signInRedirectPath(returnTo));
  const context = await getBillingContext();
  if (!context) redirect('/welcome');
  return context;
}
