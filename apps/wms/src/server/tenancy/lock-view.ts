/**
 * What the WMS lock screen shows the signed-in person (docs/billing/SPEC.md section 9.3): the
 * organization whose plan does not include the WMS, with the words, the price and the links from
 * `planLockFor` in `@kitstak/billing`. Three ways lead here: an org whose warehouse exists but whose
 * plan no longer includes the WMS (`loadShellProps` redirects), a person none of whose orgs has
 * the WMS at all (the warehouse setup page redirects), and a signed in person who is in no
 * organization (the proxy's landing gate redirects).
 *
 * No loop (review round 4): the setup page sends a person here when it has nothing to show them.
 * So this page sends a person to the setup page only when that page WILL show something
 * (`setupHasSomethingToShow`). Every other answer is an end state that renders.
 */
import 'server-only';
import { headers } from 'next/headers';
import type { AppPlanView } from '@kitstak/billing/server';
import { getPlatformDb } from '@/server/api/db';
import { getWmsAuth } from '@/server/auth/auth';
import { getPlanView } from '@/server/auth/plan';
import { billingOnlyOrg, listWmsOrgs, openableOrgs, WMS_ORG_COOKIE, type WmsOrgChoice } from './registry';

export type LockView =
  | { readonly kind: 'signed_out' }
  /**
   * Signed in, but in no organization at all: a person right after they were removed from their
   * only organization, or one whose workspace step never finished. The screen says so and points
   * to the Portal, the same answer as in Projects and Pulse (review round 4).
   */
  | { readonly kind: 'no_org' }
  /**
   * In an organization, but there is no warehouse to open, none to set up and nothing to lock. A
   * rare mix of states. The screen says so and points to the Portal. It is an end state on purpose:
   * this page never sends such a person to the setup page, which would send them back here.
   */
  | { readonly kind: 'no_warehouse' }
  /** The person can open a warehouse after all: nothing to lock. */
  | { readonly kind: 'open' }
  /**
   * An org of theirs has the WMS but no warehouse yet: the setup page handles that. Only ever
   * answered when the setup page has something to show (`setupHasSomethingToShow`), so the two
   * pages can never send a person back and forth.
   */
  | { readonly kind: 'setup' }
  /** The person only manages billing for this organization: no seat, so no warehouse opens. */
  | { readonly kind: 'billing_only'; readonly orgName: string }
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

/**
 * PURE. True when the warehouse setup page has something to show this person: an organization of
 * theirs has the WMS in its plan and no warehouse yet. Then the page offers the setup form (owner or
 * admin), the plan words (owner or admin of a view only plan), or "ask an owner or admin" (member).
 * In every other case the setup page redirects to the lock screen, so the lock screen must not
 * send the person there.
 */
export function setupHasSomethingToShow(choices: readonly WmsOrgChoice[]): boolean {
  return choices.some((choice) => choice.entitled && choice.schemaName === null);
}

/**
 * PURE. The lock screen's answer for a person with no locked organization to show, or whose locked
 * organization has no lock words. Never 'setup' unless the setup page will render.
 */
export function restingView(choices: readonly WmsOrgChoice[]): LockView {
  if (choices.length === 0) return { kind: 'no_org' };
  if (openableOrgs(choices).length > 0) return { kind: 'open' };
  return setupHasSomethingToShow(choices) ? { kind: 'setup' } : { kind: 'no_warehouse' };
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
  // In no organization at all: one calm answer, the same in every app. Nothing to set up or lock.
  if (choices.length === 0) return { kind: 'no_org' };
  const preferred = [
    cookieValue(requestHeaders.get('cookie'), WMS_ORG_COOKIE),
    (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
  ];
  // A person who only manages billing has no seat: the lock screen says that, whatever the plan holds.
  const billing = billingOnlyOrg(choices, preferred);
  if (billing) return { kind: 'billing_only', orgName: billing.name };
  // Orgs whose plan does not include the WMS. The one the person last worked in comes first.
  const locked = choices.filter((choice) => !choice.entitled);
  if (locked.length === 0) return restingView(choices);
  const org = locked.find((choice) => preferred.includes(choice.orgId)) ?? locked[0];
  if (!org) return restingView(choices);
  // A person with another warehouse they can open, and no locked org they asked for, goes there.
  if (openableOrgs(choices).length > 0 && !preferred.includes(org.orgId)) return { kind: 'open' };

  const plan = await getPlanView(platformDb, { orgId: org.orgId, userId: session.user.id, role: org.memberRole });
  if (!plan.lock) return restingView(choices);
  return { kind: 'locked', orgName: org.name, lock: plan.lock, badges: plan.badges };
}
