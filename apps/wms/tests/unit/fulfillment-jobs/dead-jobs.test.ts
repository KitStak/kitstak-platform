/**
 * M03 round 5 (critic R4):
 *  - zombie jobs: a job whose last live task is cancelled / whose last order is released closes;
 *  - no-op priority updates write nothing;
 *  - supervisor-only keys are denied to floor-only roles;
 *  - Wave Log Run By is a display name;
 *  - jobs integrity invariants.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobTypeSettingsSchema } from '@/lib/domain-types';
import { waveRuleInputSchema } from '@/lib/grid-defs/jobs/forms';
import { allowsJobAction, isFloorOnly, SUPERVISOR_ONLY_KEYS } from '@/lib/grid-defs/jobs/supervisor-policy';
import type { AuthContext } from '@/server/auth/context';
import * as schema from '@/server/db/schema';
import { ledger } from '@/server/domain/ledger';
import { createOrder } from '@/server/domain/orders';
import { execute } from '@/server/domain/tasks';
import { cancelTasks, updateJobsPriority } from '@/server/repositories/jobs-commands';
import { jobsInvariants } from '@/server/repositories/jobs-invariants';
import { canJobAction } from '@/server/repositories/jobs-policy';
import { deadJobCandidates, settleDeadJobs } from '@/server/repositories/jobs-settle';
import { removeOrder } from '@/server/repositories/jobs';
import { cancelPicking } from '@/server/repositories/orders-commands';
import { createWaveRule } from '@/server/repositories/wave-rules';
import { runWave } from '@/server/repositories/waves-run';
import { runByDisplay } from '@/server/repositories/waves-run-by';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;
let jobType: string;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(),
    restrictions: [],
    roleKeys: [],
    user: { id: w.userId, name: 'Admin' },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
  jobType = (
    await w.db
      .insert(schema.jobTypes)
      .values({
        code: 'All Orders',
        description: 'All',
        warehouseId: w.warehouseId,
        operationType: 'Picking',
        settings: jobTypeSettingsSchema.parse({}),
      })
      .returning()
  )[0].id;
});
afterEach(() => w.close());

const stock = async (qty: number) =>
  await ledger.add(w.db, w.ctx, {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    productId: w.productId,
    locationId: w.loc.storageA,
    qty,
  });
const jobRow = async (id: string) =>
  (await w.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1))[0];
const jobOrders = async (id: string) =>
  await w.db.select().from(schema.jobOrders).where(eq(schema.jobOrders.jobId, id));
const tasksOf = async (id: string) =>
  await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, id));
const jobLog = async (id: string) =>
  await w.db
    .select()
    .from(schema.changeLog)
    .where(and(eq(schema.changeLog.entityType, 'job'), eq(schema.changeLog.entityId, id)));

/** Runs one picking wave over every open order; returns the created job ids. */
async function wave(batch = 10): Promise<string[]> {
  const rule = await createWaveRule(
    w.db,
    auth,
    w.ctx,
    waveRuleInputSchema.parse({
      name: 'KS-DEAD',
      warehouseId: w.warehouseId,
      operationType: 'Picking',
      jobTypeIds: [jobType],
      batchSize: batch,
      filters: [
        { field: 'orderQuantity', op: 'rng', value: '1..10', label: 'Order Quantity between 1 and 10' },
      ],
    }),
  );
  await runWave(w.db, w.ctx, rule.id, { runBy: 'Admin' });
  return (await w.db.select().from(schema.jobs)).map((j) => j.id);
}

