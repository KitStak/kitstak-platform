/**
 * What the WMS lock screen shows the signed-in person (docs/billing/SPEC.md section 9.3): the
 * organization whose plan does not include the WMS, with the words, the price and the links from
 * `planLockFor` in `@kitstak/billing`. Two ways lead here: an org whose warehouse exists but whose
 * plan no longer includes the WMS (`loadShellProps` redirects), and a person none of whose orgs has
 * the WMS at all (the warehouse setup page redirects).
 */
import 'server-only';
import { headers } from 'next/headers';
import type { AppPlanView } from '@kitstak/billing/server';
import { getPlatformDb } from '@/server/api/db';
import { getWmsAuth } from '@/server/auth/auth';
import { getPlanView } from '@/server/auth/plan';
import { listWmsOrgs, openableOrgs, WMS_ORG_COOKIE } from './registry';

export type LockView =
  | { readonly kind: 'signed_out' }
  /** The person can open a warehouse after all: nothing to lock. */
  | { readonly kind: 'open' }
  /** An org of theirs has the WMS but no warehouse yet: the setup page handles that. */
  | { readonly kind: 'setup' }
  | {
      readonly kind: 'locked';
      readonly orgName: string;
      readonly lock: NonNullable<AppPlanView['lock']>;
      readonly badges: AppPlanView['badges'];
    };

function cookieValue(cookieHeader: string | null, name: string): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('=')) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function loadLockView(): Promise<LockView> {
  const requestHeaders = await headers();
  const auth = await getWmsAuth();
  const session = await auth.api
    .getSession({ headers: requestHeaders, query: { disableCookieCache: true } })
    .catch(() => null);
  if (!session) return { kind: 'signed_out' };

  const platformDb = await getPlatformDb();
  const choices = await listWmsOrgs(platformDb, session.user.id);
  // Orgs whose plan does not include the WMS. The one the person last worked in comes first.
  const locked = choices.filter((choice) => !choice.entitled);
  if (locked.length === 0) return openableOrgs(choices).length > 0 ? { kind: 'open' } : { kind: 'setup' };
  const preferred = [
    cookieValue(requestHeaders.get('cookie'), WMS_ORG_COOKIE),
    (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
  ];
  const org = locked.find((choice) => preferred.includes(choice.orgId)) ?? locked[0];
  if (!org) return { kind: 'setup' };
  // A person with another warehouse they can open, and no locked org they asked for, goes there.
  if (openableOrgs(choices).length > 0 && !preferred.includes(org.orgId)) return { kind: 'open' };

  const plan = await getPlanView(platformDb, { orgId: org.orgId, userId: session.user.id, role: org.memberRole });
  if (!plan.lock) return openableOrgs(choices).length > 0 ? { kind: 'open' } : { kind: 'setup' };
  return { kind: 'locked', orgName: org.name, lock: plan.lock, badges: plan.badges };
}
