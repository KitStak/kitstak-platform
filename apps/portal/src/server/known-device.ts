/**
 * "This browser signed in to this account before" (billing review round 5).
 *
 * At every new session the Portal adds the person's id to a signed cookie (and once for a session
 * that was already running when this was added, the next time it is read). The cookie gives no
 * access to anything. It only moves a request for an email code, and a try at one, onto counters
 * that strangers cannot fill (`@kitstak/billing/server` code-limits.ts). So nobody can lock the
 * owner of an account out of it by asking for codes, or guessing codes, in their name.
 *
 * The value is the ids and an HMAC of them with the auth secret, so it cannot be made up. It names
 * at most a few people, because a browser can be shared. It is HttpOnly and lasts a year.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';

export const KNOWN_DEVICE_COOKIE = 'kitstak.known_device';
const MAX_PEOPLE = 5;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(secret: string, ids: readonly string[]): string {
  return createHmac('sha256', secret).update(`known-device:v1:${ids.join('.')}`).digest('base64url');
}

/** The cookie value for these people. */
export function knownDeviceValue(secret: string, ids: readonly string[]): string {
  const kept = ids.filter((id) => UUID_SHAPE.test(id)).slice(0, MAX_PEOPLE);
  return `${kept.join('.')}.${sign(secret, kept)}`;
}

/**
 * The people this browser signed in as before, read from a `cookie` request header. Empty when
 * there is no such cookie, or when its signature is not ours.
 */
export function knownDeviceUserIds(cookieHeader: string | null | undefined, secret: string): string[] {
  if (!cookieHeader || secret === '') return [];
  let raw: string | null = null;
  for (const part of cookieHeader.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === KNOWN_DEVICE_COOKIE) raw = part.slice(at + 1).trim();
  }
  if (raw === null || raw === '') return [];
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return [];
  }
  const parts = value.split('.');
  const signature = parts.pop() ?? '';
  if (parts.length === 0 || parts.length > MAX_PEOPLE || !parts.every((part) => UUID_SHAPE.test(part))) return [];
  const expected = Buffer.from(sign(secret, parts));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return [];
  return parts;
}

/** Adds the person of every new session to the cookie. Mounted by the Portal only. */
export function knownDevicePlugin(options: { secret: string; secure: boolean }): BetterAuthPlugin {
  return {
    id: 'kitstak-known-device',
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            // A new session by any road. Also a session that is simply read: a person who was already
            // signed in when this cookie was introduced gets it without signing in again.
            const read = ctx.path === '/get-session' ? (ctx.context.returned as { user?: { id?: unknown } } | null | undefined) : null;
            const userId = ctx.context.newSession?.user.id ?? (read && !(read instanceof Error) ? read.user?.id : undefined);
            if (typeof userId !== 'string' || !UUID_SHAPE.test(userId)) return;
            try {
              const before = knownDeviceUserIds(ctx.headers?.get('cookie'), options.secret);
              if (before[0] === userId) return;
              const next = [userId, ...before.filter((id) => id !== userId)];
              ctx.setCookie(KNOWN_DEVICE_COOKIE, knownDeviceValue(options.secret, next), {
                httpOnly: true,
                secure: options.secure,
                sameSite: 'lax',
                path: '/',
                maxAge: ONE_YEAR_SECONDS,
              });
            } catch (error: unknown) {
              // The cookie is a convenience. A problem with it must never fail a sign in.
              ctx.context.logger?.error?.('could not write the known device cookie', error);
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
