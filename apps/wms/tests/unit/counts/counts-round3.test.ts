/**
 * Round 3 (parity loop): one open count per location / SKU, Lock Locations against other plans,
 * orphaned lines after a job cancel, and the four-eyes rule on count variances.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobTypeSettingsSchema } from '@/lib/domain-types';
import {
  orphanedLinesMessage,
  planCreateJobReason,
  planUpdateInvReason,
  selfApprovalReason,
} from '@/lib/grid-defs/counts/count-math';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import * as jobs from '@/server/domain/jobs';
import * as tasks from '@/server/domain/tasks';
import { ledger } from '@/server/domain/ledger';
import { createCountPlanFromWave } from '@/server/repositories/counts-commands';
import { foreignCountLock, openCountConflicts } from '@/server/repositories/counts-conflicts';
import { createCountJobs, orphanedLines, previewCountJobs } from '@/server/repositories/counts-jobs';
import {
  updateInventoryForLines,
  updateInventoryForPlans,
  varianceSummary,
} from '@/server/repositories/counts-ops';
import { countPlansById, createCountPlan, updateCountPlan } from '@/server/repositories/counts-plans';
import {
  countSheet,
  createInstantCount,
  instantLocation,
  submitSheetLine,
} from '@/server/repositories/counts-sheet';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let supervisor: AuthContext;
let operator: AuthContext;
let cycleType: string;
let rid: string;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  const base = {
    scope,
    viewScope: scope,
    restrictions: [],
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  };
  supervisor = {
    ...base,
    permissions: new Set<string>(['inventory.count_plans.delete']),
  } as unknown as AuthContext;
  operator = {
    ...base,
    permissions: new Set<string>(['inventory.count_plans.update_inv']),
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
  cycleType = await jt('Cycle Count', {});
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
const planRow = async (id: string) =>
  (await w.db.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).limit(1))[0];
const linesOf = async (id: string) =>
  await w.db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id));

async function locPlan(code: string, locationIds: string[], lockLocations = false) {
  return await createCountPlan(w.db, w.ctx, supervisor, {
    code,
    warehouseId: w.warehouseId,
    description: null,
    scheduledAt: new Date().toISOString(),
    lockLocations,
    countType: 'Location',
    locationIds,
    productIds: [],
  });
}
async function skuPlan(code: string, lockLocations = false) {
  return await createCountPlan(w.db, w.ctx, supervisor, {
    code,
    warehouseId: w.warehouseId,
    description: null,
    scheduledAt: new Date().toISOString(),
    lockLocations,
    countType: 'SKU',
    locationIds: [],
    productIds: [w.productId],
  });
}
async function countAll(planId: string, qty: number) {
  for (const l of await countSheet(w.db, supervisor.scope, planId)) {
    await submitSheetLine(w.db, w.ctx, supervisor, planId, {
      lineId: l.lineId,
      entries: l.buckets.map((b) => ({ inventoryId: b.inventoryId, countedQty: qty })),
      note: null,
    });
  }
}

describe('one open count per location / SKU', () => {
  it('rejects a second open plan on the same location, naming the plan', async () => {
    await stock(5, w.loc.storageA);
    await locPlan('R3-A', [w.loc.storageA], true);
    await expect(async () => await locPlan('R3-B', [w.loc.storageA, w.loc.storageB])).rejects.toThrow(
      /already in an open count plan: A-01-01 \(R3-A\)/,
    );
    expect(
      (
        await openCountConflicts(w.db, {
          warehouseId: w.warehouseId,
          locationIds: [w.loc.storageA, w.loc.storageB],
        })
      ).map((c) => c.planCode),
    ).toEqual(['R3-A']);
  });

  it('rejects a second open SKU plan for the same SKU, but frees it once the first is cancelled', async () => {
    await stock(5, w.loc.storageA);
    const a = await skuPlan('R3-S1');
    await expect(async () => await skuPlan('R3-S2')).rejects.toThrow(/R3-S1/);
    await w.db.update(schema.countPlans).set({ status: 'Cancelled' }).where(eq(schema.countPlans.id, a.id));
    expect((await skuPlan('R3-S2')).code).toBe('R3-S2');
  });

  it("an edit keeps its own lines but cannot add another plan's location", async () => {
    const a = await locPlan('R3-E1', [w.loc.storageA]);
    await locPlan('R3-E2', [w.loc.storageB]);
    const v = (await planRow(a.id))?.version ?? 1;
    const input = {
      code: 'R3-E1',
      warehouseId: w.warehouseId,
      description: null,
      scheduledAt: new Date().toISOString(),
      lockLocations: false,
      countType: 'Location' as const,
      productIds: [],
    };
    expect(
      (
        await updateCountPlan(w.db, w.ctx, supervisor, a.id, {
          ...input,
          version: v,
          locationIds: [w.loc.storageA],
        })
      ).code,
    ).toBe('R3-E1');
    await expect(
      async () =>
        await updateCountPlan(w.db, w.ctx, supervisor, a.id, {
          ...input,
          version: (await planRow(a.id))?.version ?? v,
          locationIds: [w.loc.storageA, w.loc.storageB],
        }),
    ).rejects.toThrow(/R3-E2/);
  });

  it('a cycle-count wave skips locations that are already in an open count', async () => {
    await stock(5, w.loc.storageA);
    await stock(5, w.loc.storageB);
    await locPlan('R3-W1', [w.loc.storageA]);
    const wave = (
      await w.db
        .insert(schema.waveRules)
        .values({ ruleSeq: 1, name: 'CC', warehouseId: w.warehouseId, operationType: 'Cycle Count' } as never)
        .returning()
    )[0];
    const res = await createCountPlanFromWave(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      waveId: 'none',
      waveRuleId: wave.id,
      countType: 'Location',
      locationIds: [w.loc.storageA, w.loc.storageB],
      jobTypeId: cycleType,
    });
    expect(res.lineCount).toBe(1);
    expect((await linesOf(res.countPlanId)).map((l) => l.locationId)).toEqual([w.loc.storageB]);
  });
});

describe('Lock Locations holds against other plans', () => {
  it('another plan cannot post into a location a locking plan holds; the holder can', async () => {
    await stock(9, w.loc.storageA);
    const holder = await locPlan('R3-L1', [w.loc.storageA], true);
    // Legacy overlap (created before the guard existed): insert a second plan on the same location directly.
    const other = (
      await w.db
        .insert(schema.countPlans)
        .values({
          code: 'R3-L2',
          warehouseId: w.warehouseId,
          scheduledAt: new Date().toISOString(),
          countType: 'Location',
          operationType: 'Cycle Count',
          status: 'Pending',
          lockLocations: false,
        })
        .returning()
    )[0];
    await w.db
      .insert(schema.countPlanLines)
      .values({ planId: other.id, locationId: w.loc.storageA, status: 'Pending', initialStockQty: 9 });
    expect(await foreignCountLock(w.db, other, w.loc.storageA)).toBe('R3-L1');
    expect(await foreignCountLock(w.db, (await planRow(holder.id))!, w.loc.storageA)).toBeNull();
    await createCountJobs(w.db, w.ctx, supervisor, {
      ids: [other.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    await countAll(other.id, 13);
    const res = await updateInventoryForPlans(w.db, w.ctx, supervisor, [other.id], rid);
    expect(res.failed[0]?.message).toMatch(/A-01-01 is locked by count plan R3-L1/);
    expect(
      (
        await w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.storageA))
      ).reduce((s, b) => s + b.onHand, 0),
    ).toBe(9);
  });

  it('Quick Count refuses a location held by a Lock Locations plan and reports the lock on lookup', async () => {
    const b = await stock(4, w.loc.storageA);
    await locPlan('R3-Q1', [w.loc.storageA], true);
    expect((await instantLocation(w.db, supervisor.scope, w.warehouseId, 'A-01-01')).lockedBy).toBe('R3-Q1');
    await expect(
      async () =>
        await createInstantCount(
          w.db,
          w.ctx,
          supervisor,
          {
            warehouseId: w.warehouseId,
            locationId: w.loc.storageA,
            entries: [{ inventoryId: b.id, countedQty: 5 }],
            note: null,
            updateInventory: true,
            reasonId: rid,
          },
          true,
        ),
    ).rejects.toThrow(/locked by count plan R3-Q1/);
  });
});

describe('orphaned lines after a count job is cancelled', () => {
  it('offers Create Job again and re-issues tasks for exactly the orphaned lines', async () => {
    await stock(5, w.loc.storageA);
    await stock(5, w.loc.storageB);
    const p = await locPlan('R3-O1', [w.loc.storageA, w.loc.storageB], true);
    const { jobIds } = await createCountJobs(w.db, w.ctx, supervisor, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 1,
      assigneeUserId: null,
    });
    expect(jobIds).toHaveLength(2);
    const first = jobIds[0]!;
    const pendingTasks = (await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, first))).map(
      (t) => t.id,
    );
    await tasks.cancel(w.db, w.ctx, { taskIds: pendingTasks });
    await jobs.cancelJob(w.db, w.ctx, { jobId: first });
    expect(await orphanedLines(w.db, p.id)).toHaveLength(1);
    const row = (await countPlansById(w.db, supervisor.scope, [p.id]))[0]!;
    expect(row.status).toBe('Ready To Count');
    expect(row.orphanedLineCount).toBe(1);
    expect(planCreateJobReason(row.status, row.orphanedLineCount)).toBeNull();
    expect((await previewCountJobs(w.db, supervisor, [p.id]))[0]?.units).toBe(1);
    const again = await createCountJobs(w.db, w.ctx, supervisor, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    expect(again.failed).toEqual([]);
    expect(again.jobIds).toHaveLength(1);
    expect(await orphanedLines(w.db, p.id)).toHaveLength(0);
    expect((await countSheet(w.db, supervisor.scope, p.id)).every((l) => l.taskId)).toBe(true);
    // Nothing orphaned now: Create Job is refused again.
    expect(
      (
        await createCountJobs(w.db, w.ctx, supervisor, {
          ids: [p.id],
          jobTypeId: cycleType,
          batchSize: 10,
          assigneeUserId: null,
        })
      ).failed[0]?.code,
    ).toBe('INVALID_STATE');
  });

  it('guards and copy', () => {
    expect(planCreateJobReason('Ready To Count', 0)).not.toBeNull();
    expect(planCreateJobReason('Count Started', 3)).toBeNull();
    expect(planCreateJobReason('Count Completed', 3)).not.toBeNull();
    expect(orphanedLinesMessage(0)).toBeNull();
    expect(orphanedLinesMessage(50)).toMatch(/50 lines have no count task/);
  });
});

describe('four-eyes rule on count variances', () => {
  it('a counter without supervisor rights cannot post their own variance; a supervisor can', async () => {
    await stock(10, w.loc.storageA);
    const p = await locPlan('R3-F1', [w.loc.storageA]);
    await createCountJobs(w.db, w.ctx, supervisor, {
      ids: [p.id],
      jobTypeId: cycleType,
      batchSize: 10,
      assigneeUserId: null,
    });
    await countAll(p.id, 7);
    const line = (await linesOf(p.id))[0]!;
    expect(
      (await varianceSummary(w.db, operator, { level: 'line', ids: [line.id] })).blocked[0]?.reason,
    ).toMatch(/four-eyes/);
    expect((await updateInventoryForLines(w.db, w.ctx, operator, [line.id], rid)).failed[0]?.code).toBe(
      'FORBIDDEN',
    );
    expect((await updateInventoryForPlans(w.db, w.ctx, operator, [p.id], rid)).failed[0]?.message).toMatch(
      /four-eyes/,
    );
    expect((await updateInventoryForLines(w.db, w.ctx, supervisor, [line.id], rid)).failed).toEqual([]);
  });

  it("an operator's quick count with a variance waits for approval", async () => {
    const b = await stock(4, w.loc.storageA);
    const res = await createInstantCount(
      w.db,
      w.ctx,
      operator,
      {
        warehouseId: w.warehouseId,
        locationId: w.loc.storageA,
        entries: [{ inventoryId: b.id, countedQty: 6 }],
        note: null,
        updateInventory: true,
        reasonId: rid,
      },
      true,
      false,
    );
    expect(res.awaitingApproval).toBe(true);
    expect(res.status).toBe('Count Completed');
    expect(
      (await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, b.id)).limit(1))[0]?.onHand,
    ).toBe(4);
  });

  it('pure rules', () => {
    expect(selfApprovalReason({ countUserId: 'u1', hasVariance: true }, 'u1', false)).toMatch(/four-eyes/);
    expect(selfApprovalReason({ countUserId: 'u1', hasVariance: true }, 'u1', true)).toBeNull();
    expect(selfApprovalReason({ countUserId: 'u1', hasVariance: false }, 'u1', false)).toBeNull();
    expect(selfApprovalReason({ countUserId: 'u2', hasVariance: true }, 'u1', false)).toBeNull();
    expect(planUpdateInvReason('Pending', 0)).toMatch(/Cancel/);
  });
});
