import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entitlements } from '@kitstak/db/schema';
import type { EntitlementsDb } from './db';
import { grantModule, revokeModule } from './grant';
import { clearEntitlementsCache, getEntitlements } from './read';

const ORG_ID = '22222222-2222-4222-8222-222222222222';

/** Plain-object mock of `db.insert(...).values(...).onConflictDoUpdate(...)` plus a select chain. */
function mockDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const where = vi.fn().mockResolvedValue([]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return {
    db: { insert, select } as unknown as EntitlementsDb,
    insert,
    values,
    onConflictDoUpdate,
    select,
  };
}

beforeEach(() => {
  clearEntitlementsCache();
});

describe('grantModule', () => {
  it('upserts an active manual entitlement keyed on (org, module)', async () => {
    const { db, insert, values, onConflictDoUpdate } = mockDb();

    await grantModule(db, ORG_ID, 'crm');

    expect(insert).toHaveBeenCalledWith(entitlements);
    expect(values).toHaveBeenCalledWith({ orgId: ORG_ID, module: 'crm', status: 'active', source: 'manual' });
    const conflict = onConflictDoUpdate.mock.calls[0][0] as {
      target: unknown[];
      set: { status: string; source: string; updatedAt: Date };
    };
    expect(conflict.target).toEqual([entitlements.orgId, entitlements.module]);
    expect(conflict.set.status).toBe('active');
    expect(conflict.set.source).toBe('manual');
    expect(conflict.set.updatedAt).toBeInstanceOf(Date);
  });

  it('passes a non-default source through', async () => {
    const { db, values } = mockDb();

    await grantModule(db, ORG_ID, 'wms', 'trial');

    expect(values).toHaveBeenCalledWith({ orgId: ORG_ID, module: 'wms', status: 'active', source: 'trial' });
  });

  it('invalidates the read cache for the org it wrote', async () => {
    const { db, select } = mockDb();
    await getEntitlements(db, ORG_ID);
    expect(select).toHaveBeenCalledTimes(1);

    await grantModule(db, ORG_ID, 'crm');
    await getEntitlements(db, ORG_ID);

    expect(select).toHaveBeenCalledTimes(2);
  });
});

describe('revokeModule', () => {
  it('upserts a canceled entitlement with the manual source', async () => {
    const { db, values, onConflictDoUpdate } = mockDb();

    await revokeModule(db, ORG_ID, 'wms');

    expect(values).toHaveBeenCalledWith({
      orgId: ORG_ID,
      module: 'wms',
      status: 'canceled',
      source: 'manual',
    });
    const conflict = onConflictDoUpdate.mock.calls[0][0] as { set: { status: string } };
    expect(conflict.set.status).toBe('canceled');
  });
});
