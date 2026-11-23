/**
 * The WMS plan gate (docs/billing/CONTRACTS.md section 18): WMS not in the plan refuses every
 * request, view only lets reads through and refuses every change with PLAN_READ_ONLY, except the
 * short list of requests that change no warehouse data. The access level itself is decided in
 * `@kitstak/entitlements` (tested there).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@/server/api/db';

/** An en dash, an em dash, or two hyphens in a row: none may appear in UI copy. */
const DASHES = new RegExp('[\\u2013\\u2014]|-{2}');

const access = vi.hoisted(() => ({ current: 'full' as 'full' | 'read_only' | 'locked' }));
vi.mock('@kitstak/entitlements', async (original) => ({
  ...(await original<typeof import('@kitstak/entitlements')>()),
  getModuleAccess: vi.fn(async () => access.current),
}));

const {
  allowedInViewOnly,
  PLAN_LOCKED_MESSAGE,
  PLAN_READ_ONLY_MESSAGE,
  requireWmsEntitlement,
  wmsAccessForOrg,
} = await import('./entitlements');

const db = {} as AppDb;
const ORG = '11111111-1111-4111-8111-111111111111';

async function caught(run: () => Promise<void>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

describe('requireWmsEntitlement', () => {
  beforeEach(() => {
    access.current = 'full';
    // NODE_ENV=test defaults to allow-all; the explicit value turns the gate on.
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '0');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets every method through with full access', async () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      await expect(requireWmsEntitlement(db, ORG, '/api/orders', method)).resolves.toBeUndefined();
    }
  });

  it('view only: reads pass, every change is refused with the one plain sentence', async () => {
    access.current = 'read_only';
    await expect(requireWmsEntitlement(db, ORG, '/api/orders', 'GET')).resolves.toBeUndefined();
    await expect(requireWmsEntitlement(db, ORG, '/api/orders')).resolves.toBeUndefined();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const error = await caught(() => requireWmsEntitlement(db, ORG, '/api/orders', method));
      expect(error).toMatchObject({
        code: 'PLAN_READ_ONLY',
        status: 402,
        message: 'Your plan is view only right now. Pick a plan in the Portal to make changes.',
      });
    }
    expect(PLAN_READ_ONLY_MESSAGE).toBe('Your plan is view only right now. Pick a plan in the Portal to make changes.');
  });

  it('view only: exports, previews, sign out, context and preference saves keep working', async () => {
    access.current = 'read_only';
    for (const path of [
      '/api/exports',
      '/api/reports/exports',
      '/api/orders/ship-preview',
      '/api/lp-numbers/removal-preview',
      '/api/printouts/preview',
      '/api/billing/calculate/preview',
      '/api/auth/sign-out',
      '/api/tenancy/switch',
      '/api/me',
      '/api/grid-prefs/orders',
      '/api/notifications/read',
    ]) {
      await expect(requireWmsEntitlement(db, ORG, path, 'POST'), path).resolves.toBeUndefined();
    }
  });

  it('not in the plan: every request is refused, reads too', async () => {
    access.current = 'locked';
    for (const method of ['GET', 'POST']) {
      const error = await caught(() => requireWmsEntitlement(db, ORG, '/api/orders', method));
      expect(error).toMatchObject({ code: 'ENTITLEMENT_MISSING', status: 402, message: PLAN_LOCKED_MESSAGE });
    }
    // Not even an export or a preview.
    expect(await caught(() => requireWmsEntitlement(db, ORG, '/api/exports', 'POST'))).toMatchObject({
      code: 'ENTITLEMENT_MISSING',
    });
  });

  it('health, the cron tick and bootstrap always answer', async () => {
    access.current = 'locked';
    for (const path of ['/api/health', '/api/cron/tick', '/api/admin/bootstrap']) {
      await expect(requireWmsEntitlement(db, ORG, path, 'POST')).resolves.toBeUndefined();
    }
  });

  it('answers full without reading anything while the allow all switch is on', async () => {
    access.current = 'locked';
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '1');
    expect(await wmsAccessForOrg(db, ORG)).toBe('full');
    await expect(requireWmsEntitlement(db, ORG, '/api/orders', 'POST')).resolves.toBeUndefined();
  });
});

describe('allowedInViewOnly', () => {
  it('does not let ordinary writes through', () => {
    for (const path of [
      '/api/orders',
      '/api/warehouses',
      '/api/warehouses/bulk-active',
      '/api/tenancy/warehouse',
      '/api/billing/calculate',
      '/api/printouts',
      '/api/me/password',
      '/api/exports/delete',
      '/api/previewer',
    ]) {
      expect(allowedInViewOnly(path), path).toBe(false);
    }
  });

  it('keeps its sentences short and free of dashes', () => {
    for (const text of [PLAN_READ_ONLY_MESSAGE, PLAN_LOCKED_MESSAGE]) {
      expect(text).not.toMatch(DASHES);
      for (const sentence of text.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
    }
  });
});