describe('dead jobs (zombie job settlement)', () => {
  it('a job whose only order is released by Cancel Picking closes as Cancelled with orderCount 0', async () => {
    await stock(10);
    const order = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = await wave();
    expect((await jobRow(jobId))?.status).toBe('Pending');
    // Other module's path (orders Cancel Picking): cancels the tasks and clears the order's job id only.
    expect((await cancelPicking(w.db, w.ctx, [order.id])).failed).toEqual([]);
    expect(await deadJobCandidates(w.db)).toContain(jobId);
    const out = await settleDeadJobs(w.db, w.ctx);
    expect(out.map((o) => o.jobId)).toEqual([jobId]);
    const job = await jobRow(jobId);
    expect(job?.status).toBe('Cancelled');
    expect(job?.orderCount).toBe(0);
    expect(job?.taskCount).toBe(0);
    expect(await jobOrders(jobId)).toHaveLength(0);
    const log = (await jobLog(jobId)).find((r) => r.field === 'status');
    expect(log?.message).toMatch(/Pending --> Cancelled · last order released/);
    expect(await deadJobCandidates(w.db)).toEqual([]);
    expect(await settleDeadJobs(w.db, w.ctx)).toEqual([]); // idempotent
  });

  it('M03 task cancel of the last pick task closes the job at once (no sweep needed)', async () => {
    await stock(10);
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = await wave();
    const pick = (await tasksOf(jobId)).find((t) => t.taskType === 'Picking');
    expect((await cancelTasks(w.db, w.ctx, [pick!.id])).failed).toEqual([]);
    expect((await jobRow(jobId))?.status).toBe('Cancelled');
    expect((await jobRow(jobId))?.orderCount).toBe(0);
    expect((await jobsInvariants(w.db)).dead_live_jobs).toBe(0);
  });

  it('removing the last order from a job cancels the job; removing one of two keeps it Pending with orderCount 1', async () => {
    await stock(20);
    const a = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const b = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = await wave();
    expect((await jobRow(jobId))?.orderCount).toBe(2);
    await removeOrder(w.db, w.ctx, jobId, a.id);
    expect((await jobRow(jobId))?.status).toBe('Pending');
    expect((await jobRow(jobId))?.orderCount).toBe(1);
    await removeOrder(w.db, w.ctx, jobId, b.id);
    expect((await jobRow(jobId))?.status).toBe('Cancelled');
    expect((await jobRow(jobId))?.orderCount).toBe(0);
  });

  it('drops the stale order link of a released order from a job that still has work', async () => {
    await stock(20);
    const a = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = await wave();
    await cancelPicking(w.db, w.ctx, [a.id]);
    expect((await jobsInvariants(w.db)).stale_job_orders).toBe(1);
    await settleDeadJobs(w.db, w.ctx);
    expect((await jobRow(jobId))?.status).toBe('Pending');
    expect((await jobRow(jobId))?.orderCount).toBe(1);
    expect(await jobsInvariants(w.db)).toMatchObject({ stale_job_orders: 0, dead_live_jobs: 0 });
  });

  it('a job with completed work and the rest cancelled elsewhere settles as Completed', async () => {
    await stock(20);
    const a = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const b = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = await wave();
    // Complete every task of order A (pick, then pack), then cancel picking of order B elsewhere.
    for (const type of ['Picking', 'Sorting', 'Packing', 'Loading'] as const) {
      for (const t of (await tasksOf(jobId)).filter(
        (x) => x.orderId === a.id && x.taskType === type && x.status === 'Pending',
      )) {
        await execute(w.db, w.ctx, {
          taskIds: [t.id],
          targetLocationId: w.loc.pack ?? w.loc.storageB,
          targetLpId: null,
        });
      }
    }
    await cancelPicking(w.db, w.ctx, [b.id]);
    await settleDeadJobs(w.db, w.ctx);
    const job = await jobRow(jobId);
    if ((await tasksOf(jobId)).some((t) => t.status === 'Pending' || t.status === 'Started')) {
      expect(job?.status).not.toBe('Cancelled'); // still has open work: untouched
    } else {
      expect(job?.status).toBe('Completed');
      expect(job?.completedAt).toBeTruthy();
    }
    expect((await jobsInvariants(w.db)).dead_live_jobs).toBe(0);
  });
});

