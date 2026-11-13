/**
 * Regression tests for the 2026-11-13 logout incident: a deployment whose
 * AUTH_COOKIE_DOMAIN env had drifted away expired only a host-only cookie on
 * sign-out, which cannot delete the `Domain=.kitstak.app` session cookie that
 * sign-in (on a correctly configured sibling app) had set — so "Log out"
 * silently kept the session. The shared factory now mounts a sweep that also
 * expires every plausible Domain scope derived from the request Host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAuth } from '@kitstak/auth';
import { wmsAuthSchema } from '@/server/auth/auth';
import { createTestDb, type TestDb } from '../../setup/test-db';

const SECRET = 'unit-test-secret-unit-test-secret-42';
const PROD_ORIGIN = 'https://crm.kitstak.app';
const SECURE_TOKEN = '__Secure-kitstak.session_token';
const SECURE_DATA = '__Secure-kitstak.session_data';

let testDb: TestDb | undefined;
let requestCounter = 0;

afterEach(async () => {
  await testDb?.close();
  testDb = undefined;
});

type SweepAuth = ReturnType<typeof createAuth>;

function buildAuth(db: TestDb['db'], options: { cookieDomain?: string; baseURL?: string }): SweepAuth {
  const baseURL = options.baseURL ?? PROD_ORIGIN;
  return createAuth({
    db,
    schema: wmsAuthSchema,
    secret: SECRET,
    baseURL,
    trustedOrigins: [new URL(baseURL).origin],
    useSecureCookies: baseURL.startsWith('https://'),
    ...(options.cookieDomain ? { cookieDomain: options.cookieDomain } : {}),
  });
}

async function signOutSetCookies(
  auth: SweepAuth,
  origin: string,
  extraHeaders: Record<string, string> = {},
): Promise<string[]> {
  requestCounter += 1;
  const response = await auth.handler(
    new Request(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers: new Headers({
        origin,
        host: new URL(origin).host,
        'content-type': 'application/json',
        // Unique client IP per request so Better Auth's DB rate limiter never
        // collapses the suite into one shared bucket.
        'x-forwarded-for': `10.77.0.${(requestCounter % 250) + 1}`,
        ...extraHeaders,
      }),
      body: '{}',
    }),
  );
  expect(response.status).toBe(200);
  return response.headers.getSetCookie();
}

/** The Set-Cookie expiries (Max-Age=0) for exactly this cookie name (not its chunks). */
function expiriesFor(cookies: readonly string[], name: string): string[] {
  return cookies.filter((entry) => entry.startsWith(`${name}=`) && /max-age=0/i.test(entry));
}

function domainOf(entry: string): string | null {
  const match = /(?:^|;\s*)domain=([^;]+)/i.exec(entry);
  return match ? (match[1] ?? '').trim().toLowerCase() : null;
}

describe('sign-out cookie sweep (shared @kitstak/auth factory)', () => {
  it('with a configured cookie domain, sign-out also expires the host-only variant', async () => {
    testDb = await createTestDb();
    const auth = buildAuth(testDb.db, { cookieDomain: '.kitstak.app' });
    const cookies = await signOutSetCookies(auth, PROD_ORIGIN);

    const tokenExpiries = expiriesFor(cookies, SECURE_TOKEN);
    const domains = tokenExpiries.map(domainOf);
    // Better Auth's own expiry, scoped to the configured domain:
    expect(domains).toContain('.kitstak.app');
    // The sweep's host-only expiry, for sessions issued while the domain was unset:
    expect(domains).toContain(null);
    // session_data (cookie cache) gets the same treatment:
    expect(expiriesFor(cookies, SECURE_DATA).map(domainOf)).toEqual(
      expect.arrayContaining(['.kitstak.app', null]),
    );
  });

  it('WITHOUT a configured cookie domain, sign-out still expires parent-domain scopes (the incident)', async () => {
    testDb = await createTestDb();
    const auth = buildAuth(testDb.db, {});
    const cookies = await signOutSetCookies(auth, PROD_ORIGIN);

    const domains = expiriesFor(cookies, SECURE_TOKEN).map(domainOf);
    // Better Auth's own host-only expiry:
    expect(domains).toContain(null);
    // The sweep reaches the cookie a correctly configured sibling app set for `.kitstak.app`:
    expect(domains).toContain('kitstak.app');
    expect(domains).toContain('crm.kitstak.app');
  });

  it('expires chunked session_data cookies present on the request in both scopes', async () => {
    testDb = await createTestDb();
    const auth = buildAuth(testDb.db, { cookieDomain: '.kitstak.app' });
    const cookies = await signOutSetCookies(auth, PROD_ORIGIN, {
      cookie: `${SECURE_DATA}.0=aaa; ${SECURE_DATA}.1=bbb`,
    });

    for (const chunk of [`${SECURE_DATA}.0`, `${SECURE_DATA}.1`]) {
      const domains = expiriesFor(cookies, chunk).map(domainOf);
      expect(domains).toContain('.kitstak.app'); // Better Auth's chunk clean
      expect(domains).toContain(null); // the sweep's host-only variant
    }
  });

  it('is a no-op on localhost dev (no Domain attribute ever emitted)', async () => {
    testDb = await createTestDb();
    const origin = 'http://localhost:3000';
    const auth = buildAuth(testDb.db, { baseURL: origin });
    const cookies = await signOutSetCookies(auth, origin);

    const tokenExpiries = expiriesFor(cookies, 'kitstak.session_token');
    expect(tokenExpiries.length).toBeGreaterThan(0);
    for (const entry of cookies) {
      expect(domainOf(entry)).toBeNull();
    }
  });
});
