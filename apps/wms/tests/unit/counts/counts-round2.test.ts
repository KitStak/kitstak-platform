/** M07 round 2 (parity loop): job preview, SKU list on lines, assignees, AI suggest, blind sheet, accuracy, pickers, timeline copy. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobTypeSettingsSchema } from '@/lib/domain-types';
import { jobsForUnits, scoreCountRisk } from '@/lib/grid-defs/counts/count-math';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { ledger } from '@/server/domain/ledger';
import { createCountJobs, previewCountJobs } from '@/server/repositories/counts-jobs';
import { createCountPlan, getCountPlanDetail } from '@/server/repositories/counts-plans';
import { countSheet, submitSheetLine } from '@/server/repositories/counts-sheet';
import { countAssignees } from '@/server/repositories/counts-assignees';
import { suggestCountTargets } from '@/server/repositories/counts-suggest';
import { countAccuracy } from '@/server/repositories/counts-accuracy';
import { listPickProducts } from '@/server/repositories/counts-pickers';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { countChangeMessage } from '@/components/counts/count-timeline';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;
let cycleType: string;

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
  cycleType = (
    await w.db
      .insert(schema.jobTypes)
      .values({
        code: 'CC',
        description: 'Cycle',
        warehouseId: w.warehouseId,
        operationType: 'Count',
        settings: jobTypeSettingsSchema.parse({ count: {} }),
      })
      .returning()
  )[0].id;
});
afterEach(() => w.close());

const stock = async (qty: number, locationId: string) =>
  await ledger.add(w.db, w.ctx, {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    productId: w.productId,
    locationId,
    qty,
  });
const base = {
  description: null,
  scheduledAt: new Date().toISOString(),
  lockLocations: false,
  lpIds: [] as string[],
};
const skuPlan = async (code: string) =>
  await createCountPlan(w.db, w.ctx, auth, {
    ...base,
    warehouseId: w.warehouseId,
    code,
    countType: 'SKU',
    locationIds: [],
    productIds: [w.productId],
  });
const locPlan = async (code: string, locationIds: string[]) =>
  await createCountPlan(w.db, w.ctx, auth, {
    ...base,
    warehouseId: w.warehouseId,
    code,
    countType: 'Location',
    locationIds,
    productIds: [],
  });

describe('Create Job preview', () => {
  it('jobsForUnits is ceil(units / batch)', () => {
    expect(jobsForUnits(2, 1)).toBe(2);
    expect(jobsForUnits(5, 2)).toBe(3);
    expect(jobsForUnits(0, 5)).toBe(0);
    expect(jobsForUnits(3, 0)).toBe(3);
  });

  it('previews a SKU plan by its stocked locations, and matches the jobs Save creates', async () => {
    await stock(5, w.loc.storageA);
    await stock(4, w.loc.storageB);
    const p = await skuPlan('KS-PREV-1');
    const [preview] = await previewCountJobs(w.db, auth, [p.id]);
    expect(preview?.units).toBe(2);
    const res = await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 1,
      assigneeUserId: null,
    });
    expect(res.jobIds.length).toBe(jobsForUnits(preview?.units ?? 0, 1));
  });
});

describe('line SKU columns', () => {
  it('a location line lists the SKUs on hand before counting, and Item Type / Group come from the product', async () => {
    await stock(5, w.loc.storageA);
    const p = await locPlan('KS-SKUL-1', [w.loc.storageA]);
    const detail = await getCountPlanDetail(w.db, auth.scope, p.id);
    const sku = (
      await w.db.select().from(schema.products).where(eq(schema.products.id, w.productId)).limit(1)
    )[0]?.sku;
    expect(detail.lines[0]?.skuList).toBe(sku);
    expect(detail.lines[0]).toHaveProperty('productType');
    expect(detail.lines[0]).toHaveProperty('locationType');
  });
});

describe('count assignees', () => {
  it('lists active warehouse staff who can count, never client-portal or API users', async () => {
    const client = (
      await w.db
        .insert(schema.users)
        .values({
          email: 'portal@client.test',
          name: 'Portal User',
          role: 'viewer',
          userType: 'Client',
          passwordHash: 'x',
        })
        .returning()
    )[0];
    const api = (
      await w.db
        .insert(schema.users)
        .values({ email: 'api@x.test', name: 'API', role: 'operator', isApiUser: true, passwordHash: 'x' })
        .returning()
    )[0];
    const ids = (await countAssignees(w.db, auth.scope, w.warehouseId)).map((u) => u.id);
    expect(ids).not.toContain(client.id);
    expect(ids).not.toContain(api.id);
  });
});

describe('AI count plan', () => {
  it('scores never-counted, fast-moving, inaccurate A locations highest, with reasons', () => {
    const hot = scoreCountRisk({ daysSinceCount: null, moves: 20, pastVariances: 3, abcCode: 'A' }, 20);
    const cold = scoreCountRisk({ daysSinceCount: 2, moves: 0, pastVariances: 0, abcCode: 'C' }, 20);
    expect(hot.score).toBe(100);
    expect(hot.reasons[0]).toBe('Never counted');
    expect(cold.score).toBeLessThan(5);
    expect(cold.reasons).toEqual([]);
  });

  it('suggests stocked locations not already in an open count', async () => {
    await stock(5, w.loc.storageA);
    await stock(4, w.loc.storageB);
    await locPlan('KS-AI-OPEN', [w.loc.storageA]);
    const ids = (
      await suggestCountTargets(w.db, auth.scope, {
        warehouseId: w.warehouseId,
        countType: 'Location',
        limit: 20,
      })
    ).map((s) => s.id);
    expect(ids).toContain(w.loc.storageB);
    expect(ids).not.toContain(w.loc.storageA);
  });

  it('saves a suggested plan as an AI Count Plan', async () => {
    await stock(5, w.loc.storageA);
    const p = await createCountPlan(w.db, w.ctx, auth, {
      ...base,
      warehouseId: w.warehouseId,
      code: 'KS-AI-1',
      countType: 'Location',
      locationIds: [w.loc.storageA],
      productIds: [],
      isAi: true,
    });
    expect(p.isAi).toBe(true);
  });
});

describe('blind count', () => {
  it('withholds system quantities on the sheet when the job type is blind, and still records the real variance', async () => {
    const blindType = (
      await w.db
        .insert(schema.jobTypes)
        .values({
          code: 'BLIND',
          description: 'Blind',
          warehouseId: w.warehouseId,
          operationType: 'Count',
          settings: {
            ...jobTypeSettingsSchema.parse({ count: {} }),
            count: { ...jobTypeSettingsSchema.parse({ count: {} }).count, blindCount: true },
          } as never,
        })
        .returning()
    )[0].id;
    await stock(5, w.loc.storageA);
    const p = await locPlan('KS-BLIND-1', [w.loc.storageA]);
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: blindType,
      batchSize: 10,
      assigneeUserId: null,
    });
    const [line] = await countSheet(w.db, auth.scope, p.id);
    expect(line?.blind).toBe(true);
    expect(line?.buckets.every((b) => b.systemQty === 0)).toBe(true);
    await submitSheetLine(w.db, w.ctx, auth, p.id, {
      lineId: line?.lineId ?? '',
      entries: line?.buckets.map((b) => ({ inventoryId: b.inventoryId, countedQty: 4 })) ?? [],
    });
    const entry = (await w.db.select().from(schema.countLineEntries))[0];
    expect(entry?.systemQty).toBe(5);
    expect(entry?.countedQty).toBe(4);
    const job = (await w.db.select().from(schema.jobs).where(eq(schema.jobs.countPlanId, p.id)).limit(1))[0];
    expect(job?.startedAt).toBeTruthy();
  });
});

describe('accuracy', () => {
  it('reports bucket accuracy from counted entries', async () => {
    await stock(5, w.loc.storageA);
    const p = await locPlan('KS-ACC-1', [w.loc.storageA]);
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    const [line] = await countSheet(w.db, auth.scope, p.id);
    await submitSheetLine(w.db, w.ctx, auth, p.id, {
      lineId: line?.lineId ?? '',
      entries: line?.buckets.map((b) => ({ inventoryId: b.inventoryId, countedQty: 3 })) ?? [],
    });
    const acc = await countAccuracy(w.db, auth.scope, { days: 90 });
    expect(acc.totals.buckets).toBe(1);
    expect(acc.totals.exactBuckets).toBe(0);
    expect(acc.totals.netVarianceUnits).toBe(-2);
    expect(acc.bySku[0]?.netVarianceUnits).toBe(-2);
  });
});

describe('product picker', () => {
  it('returns the warehouse on-hand from one grouped join', async () => {
    await stock(5, w.loc.storageA);
    await stock(4, w.loc.storageB);
    const row = (await listPickProducts(w.db, auth.scope, w.warehouseId, EMPTY_GRID_QUERY)).rows.find(
      (r) => r.id === w.productId,
    );
    expect(row?.onHand).toBe(9);
  });
});

describe('timeline copy', () => {
  it("names a recount line's first status entry instead of '— →', and uses pill casing", () => {
    expect(
      countChangeMessage({
        type: 'Update',
        field: 'status',
        fieldLabel: 'Status',
        fromValue: '—',
        toValue: 'Ready To Count',
        message: 'B-1 -> Status is modified. — --> Ready To Count',
        lineLabel: 'B-1',
        parentEntityType: 'count_plan',
      }),
    ).toBe('B-1: Recount line created (Ready to Count)');
    expect(
      countChangeMessage({
        type: 'Update',
        field: 'status',
        fieldLabel: 'Status',
        fromValue: 'Pending',
        toValue: 'Ready To Count',
        message: 'x',
        lineLabel: null,
        parentEntityType: null,
      }),
    ).toBe('Status changed from Pending to Ready to Count');
  });
});
