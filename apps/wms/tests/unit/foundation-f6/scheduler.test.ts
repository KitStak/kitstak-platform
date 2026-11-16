import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  backgroundTasks,
  inventory,
  inventorySnapshots,
  locations,
  productPackTypes,
  products,
  warehouses,
} from '@/server/db/schema';
import { createLogger } from '@/server/log';
import { getSchedulerHeartbeat, schedulerDisabledReason, startScheduler } from '@/server/scheduler';
import { verifyCronAuthorization } from '@/server/scheduler/cron-auth';
import { SCHEDULER_TASKS } from '@/server/scheduler/registry';
import { createSchedulerRunner, isTaskDue } from '@/server/scheduler/runner';
import {
  acquireLease,
  ensureSchedulerTables,
  readLease,
  readTaskRuns,
  releaseLease,
} from '@/server/scheduler/store';
import { runExportsCleanup } from '@/server/scheduler/tasks/exports-cleanup';
import { isPastSnapshotTime, runSnapshots } from '@/server/scheduler/tasks/snapshot';
import { localMidnightUtc, localParts, zoneOffsetMs } from '@/server/scheduler/timezone';
import type { SchedulerTask } from '@/server/scheduler/types';
import { seededDb, tempStore, type SeededDb } from './fixtures';

const quietLog = createLogger({ sink: () => undefined });

async function seedInventory(testDb: SeededDb): Promise<void> {
  const { db, ids } = testDb;
  await db
    .insert(products)
    .values({
      id: 'p-1',
      clientId: ids.c1,
      sku: 'SKU1',
      barcode: '1',
      name: 'Widget',
      category: 'General',
      weightOz: 1,
      lengthIn: 1,
      widthIn: 1,
      heightIn: 1,
      price: 1,
      status: 'Active',
    });
  await db
    .insert(productPackTypes)
    .values({ productId: 'p-1', packType: 'Case', kind: 'Hierarchical', uomQty: 12 });
  await db
    .insert(locations)
    .values({
      id: 'loc-1',
      warehouseId: ids.wh1,
      code: 'A-01',
      zone: 'A',
      aisle: '1',
      bay: '1',
      level: '1',
      type: 'Picking',
      capacityUnits: 100,
    });
  await db.insert(inventory).values([
    {
      warehouseId: ids.wh1,
      productId: 'p-1',
      locationId: 'loc-1',
      onHand: 30,
      receivedAt: '2026-01-01T00:00:00Z',
      packType: 'Case',
      clientId: null,
    },
    {
      warehouseId: ids.wh1,
      productId: 'p-1',
      locationId: 'loc-1',
      onHand: 5,
      receivedAt: '2026-01-01T00:00:00Z',
      lotNumber: 'L1',
      clientId: ids.c1,
    },
    {
      warehouseId: ids.wh1,
      productId: 'p-1',
      locationId: 'loc-1',
      onHand: 0,
      receivedAt: '2026-01-01T00:00:00Z',
      lotNumber: 'L2',
      clientId: ids.c1,
    },
  ]);
}

