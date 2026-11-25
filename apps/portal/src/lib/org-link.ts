/**
 * Links that name their organization (review round 4). PURE: shared by the proxy and the switch
 * route.
 *
 * A person can be in two organizations. A link from a billing email, or from a banner in another
 * app, is about one of them, and it says which with `org=<organization id>`. The proxy sends such a
 * visit through `/org/switch`, which makes that organization the active one when the person is a
 * member, and then goes on to the page with the key taken out of the address. A person who is not
 * a member reads one plain sentence instead of the wrong organization's page.
 */
import { ORG_PARAM, orgParamValue } from '@kitstak/billing/links';

export const ORG_SWITCH_PATH = '/org/switch';
export const ORG_NOT_MEMBER_PATH = '/org/not-a-member';

/**
 * For a page request that names an organization: the switch address to go through. null when the
 * request names none, or is the switch route itself.
 */
export function orgSwitchRedirect(pathname: string, search: string): string | null {
  if (pathname === ORG_SWITCH_PATH || pathname === ORG_NOT_MEMBER_PATH) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get(ORG_PARAM);
  if (raw === null) return null;
  params.delete(ORG_PARAM);
  const rest = params.toString();
  const next = rest ? `${pathname}?${rest}` : pathname;
  const org = orgParamValue(raw);
  // A value that is not an organization id is simply dropped from the address.
  const out = new URLSearchParams(org ? { [ORG_PARAM]: org, next } : { next });
  return `${ORG_SWITCH_PATH}?${out.toString()}`;
}

/** The page the switch goes on to, with the organization put back, for the sign in round trip. */
export function withOrg(next: string, orgId: string): string {
  const queryAt = next.indexOf('?');
  const path = queryAt === -1 ? next : next.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : next.slice(queryAt + 1));
  params.set(ORG_PARAM, orgId);
  return `${path}?${params.toString()}`;
}
