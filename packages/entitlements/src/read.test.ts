import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingStamps } from '@kitstak/db/schema';
import type { EntitlementsDb } from './db';
import { isDevAllowAll } from './dev';
import {
  GRACE_DAYS,
  clearEntitlementsCache,
  getEntitlements,
  getModuleAccess,
  hasModule,
  isEntitled,
  moduleAccess,
  readBillingStamp,
  resetBillingStampProbe,
  type ModuleEntitlement,
} from './read';

interface Row {
  readonly module: 'crm' | 'wms' | 'projects' | 'pulse';
  readonly status: 'active' | 'trialing' | 'past_due' | 'canceled';
  readonly source: 'stripe' | 'manual' | 'trial';
  readonly periodEnd: Date | null;
  readonly seats?: number | null;
}

/**
 * Plain-object mock of the `db.select({...}).from(...).where(...)` chain (repo norm). Reads of
 * `core.entitlements` and reads of the billing stamp are counted apart: `reads` is the first,
 * `stampReads` the second. `stamp.version` is what the stamp read answers; set it to move the stamp.
 * `stamp.missing` makes the stamp read fail, like a database without migration 0010.
 */
function mockSelectDb(rows: readonly Row[]) {
  const stamp: { version: number; missing: boolean } = { version: 1, missing: false };
  const reads = vi.fn().mockResolvedValue([...rows]);
  const stampReads = vi.fn(async () => {
    if (stamp.missing) throw new Error('relation "core.billing_stamps" does not exist');
    return [{ version: stamp.version }];
  });
  const from = vi.fn((table: unknown) => ({ where: table === billingStamps ? stampReads : reads }));
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as unknown as EntitlementsDb, select, reads, stampReads, stamp };
}

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-12T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function entitlement(overrides: Partial<ModuleEntitlement> = {}): ModuleEntitlement {
  return { status: 'active', source: 'manual', periodEnd: null, seats: null, ...overrides };
}

beforeEach(() => {
  clearEntitlementsCache();
  resetBillingStampProbe();
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

    expect(snapshot.crm).toEqual({ status: 'active', source: 'manual', periodEnd: null, seats: null });
    expect(snapshot.wms).toBeNull();
  });

  it('serves from the cache within the 60s TTL and refetches after it expires', async () => {
    const { db, reads } = mockSelectDb([]);

    await getEntitlements(db, ORG_ID);
    vi.setSystemTime(new Date(NOW.getTime() + 59_000));
    await getEntitlements(db, ORG_ID);
    expect(reads).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    await getEntitlements(db, ORG_ID);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('caches per org id', async () => {
    const { db, reads } = mockSelectDb([]);

    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, '33333333-3333-4333-8333-333333333333');

    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('clearEntitlementsCache(orgId) evicts one org; clearEntitlementsCache() evicts all', async () => {
    const otherOrg = '33333333-3333-4333-8333-333333333333';
    const { db, reads } = mockSelectDb([]);
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, otherOrg);

    clearEntitlementsCache(ORG_ID);
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, otherOrg);
    expect(reads).toHaveBeenCalledTimes(3);

    clearEntitlementsCache();
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, otherOrg);
    expect(reads).toHaveBeenCalledTimes(5);
  });
});

describe('moduleAccess (the one access rule, row by row)', () => {
  const future = new Date(NOW.getTime() + 3 * DAY_MS);
  const past = new Date(NOW.getTime() - 3 * DAY_MS);
  const cases: readonly [string, ModuleEntitlement | null, 'full' | 'read_only' | 'locked'][] = [
    ['no row', null, 'locked'],
    ['active', entitlement({ status: 'active', source: 'stripe' }), 'full'],
    ['active manual grant', entitlement({ status: 'active', source: 'manual' }), 'full'],
    ['trialing, no period end (old manual rows)', entitlement({ status: 'trialing', source: 'trial' }), 'full'],
    ['trialing, period end in the future', entitlement({ status: 'trialing', source: 'trial', periodEnd: future }), 'full'],
    ['trialing, period end in the past', entitlement({ status: 'trialing', source: 'trial', periodEnd: past }), 'read_only'],
    ['past_due, no period end', entitlement({ status: 'past_due', source: 'stripe' }), 'locked'],
    ['past_due, inside the grace days', entitlement({ status: 'past_due', source: 'stripe', periodEnd: past }), 'full'],
    [
      'past_due, after the grace days',
      entitlement({ status: 'past_due', source: 'stripe', periodEnd: new Date(NOW.getTime() - (GRACE_DAYS + 1) * DAY_MS) }),
      'read_only',
    ],
    ['canceled, source manual (a manual revoke)', entitlement({ status: 'canceled', source: 'manual', periodEnd: future }), 'locked'],
    ['canceled, period end in the future', entitlement({ status: 'canceled', source: 'stripe', periodEnd: future }), 'full'],
    ['canceled, period end in the past', entitlement({ status: 'canceled', source: 'stripe', periodEnd: past }), 'read_only'],
    ['canceled, no period end', entitlement({ status: 'canceled', source: 'stripe' }), 'read_only'],
    ['canceled trial row', entitlement({ status: 'canceled', source: 'trial', periodEnd: past }), 'read_only'],
  ];

  it.each(cases)('%s', (_name, row, expected) => {
    expect(moduleAccess(row, NOW)).toBe(expected);
  });

  it('a trial ends exactly at its period end', () => {
    const row = entitlement({ status: 'trialing', source: 'trial', periodEnd: NOW });
    expect(moduleAccess(row, new Date(NOW.getTime() - 1))).toBe('full');
    expect(moduleAccess(row, NOW)).toBe('read_only');
  });
});

