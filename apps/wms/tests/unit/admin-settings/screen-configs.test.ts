/** M14 Screen Configuration: pure condition / step logic and the repository against an in-memory DB. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import {
  conditionSentence,
  conditionsMatch,
  defaultSteps,
  normalizeSteps,
  screenConfigDefaults,
  screenConfigSchema,
  type ScreenConfigFormValues,
} from '@/lib/grid-defs/admin/screen-configs';
import {
  configForPurchaseOrder,
  createScreenConfig,
  deleteScreenConfigs,
  duplicateScreenConfig,
  listScreenConfigs,
  loadScreenConfig,
  setScreenConfigsActive,
  updateScreenConfig,
} from '@/server/repositories/screen-configs';
import { receivingRequirements } from '@/server/repositories/purchase-orders';
import { createWorld, type World } from '../foundation/domain/fixtures';

describe('conditionsMatch', () => {
  const po = { clientId: 'c1', poType: 'Purchase Order', vendorId: 'v1' };
  it('applies to every PO when no conditions are set', () => {
    expect(conditionsMatch({ join: 'And', clientIds: [], poTypes: [], vendorIds: [] }, po)).toBe(true);
  });
  it('And needs every non-empty group to match', () => {
    expect(
      conditionsMatch({ join: 'And', clientIds: ['c1'], poTypes: ['Purchase Order'], vendorIds: [] }, po),
    ).toBe(true);
    expect(
      conditionsMatch({ join: 'And', clientIds: ['c1'], poTypes: ['Return Order'], vendorIds: [] }, po),
    ).toBe(false);
  });
  it('Or needs any group to match', () => {
    expect(
      conditionsMatch({ join: 'Or', clientIds: ['c9'], poTypes: ['Purchase Order'], vendorIds: [] }, po),
    ).toBe(true);
    expect(
      conditionsMatch({ join: 'Or', clientIds: ['c9'], poTypes: ['Return Order'], vendorIds: ['v9'] }, po),
    ).toBe(false);
  });
  it('a vendor condition never matches a PO without a vendor', () => {
    expect(
      conditionsMatch(
        { join: 'And', clientIds: [], poTypes: [], vendorIds: ['v1'] },
        { ...po, vendorId: null },
      ),
    ).toBe(false);
  });
});

describe('steps and schema', () => {
  it('normalizes to catalog order, fills missing steps, drops unknown ones and clears required on hidden steps', () => {
    const out = normalizeSteps([
      { key: 'bogus', enabled: true, required: true },
      { key: 'lot', enabled: false, required: true },
    ]);
    expect(out.map((s) => s.key)).toEqual(defaultSteps().map((s) => s.key));
    expect(out.find((s) => s.key === 'lot')).toEqual({ key: 'lot', enabled: false, required: false });
    expect(out.find((s) => s.key === 'printLabel')?.required).toBe(false);
  });
  it('requires a warehouse, a name and at least one enabled step', () => {
    const bad = screenConfigSchema.safeParse({
      ...screenConfigDefaults(null),
      steps: defaultSteps().map((s) => ({ ...s, enabled: false })),
    });
    const paths = bad.error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(paths).toEqual(expect.arrayContaining(['warehouseId', 'name', 'steps']));
  });
  it('describes conditions as a sentence', () => {
    expect(conditionSentence({ join: 'And' }, { clients: [], poTypes: [], vendors: [] })).toBe(
      'Every purchase order',
    );
    expect(
      conditionSentence({ join: 'Or' }, { clients: ['Apex'], poTypes: ['Transfer Order'], vendors: [] }),
    ).toBe('Client is Apex or PO type is Transfer Order');
  });
});

describe('screen config repository', () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: 'Web' });
  const input = (over: Partial<ScreenConfigFormValues> = {}) =>
    screenConfigSchema.parse({ ...screenConfigDefaults(w.warehouseId), name: 'KS-TEST Inbound', ...over });

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

  it('creates, lists, edits with version checks, and logs changes', async () => {
    const { id } = await createScreenConfig(w.db, auth, actor(), input());
    const { rows, total } = await listScreenConfigs(w.db, auth, EMPTY_GRID_QUERY);
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      name: 'KS-TEST Inbound',
      screenName: 'Receiving',
      isActive: true,
      conditionCount: 0,
    });

    const d = await loadScreenConfig(w.db, auth, id);
    const steps = d.steps.map((s) => (s.key === 'lot' ? { ...s, required: false } : s));
    const res = await updateScreenConfig(
      w.db,
      auth,
      actor(),
      id,
      input({
        name: 'KS-TEST Lot optional',
        steps,
        conditions: { join: 'Or', clientIds: [w.clientId], poTypes: ['Purchase Order'], vendorIds: [] },
        version: d.version,
      }),
    );
    expect(res.version).toBe(2);
    await expect(
      async () => await updateScreenConfig(w.db, auth, actor(), id, input({ version: 1 })),
    ).rejects.toThrow(/changed since you opened it/);

    const log = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id));
    expect(log.map((l) => l.type)).toEqual(expect.arrayContaining(['Create', 'Update']));
  });

  it('rejects a duplicate name in the same warehouse and a warehouse outside scope', async () => {
    await createScreenConfig(w.db, auth, actor(), input());
    await expect(
      async () => await createScreenConfig(w.db, auth, actor(), input({ name: 'ks-test inbound' })),
    ).rejects.toThrow(/already exists/);
    await expect(
      async () => await createScreenConfig(w.db, auth, actor(), input({ warehouseId: 'nope' })),
    ).rejects.toThrow(/warehouse you have access to/);
  });

  it('duplicates as inactive, toggles status and deletes', async () => {
    const { id } = await createScreenConfig(w.db, auth, actor(), input());
    const copy = await duplicateScreenConfig(w.db, auth, actor(), id);
    expect(copy.name).toBe('KS-TEST Inbound (copy)');
    expect((await loadScreenConfig(w.db, auth, copy.id)).isActive).toBe(false);
    expect((await setScreenConfigsActive(w.db, auth, actor(), [copy.id], true)).succeeded).toEqual([copy.id]);
    expect(
      (await deleteScreenConfigs(w.db, auth, actor(), [copy.id, 'missing'])).failed.map((f) => f.id),
    ).toEqual(['missing']);
  });

  it("picks the condition-specific config before the catch-all and feeds M05's receiving requirements", async () => {
    const optionalLot = defaultSteps().map((s) => (s.key === 'lot' ? { ...s, required: false } : s));
    const all = await createScreenConfig(w.db, auth, actor(), input({ name: 'All POs' }));
    const returns = await createScreenConfig(
      w.db,
      auth,
      actor(),
      input({
        name: 'Returns',
        steps: optionalLot,
        conditions: { join: 'And', clientIds: [], poTypes: ['Return Order'], vendorIds: [] },
      }),
    );
    expect(
      (
        await configForPurchaseOrder(w.db, w.warehouseId, {
          clientId: w.clientId,
          poType: 'Return Order',
          vendorId: null,
        })
      )?.id,
    ).toBe(returns.id);
    expect(
      (
        await configForPurchaseOrder(w.db, w.warehouseId, {
          clientId: w.clientId,
          poType: 'Purchase Order',
          vendorId: null,
        })
      )?.id,
    ).toBe(all.id);
    const req = await receivingRequirements(w.db, w.warehouseId, {
      lot: true,
      expiry: true,
      production: false,
      serial: false,
    });
    expect(req.lot).toBe(false);
    expect(req.expiry).toBe(true);
  });
});