describe('timezone helpers', () => {
  it('computes local parts and DST-safe local midnight', () => {
    expect(localParts(new Date('2026-11-05T05:30:00Z'), 'America/Chicago')).toEqual({
      date: '2026-11-04',
      hour: 23,
      minute: 30,
    });
    expect(zoneOffsetMs(new Date('2026-07-01T12:00:00Z'), 'America/Chicago')).toBe(-5 * 3600_000);
    expect(localMidnightUtc('2026-07-01', 'America/Chicago').toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(localMidnightUtc('2026-12-01', 'America/Chicago').toISOString()).toBe('2026-12-01T06:00:00.000Z');
    expect(localMidnightUtc('2026-03-08', 'America/Chicago').toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(isPastSnapshotTime(0, 1)).toBe(false);
    expect(isPastSnapshotTime(0, 2)).toBe(true);
  });
});

describe('lease + run state', () => {
  let testDb: SeededDb;
  beforeEach(async () => {
    testDb = await seededDb();
    await ensureSchedulerTables(testDb.db);
    await ensureSchedulerTables(testDb.db); // idempotent
  });
  afterEach(async () => await testDb.close());

  it('grants the lease to one owner until it expires or is released', async () => {
    const t0 = new Date('2026-11-05T00:00:00Z');
    expect(await acquireLease(testDb.db, 'a', t0, 60_000)).toBe(true);
    expect(await acquireLease(testDb.db, 'b', new Date(t0.getTime() + 1000), 60_000)).toBe(false);
    expect(await acquireLease(testDb.db, 'a', new Date(t0.getTime() + 1000), 60_000)).toBe(true);
    expect(await acquireLease(testDb.db, 'b', new Date(t0.getTime() + 62_000), 60_000)).toBe(true);
    await releaseLease(testDb.db, 'b', new Date(t0.getTime() + 63_000));
    expect(await acquireLease(testDb.db, 'a', new Date(t0.getTime() + 63_000), 60_000)).toBe(true);
    expect((await readLease(testDb.db))?.owner).toBe('a');
  });
});

describe('runner', () => {
  let testDb: SeededDb;
  beforeEach(async () => {
    testDb = await seededDb();
  });
  afterEach(async () => await testDb.close());

  const task = (key: string, run: SchedulerTask['run'], configured = true): SchedulerTask => ({
    key,
    title: key,
    owner: 'test',
    configured,
    schedule: { kind: 'interval', everyMs: 60_000 },
    run,
  });

  it('runs due configured tasks, records failures, and respects intervals', async () => {
    let clock = new Date('2026-11-05T12:00:00Z');
    const ok = vi.fn(() => ({ status: 'ok' as const, message: 'done' }));
    const stub = vi.fn(() => ({ status: 'ok' as const }));
    const runner = createSchedulerRunner({
      getDb: () => testDb.db,
      tasks: [
        task('ok', ok),
        task('boom', () => {
          throw new Error('kaput');
        }),
        task('stub', stub, false),
      ],
      ownerId: 'me',
      now: () => clock,
      log: quietLog,
    });
    const first = await runner.tick();
    expect(first.status).toBe('ran');
    expect(first.ran).toEqual([
      { key: 'ok', status: 'ok', message: 'done' },
      { key: 'boom', status: 'error', message: 'kaput' },
    ]);
    expect(stub).not.toHaveBeenCalled();
    expect((await readTaskRuns(testDb.db)).get('boom')).toMatchObject({
      lastStatus: 'error',
      lastMessage: 'kaput',
      runCount: 1,
    });

    clock = new Date(clock.getTime() + 30_000);
    expect((await runner.tick()).ran).toEqual([]);
    clock = new Date(clock.getTime() + 31_000);
    expect((await runner.tick()).ran).toHaveLength(2);
    expect(ok).toHaveBeenCalledTimes(2);
    expect(runner.heartbeat()).toMatchObject({ running: false, lastTickStatus: 'ran', ownerId: 'me' });
  });

  it('stops starting tasks once the tick is out of time, leaving the rest due', async () => {
    const slow = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { status: 'ok' as const };
    });
    const later = vi.fn(() => ({ status: 'ok' as const }));
    const runner = createSchedulerRunner({
      getDb: () => testDb.db,
      tasks: [task('slow', slow), task('later', later)],
      ownerId: 'me',
      budgetMs: 20,
      log: quietLog,
    });
    const first = await runner.tick();
    expect(first).toMatchObject({ status: 'ran', outOfTime: true, ran: [{ key: 'slow', status: 'ok' }] });
    expect(later).not.toHaveBeenCalled();
    // Never started, so never marked: it is still due, and the lease was released.
    expect((await readTaskRuns(testDb.db)).has('later')).toBe(false);
    const roomy = createSchedulerRunner({
      getDb: () => testDb.db,
      tasks: [task('slow', slow), task('later', later)],
      ownerId: 'me',
      log: quietLog,
    });
    const second = await roomy.tick();
    expect(second.outOfTime).toBeUndefined();
    expect(second.ran).toEqual([{ key: 'later', status: 'ok' }]);
  });

  it('never overlaps ticks and yields to another lease holder', async () => {
    let release: () => void = () => undefined;
    const slow = task(
      'slow',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 'ok' });
        }),
    );
    const runner = createSchedulerRunner({
      getDb: () => testDb.db,
      tasks: [slow],
      ownerId: 'me',
      log: quietLog,
    });
    const pending = runner.tick();
    await new Promise((r) => setTimeout(r, 5));
    expect((await runner.tick()).status).toBe('busy');
    release();
    expect((await pending).status).toBe('ran');

    await acquireLease(testDb.db, 'other', new Date(), 600_000);
    expect((await runner.tick()).status).toBe('lease-held');
  });

  it("start/stop manages an unref'd timer", () => {
    vi.useFakeTimers();
    try {
      const runner = createSchedulerRunner({
        getDb: () => testDb.db,
        tasks: [],
        ownerId: 'me',
        log: quietLog,
      });
      runner.start();
      runner.start();
      expect(runner.heartbeat().running).toBe(true);
      runner.stop();
      expect(runner.heartbeat().running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('isTaskDue skips stubs and honours the interval', () => {
    const t = task('x', () => ({ status: 'ok' }));
    const now = new Date('2026-11-05T00:01:00Z');
    expect(isTaskDue(t, undefined, now)).toBe(true);
    expect(isTaskDue({ ...t, configured: false }, undefined, now)).toBe(false);
    expect(
      isTaskDue(
        t,
        {
          taskKey: 'x',
          lastStartedAt: '2026-11-05T00:00:30Z',
          lastFinishedAt: null,
          lastStatus: 'ok',
          lastMessage: null,
          runCount: 1,
        },
        now,
      ),
    ).toBe(false);
  });

  it('isTaskDue tolerates cron tick jitter (a 60 s task is due on a tick 59.8 s later)', () => {
    const t = task('x', () => ({ status: 'ok' }));
    const state = (lastStartedAt: string) => ({
      taskKey: 'x',
      lastStartedAt,
      lastFinishedAt: null,
      lastStatus: 'ok' as const,
      lastMessage: null,
      runCount: 1,
    });
    expect(isTaskDue(t, state('2026-11-05T00:00:00.500Z'), new Date('2026-11-05T00:01:00.300Z'))).toBe(true);
    // A local 30 s tick is still not enough for a 60 s task.
    expect(isTaskDue(t, state('2026-11-05T00:00:00.000Z'), new Date('2026-11-05T00:00:30.000Z'))).toBe(false);
  });
});

describe('tasks', () => {
  let testDb: SeededDb;
  beforeEach(async () => {
    testDb = await seededDb();
    await seedInventory(testDb);
  });
  afterEach(async () => await testDb.close());

  it('registry contains foundation tasks plus the 0.6 stubs', () => {
    const byKey = new Map(SCHEDULER_TASKS.map((t) => [t.key, t]));
    expect(byKey.get('inventory-snapshot')?.configured).toBe(true);
    expect(byKey.get('exports-cleanup')?.configured).toBe(true);
    for (const [key, owner] of [
      ['wave-rules', 'M03'],
      ['channel-methods', 'M12'],
      ['billing-periods', 'M11'],
      ['kit-inventory-recalc', 'M08'],
    ] as const) {
      // Registered with the right owner; the module flips configured once its job ships.
      expect(byKey.get(key)).toMatchObject({ owner });
      expect(typeof byKey.get(key)?.configured).toBe('boolean');
    }
  });

  it('snapshots each warehouse once per local day after 00:02', async () => {
    await testDb.db
      .update(warehouses)
      .set({ timezone: 'America/Chicago' })
      .where(eq(warehouses.id, testDb.ids.wh1));
    await testDb.db
      .update(warehouses)
      .set({ timezone: 'Not/AZone' })
      .where(eq(warehouses.id, testDb.ids.wh2));
    const before = await runSnapshots({
      db: testDb.db,
      now: new Date('2026-11-05T06:01:00Z'),
      log: quietLog,
    }); // 00:01 CST
    expect(
      await testDb.db
        .select()
        .from(inventorySnapshots)
        .where(eq(inventorySnapshots.warehouseId, testDb.ids.wh1)),
    ).toHaveLength(0);
    expect(before.message).not.toContain('W1');

    const taken = await runSnapshots({ db: testDb.db, now: new Date('2026-11-05T06:03:00Z'), log: quietLog });
    expect(taken.status).toBe('ok');
    const rows = await testDb.db
      .select()
      .from(inventorySnapshots)
      .where(eq(inventorySnapshots.warehouseId, testDb.ids.wh1));
    expect(rows).toHaveLength(2);
    const caseRow = rows.find((r) => r.packType === 'Case');
    expect(caseRow).toMatchObject({ uomQty: 30, packQty: 2, clientId: testDb.ids.c1 });

    await runSnapshots({ db: testDb.db, now: new Date('2026-11-05T20:00:00Z'), log: quietLog });
    expect(
      await testDb.db
        .select()
        .from(inventorySnapshots)
        .where(eq(inventorySnapshots.warehouseId, testDb.ids.wh1)),
    ).toHaveLength(2);
    await runSnapshots({ db: testDb.db, now: new Date('2026-11-06T06:05:00Z'), log: quietLog });
    expect(
      await testDb.db
        .select()
        .from(inventorySnapshots)
        .where(eq(inventorySnapshots.warehouseId, testDb.ids.wh1)),
    ).toHaveLength(4);
  });

  it('exports cleanup deletes expired files and fails interrupted exports', async () => {
    const now = new Date('2026-11-20T00:00:00Z');
    let clock = new Date('2026-11-01T00:00:00Z');
    const temp = tempStore(() => clock);
    try {
      await temp.store.store(testDb.db, {
        name: 'e.xlsx',
        bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]),
        purpose: 'export',
      });
      await testDb.db
        .insert(backgroundTasks)
        .values({
          kind: 'export',
          title: 't',
          userId: testDb.ids.admin,
          status: 'queued',
          createdAt: '2026-11-19T00:00:00Z',
        });
      clock = now;
      const result = await runExportsCleanup({ db: testDb.db, now, log: quietLog }, temp.store);
      expect(result).toMatchObject({
        status: 'ok',
        message: 'Deleted 1 expired files; failed 1 interrupted exports',
      });
      expect((await runExportsCleanup({ db: testDb.db, now, log: quietLog }, temp.store)).status).toBe(
        'skipped',
      );
    } finally {
      temp.cleanup();
    }
  });
});

