/** M07 count lifecycle against an in-memory migrated DB: plan → job → count → recount → Update Inv., cancel, instant count. */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobTypeSettingsSchema } from '@/lib/domain-types';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { ledger } from '@/server/domain/ledger';
import { createCountJobs, createRecounts } from '@/server/repositories/counts-jobs';
import {
  cancelCountLines,
  cancelCountPlans,
  deleteCountLine,
  updateInventoryForLines,
  updateInventoryForPlans,
  varianceSummary,
} from '@/server/repositories/counts-ops';
import {
  createCountPlan,
  deleteCountPlan,
  getCountPlanDetail,
  listCountPlans,
  updateCountPlan,
} from '@/server/repositories/counts-plans';
import { listCountLines } from '@/server/repositories/counts-lines';
import { countSheet, createInstantCount, submitSheetLine } from '@/server/repositories/counts-sheet';
import { createCountPlanFromWave } from '@/server/repositories/counts-commands';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;
let cycleType: string;
let rid: string;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  // Supervisor: may post variances they counted themselves (four-eyes rule, counts-round3.test.ts covers the operator case).
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(['inventory.count_plans.delete']),
    restrictions: [],
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
  const jt = async (code: string, count: Record<string, boolean>) =>
    (
      await w.db
        .insert(schema.jobTypes)
        .values({
          code,
          description: code,
          warehouseId: w.warehouseId,
          operationType: 'Count',
          settings: jobTypeSettingsSchema.parse({ count }),
        })
        .returning()
    )[0].id;
  rid = (
    await w.db
      .insert(schema.lookupValues)
      .values({ type: 'adjustment_reason', name: 'Count variance' })
      .returning()
  )[0].id;
  cycleType = await jt('Cycle Count', { autoUpdateNoDifferenceLines: true });
  await jt('Instant Count', { instantCount: true });
});
afterEach(() => w.close());

const stock = async (qty: number, locationId: string, productId = w.productId) =>
  (
    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId,
      locationId,
      qty,
    })
  ).bucket;
const plan = async (id: string) =>
  (await w.db.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).limit(1))[0];
const linesOf = async (id: string) =>
  await w.db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id));
const onHandAt = async (locationId: string) =>
  (await w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, locationId))).reduce(
    (s, b) => s + b.onHand,
    0,
  );
const clean = async () => expect(await ledger.reconcileLedger(w.db)).toEqual([]);

async function skuPlan(name = 'KS-E2E-COUNT-1') {
  return await createCountPlan(w.db, w.ctx, auth, {
    code: name,
    warehouseId: w.warehouseId,
    description: null,
    scheduledAt: new Date().toISOString(),
    lockLocations: true,
    countType: 'SKU',
    locationIds: [],
    productIds: [w.productId],
  });
}

async function countLine(planId: string, lineId: string, qty: number) {
  const sheet = (await countSheet(w.db, auth.scope, planId)).find((l) => l.lineId === lineId);
  expect(sheet).toBeDefined();
  const entries = (sheet?.buckets ?? []).map((b) => ({ inventoryId: b.inventoryId, countedQty: qty }));
  return await submitSheetLine(w.db, w.ctx, auth, planId, { lineId, entries, note: null });
}

