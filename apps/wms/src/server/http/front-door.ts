/**
 * One front door (billing review round 4): where a signed out visit to the WMS goes.
 *
 * KitStak has one sign in page, the Portal's. It is the only one with every way in (password,
 * emailed code, Google, Microsoft) and the one place a password is reset. A signed out person who
 * opens the WMS is sent there with the full WMS address they asked for, and comes back signed in.
 *
 * The WMS keeps its own sign in page for four cases, and only these:
 *  - the warehouse turned on company single sign on (Apps, Single sign-on): that button lives here,
 *  - `sso_error`: the single sign on callback came back with something to say,
 *  - `?local=1`: tests, and the day the Portal is down,
 *  - the Portal sent the person here already signed in (`from=portal`), or the browser holds a
 *    valid KitStak session the WMS itself refuses (an inactive warehouse user): going back to the
 *    Portal would only bounce them here again.
 *
 * The decision is made in the proxy, before any page renders, like the landing gate.
 */
import {
  FROM_PORTAL_PARAM,
  FROM_PORTAL_VALUE,
  LOCAL_SIGN_IN_PARAM,
  portalForgotPasswordUrl,
  portalSignInUrl,
  safeAppPath,
} from '@kitstak/auth/front-door';

export const LOGIN_PATH = '/login';
export const FORGOT_PASSWORD_PATH = '/forgot-password';

export interface FrontDoorFacts {
  /** The browser holds a KitStak session the shared sign in layer accepts. */
  readonly hasValidSession: boolean;
  /** Company single sign on is switched on for this warehouse. */
  readonly ssoEnabled: boolean;
  readonly portalUrl: string | null | undefined;
  /** The WMS's own address. */
  readonly appUrl: string;
}

/** PURE. The Portal address to send this page request to, or null to render the WMS page. */
export function frontDoorDecision(pathname: string, params: URLSearchParams, facts: FrontDoorFacts): string | null {
  if (pathname === FORGOT_PASSWORD_PATH) return portalForgotPasswordUrl(facts.portalUrl, facts.appUrl);
  if (pathname !== LOGIN_PATH) return null;
  if (params.get(LOCAL_SIGN_IN_PARAM) === '1' || params.get(FROM_PORTAL_PARAM) === FROM_PORTAL_VALUE) return null;
  if (params.has('sso_error')) return null;
  if (facts.ssoEnabled || facts.hasValidSession) return null;
  return portalSignInUrl({
    portalUrl: facts.portalUrl,
    appUrl: facts.appUrl,
    next: params.get('next') ?? params.get('returnTo'),
    // The WMS signs a person out after a long time away (`reason=idle`). The Portal says so.
    notice: params.get('reason') === 'idle' ? 'idle' : params.get('notice'),
  });
}

/** True for the two paths this gate looks at. Everything else skips the lookups. */
export function isFrontDoorPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === FORGOT_PASSWORD_PATH;
}

/**
 * The redirect for a document request (a Portal address, or a path inside the WMS), or null. A failing lookup never blocks the page: single
 * sign on then counts as off and the session as missing, which sends the person to the Portal,
 * where every way in still works.
 */
export async function frontDoorRedirectFor(pathname: string, params: URLSearchParams, headers: Headers, hasSessionCookie: boolean): Promise<string | null> {
  if (!isFrontDoorPath(pathname)) return null;
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL?.trim() || null;
  const appUrl = process.env.BETTER_AUTH_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000';
  let ssoEnabled = false;
  let hasValidSession = false;
  // The Portal sent a signed in person here on their way to a WMS page. When the WMS opens for
  // them, go straight on to that page: they never see a sign in form while signed in.
  if (pathname === LOGIN_PATH && hasSessionCookie && params.get(FROM_PORTAL_PARAM) === FROM_PORTAL_VALUE) {
    try {
      const { getPlatformDb } = await import('@/server/api/db');
      const { resolveSession } = await import('@/server/auth/session-store');
      if ((await resolveSession(await getPlatformDb(), headers)).ok) {
        const next = safeAppPath(params.get('next'));
        // Never back to this page itself.
        return next && !next.startsWith(LOGIN_PATH) ? next : '/';
      }
    } catch {
      // Not resolvable: the sign in page below is the answer.
    }
  }
  if (pathname === LOGIN_PATH) {
    try {
      const { getPlatformDb } = await import('@/server/api/db');
      const { ssoPublicStatus } = await import('@/server/repositories/apps-sso');
      ssoEnabled = (await ssoPublicStatus(await getPlatformDb())).enabled;
    } catch {
      ssoEnabled = false;
    }
    if (hasSessionCookie) {
      try {
        const { getWmsAuth } = await import('@/server/auth/auth');
        const auth = await getWmsAuth();
        hasValidSession = (await auth.api.getSession({ headers, query: { disableCookieCache: true } })) !== null;
      } catch {
        hasValidSession = false;
      }
    }
  }
  return frontDoorDecision(pathname, params, { hasValidSession, ssoEnabled, portalUrl, appUrl });
}
