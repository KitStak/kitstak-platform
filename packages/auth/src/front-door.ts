/**
 * One front door (billing review round 4). PURE and edge safe: no imports.
 *
 * KitStak has one sign in page: the Portal's. It is the only one with every way in (password,
 * emailed code, Google, Microsoft) and the only place a password is reset. Before, each app had a
 * sign in page of its own with a password field only, so a person who signed up with a code could
 * not get into the CRM, the WMS, Projects or Pulse from a link.
 *
 * Every app builds the address of that page here, with the full address of the page the person
 * asked for in `next`. The Portal only goes back to an address on one of the trusted origins
 * (`safeReturnUrl` in the Portal), so the door can never be used to send a person somewhere else.
 */

/** Control characters, whitespace and backslashes never belong in a path a redirect goes to. */
const UNSAFE = /[\u0000- \u007f\\]/;

/** A path inside one app: one leading slash, nothing a browser could read as another host. */
export function safeAppPath(path: string | null | undefined): string | null {
  if (!path || path.length > 1500) return null;
  if (UNSAFE.test(path)) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}

function origin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Notices an app may hand to the Portal sign in page. Anything else is dropped. */
export const FRONT_DOOR_NOTICES = ['signed-out', 'password-reset', 'idle'] as const;
export type FrontDoorNotice = (typeof FRONT_DOOR_NOTICES)[number];

export function frontDoorNotice(value: string | null | undefined): FrontDoorNotice | null {
  return (FRONT_DOOR_NOTICES as readonly string[]).includes(value ?? '') ? (value as FrontDoorNotice) : null;
}

/**
 * The Portal sign in page for a person who was on their way to `next` inside the app at `appUrl`.
 * null when the Portal address is missing or is this very app: the app then shows its own form.
 */
export function portalSignInUrl(input: {
  readonly portalUrl: string | null | undefined;
  /** This app's own address. */
  readonly appUrl: string;
  /** The page inside this app the person asked for. Default: the app's front page. */
  readonly next?: string | null;
  readonly notice?: string | null;
}): string | null {
  const portal = input.portalUrl ? origin(input.portalUrl) : null;
  const app = origin(input.appUrl);
  if (!portal || !app || portal === app) return null;
  const path = safeAppPath(input.next) ?? '/';
  const params = new URLSearchParams({ next: `${app}${path}` });
  const notice = frontDoorNotice(input.notice);
  if (notice) params.set('notice', notice);
  return `${portal}/login?${params.toString()}`;
}

/** The Portal's "Forgot password" page: the one place a password is reset. null as above. */
export function portalForgotPasswordUrl(portalUrl: string | null | undefined, appUrl: string): string | null {
  const portal = portalUrl ? origin(portalUrl) : null;
  const app = origin(appUrl);
  if (!portal || !app || portal === app) return null;
  return `${portal}/forgot-password`;
}

/**
 * Marks a visit to an app's own `/login` as "the Portal sent me, already signed in". The app then
 * never sends the person back to the Portal, so the two can not bounce a person between them when
 * the app does not see the session the Portal sees (a cookie that is not shared, or an account the
 * app itself refuses).
 */
export const FROM_PORTAL_PARAM = 'from';
export const FROM_PORTAL_VALUE = 'portal';
/** `?local=1`: this app's own sign in form, for tests and for the day the Portal is down. */
export const LOCAL_SIGN_IN_PARAM = 'local';

/** True when an app must show its own sign in form instead of going to the Portal. */
export function staysOnLocalSignIn(params: Readonly<Record<string, string | string[] | undefined>>): boolean {
  return params[LOCAL_SIGN_IN_PARAM] === '1' || params[FROM_PORTAL_PARAM] === FROM_PORTAL_VALUE;
}

/**
 * For the Portal: where to send a person who is ALREADY signed in and asked for `target`, an
 * address on another KitStak app. It goes through that app's own `/login`, marked as coming from
 * the Portal. When the app sees the session it goes straight on to the page. When it does not, it
 * shows its own form and stops there. `target` must already be a trusted absolute address.
 */
export function appEntryUrl(target: string): string {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return target;
  }
  const params = new URLSearchParams({ [FROM_PORTAL_PARAM]: FROM_PORTAL_VALUE });
  const path = `${url.pathname}${url.search}`;
  if (path !== '/' && path !== '') params.set('next', path);
  return `${url.origin}/login?${params.toString()}`;
}
