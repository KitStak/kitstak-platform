/**
 * Test helper: real Better Auth sign-in cookies for route/integration tests.
 *
 * Test files mock `@/server/api/db` (getAppDb → the test database), so `getWmsAuth()`
 * builds an instance bound to that database; `signInCookie` runs the full
 * `/sign-in/email` flow (password-compat verify, policy plugin, audit hooks) and
 * returns the `kitstak.session_token` cookie pair for request headers. Cookies are
 * cached per (database, email) so a test that calls `cookieFor` repeatedly does not
 * trip Better Auth's per-IP sign-in rate limit; each real sign-in also gets a unique
 * x-forwarded-for for the same reason.
 */
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE_PREFIX } from '@kitstak/auth/options';
import type { AppDb } from '@/server/api/db';
import { getWmsAuth } from '@/server/auth/auth';
import { users } from '@/server/db/schema';
import { TEST_PASSWORD } from '../unit/foundation-f3/fixtures';

export const SESSION_COOKIE_NAME = `${SESSION_COOKIE_PREFIX}.session_token`;

const cookieCache = new WeakMap<object, Map<string, string>>();
let signInCounter = 0;

function sessionCookieFrom(response: Response): string {
  const header = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = header.getSetCookie ? header.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  for (const cookie of cookies) {
    if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      const value = cookie.split(';')[0];
      if (value && !value.endsWith('=')) return value;
    }
  }
  throw new Error(`sign-in response carried no ${SESSION_COOKIE_NAME} cookie`);
}

/** Signs in via the real Better Auth endpoint; returns `kitstak.session_token=<value>`. */
export async function signInCookie(
  db: AppDb,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<string> {
  let perDb = cookieCache.get(db as object);
  if (!perDb) {
    perDb = new Map();
    cookieCache.set(db as object, perDb);
  }
  const cached = perDb.get(email);
  if (cached) return cached;
  const auth = await getWmsAuth();
  signInCounter += 1;
  const response = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      'x-forwarded-for': `10.99.${Math.floor(signInCounter / 250)}.${(signInCounter % 250) + 1}`,
    }),
    asResponse: true,
  });
  if (response.status >= 400) {
    throw new Error(`sign-in as ${email} failed: ${response.status} ${await response.text()}`);
  }
  const cookie = sessionCookieFrom(response);
  perDb.set(email, cookie);
  return cookie;
}

/** Sign-in cookie for a wms.users row id (looks the email up first). */
export async function signInCookieForUser(db: AppDb, userId: string): Promise<string> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new Error(`No wms.users row with id ${userId}`);
  return await signInCookie(db, row.email);
}

/** Forgets cached cookies for a database (after revoking sessions in a test). */
export function forgetSignInCookies(db: AppDb): void {
  cookieCache.delete(db as object);
}