describe('entry point + cron auth', () => {
  it('does not start under vitest and reports a heartbeat shape', async () => {
    expect(schedulerDisabledReason({ VITEST: 'true' })).toMatch(/test/);
    expect(schedulerDisabledReason({ SCHEDULER_ENABLED: '0' })).toMatch(/SCHEDULER_ENABLED/);
    expect(schedulerDisabledReason({})).toBeNull();
    await expect(startScheduler()).resolves.toMatchObject({ started: false });
    expect(getSchedulerHeartbeat()).toMatchObject({
      running: false,
      lastTickAt: null,
      tickIntervalMs: 30_000,
    });
  });

  it('checks the bearer token in constant time', () => {
    const secret = 's'.repeat(40);
    expect(verifyCronAuthorization(`Bearer ${secret}`, secret)).toBe('ok');
    expect(verifyCronAuthorization(`bearer  ${secret} `, secret)).toBe('ok');
    expect(verifyCronAuthorization('Bearer nope', secret)).toBe('unauthorized');
    expect(verifyCronAuthorization(null, secret)).toBe('unauthorized');
    expect(verifyCronAuthorization(`Bearer ${secret}`, 'short')).toBe('not_configured');
    expect(verifyCronAuthorization(`Bearer x`, undefined)).toBe('not_configured');
  });
});
