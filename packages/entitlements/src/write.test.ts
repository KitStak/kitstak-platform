import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlements } from '@kitstak/db/schema';
import type { EntitlementsDb } from './db';
import { clearEntitlementsCache, getEntitlements } from './read';
import { setEntitlement, type EntitlementWrite } from './write';

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const PERIOD_END = new Date('2026-12-07T12:00:00.000Z');

/** Plain-object mock of `insert().values().onConflictDoUpdate().returning()` plus a select chain. */
function mockDb(returned: readonly { id: string }[]) {
  const returning = vi.fn().mockResolvedValue([...returned]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const where = vi.fn().mockResolvedValue([]);
  const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) });
  return { db: { insert, select } as unknown as EntitlementsDb, insert, values, onConflictDoUpdate, select };
}

const TRIAL_WRITE: EntitlementWrite = {
  orgId: ORG_ID,
  module: 'crm',
  status: 'trialing',
  source: 'trial',
  periodEnd: PERIOD_END,
  seats: 5,
  stripeSubscriptionId: null,
  stripePriceId: null,
};

beforeEach(() => {
  clearEntitlementsCache();
});

describe('setEntitlement', () => {
  it('writes every column on insert and on conflict', async () => {
    const { db, insert, values, onConflictDoUpdate } = mockDb([{ id: 'row' }]);

    const written = await setEntitlement(db, {
      ...TRIAL_WRITE,
      status: 'active',
      source: 'stripe',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
    });

    expect(written).toBe(true);
    expect(insert).toHaveBeenCalledWith(entitlements);
    const expected = {
      orgId: ORG_ID,
      module: 'crm',
      status: 'active',
      source: 'stripe',
      currentPeriodEnd: PERIOD_END,
      seats: 5,
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
    };
    expect(values).toHaveBeenCalledWith(expected);
    const conflict = onConflictDoUpdate.mock.calls[0][0] as {
      target: unknown[];
      set: Record<string, unknown>;
      setWhere: unknown;
    };
    expect(conflict.target).toEqual([entitlements.orgId, entitlements.module]);
    expect(conflict.set).toMatchObject(expected);
    expect(conflict.set.updatedAt).toBeInstanceOf(Date);
  });

  it('guards the update so a live manual grant is never overwritten', async () => {
    const { db, onConflictDoUpdate } = mockDb([]);

    const written = await setEntitlement(db, TRIAL_WRITE);

    expect(written).toBe(false);
    const conflict = onConflictDoUpdate.mock.calls[0][0] as { setWhere: unknown };
    expect(conflict.setWhere).toBeDefined();
  });

  it('a manual write has no guard (a manual write may replace anything)', async () => {
    const { db, onConflictDoUpdate } = mockDb([{ id: 'row' }]);

    await setEntitlement(db, { ...TRIAL_WRITE, status: 'active', source: 'manual', periodEnd: null, seats: null });

    const conflict = onConflictDoUpdate.mock.calls[0][0] as { setWhere: unknown };
    expect(conflict.setWhere).toBeUndefined();
  });

  it('clears the read cache for the org it wrote', async () => {
    const { db, select } = mockDb([{ id: 'row' }]);
    await getEntitlements(db, ORG_ID);
    expect(select).toHaveBeenCalledTimes(1);

    await setEntitlement(db, TRIAL_WRITE);
    await getEntitlements(db, ORG_ID);

    expect(select).toHaveBeenCalledTimes(2);
  });
});