describe('count plan lifecycle (acceptance KS-E2E-COUNT-1)', () => {
  it('runs Pending → job → count → recount → Update Inv.', async () => {
    await stock(20, w.loc.storageA);
    await stock(5, w.loc.storageB);
    const p = await skuPlan();
    expect(p.status).toBe('Pending');
    expect(p.lockLocations).toBe(true);

    const jobs = await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 1,
      assigneeUserId: null,
    });
    expect(jobs.failed).toEqual([]);
    expect(jobs.jobIds).toHaveLength(2);
    expect((await plan(p.id))?.status).toBe('Ready To Count');
    const lines = await linesOf(p.id);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.status === 'Ready To Count' && l.jobId)).toBe(true);

    const lineA = lines.find((l) => l.locationId === w.loc.storageA);
    const lineB = lines.find((l) => l.locationId === w.loc.storageB);
    if (!lineA || !lineB) throw new Error('lines');
    expect((await countLine(p.id, lineA.id, 18)).status).toBe('Count Completed');
    expect((await plan(p.id))?.status).toBe('Count Started');
    // no difference + auto-update job type → Inventory Updated without posting
    expect((await countLine(p.id, lineB.id, 5)).status).toBe('Inventory Updated');
    expect((await plan(p.id))?.status).toBe('Count Completed');

    const grid = (await listCountLines(w.db, auth.scope, 'skus', EMPTY_GRID_QUERY)).rows.find(
      (r) => r.id === lineA.id,
    );
    expect(grid?.difference).toBe(-10);

    const rc = await createRecounts(w.db, w.ctx, auth, [lineA.id]);
    expect(rc.failed).toEqual([]);
    expect(rc.jobIds).toHaveLength(1);
    const after = await linesOf(p.id);
    expect(after.find((l) => l.id === lineA.id)?.status).toBe('Recount Created');
    const recount = after.find((l) => l.isRecountLine);
    expect(recount?.status).toBe('Ready To Count');
    expect(recount?.recountOfLineId).toBe(lineA.id);
    expect((await plan(p.id))?.status).toBe('Count Started');

    if (!recount) throw new Error('recount');
    await countLine(p.id, recount.id, 18);
    expect((await plan(p.id))?.status).toBe('Count Completed');
    const v = await varianceSummary(w.db, auth, { level: 'plan', ids: [p.id] });
    expect(v.rows).toHaveLength(1);
    expect(v.unitsDown).toBe(2);

    const res = await updateInventoryForPlans(w.db, w.ctx, auth, [p.id], rid);
    expect(res.failed).toEqual([]);
    expect(await onHandAt(w.loc.storageA)).toBe(18);
    const txn = await w.db
      .select()
      .from(schema.inventoryTransactions)
      .where(
        and(
          eq(schema.inventoryTransactions.type, 'Count'),
          eq(schema.inventoryTransactions.countPlanId, p.id),
        ),
      );
    expect(txn).toHaveLength(1);
    expect(txn[0]?.uomQty).toBe(-2);
    expect(txn[0]?.note).toContain('KS-E2E-COUNT-1');
    const final = await plan(p.id);
    expect(final?.status).toBe('Inventory Updated');
    expect(final?.inventoryUpdatedBy).toBe(w.userId);
    await clean();
  });

  it('plan Update Inv. posts Count Completed lines and cancels the uncounted rest (Logiwa parity)', async () => {
    await stock(10, w.loc.storageA);
    await stock(4, w.loc.storageB);
    const p = await skuPlan('KS-TEST-CNT-PARTIAL');
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 1,
      assigneeUserId: null,
    });
    const lineA = (await linesOf(p.id)).find((l) => l.locationId === w.loc.storageA);
    if (!lineA) throw new Error('line');
    await countLine(p.id, lineA.id, 7);
    const v = await varianceSummary(w.db, auth, { level: 'plan', ids: [p.id] });
    expect(v.linesToCancel).toEqual([{ code: 'KS-TEST-CNT-PARTIAL', lines: 1 }]);
    expect((await updateInventoryForPlans(w.db, w.ctx, auth, [p.id], rid)).failed).toEqual([]);
    expect(await onHandAt(w.loc.storageA)).toBe(7);
    expect(await onHandAt(w.loc.storageB)).toBe(4);
    const statuses = (await linesOf(p.id)).map((l) => l.status).sort();
    expect(statuses).toEqual(['Cancelled', 'Inventory Updated']);
    expect(
      (await w.db.select().from(schema.tasks).where(eq(schema.tasks.status, 'Pending'))).filter(
        (t) => t.countLineId,
      ),
    ).toEqual([]);
    await clean();
  });

  it('blocks a second Create Job', async () => {
    await stock(3, w.loc.storageA);
    const p = await skuPlan();
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    const again = await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    expect(again.failed[0]?.code).toBe('INVALID_STATE');
  });
});