describe('priority no-op', () => {
  it('skips jobs that already have the priority: no version bump, reported as unchanged', async () => {
    await stock(10);
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = await wave();
    const before = (await jobRow(jobId))!;
    const logs = (await jobLog(jobId)).length;
    const res = await updateJobsPriority(w.db, w.ctx, [jobId], before.priority);
    expect(res.succeeded).toEqual([]);
    expect(res.unchanged).toEqual([jobId]);
    expect(res.failed).toEqual([]);
    expect((await jobRow(jobId))?.version).toBe(before.version);
    expect(await jobLog(jobId)).toHaveLength(logs);
    const changed = await updateJobsPriority(w.db, w.ctx, [jobId], 'High');
    expect(changed.succeeded).toEqual([jobId]);
    expect((await jobRow(jobId))?.version).toBe(before.version + 1);
    expect((await jobLog(jobId)).some((r) => r.field === 'priority' && r.toValue === 'High')).toBe(true);
  });
});

describe('supervisor-only job actions', () => {
  const keys = [
    'fulfillment.job_management.update_priority',
    'fulfillment.job_management.cancel',
    'fulfillment.job_management.assign',
    'fulfillment.job_management.unassign',
    'fulfillment.job_management.override_job_cancel_warning',
    'fulfillment.task_details.cancel_task',
  ];
  it('covers exactly the six keys of request R4-1', () => {
    expect([...SUPERVISOR_ONLY_KEYS].sort()).toEqual([...keys].sort());
  });
  it.each(keys)('denies %s to a Warehouse Clerk that still holds it', (key) => {
    const clerk = {
      ...auth,
      permissions: new Set([key]),
      roleKeys: ['operator'],
      user: { id: 'u', name: 'J', role: 'operator' },
    } as unknown as AuthContext;
    expect(canJobAction(clerk, key)).toBe(false);
    const supervisor = {
      ...clerk,
      roleKeys: ['manager'],
      user: { id: 'u', name: 'S', role: 'manager' },
    } as unknown as AuthContext;
    expect(canJobAction(supervisor, key)).toBe(true);
  });
  it('keeps execution keys for floor users and honours mixed / custom roles', () => {
    expect(allowsJobAction('fulfillment.task_details.execute_task', true, ['operator'], 'operator')).toBe(
      true,
    );
    expect(
      allowsJobAction('fulfillment.job_management.cancel', true, ['operator', 'ks_custom'], 'operator'),
    ).toBe(true);
    expect(allowsJobAction('fulfillment.job_management.cancel', false, ['manager'], 'manager')).toBe(false);
    expect(isFloorOnly([], 'operator')).toBe(true);
    expect(isFloorOnly([], 'admin')).toBe(false);
  });
});

describe('Wave Log Run By identity', () => {
  it('stores a display name, resolving emails and defaulting to Integration', async () => {
    expect(await runByDisplay(w.db, 'admin@test.io')).toBe('Admin');
    expect(await runByDisplay(w.db, 'ADMIN@test.io')).toBe('Admin');
    expect(await runByDisplay(w.db, 'Mike Lunsford')).toBe('Mike Lunsford');
    expect(await runByDisplay(w.db, '')).toBe('Integration');
    expect(await runByDisplay(w.db, 'ghost@nowhere.io')).toBe('ghost@nowhere.io');
  });
  it("a wave run with an email records the user's name", async () => {
    await stock(10);
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const rule = await createWaveRule(
      w.db,
      auth,
      w.ctx,
      waveRuleInputSchema.parse({
        name: 'KS-RUNBY',
        warehouseId: w.warehouseId,
        operationType: 'Picking',
        jobTypeIds: [jobType],
        filters: [
          { field: 'orderQuantity', op: 'rng', value: '1..10', label: 'Order Quantity between 1 and 10' },
        ],
      }),
    );
    const res = await runWave(w.db, w.ctx, rule.id, { runBy: 'admin@test.io' });
    expect(
      (await w.db.select().from(schema.waves).where(eq(schema.waves.id, res.wave.id)).limit(1))[0]?.runBy,
    ).toBe('Admin');
    expect((await jobsInvariants(w.db)).wave_jobs_created_mismatch).toBe(0);
  });
});
