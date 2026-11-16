/**
 * Module entitlement gate in defineRoute() (BLUEPRINT.md §3.3): with allow-all off, a
 * revoked `wms` entitlement 402s every authed route; a manual grant restores access;
 * ENTITLEMENTS_DEV_ALLOW_ALL=1 bypasses the gate; `auth: 'public'` routes never gate.
 * Uses the real PGlite fixture (migration 0010 creates core.entitlements locally) and
 * the @kitstak/entitlements grant/revoke writers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  clearEntitlementsCache,
  grantModule,
  revokeModule,
  type EntitlementsDb,
} from '@kitstak/entitlements';
import type { AppDb } from '@/server/api/db';
import { seededDb, type SeededDb } from '../foundation-f3/fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => {
  const get = async (): Promise<AppDb> => current.db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

const { defineRoute } = await import('@/server/api/define-route');
const { ensurePlatformOrg } = await import('@/server/auth/credentials');
const { signInCookieForUser, forgetSignInCookies } = await import('../../setup/auth-session');

const BASE = 'http://localhost:3000';

function request(path: string, cookie?: string): NextRequest {
  const headers = new Headers({ host: 'localhost:3000', origin: BASE });
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(`${BASE}${path}`, { method: 'GET', headers });
}

const authedRoute = defineRoute({ transaction: false, handler: () => ({ pong: true }) });
const publicRoute = defineRoute({ auth: 'public', transaction: false, handler: () => ({ pong: true }) });

function entitlementsDb(): EntitlementsDb {
  return current.db as unknown as EntitlementsDb;
}

describe('defineRoute entitlement gate', () => {
  beforeEach(async () => {
    current = await seededDb();
    clearEntitlementsCache();
    // NODE_ENV=test defaults to allow-all; the explicit override enforces the gate.
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '0');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    clearEntitlementsCache();
    forgetSignInCookies(current.db);
    await current.close();
  });

  it('402s authed routes when the wms entitlement is revoked; a grant restores access', async () => {
    const orgId = await ensurePlatformOrg(current.db);
    await revokeModule(entitlementsDb(), orgId, 'wms');
    const cookie = await signInCookieForUser(current.db, current.ids.admin);

    const blocked = await authedRoute(request('/api/ping', cookie));
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toMatchObject({
      success: false,
      code: 'ENTITLEMENT_MISSING',
      error: 'WMS is not enabled for this organization',
    });

    await grantModule(entitlementsDb(), orgId, 'wms');
    const allowed = await authedRoute(request('/api/ping', cookie));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ success: true, data: { pong: true } });
  });

  it('ENTITLEMENTS_DEV_ALLOW_ALL=1 bypasses a revoked entitlement; public routes never gate', async () => {
    const orgId = await ensurePlatformOrg(current.db);
    await revokeModule(entitlementsDb(), orgId, 'wms');
    const cookie = await signInCookieForUser(current.db, current.ids.admin);

    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '1');
    expect((await authedRoute(request('/api/ping', cookie))).status).toBe(200);

    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '0');
    expect((await publicRoute(request('/api/pub'))).status).toBe(200);
  });
});