describe('isEntitled', () => {
  it('treats active and trialing as entitled', () => {
    expect(isEntitled(entitlement({ status: 'active' }), NOW)).toBe(true);
    expect(isEntitled(entitlement({ status: 'trialing' }), NOW)).toBe(true);
  });

  it('a trial past its end is no longer entitled', () => {
    const periodEnd = new Date(NOW.getTime() - 1000);
    expect(isEntitled(entitlement({ status: 'trialing', source: 'trial', periodEnd }), NOW)).toBe(false);
  });

  it('view only is not entitled', () => {
    const periodEnd = new Date(NOW.getTime() - DAY_MS);
    expect(isEntitled(entitlement({ status: 'canceled', source: 'stripe', periodEnd }), NOW)).toBe(false);
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

  it('reads a cached "not full" answer again, so good news shows on the next request', async () => {
    const rows: Row[] = [];
    // No stamp to go by here (a database without migration 0010): this older rule stands alone.
    const reads = vi.fn().mockImplementation(async () => [...rows]);
    const noStamp = vi.fn().mockRejectedValue(new Error('relation "core.billing_stamps" does not exist'));
    const select = vi.fn().mockReturnValue({ from: vi.fn((table: unknown) => ({ where: table === billingStamps ? noStamp : reads })) });
    const db = { select } as unknown as EntitlementsDb;

    await expect(hasModule(db, ORG_ID, 'crm')).resolves.toBe(false);
    expect(reads).toHaveBeenCalledTimes(1);

    // A payment lands in another process. The cached snapshot still says "no row".
    rows.push({ module: 'crm', status: 'active', source: 'stripe', periodEnd: null });
    await expect(hasModule(db, ORG_ID, 'crm')).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);

    // A cached "full" answer is served from the cache.
    await expect(hasModule(db, ORG_ID, 'crm')).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('short-circuits to true without touching the db when ENTITLEMENTS_DEV_ALLOW_ALL=1', async () => {
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '1');
    const { db, select } = mockSelectDb([]);

    await expect(hasModule(db, ORG_ID, 'crm')).resolves.toBe(true);
    expect(select).not.toHaveBeenCalled();
  });
});

describe('getModuleAccess', () => {
  it('returns the three levels from the rows', async () => {
    const { db } = mockSelectDb([
      { module: 'crm', status: 'active', source: 'stripe', periodEnd: null },
      { module: 'wms', status: 'trialing', source: 'trial', periodEnd: new Date(NOW.getTime() - DAY_MS) },
    ]);

    await expect(getModuleAccess(db, ORG_ID, 'crm')).resolves.toBe('full');
    await expect(getModuleAccess(db, ORG_ID, 'wms')).resolves.toBe('read_only');
    await expect(getModuleAccess(db, ORG_ID, 'projects')).resolves.toBe('locked');
  });

  it('returns full without touching the db when the dev switch is on', async () => {
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', 'true');
    const { db, select } = mockSelectDb([]);

    await expect(getModuleAccess(db, ORG_ID, 'pulse')).resolves.toBe('full');
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

describe('the billing stamp: a write in another process shows on the very next read', () => {
  const FULL: Row[] = [{ module: 'crm', status: 'active', source: 'stripe', periodEnd: new Date(NOW.getTime() + 20 * DAY_MS) }];

  it('reads the stamp before it trusts the cached rows, and keeps them while the stamp stands', async () => {
    const { db, reads, stampReads } = mockSelectDb(FULL);
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, ORG_ID);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(stampReads).toHaveBeenCalledTimes(3);
  });

  it('full access before and after (cancel, then "Keep my plan"): the rows are read again at once', async () => {
    const { db, reads, stamp } = mockSelectDb(FULL);
    await expect(getModuleAccess(db, ORG_ID, 'crm')).resolves.toBe('full');
    expect(reads).toHaveBeenCalledTimes(1);

    // The Portal writes (another process). Nothing here was told. One second later the app is opened.
    stamp.version += 1;
    vi.setSystemTime(new Date(NOW.getTime() + 1_000));
    await expect(getModuleAccess(db, ORG_ID, 'crm')).resolves.toBe('full');
    expect(reads).toHaveBeenCalledTimes(2);

    // And the new copy is kept until the stamp moves again.
    await getModuleAccess(db, ORG_ID, 'crm');
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('an organization with no billing rows yet has stamp 0, and its first billing write moves it', async () => {
    const reads = vi.fn().mockResolvedValue([]);
    let stampRows: { version: number }[] = [];
    const from = vi.fn((table: unknown) => ({ where: table === billingStamps ? vi.fn(async () => stampRows) : reads }));
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as EntitlementsDb;
    await expect(readBillingStamp(db, ORG_ID)).resolves.toBe('0');
    await getEntitlements(db, ORG_ID);
    await getEntitlements(db, ORG_ID);
    expect(reads).toHaveBeenCalledTimes(1);
    stampRows = [{ version: 1 }];
    await getEntitlements(db, ORG_ID);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('a database without the stamp table falls back to the 60 second rule and is not asked on every read', async () => {
    const { db, reads, stampReads, stamp } = mockSelectDb(FULL);
    stamp.missing = true;
    await expect(readBillingStamp(db, ORG_ID)).resolves.toBeNull();
    await getEntitlements(db, ORG_ID);
    vi.setSystemTime(new Date(NOW.getTime() + 30_000));
    await getEntitlements(db, ORG_ID);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(stampReads).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    await getEntitlements(db, ORG_ID);
    expect(reads).toHaveBeenCalledTimes(2);
  });
});