describe('Update Inv. on open plans (Logiwa parity)', () => {
  it('on a Pending plan with nothing counted, is refused (Cancel closes it) and stock is untouched', async () => {
    await stock(3, w.loc.storageA);
    const p = await skuPlan();
    const summary = await varianceSummary(w.db, auth, { level: 'plan', ids: [p.id] });
    expect(summary.eligible).toBe(0);
    expect(summary.blocked[0]?.reason).toMatch(/Nothing is counted yet/);
    expect((await updateInventoryForPlans(w.db, w.ctx, auth, [p.id])).failed[0]?.code).toBe('INVALID_STATE');
    expect((await plan(p.id))?.status).toBe('Pending');
    expect(await onHandAt(w.loc.storageA)).toBe(3);
    await clean();
  });

  it('on a Ready to Count plan with nothing counted, is refused and its count tasks stay live', async () => {
    await stock(3, w.loc.storageA);
    const p = await skuPlan();
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    expect((await plan(p.id))?.status).toBe('Ready To Count');
    expect((await updateInventoryForPlans(w.db, w.ctx, auth, [p.id])).failed[0]?.message).toMatch(
      /Nothing is counted yet/,
    );
    expect((await plan(p.id))?.status).toBe('Ready To Count');
    expect(
      (await w.db.select().from(schema.tasks).where(eq(schema.tasks.status, 'Pending'))).filter(
        (t) => t.countLineId,
      ).length,
    ).toBe(1);
    await clean();
  });
});

describe('cancel, edit, delete', () => {
  it('cancelling a pending plan cancels its lines (locations unlock)', async () => {
    await stock(4, w.loc.storageA);
    const p = await skuPlan();
    expect((await cancelCountPlans(w.db, w.ctx, auth, [p.id])).failed).toEqual([]);
    expect((await plan(p.id))?.status).toBe('Cancelled');
    expect((await linesOf(p.id)).every((l) => l.status === 'Cancelled')).toBe(true);
  });

  it('cancelling a ready plan cancels its pending tasks and jobs', async () => {
    await stock(4, w.loc.storageA);
    const p = await skuPlan();
    const { jobIds } = await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    await cancelCountPlans(w.db, w.ctx, auth, [p.id]);
    const job = (
      await w.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobIds[0] ?? ''))
        .limit(1)
    )[0];
    expect(job?.status).toBe('Cancelled');
    expect(
      (
        await w.db
          .select()
          .from(schema.tasks)
          .where(eq(schema.tasks.jobId, jobIds[0] ?? ''))
      ).every((t) => t.status === 'Cancelled'),
    ).toBe(true);
  });

  it('cancelling the only open line cancels the plan', async () => {
    await stock(4, w.loc.storageA);
    const p = await skuPlan();
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    const [line] = await linesOf(p.id);
    expect((await cancelCountLines(w.db, w.ctx, auth, [line?.id ?? ''])).failed).toEqual([]);
    expect((await plan(p.id))?.status).toBe('Cancelled');
  });

  it('edits a pending plan with a version check and rejects stale versions', async () => {
    const p = await createCountPlan(w.db, w.ctx, auth, {
      code: 'LOC-1',
      warehouseId: w.warehouseId,
      description: 'x',
      scheduledAt: new Date().toISOString(),
      lockLocations: false,
      countType: 'Location',
      locationIds: [w.loc.storageA],
      productIds: [],
    });
    const u = await updateCountPlan(w.db, w.ctx, auth, p.id, {
      version: p.version,
      code: 'LOC-1',
      warehouseId: w.warehouseId,
      description: 'y',
      scheduledAt: new Date().toISOString(),
      lockLocations: true,
      countType: 'Location',
      locationIds: [w.loc.storageA, w.loc.storageB],
      productIds: [],
    });
    expect(u.locationCount).toBe(2);
    await expect(
      async () =>
        await updateCountPlan(w.db, w.ctx, auth, p.id, {
          version: p.version,
          code: 'LOC-1',
          warehouseId: w.warehouseId,
          description: 'z',
          scheduledAt: new Date().toISOString(),
          lockLocations: true,
          countType: 'Location',
          locationIds: [w.loc.storageA],
          productIds: [],
        }),
    ).rejects.toThrow(/changed/);
    const logs = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, p.id));
    expect(logs.some((l) => l.field === 'lockLocations')).toBe(true);
  });

  it('rejects duplicate names and deletes only pending plans / lines', async () => {
    await createCountPlan(w.db, w.ctx, auth, {
      code: 'DUP',
      warehouseId: w.warehouseId,
      description: null,
      scheduledAt: new Date().toISOString(),
      lockLocations: false,
      countType: 'Location',
      locationIds: [w.loc.storageA],
      productIds: [],
    });
    await expect(
      async () =>
        await createCountPlan(w.db, w.ctx, auth, {
          code: 'dup',
          warehouseId: w.warehouseId,
          description: null,
          scheduledAt: new Date().toISOString(),
          lockLocations: false,
          countType: 'Location',
          locationIds: [w.loc.storageA],
          productIds: [],
        }),
    ).rejects.toThrow(/already exists/);
    const p = await createCountPlan(w.db, w.ctx, auth, {
      code: 'TWO',
      warehouseId: w.warehouseId,
      description: null,
      scheduledAt: new Date().toISOString(),
      lockLocations: false,
      countType: 'SKU',
      locationIds: [],
      productIds: [w.productId, w.product2Id],
    });
    const [first, second] = await linesOf(p.id);
    await deleteCountLine(w.db, w.ctx, auth, first?.id ?? '');
    await expect(async () => await deleteCountLine(w.db, w.ctx, auth, second?.id ?? '')).rejects.toThrow(
      /at least one line/,
    );
    await deleteCountPlan(w.db, w.ctx, auth, p.id);
    expect(await plan(p.id)).toBeUndefined();
  });

  it('lists plans with counts and detail', async () => {
    await stock(2, w.loc.storageA);
    const p = await skuPlan();
    const row = (await listCountPlans(w.db, auth.viewScope, EMPTY_GRID_QUERY)).rows.find(
      (r) => r.id === p.id,
    );
    expect(row).toMatchObject({ skuCount: 1, countType: 'SKU', status: 'Pending' });
    const detail = await getCountPlanDetail(w.db, auth.scope, p.code);
    expect(detail.plan.id).toBe(p.id);
    expect(detail.productIds).toEqual([w.productId]);
  });
});

