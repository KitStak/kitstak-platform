/**
 * What the warehouse-setup page shows the signed-in user: organizations they may set up a
 * warehouse for (entitled, none yet, owner/admin) and whether they can already open one.
 */
import 'server-only';
import { headers } from 'next/headers';
import { getPlatformDb } from '@/server/api/db';
import { getWmsAuth } from '@/server/auth/auth';
import { getPlanView, portalUrl } from '@/server/auth/plan';
import { isSetupRole, listWmsOrgs, openableOrgs, setupCandidates } from './registry';

export interface SetupOffers {
  readonly signedIn: boolean;
  readonly offers: readonly { readonly orgId: string; readonly orgName: string }[];
  /** True when the user can already open at least one warehouse. */
  readonly hasWarehouse: boolean;
  /** Orgs that hold WMS but whose owner/admin has not set the warehouse up yet. */
  readonly waitingOn: readonly string[];
  /**
   * The first organization this person could set a warehouse up for, if its plan were not view
   * only (the trial ended, the plan ended, a payment is late). They are an owner or admin, so
   * "ask an owner or admin" would be a dead end: the page shows the plan words and the way to
   * fix it instead. null when there is none.
   */
  readonly needsPlan: {
    readonly orgName: string;
    /** The plan banner's words for this person ("Your free trial ended on Dec 7. ..."). */
    readonly text: string | null;
    /** The banner's button ("Pick a plan"), or null for a person who cannot manage billing. */
    readonly action: { readonly label: string; readonly href: string } | null;
  } | null;
  /** The Portal, for a way out of this page that always works. */
  readonly portalHref: string;
}

export async function loadSetupOffers(): Promise<SetupOffers> {
  const requestHeaders = await headers();
  const auth = await getWmsAuth();
  const session = await auth.api
    .getSession({ headers: requestHeaders, query: { disableCookieCache: true } })
    .catch(() => null);
  const portalHref = portalUrl();
  if (!session) return { signedIn: false, offers: [], hasWarehouse: false, waitingOn: [], needsPlan: null, portalHref };
  const platformDb = await getPlatformDb();
  const choices = await listWmsOrgs(platformDb, session.user.id);
  const offers = setupCandidates(choices).map((c) => ({ orgId: c.orgId, orgName: c.name }));
  const offered = new Set(offers.map((o) => o.orgId));
  // An owner or admin of a view only organization with no warehouse yet: setting one up is a
  // change, so it waits for a plan. The reader IS the owner, so the page must not say "ask an owner".
  const held = choices.find((c) => c.entitled && c.viewOnly === true && !c.schemaName && isSetupRole(c.memberRole));
  let needsPlan: SetupOffers['needsPlan'] = null;
  if (held) {
    const view = await getPlanView(platformDb, { orgId: held.orgId, userId: session.user.id, role: held.memberRole }).catch(() => null);
    needsPlan = {
      orgName: held.name,
      text: view?.notice?.text ?? null,
      action: view?.notice?.action ? { label: view.notice.action.label, href: view.notice.action.href } : null,
    };
  }
  return {
    signedIn: true,
    offers,
    hasWarehouse: openableOrgs(choices).length > 0,
    waitingOn: choices.filter((c) => c.entitled && !c.schemaName && !offered.has(c.orgId) && c.orgId !== held?.orgId).map((c) => c.name),
    needsPlan,
    portalHref,
  };
}
