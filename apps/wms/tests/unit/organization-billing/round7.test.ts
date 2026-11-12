/**
 * Round 7 (parity loop, R3): caller-aware client list (viewer / operator get picker-safe rows),
 * "up to / above" tier boundaries for decimal units, Last calculation from successful bills only,
 * and SO-level bill lines without a SKU.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { DEFAULT_ROLE_PERMISSIONS } from '@/server/auth/permission-catalog';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import {
  contractSchema,
  FEE_DEFAULTS,
  feeSchema,
  priceQuantity,
  tieredAmount,
  validatePricing,
  validateTiers,
} from '@/lib/grid-defs/organization/billing';
import { listClientsForCaller } from '@/server/repositories/clients';
import { createContract, createFee, getContract, listContracts } from '@/server/repositories/billing';
import { calculateContracts } from '@/server/repositories/billing-reports';
import { createWorld, type World } from '../foundation/domain/fixtures';

const SLIM_KEYS = ['code', 'currency', 'fullName', 'id', 'name', 'officialName', 'status'];

describe('GET /api/clients payload by role', () => {
  let w: World;
  const authFor = (permissions: readonly string[]): AuthContext => {
    const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
    return {
      scope,
      viewScope: scope,
      permissions: new Set(permissions),
      restrictions: [],
      user: { id: w.userId },
      context: { warehouseId: null, clientId: null },
    } as unknown as AuthContext;
  };
  beforeEach(async () => {
    w = await createWorld();
  });
  afterEach(() => w.close());

  it('gives viewers and operators only the picker-safe fields (no tax ID, contacts or KPIs)', async () => {
    for (const role of ['viewer', 'operator'] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('settings.clients.view');
      const { rows } = await listClientsForCaller(
        w.db,
        authFor(DEFAULT_ROLE_PERMISSIONS[role]),
        EMPTY_GRID_QUERY,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(SLIM_KEYS);
        expect(row).not.toHaveProperty('taxId');
        expect(row).not.toHaveProperty('contactEmail');
      }
    }
  });

  it('gives Clients-view holders the full grid row', async () => {
    const { rows } = await listClientsForCaller(
      w.db,
      authFor(DEFAULT_ROLE_PERMISSIONS.admin),
      EMPTY_GRID_QUERY,
    );
    expect(rows[0]).toHaveProperty('taxId');
    expect(rows[0]).toHaveProperty('totalOrders');
  });
});

describe('tier boundaries (up to / above)', () => {
  const cont = [
    { fromQty: 0, toQty: 100, rate: 1 },
    { fromQty: 100, toQty: 500, rate: 0.5 },
    { fromQty: 500, toQty: null, rate: 0.25 },
  ];
  const legacy = [
    { fromQty: 1, toQty: 100, rate: 1 },
    { fromQty: 101, toQty: 500, rate: 0.5 },
    { fromQty: 501, toQty: null, rate: 0.25 },
  ];

  it('accepts the continuous and the legacy whole-unit forms, and rejects gaps', () => {
    expect(validateTiers(cont)).toBeNull();
    expect(validateTiers(legacy)).toBeNull();
    expect(
      validateTiers([
        { fromQty: 0, toQty: 100, rate: 1 },
        { fromQty: 150, toQty: null, rate: 1 },
      ]),
    ).toMatch(/should start at 100/);
    expect(
      validateTiers([
        { fromQty: 0, toQty: 100, rate: 1 },
        { fromQty: 100, toQty: 100, rate: 1 },
        { fromQty: 100, toQty: null, rate: 1 },
      ]),
    ).toMatch(/Up to must be greater/);
    expect(
      validatePricing('graduated', [
        { fromQty: 0, toQty: 10.5, rate: 1 },
        { fromQty: 10.5, toQty: null, rate: 2 },
      ]),
    ).toBeNull();
  });

  it('prices whole quantities the same in both forms and never drops a fractional unit between tiers', () => {
    for (const q of [1, 50, 100, 101, 250, 500, 501, 1000])
      expect(tieredAmount(q, cont).total).toBe(tieredAmount(q, legacy).total);
    // 100.5 = 100 × 1 + 0.5 × 0.5 in both forms (the legacy 100 → 101 gap used to lose the 0.5).
    expect(tieredAmount(100.5, cont).total).toBe(100.25);
    expect(tieredAmount(100.5, legacy).total).toBe(100.25);
    expect(priceQuantity(100.5, cont, 'tierBase').parts[0]?.rate).toBe(0.5);
    expect(priceQuantity(100.5, legacy, 'tierBase').parts[0]?.rate).toBe(0.5);
    expect(priceQuantity(100, cont, 'tierBase').parts[0]?.rate).toBe(1);
  });
});

describe('Last calculation and SO-level lines', () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: 'Web' });
  const now = new Date('2026-11-06T12:00:00.000Z');
  beforeEach(async () => {
    w = await createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
    auth = {
      scope,
      viewScope: scope,
      permissions: new Set<string>(),
      restrictions: [],
      user: { id: w.userId },
      context: { warehouseId: null, clientId: null },
    } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  it('a failed run never stamps Last calculation; a deleted (canceled) bill clears it', async () => {
    const c = await createContract(
      w.db,
      auth,
      actor(),
      contractSchema.parse({
        name: 'Empty',
        clientId: w.clientId,
        warehouseId: w.warehouseId,
        calcStartDate: '2026-10-01',
        frequency: 'Monthly',
      }),
    );
    await calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: 'lastClosed' }, now);
    expect((await getContract(w.db, auth, c.id)).lastCalculatedAt).toBeNull();
    expect(
      (
        await w.db.select().from(schema.billingContracts).where(eq(schema.billingContracts.id, c.id)).limit(1)
      )[0]?.lastCalculatedAt,
    ).toBeNull();

    await createFee(
      w.db,
      auth,
      actor(),
      c.id,
      feeSchema.parse({
        ...FEE_DEFAULTS,
        name: 'Account',
        operationType: 'Recurring',
        feeBy: 'Recurring',
        chargeBy: 'Recurring',
        tiers: [{ fromQty: 1, toQty: null, rate: 50 }],
      }),
    );
    const ok = (await calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: 'lastClosed' }, now))
      .reports[0]!;
    const detail = await getContract(w.db, auth, c.id);
    expect(detail.lastCalculatedAt).toBe(now.toISOString());
    expect(detail.lastReport?.id).toBe(ok.reportId);
    expect(
      (await listContracts(w.db, auth, EMPTY_GRID_QUERY)).rows.find((r) => r.id === c.id)?.lastCalculatedAt,
    ).toBe(now.toISOString());

    await w.db
      .update(schema.billingReports)
      .set({ billStatus: 'Canceled' })
      .where(eq(schema.billingReports.id, ok.reportId));
    const after = await getContract(w.db, auth, c.id);
    expect(after.lastCalculatedAt).toBeNull();
    expect(after.lastReport).toBeNull();
  });
});