describe('update inventory per line + found stock', () => {
  it('posts found stock into a new bucket', async () => {
    const p = await createCountPlan(w.db, w.ctx, auth, {
      code: 'FOUND',
      warehouseId: w.warehouseId,
      description: null,
      scheduledAt: new Date().toISOString(),
      lockLocations: false,
      countType: 'Location',
      locationIds: [w.loc.storageB],
      productIds: [],
    });
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    const [line] = await linesOf(p.id);
    await submitSheetLine(w.db, w.ctx, auth, p.id, {
      lineId: line?.id ?? '',
      entries: [{ productId: w.product2Id, countedQty: 7 }],
      note: 'found on floor',
    });
    expect((await updateInventoryForLines(w.db, w.ctx, auth, [line?.id ?? ''], rid)).failed).toEqual([]);
    expect(await onHandAt(w.loc.storageB)).toBe(7);
    expect((await plan(p.id))?.status).toBe('Inventory Updated');
    await clean();
  });
});

describe('instant count', () => {
  it('auto-updates a no-variance instant count and leaves no open line', async () => {
    const b = await stock(9, w.loc.storageA);
    const r = await createInstantCount(
      w.db,
      w.ctx,
      auth,
      {
        warehouseId: w.warehouseId,
        locationId: w.loc.storageA,
        entries: [{ inventoryId: b.id, countedQty: 9 }],
        note: null,
        updateInventory: false,
        reasonId: null,
      },
      false,
    );
    expect(r.code).toMatch(/^IC\d{17}$/);
    expect(r.status).toBe('Inventory Updated');
    expect((await linesOf(r.planId)).every((l) => l.status === 'Inventory Updated')).toBe(true);
    expect((await plan(r.planId))?.operationType).toBe('Instant Count');
  });

  it('posts an instant count variance when asked', async () => {
    const b = await stock(9, w.loc.storageA);
    const r = await createInstantCount(
      w.db,
      w.ctx,
      auth,
      {
        warehouseId: w.warehouseId,
        locationId: w.loc.storageA,
        entries: [{ inventoryId: b.id, countedQty: 6 }],
        note: null,
        updateInventory: true,
        reasonId: rid,
      },
      true,
    );
    expect(r.status).toBe('Inventory Updated');
    expect(await onHandAt(w.loc.storageA)).toBe(6);
    await clean();
  });

  it('keeps the variance for review without update permission', async () => {
    const b = await stock(9, w.loc.storageA);
    const r = await createInstantCount(
      w.db,
      w.ctx,
      auth,
      {
        warehouseId: w.warehouseId,
        locationId: w.loc.storageA,
        entries: [{ inventoryId: b.id, countedQty: 6 }],
        note: null,
        updateInventory: false,
        reasonId: null,
      },
      false,
    );
    expect(r.status).toBe('Count Completed');
    expect(await onHandAt(w.loc.storageA)).toBe(9);
  });

  it('rejects Create Recount on instant count lines (Logiwa: Cycle Count plans only)', async () => {
    const b = await stock(9, w.loc.storageA);
    const r = await createInstantCount(
      w.db,
      w.ctx,
      auth,
      {
        warehouseId: w.warehouseId,
        locationId: w.loc.storageA,
        entries: [{ inventoryId: b.id, countedQty: 6 }],
        note: null,
        updateInventory: false,
        reasonId: null,
      },
      false,
    );
    const [line] = await linesOf(r.planId);
    const rc = await createRecounts(w.db, w.ctx, auth, [line?.id ?? '']);
    expect(rc.succeeded).toEqual([]);
    expect(rc.failed[0]?.message).toMatch(/Instant/);
    expect(await linesOf(r.planId)).toHaveLength(1);
  });
});

