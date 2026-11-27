/**
 * Landing gate for document requests: where a signed-in person must go BEFORE any page renders.
 *
 * Two cases used to be decided inside the (app) layout, after the cached shell had started to
 * render: a person whose organization has no warehouse yet (to `/setup-warehouse`) and an
 * organization whose plan does not include the WMS (to `/locked`). A redirect thrown there works,
 * but in development Next then logs "Could not validate `instant` because the target segment was
 * prevented from rendering" on every such open, which is the first thing a new trial does. The
 * proxy runs before rendering, so the same decision made here sends the browser straight to the
 * right screen, in one hop, with a clean console. The layout keeps its own redirect as a backstop
 * (client side navigations never pass through here).
 *
 * A failing lookup never blocks the page: the answer is then null and the page decides.
 */
import { getPlatformDb } from '@/server/api/db';

export const SETUP_PATH = '/setup-warehouse';
export const LOCKED_PATH = '/locked';

/** Pure: pages that take part in the gate. Auth pages, APIs and files are filtered by the proxy. */
export function isLandingGated(pathname: string): boolean {
  return pathname !== LOCKED_PATH;
}

/** Pure: the decision, from what the lookups found. Exported for tests. */
export function landingDecision(
  pathname: string,
  found:
    | { readonly kind: 'open'; readonly locked: boolean }
    | { readonly kind: 'no_warehouse'; readonly canSetUp: boolean; readonly anyEntitled: boolean }
    | { readonly kind: 'other' },
): string | null {
  if (found.kind === 'other') return null;
  if (found.kind === 'open') {
    if (pathname === SETUP_PATH) return null;
    if (found.locked) return LOCKED_PATH;
    return pathname === '/' ? '/dashboard' : null;
  }
  // No warehouse yet. An owner or admin sets one up; a member is told who can; an organization
  // without the WMS in its plan sees what it costs and how to add it.
  const target = found.canSetUp || found.anyEntitled ? SETUP_PATH : LOCKED_PATH;
  return target === pathname ? null : target;
}

/** One cookie's value from the request, or null. */
function cookieOf(headers: Headers, name: string): string | null {
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join('=')) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** The path a signed-in document request should be redirected to, or null to render as asked. */
export async function landingRedirectFor(pathname: string, headers: Headers): Promise<string | null> {
  if (!isLandingGated(pathname)) return null;
  try {
    const platform = await getPlatformDb();
    const { resolveSession } = await import('@/server/auth/session-store');
    const session = await resolveSession(platform, headers);
    if (session.ok) {
      if (pathname === SETUP_PATH) return null;
      const { wmsAccessForOrg } = await import('@/server/auth/entitlements');
      const locked = (await wmsAccessForOrg(platform, session.user.orgId)) === 'locked';
      return landingDecision(pathname, { kind: 'open', locked });
    }
    if (session.reason === 'unauthenticated') return landingDecision(pathname, { kind: 'other' });
    const { getWmsAuth } = await import('@/server/auth/auth');
    const { billingOnlyOrg, listWmsOrgs, WMS_ORG_COOKIE } = await import('@/server/tenancy/registry');
    const auth = await getWmsAuth();
    const current = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!current) return null;
    const choices = await listWmsOrgs(platform, current.user.id);
    // A person who only manages billing has no seat and no warehouse profile. Without this they
    // would land on the sign in form while signed in. The lock screen tells them, with a way back.
    const preferred = [cookieOf(headers, WMS_ORG_COOKIE), (current.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null];
    if (billingOnlyOrg(choices, preferred)) return LOCKED_PATH;
    if (session.reason !== 'no_warehouse') return landingDecision(pathname, { kind: 'other' });
    const canSetUp = (session.setup?.length ?? 0) > 0;
    const anyEntitled = canSetUp || choices.some((choice) => choice.entitled);
    return landingDecision(pathname, { kind: 'no_warehouse', canSetUp, anyEntitled });
  } catch {
    return null;
  }
}
