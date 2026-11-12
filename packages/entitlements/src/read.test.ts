import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementsDb } from './db';
import { isDevAllowAll } from './dev';
import {
  GRACE_DAYS,
  clearEntitlementsCache,
  getEntitlements,
  hasModule,
  isEntitled,
  type ModuleEntitlement,
} from './read';

interface Row {
  readonly module: 'crm' | 'wms';
  readonly status: 'active' | 'trialing' | 'past_due' | 'canceled';
  readonly source: 'stripe' | 'manual' | 'trial';
  readonly periodEnd: Date | null;
}

/** Plain-object mock of the `db.select({...}).from(...).where(...)` chain (repo norm). */
function mockSelectDb(rows: readonly Row[]) {
  const where = vi.fn().mockResolvedValue([...rows]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as unknown as EntitlementsDb, select };
}

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-12T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function entitlement(overrides: Partial<ModuleEntitlement> = {}): ModuleEntitlement {
  return { status: 'active', source: 'manual', periodEnd: null, ...overrides };
}

beforeEach(() => {
  clearEntitlementsCache();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('getEntitlements', () => {
  it('maps rows per module and reports missing modules as null', async () => {
    const { db } = mockSelectDb([{ module: 'crm', status: 'active', source: 'manual', periodEnd: null }]);

    const snapshot = await getEntitlements(db, ORG_ID);

    expect(snapshot.crm).toEqual({ status: 'active', source: 'manual', periodEnd: null });
    expect(snapshot.wms).toBeNull();
  });

  it('serves from the cache within the 60s TTL and refetches after it expires', async () => {
    const { db, select } = mockSelectDb([]);

    await getEntitlements(db, ORG_ID);
    vi.setSystemTime(new Date(NOW.getTime() + 59_000));
    await getEntitlements(db, ORG_ID);
    expect(select).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    await getEntitlements(db, ORG_ID);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('caches per org id', async () => {
    const { db, select } = mockSelectDb([]);

    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, '33333333-3333-4333-8333-333333333333');

    expect(select).toHaveBeenCalledTimes(2);
  });

  it('clearEntitlementsCache(orgId) evicts one org; clearEntitlementsCache() evicts all', async () => {
    const otherOrg = '33333333-3333-4333-8333-333333333333';
    const { db, select } = mockSelectDb([]);
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, otherOrg);

    clearEntitlementsCache(ORG_ID);
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, otherOrg);
    expect(select).toHaveBeenCalledTimes(3);

    clearEntitlementsCache();
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, otherOrg);
    expect(select).toHaveBeenCalledTimes(5);
  });
});

describe('isEntitled', () => {
  it('treats active and trialing as entitled', () => {
    expect(isEntitled(entitlement({ status: 'active' }), NOW)).toBe(true);
    expect(isEntitled(entitlement({ status: 'trialing' }), NOW)).toBe(true);
  });

  it('blocks canceled and missing entitlements', () => {
    expect(isEntitled(entitlement({ status: 'canceled' }), NOW)).toBe(false);
    expect(isEntitled(null, NOW)).toBe(false);
  });

  it('keeps past_due entitled within the grace window of current_period_end', () => {
    const periodEnd = new Date(NOW.getTime() - 2 * DAY_MS);
    expect(isEntitled(entitlement({ status: 'past_due', periodEnd }), NOW)).toBe(true);
  });

  it('keeps past_due entitled exactly at the grace boundary and blocks it one ms later', () => {
    const periodEnd = new Date(NOW.getTime() - GRACE_DAYS * DAY_MS);
    expect(isEntitled(entitlement({ status: 'past_due', periodEnd }), NOW)).toBe(true);

    const justExpired = new Date(periodEnd.getTime() + GRACE_DAYS * DAY_MS + 1);
    expect(isEntitled(entitlement({ status: 'past_due', periodEnd }), justExpired)).toBe(false);
  });

  it('blocks past_due beyond the grace window', () => {
    const periodEnd = new Date(NOW.getTime() - (GRACE_DAYS + 1) * DAY_MS);
    expect(isEntitled(entitlement({ status: 'past_due', periodEnd }), NOW)).toBe(false);
  });

  it('fails closed when past_due has no recorded period end', () => {
    expect(isEntitled(entitlement({ status: 'past_due', periodEnd: null }), NOW)).toBe(false);
  });
});

describe('hasModule', () => {
  it('reads through getEntitlements and applies the gating rule', async () => {
    const { db } = mockSelectDb([
      { module: 'crm', status: 'active', source: 'manual', periodEnd: null },
      { module: 'wms', status: 'canceled', source: 'manual', periodEnd: null },
    ]);

    await expect(hasModule(db, ORG_ID, 'crm')).resolves.toBe(true);
    await expect(hasModule(db, ORG_ID, 'wms')).resolves.toBe(false);
  });

  it('short-circuits to true without touching the db when ENTITLEMENTS_DEV_ALLOW_ALL=1', async () => {
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '1');
    const { db, select } = mockSelectDb([]);

    await expect(hasModule(db, ORG_ID, 'crm')).resolves.toBe(true);
    expect(select).not.toHaveBeenCalled();
  });
});

describe('isDevAllowAll', () => {
  it('accepts 1 and true (any case, padded); rejects everything else', () => {
    expect(isDevAllowAll({ ENTITLEMENTS_DEV_ALLOW_ALL: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDevAllowAll({ ENTITLEMENTS_DEV_ALLOW_ALL: ' TRUE ' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDevAllowAll({ ENTITLEMENTS_DEV_ALLOW_ALL: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isDevAllowAll({ ENTITLEMENTS_DEV_ALLOW_ALL: 'yes' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isDevAllowAll({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