describe('location line delete', () => {
  it('removes a location from a pending location plan but keeps the last one', async () => {
    const p = await createCountPlan(w.db, w.ctx, auth, {
      code: 'LOC-DEL',
      warehouseId: w.warehouseId,
      description: null,
      scheduledAt: new Date().toISOString(),
      lockLocations: false,
      countType: 'Location',
      locationIds: [w.loc.storageA, w.loc.storageB],
      productIds: [],
    });
    const [first, second] = await linesOf(p.id);
    await deleteCountLine(w.db, w.ctx, auth, first?.id ?? '');
    expect((await linesOf(p.id)).map((l) => l.id)).toEqual([second?.id]);
    await expect(async () => await deleteCountLine(w.db, w.ctx, auth, second?.id ?? '')).rejects.toThrow(
      /at least one line/,
    );
  });

  it('links plan jobs in the plan grid', async () => {
    await stock(4, w.loc.storageA);
    const p = await skuPlan('KS-TEST-CNT-JOBREF');
    const { jobIds } = await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    const row = (await listCountPlans(w.db, auth.viewScope, EMPTY_GRID_QUERY)).rows.find(
      (r) => r.id === p.id,
    );
    expect(row?.jobRefs?.split(';').map((x) => x.split('|')[0])).toEqual(jobIds);
  });
});

describe('wave command', () => {
  it('creates a cycle count plan with jobs from a wave rule', async () => {
    await stock(3, w.loc.storageA);
    const rule = (
      await w.db
        .insert(schema.waveRules)
        .values({
          ruleSeq: 1,
          name: 'Cycle',
          warehouseId: w.warehouseId,
          operationType: 'Cycle Count',
          countType: 'Location',
        })
        .returning()
    )[0];
    const wave = (
      await w.db
        .insert(schema.waves)
        .values({ waveNo: '1-1', waveRuleId: rule.id, warehouseId: w.warehouseId, runBy: 'admin' })
        .returning()
    )[0];
    const res = await createCountPlanFromWave(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      waveId: wave.id,
      waveRuleId: rule.id,
      countType: 'Location',
    });
    expect(res.code).toMatch(/^CNT/);
    expect(res.lineCount).toBe(1);
    expect(res.jobIds).toHaveLength(1);
    expect((await plan(res.countPlanId))?.status).toBe('Ready To Count');
  });
});

