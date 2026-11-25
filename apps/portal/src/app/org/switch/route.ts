/**
 * Opens a link for the organization it is about (review round 4, see `@/lib/org-link`).
 *
 * `GET /org/switch?org=<organization id>&next=<page>`:
 *  - signed out: to sign in, and back to the same link afterwards,
 *  - a member of that organization: it becomes the active one, then on to the page,
 *  - not a member: one plain sentence (`/org/not-a-member`), never another organization's page.
 *
 * The organization is never taken on trust. `setActiveOrganization` in the shared sign in layer
 * checks the membership again, and every billing page still works on the session's organization.
 */
import { NextResponse } from 'next/server';
import { orgParamValue, ORG_PARAM } from '@kitstak/billing/links';
import { ORG_NOT_MEMBER_PATH, withOrg } from '@/lib/org-link';
import { safeNextPath } from '@/lib/routes';
import { auth } from '@/server/auth';
import { isActiveOrgMember } from '@/server/orgs';
import { getSessionFromHeaders } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function to(request: Request, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'), '/');
  const orgId = orgParamValue(url.searchParams.get(ORG_PARAM));
  if (!orgId) return to(request, next);

  const session = await getSessionFromHeaders(request.headers);
  if (!session) return to(request, `/login?next=${encodeURIComponent(withOrg(next, orgId))}`);

  if (!(await isActiveOrgMember(session.user.id, orgId))) return to(request, ORG_NOT_MEMBER_PATH);
  if (session.session.activeOrganizationId === orgId) return to(request, next);

  try {
    const switched = await auth.api.setActiveOrganization({
      body: { organizationId: orgId },
      headers: request.headers,
      returnHeaders: true,
    });
    const response = to(request, next);
    // The sign in layer may refresh the session cookie here. Hand its cookies to the browser.
    for (const line of switched.headers.getSetCookie()) response.headers.append('Set-Cookie', line);
    return response;
  } catch (error: unknown) {
    console.error('[portal] could not switch to the organization a link named', error instanceof Error ? error.message : error);
    return to(request, ORG_NOT_MEMBER_PATH);
  }
}
