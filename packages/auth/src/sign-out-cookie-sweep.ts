/**
 * Sign-out cookie sweep (2026-11-13 logout incident).
 *
 * Better Auth expires the auth cookies with the attributes it is CURRENTLY configured
 * with. If the configured cookie Domain and the Domain a live cookie was originally
 * set with disagree — e.g. `AUTH_COOKIE_DOMAIN` drifted out of one deployment's env,
 * or sessions were issued during such a window — the expiry doesn't match the cookie,
 * the browser keeps it, and "Log out" silently no-ops (the login page then bounces the
 * still-authenticated user straight back into the app).
 *
 * This after-hook makes sign-out scope-exhaustive: it additionally expires every auth
 * cookie (and any chunked `name.N` variants present on the request) host-only AND for
 * each parent domain derived from the request `Host`, skipping the scope the configured
 * expiry already covered. Expiring a cookie that doesn't exist is a no-op, so the extra
 * `Set-Cookie` entries are harmless; browsers reject the ones whose Domain they would
 * not have accepted a cookie for in the first place.
 */
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';

const SIGN_OUT_PATH = '/sign-out';
const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Parent domains of a request host that a cookie of this app could plausibly have been
 * scoped to: `crm.kitstak.app` → `['crm.kitstak.app', 'kitstak.app']`. Hosts that can't
 * carry a Domain attribute (localhost, IP literals) yield none.
 */
export function cookieDomainCandidates(hostHeader: string | null): readonly string[] {
  if (!hostHeader) return [];
  const host = (hostHeader.split(':')[0] ?? '').trim().toLowerCase();
  if (!host || host === 'localhost' || IPV4_HOST.test(host) || hostHeader.includes('::')) return [];
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return [];
  const candidates: string[] = [];
  for (let index = 0; index < labels.length - 1; index += 1) {
    candidates.push(labels.slice(index).join('.'));
  }
  return candidates;
}

/** Cookie names present on the request (used to find chunked `name.N` variants). */
function requestCookieNames(cookieHeader: string | null): readonly string[] {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(';')
    .map((part) => (part.split('=')[0] ?? '').trim())
    .filter((name) => name.length > 0);
}

export function signOutCookieSweepPlugin(): BetterAuthPlugin {
  return {
    id: 'kitstak-sign-out-cookie-sweep',
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === SIGN_OUT_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const { sessionToken, sessionData, dontRememberToken } = ctx.context.authCookies;
            const presentNames = requestCookieNames(ctx.headers?.get('cookie') ?? null);
            const hostDomains = cookieDomainCandidates(ctx.headers?.get('host') ?? null);

            for (const cookie of [sessionToken, sessionData, dontRememberToken]) {
              const { domain, ...hostOnlyAttributes } = cookie.attributes;
              const configuredDomain = domain?.replace(/^\./, '').toLowerCase();
              // The scopes Better Auth's own expiry did NOT cover.
              const missingScopes: (string | undefined)[] = [
                ...(configuredDomain ? [undefined] : []),
                ...hostDomains.filter((candidate) => candidate !== configuredDomain),
              ];
              const names = [
                cookie.name,
                ...presentNames.filter((name) => name.startsWith(`${cookie.name}.`)),
              ];
              for (const name of names) {
                for (const scope of missingScopes) {
                  ctx.setCookie(name, '', {
                    ...hostOnlyAttributes,
                    ...(scope ? { domain: scope } : {}),
                    maxAge: 0,
                  });
                }
              }
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