describe('mandatory reason for cycle count', () => {
  async function countedPlan() {
    await stock(20, w.loc.storageA);
    const p = await skuPlan('KS-REASON-1');
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 1,
      assigneeUserId: null,
    });
    const line = (await linesOf(p.id))[0];
    if (!line) throw new Error('line');
    await countLine(p.id, line.id, 17);
    return { p, line };
  }
  const requireReason = async () =>
    await w.db
      .update(schema.warehouses)
      .set({ mandatoryCountReason: true })
      .where(eq(schema.warehouses.id, w.warehouseId));

  it('rejects Update Inv. without a reason when the warehouse requires one', async () => {
    await requireReason();
    const { p } = await countedPlan();
    const res = await updateInventoryForPlans(w.db, w.ctx, auth, [p.id]);
    expect(res.succeeded).toEqual([]);
    expect(res.failed[0]?.message).toMatch(/requires a reason/);
    expect(await onHandAt(w.loc.storageA)).toBe(20);
    expect((await varianceSummary(w.db, auth, { level: 'plan', ids: [p.id] })).reasonRequired).toBe(true);
  });

  it('posts with a valid reason and stores it on the Count transaction', async () => {
    await requireReason();
    const reason = (
      await w.db
        .insert(schema.lookupValues)
        .values({ type: 'adjustment_reason', name: 'Cycle count variance' })
        .returning()
    )[0];
    const { p, line } = await countedPlan();
    const res = await updateInventoryForLines(w.db, w.ctx, auth, [line.id], reason.id);
    expect(res.failed).toEqual([]);
    expect(await onHandAt(w.loc.storageA)).toBe(17);
    const txn = (
      await w.db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.type, 'Count'),
            eq(schema.inventoryTransactions.countPlanId, p.id),
          ),
        )
        .limit(1)
    )[0];
    expect(txn?.adjustmentReasonId).toBe(reason.id);
    expect((await plan(p.id))?.status).toBe('Inventory Updated');
    await clean();
  });

  it('rejects a non-zero variance without a reason even when the warehouse does not require one', async () => {
    const { p, line } = await countedPlan();
    expect((await varianceSummary(w.db, auth, { level: 'line', ids: [line.id] })).reasonRequired).toBe(true);
    const res = await updateInventoryForPlans(w.db, w.ctx, auth, [p.id]);
    expect(res.succeeded).toEqual([]);
    expect(res.failed[0]?.message).toMatch(/requires a reason/);
    expect(await onHandAt(w.loc.storageA)).toBe(20);
    expect((await linesOf(p.id)).every((l) => l.status === 'Count Completed')).toBe(true);
  });

  it('rejects an unknown reason id', async () => {
    const { line } = await countedPlan();
    const res = await updateInventoryForLines(w.db, w.ctx, auth, [line.id], 'not-a-reason');
    expect(res.failed[0]?.message).toMatch(/valid adjustment reason/);
  });
});

describe('Count SKU Details (per-SKU results for every plan type)', () => {
  it('lists SKUs counted inside a location plan, keyed to the real line', async () => {
    await stock(20, w.loc.storageA);
    const p = await createCountPlan(w.db, w.ctx, auth, {
      code: 'LOC-SKU-1',
      warehouseId: w.warehouseId,
      description: null,
      scheduledAt: new Date().toISOString(),
      lockLocations: false,
      countType: 'Location',
      locationIds: [w.loc.storageA],
      productIds: [],
    });
    // Before counting, every SKU on hand in scope is listed with its expected qty.
    const before = (await listCountLines(w.db, auth.viewScope, 'skus', EMPTY_GRID_QUERY)).rows.filter(
      (r) => r.planCode === 'LOC-SKU-1',
    );
    expect(before).toHaveLength(1);
    expect(before[0]?.productId).toBe(w.productId);
    expect(before[0]?.initialStockQty).toBe(20);
    expect(before[0]?.countedQty).toBeNull();
    expect(before[0]?.status).toBe('Pending');
    await createCountJobs(w.db, w.ctx, auth, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    const line = (await linesOf(p.id))[0];
    expect(line).toBeDefined();
    await countLine(p.id, line?.id ?? '', 18);
    const rows = (await listCountLines(w.db, auth.viewScope, 'skus', EMPTY_GRID_QUERY)).rows.filter(
      (r) => r.planCode === 'LOC-SKU-1',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lineId).toBe(line?.id);
    expect(rows[0]?.id).not.toBe(line?.id);
    expect(rows[0]?.productId).toBe(w.productId);
    expect(rows[0]?.countedQty).toBe(18);
    expect(rows[0]?.approvedStockQty).toBe(20);
    expect(rows[0]?.difference).toBe(-10);
    // Location Details keeps one row per location line.
    const loc = (await listCountLines(w.db, auth.viewScope, 'locations', EMPTY_GRID_QUERY)).rows.filter(
      (r) => r.planCode === 'LOC-SKU-1',
    );
    expect(loc.map((r) => r.id)).toEqual([line?.id]);
  });
  it('keeps SKU-count lines (no location) off Location Details', async () => {
    await skuPlan('SKU-ONLY');
    expect(
      (await listCountLines(w.db, auth.viewScope, 'locations', EMPTY_GRID_QUERY)).rows.filter(
        (r) => r.planCode === 'SKU-ONLY',
      ),
    ).toHaveLength(0);
    expect(
      (await listCountLines(w.db, auth.viewScope, 'skus', EMPTY_GRID_QUERY)).rows.filter(
        (r) => r.planCode === 'SKU-ONLY',
      ),
    ).toHaveLength(1);
  });
});
