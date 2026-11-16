/**
 * What the warehouse-setup page shows the signed-in user: organizations they may set up a
 * warehouse for (entitled, none yet, owner/admin) and whether they can already open one.
 */
import 'server-only';
import { headers } from 'next/headers';
import { getPlatformDb } from '@/server/api/db';
import { getWmsAuth } from '@/server/auth/auth';
import { listWmsOrgs, openableOrgs, setupCandidates } from './registry';

export interface SetupOffers {
  readonly signedIn: boolean;
  readonly offers: readonly { readonly orgId: string; readonly orgName: string }[];
  /** True when the user can already open at least one warehouse. */
  readonly hasWarehouse: boolean;
  /** Orgs that hold WMS but whose owner/admin has not set the warehouse up yet. */
  readonly waitingOn: readonly string[];
}

export async function loadSetupOffers(): Promise<SetupOffers> {
  const requestHeaders = await headers();
  const auth = await getWmsAuth();
  const session = await auth.api
    .getSession({ headers: requestHeaders, query: { disableCookieCache: true } })
    .catch(() => null);
  if (!session) return { signedIn: false, offers: [], hasWarehouse: false, waitingOn: [] };
  const choices = await listWmsOrgs(await getPlatformDb(), session.user.id);
  const offers = setupCandidates(choices).map((c) => ({ orgId: c.orgId, orgName: c.name }));
  const offered = new Set(offers.map((o) => o.orgId));
  return {
    signedIn: true,
    offers,
    hasWarehouse: openableOrgs(choices).length > 0,
    waitingOn: choices.filter((c) => c.entitled && !c.schemaName && !offered.has(c.orgId)).map((c) => c.name),
  };
}
