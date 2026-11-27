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
  setEntitlement,
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

function request(path: string, cookie?: string, method: 'GET' | 'POST' = 'GET'): NextRequest {
  const headers = new Headers({ host: 'localhost:3000', origin: BASE });
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(`${BASE}${path}`, { method, headers });
}

/** A free trial that ended yesterday: the WMS is view only (docs/billing/SPEC.md P14). */
async function endTrial(orgId: string): Promise<void> {
  await setEntitlement(entitlementsDb(), {
    orgId,
    module: 'wms',
    status: 'trialing',
    source: 'trial',
    periodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
    seats: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
  });
  clearEntitlementsCache();
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
      error: 'WMS is not in your plan yet. Add it in the Portal to use it.',
    });

    await grantModule(entitlementsDb(), orgId, 'wms');
    const allowed = await authedRoute(request('/api/ping', cookie));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ success: true, data: { pong: true } });
  });

  it('view only: reads pass, every change is refused with the one plain sentence', async () => {
    const orgId = await ensurePlatformOrg(current.db);
    await endTrial(orgId);
    const cookie = await signInCookieForUser(current.db, current.ids.admin);

    const read = await authedRoute(request('/api/ping', cookie));
    expect(read.status).toBe(200);

    const write = await authedRoute(request('/api/ping', cookie, 'POST'));
    expect(write.status).toBe(402);
    expect(await write.json()).toMatchObject({
      success: false,
      code: 'PLAN_READ_ONLY',
      error: 'Your plan is view only right now. Pick a plan in the Portal to make changes.',
    });
  });

  it('view only: exports and previews keep working', async () => {
    const orgId = await ensurePlatformOrg(current.db);
    await endTrial(orgId);
    const cookie = await signInCookieForUser(current.db, current.ids.admin);

    expect((await authedRoute(request('/api/exports', cookie, 'POST'))).status).toBe(200);
    expect((await authedRoute(request('/api/orders/ship-preview', cookie, 'POST'))).status).toBe(200);
  });

  it('view only ends the moment the plan is paid: the next write passes', async () => {
    const orgId = await ensurePlatformOrg(current.db);
    await endTrial(orgId);
    const cookie = await signInCookieForUser(current.db, current.ids.admin);
    expect((await authedRoute(request('/api/ping', cookie, 'POST'))).status).toBe(402);

    await setEntitlement(entitlementsDb(), {
      orgId,
      module: 'wms',
      status: 'active',
      source: 'stripe',
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      seats: null,
      stripeSubscriptionId: 'sub_test_wms_gate',
      stripePriceId: 'price_test_wms_gate',
    });
    // No cache clear here: a "not full" answer is always read again.
    expect((await authedRoute(request('/api/ping', cookie, 'POST'))).status).toBe(200);
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
