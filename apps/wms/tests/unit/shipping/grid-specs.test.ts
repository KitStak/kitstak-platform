/**
 * Guards against grid-def / SQL drift: every field, search field and sort field a shipping grid
 * advertises must have SQL behind it, and every sort must run against a migrated DB. A field
 * added to a grid-def without SQL used to surface only as an HTTP 500 from the list route.
 */
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@/server/auth/context';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { compileGrid, type GridSpec } from '@/server/repositories/shipping-grid';
import { SHIPMENT_HISTORY_GRID } from '@/server/repositories/shipping-history';
import {
  ELIGIBLE_GRID,
  listEligibleOrders,
  listPlanLps,
  listPlanOrders,
  listPlans,
  PLAN_GRID,
  PLAN_LP_GRID,
  PLAN_ORDER_GRID,
} from '@/server/repositories/shipment-plans-lists';
import { createWorld } from '../foundation/domain/fixtures';

const SPECS: Readonly<Record<string, GridSpec>> = {
  plans: PLAN_GRID,
  planOrders: PLAN_ORDER_GRID,
  planLps: PLAN_LP_GRID,
  eligible: ELIGIBLE_GRID,
  history: SHIPMENT_HISTORY_GRID,
};

describe('shipping grid specs', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    it(`${name}: every field, search field and sort field has SQL`, () => {
      const missing = [...spec.fields.map((f) => f.field), ...spec.searchFields, ...spec.sortFields].filter(
        (f) => !spec.sqlFor[f],
      );
      expect(missing).toEqual([]);
      for (const field of spec.sortFields)
        expect(() =>
          compileGrid(spec, { ...EMPTY_GRID_QUERY, sort: [{ field, dir: 'desc' }] }),
        ).not.toThrow();
    });
  }

  it('every sort runs against the DB for the plan grids and the order picker', async () => {
    const w = await createWorld();
    try {
      const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
      const auth = {
        scope,
        viewScope: scope,
        permissions: new Set<string>(),
        restrictions: [],
        user: { id: w.userId },
        context: { warehouseId: null, clientId: null },
      } as unknown as AuthContext;
      const run = async (spec: GridSpec, list: (q: typeof EMPTY_GRID_QUERY) => Promise<unknown>) => {
        for (const field of spec.sortFields)
          await list({ ...EMPTY_GRID_QUERY, sort: [{ field, dir: 'asc' }], q: 'SO' });
      };
      await run(
        ELIGIBLE_GRID,
        async (q) => await listEligibleOrders(w.db, auth, q, { warehouseId: w.warehouseId }),
      );
      await run(PLAN_GRID, async (q) => await listPlans(w.db, auth, q));
      await run(PLAN_ORDER_GRID, async (q) => await listPlanOrders(w.db, auth, q));
      await run(PLAN_LP_GRID, async (q) => await listPlanLps(w.db, auth, q));
    } finally {
      await w.close();
    }
  });
});
