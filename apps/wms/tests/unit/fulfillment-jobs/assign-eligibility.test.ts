/**
 * Round 4 (critic R4): job / task Assign eligibility (server-side 400, 3-character search),
 * all-cancelled orders released from a live job, AI wave message wording, interval bounds and
 * warehouse-time formatting.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobTypeSettingsSchema } from '@/lib/domain-types';
import { waveRuleInputSchema } from '@/lib/grid-defs/jobs/forms';
import { formatInZone, MIN_REPEAT_MINUTES, timesForPeriod } from '@/lib/grid-defs/jobs/schedule';
import type { AuthContext } from '@/server/auth/context';
import * as schema from '@/server/db/schema';
import { ledger } from '@/server/domain/ledger';
import { createOrder } from '@/server/domain/orders';
import { assignJobs } from '@/server/repositories/jobs-commands';
import { getJobDetail } from '@/server/repositories/jobs';
import { assignTasks } from '@/server/repositories/tasks';
import { createWaveRule } from '@/server/repositories/wave-rules';
import { assertEligibleAssignee, searchAssignees } from '@/server/repositories/wave-rules-options';
import { aiWaveMessage, runWave } from '@/server/repositories/waves-run';
import { isBusyError, withBusyRetry } from '@/server/repositories/jobs-read-retry';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';
import { mapSeq } from '@/server/db/sql';

let w: World;
let auth: AuthContext;
let clerk: string;
let viewer: string;
let client: string;
let multiType: string;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(),
    restrictions: [],
    user: { id: w.userId, name: 'Admin' },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
  const exec = (
    await w.db.insert(schema.roles).values({ key: 'clerk', name: 'Clerk', category: 'Operation' }).returning()
  )[0].id;
  const view = (
    await w.db
      .insert(schema.roles)
      .values({ key: 'finance', name: 'Finance viewer', category: 'Operation' })
      .returning()
  )[0].id;
  const clientRole = (
    await w.db.insert(schema.roles).values({ key: 'client', name: 'Client', category: 'Client' }).returning()
  )[0].id;
  await w.db.insert(schema.rolePermissions).values([
    { roleId: exec, permission: 'fulfillment.task_details.execute_task' },
    { roleId: clientRole, permission: 'fulfillment.task_details.execute_task' },
  ]);
  const user = async (
    email: string,
    name: string,
    roleId: string,
    extra: Partial<typeof schema.users.$inferInsert> = {},
  ) => {
    const id = (
      await w.db
        .insert(schema.users)
        .values({ email, name, passwordHash: 'x', role: 'operator', ...extra })
        .returning()
    )[0].id;
    await w.db.insert(schema.userRoles).values({ userId: id, roleId });
    await w.db.insert(schema.userWarehouses).values({ userId: id, warehouseId: w.warehouseId });
    return id;
  };
  clerk = await user('thao@x.io', 'Thao Nguyen', exec);
  viewer = await user('grace@x.io', 'Grace Whitmore', view, { role: 'viewer' });
  client = await user('dana@apex.io', 'Dana Whitfield', clientRole, { userType: 'Client' });
  multiType = (
    await w.db
      .insert(schema.jobTypes)
      .values({
        code: 'Multi Item Orders',
        description: 'Multi',
        warehouseId: w.warehouseId,
        operationType: 'Picking',
        settings: jobTypeSettingsSchema.parse({ orderScope: 'All Orders' }),
      })
      .returning()
  )[0].id;
});
afterEach(() => w.close());

async function waveJob(orders = 2): Promise<{ jobId: string; orderIds: string[] }> {
  await ledger.add(w.db, w.ctx, {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    productId: w.productId,
    locationId: w.loc.storageA,
    qty: 50,
  });
  const orderIds = await mapSeq(
    Array.from({ length: orders }),
    async () => (await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]))).id,
  );
  const rule = await createWaveRule(
    w.db,
    auth,
    w.ctx,
    waveRuleInputSchema.parse({
      name: 'KS-ASSIGN',
      warehouseId: w.warehouseId,
      operationType: 'Picking',
      jobTypeIds: [multiType],
    }),
  );
  await runWave(w.db, w.ctx, rule.id, { runBy: 'Admin' });
  const job = (await w.db.select().from(schema.jobs))[0];
  if (!job) throw new Error('no job');
  return { jobId: job.id, orderIds };
}

describe('assign eligibility', () => {
  it('rejects viewer and client-portal users with a validation error, accepts warehouse operators', async () => {
    const { jobId } = await waveJob(1);
    await expect(async () => await assignJobs(w.db, w.ctx, [jobId], viewer)).rejects.toThrow(
      /Grace Whitmore can't be assigned/,
    );
    await expect(async () => await assignJobs(w.db, w.ctx, [jobId], client)).rejects.toThrow(
      /can't be assigned/,
    );
    try {
      await assertEligibleAssignee(w.db, client, [w.warehouseId]);
    } catch (e) {
      expect((e as { code?: string }).code).toBe('VALIDATION');
    }
    const ok = await assignJobs(w.db, w.ctx, [jobId], clerk);
    expect(ok.failed).toEqual([]);
    expect(
      (await w.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0]?.assignedToUserId,
    ).toBe(clerk);
  });

  it('applies the same rule to task assign', async () => {
    const { jobId } = await waveJob(1);
    const task = (await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId)))[0];
    if (!task) throw new Error('no task');
    await expect(
      async () => await assignTasks(w.db, w.ctx, { ids: [task.id], userId: viewer }),
    ).rejects.toThrow(/can't be assigned/);
    expect((await assignTasks(w.db, w.ctx, { ids: [task.id], userId: clerk })).succeeded).toEqual([task.id]);
  });

  it('searches eligible users only, from 3 characters', async () => {
    expect(await searchAssignees(w.db, w.warehouseId, 'th')).toEqual([]);
    expect((await searchAssignees(w.db, w.warehouseId, 'tha')).map((u) => u.label)).toEqual(['Thao Nguyen']);
    expect(await searchAssignees(w.db, w.warehouseId, 'gra')).toEqual([]);
    expect(await searchAssignees(w.db, w.warehouseId, 'apex')).toEqual([]);
  });
});

describe('job detail released orders', () => {
  it('marks an order whose job tasks are all cancelled as released and drops it from the live count', async () => {
    const { jobId, orderIds } = await waveJob(2);
    const [gone, kept] = orderIds as [string, string];
    await w.db
      .update(schema.tasks)
      .set({ status: 'Cancelled' })
      .where(and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.orderId, gone)));
    const d = await getJobDetail(w.db, auth, jobId);
    expect(d.orders.find((o) => o.id === gone)?.released).toBe(true);
    expect(d.orders.find((o) => o.id === kept)?.released).toBe(false);
    expect(d.job.orderCount).toBe(1);
    expect(d.history.releasedOrderCount).toBe(1);
  });
});

describe('AI wave message', () => {
  it('never shows an arrow when the rounded walk is unchanged', () => {
    expect(aiWaveMessage(6, 133.2, 132.9, 0.2)).toBe(
      'AI optimized 6 jobs: routes were already the shortest walk (133 m)',
    );
    expect(aiWaveMessage(2, 200, 150, 25)).toBe('AI optimized 2 jobs: walk 200 m → 150 m (−25%)');
    expect(aiWaveMessage(0, 0, 0, 0)).toMatch(/no allocated orders/);
  });
});

describe('schedule helpers', () => {
  it('has a 5-minute interval floor and labels warehouse time', () => {
    expect(MIN_REPEAT_MINUTES).toBe(5);
    expect(timesForPeriod(5, '14:00', '22:00')).toHaveLength(97);
    expect(formatInZone('2026-11-10T19:00:00.000Z', 'America/New_York')).toBe('11/10/2026 2:00 PM EST');
  });

  it('passes reads through (Postgres readers never hit SQLite busy errors) and rethrows errors', async () => {
    let n = 0;
    const out = await withBusyRetry(async () => {
      n += 1;
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(n).toBe(1);
    expect(isBusyError(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))).toBe(false);
    await expect(
      withBusyRetry(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
