/**
 * M13 parity loop round 6 (critic R5): warehouse-day dashboard, one labor visibility policy,
 * snapshot catch-up from the ledger, Others drilldowns, date-only report chips, busiest hour.
 */
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { createOrder } from '@/server/domain/orders';
import { ledger } from '@/server/domain/ledger';
import { EMPTY_GRID_QUERY, parseGridQuery, type GridQuery } from '@/server/query/grid-query';
import { snapshotWarehouse } from '@/server/scheduler/tasks/snapshot';
import { dashboardDays, daySpan, getLiveDashboard, rankRows } from '@/server/repositories/dashboard-live';
import { listOrderLines } from '@/server/repositories/reports-order-lines';
import {
  listUserPerformance,
  periodSince,
  seesTeamPerformance,
} from '@/server/repositories/reports-receiving';
import { localizeDateOnlyFilters } from '@/server/repositories/reports-grid';
import { offsetSegments } from '@/server/repositories/report-local-day';
import {
  backfillMissingSnapshots,
  daysToBackfill,
  rebuildSnapshotRows,
  snapshotInstant,
} from '@/server/repositories/reports-snapshot-backfill';
import { busiestHourOfDay } from '@/server/repositories/analytics-operational';
import { USER_PERFORMANCE_DEF } from '@/lib/grid-defs/reports/receiving';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';
import { dbAll, dbRun, withWriteTx } from '@/server/db/sql';

let w: World;
let auth: AuthContext;
const q = (qs = ''): GridQuery => ({ ...EMPTY_GRID_QUERY, ...parseGridQuery(qs).query, pageSize: 500 });
const PERMS = [
  'fulfillment.shipment_orders.view',
  'reports.inventory_snapshot_report.view',
  'reports.user_performance_report.view',
];

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(PERMS),
    restrictions: [],
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
});
afterEach(() => {
  vi.useRealTimers();
  return w.close();
});

describe('dashboard business day (warehouse zone, not UTC)', () => {
  // 21:30 in Memphis (America/Chicago, CST = UTC-6) on Nov 10 is already Nov 11 in UTC.
  const evening = new Date('2026-11-11T03:30:00Z');

  it("keeps 'today' on the warehouse's calendar day after the UTC date rolls over", () => {
    const d = dashboardDays('America/Chicago', evening);
    expect(d.day(0)).toBe('2026-11-10');
    expect(d.start(0)).toBe('2026-11-10T06:00:00.000Z');
    expect(d.end(0)).toBe('2026-11-11T05:59:59.999Z');
    expect(daySpan(d, 1, 1)).toBe('date:custom:2026-11-11T06:00:00.000Z..2026-11-12T05:59:59.999Z');
    // DST: the day after the November change still starts at local midnight.
    expect(dashboardDays('America/New_York', new Date('2026-11-01T12:00:00Z')).start(0)).toBe(
      '2026-11-01T04:00:00.000Z',
    );
    expect(dashboardDays('America/New_York', new Date('2026-11-01T12:00:00Z')).start(1)).toBe(
      '2026-11-02T05:00:00.000Z',
    );
  });

  it('counts an order shipped at 20:00 local as shipped today at 21:30, and its drilldown opens it', async () => {
    // listOrderLines resolves "shipped today" from the wall clock (orderLinesDays' `now`
    // default), so pin Date to the same instant the dashboard is queried at; otherwise the
    // test only passes while the machine's real Chicago-local day is 2026-11-10. Timers
    // stay real so async DB work is unaffected.
    vi.useFakeTimers({ toFake: ['Date'], now: evening });
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await w.db
      .update(schema.shipmentOrders)
      .set({ status: 'Shipped', shippedAt: '2026-11-11T02:00:00.000Z' })
      .where(eq(schema.shipmentOrders.id, o.id));
    const dash = await getLiveDashboard(w.db, auth, { warehouseIds: [], clientIds: [] }, evening);
    expect(dash.businessDay).toEqual({
      date: '2026-11-10',
      timeZone: 'America/Chicago',
      mixedZones: false,
      zoneWarehouse: null,
    });
    const shipped = dash.breakdown.flat().find((m) => m.label === 'Already Shipped Today');
    expect(shipped?.count).toBe(1);
    expect(decodeURIComponent(shipped?.href ?? '')).toContain(
      'f.shippedAt=date:custom:2026-11-10T06:00:00.000Z..2026-11-11T05:59:59.999Z',
    );
    expect(dash.progress.ordersToday.parts?.[0]).toMatchObject({ label: 'shipped today', count: 1 });
    // The Order Line Progress grid uses the same warehouse day, so the part and the grid agree.
    const lines = await listOrderLines(w.db, auth, { ...q(), tzOffsetMinutes: -360 });
    expect(lines.total).toBe(dash.progress.lines.total);
    // Under the old UTC day the same order would have dropped out at 18:00 local.
    const utc = await getLiveDashboard(
      w.db,
      { ...auth } as AuthContext,
      { warehouseIds: [], clientIds: [] },
      new Date('2026-11-11T05:30:00Z'),
    );
    expect(utc.breakdown.flat().find((m) => m.label === 'Already Shipped Today')?.count).toBe(1);
  });
});

describe('rank card Others', () => {
  it('links Others to exactly the values outside the top five', () => {
    const named = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, i) => ({ name, n: 10 - i }));
    const rows = rankRows(
      [...named, { name: null, n: 2 }],
      () => '/x',
      'Not set',
      (top) => `/orders?not=${top.join(',')}`,
    );
    expect(rows.find((r) => r.name === 'Others')).toMatchObject({
      count: 5 + 4,
      href: '/orders?not=A,B,C,D,E',
    });
    // Without a link builder the row stays unlinked (and the UI renders plain text).
    expect(rankRows(named, () => '/x').find((r) => r.name === 'Others')?.href).toBeNull();
  });
});

describe('User Performance visibility (one policy with Labor Analytics)', () => {
  let taskNo = 0;
  async function completedTask(userId: string, finishedAt: string): Promise<void> {
    taskNo += 1;
    const job = (
      await w.db
        .insert(schema.jobs)
        .values({
          id: crypto.randomUUID(),
          code: `J-${finishedAt}-${userId.slice(0, 4)}`,
          warehouseId: w.warehouseId,
          jobType: 'Picking',
          status: 'Completed',
        })
        .returning()
    )[0];
    await w.db.insert(schema.tasks).values({
      id: crypto.randomUUID(),
      taskNo: 9000 + taskNo,
      jobId: job.id,
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      taskType: 'Picking',
      status: 'Completed',
      plannedQty: 3,
      actualQty: 3,
      executedByUserId: userId,
      finishedAt,
    });
  }

  it('shows a non-supervisor only their own rows; a supervisor sees the team', async () => {
    const other = (
      await w.db
        .insert(schema.users)
        .values({ email: 'other@test.io', name: 'Other', passwordHash: 'x', role: 'operator' })
        .returning()
    )[0].id;
    await completedTask(w.userId, '2026-11-09T15:00:00.000Z');
    await completedTask(other, '2026-11-09T16:00:00.000Z');
    expect(seesTeamPerformance(auth)).toBe(false);
    const own = await listUserPerformance(w.db, auth, q());
    expect(own.rows.map((r) => r.userId)).toEqual([w.userId]);
    const sup = {
      ...auth,
      permissions: new Set([...PERMS, 'settings.users.view']),
    } as unknown as AuthContext;
    expect(seesTeamPerformance(sup)).toBe(true);
    expect((await listUserPerformance(w.db, sup, q())).rows.map((r) => r.userId).sort()).toEqual(
      [w.userId, other].sort(),
    );
  });

  it('buckets work by the warehouse-local day and filters date-only chips by local days', async () => {
    // 23:30 CST on Nov 9 is 05:30Z on Nov 10: it belongs to Nov 9 in Memphis.
    await completedTask(w.userId, '2026-11-10T05:30:00.000Z');
    const page = await listUserPerformance(w.db, auth, q());
    expect(page.rows[0]?.activityDate).toBe('2026-11-09');
    const one = await listUserPerformance(w.db, auth, {
      ...q('f.activityDate=date:custom:2026-11-09..2026-11-09'),
      tzOffsetMinutes: -360,
    });
    expect(one.total).toBe(1);
    const next = await listUserPerformance(w.db, auth, {
      ...q('f.activityDate=date:custom:2026-11-10..2026-11-10'),
      tzOffsetMinutes: -360,
    });
    expect(next.total).toBe(0);
  });

  it('converts date-only chips to inclusive local-day ranges', () => {
    const filters = parseGridQuery('f.activityDate=date:custom:2026-10-11..2026-11-10').query.filters;
    expect(localizeDateOnlyFilters(USER_PERFORMANCE_DEF, filters, -300)).toEqual([
      { field: 'activityDate', op: 'rng', min: '2026-10-11', max: '2026-11-10' },
    ]);
    const today = parseGridQuery('f.activityDate=date:today').query.filters;
    expect(
      localizeDateOnlyFilters(USER_PERFORMANCE_DEF, today, -300, new Date('2026-11-11T02:00:00Z')),
    ).toEqual([{ field: 'activityDate', op: 'rng', min: '2026-11-10', max: '2026-11-10' }]);
  });

  it('starts the Period chip at local midnight', () => {
    const since = periodSince(
      { ...q('f.period=in:Last%207%20days'), tzOffsetMinutes: -300 },
      new Date('2026-11-11T02:00:00Z'),
    );
    expect(since).toBe('2026-11-04T05:00:00.000Z');
  });

  it('resolves DST segments for a zone', () => {
    const segs = offsetSegments('America/New_York');
    const nov2026 = segs.find((s) => s.from?.startsWith('2026-11-01'));
    expect(nov2026).toEqual({ from: '2026-11-01T06:00:00.000Z', offsetMinutes: -300 });
    expect(offsetSegments('UTC')).toHaveLength(1);
  });
});

describe('snapshot catch-up from the ledger', () => {
  it('rebuilds a missed night exactly as the 00:02 run would have taken it', async () => {
    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId: w.productId,
      locationId: w.loc.storageA,
      qty: 5,
    });
    await dbRun(w.db, sql`UPDATE inventory_transactions SET at = '2026-11-01T12:00:00.000Z'`);
    const at = snapshotInstant('2026-11-06', 'America/Chicago');
    expect(at).toBe('2026-11-06T06:02:00.000Z');
    // A run taken at that instant and a rebuild for the same instant hold the same buckets.
    const live = await withWriteTx(w.db, async (tx) => {
      await snapshotWarehouse(tx, w.warehouseId, at);
      return await dbAll<{ q: number }>(
        tx,
        sql`SELECT SUM(uom_qty) AS q FROM inventory_snapshots WHERE snapshot_at = ${at}`,
      );
    });
    const rebuilt = await rebuildSnapshotRows(w.db, w.warehouseId, at);
    expect(rebuilt.reduce((s, r) => s + r.uomQty, 0)).toBe(Number(live[0]?.q ?? 0));
    // Movements after the instant are rolled back out of the rebuilt night.
    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId: w.productId,
      locationId: w.loc.storageA,
      qty: 7,
    });
    expect((await rebuildSnapshotRows(w.db, w.warehouseId, at)).reduce((s, r) => s + r.uomQty, 0)).toBe(
      Number(live[0]?.q ?? 0),
    );
  });

  it('fills interior and trailing gaps once, never touching nights that have a run', async () => {
    expect(daysToBackfill(['2026-11-05', '2026-11-10'], '2026-11-10', true)).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
    ]);
    expect(daysToBackfill(['2026-11-08'], '2026-11-10', false)).toEqual(['2026-11-09']);
    expect(daysToBackfill(['2026-11-08'], '2026-11-10', true)).toEqual(['2026-11-09', '2026-11-10']);
    expect(daysToBackfill(['2026-09-01', '2026-11-10'], '2026-11-10', true, 3)).toEqual([
      '2026-11-08',
      '2026-11-09',
    ]);

    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId: w.productId,
      locationId: w.loc.storageA,
      qty: 5,
    });
    await dbRun(w.db, sql`UPDATE inventory_transactions SET at = '2026-11-01T12:00:00.000Z'`);
    await snapshotWarehouse(w.db, w.warehouseId, '2026-11-05T06:02:00.000Z');
    await snapshotWarehouse(w.db, w.warehouseId, '2026-11-09T06:02:00.000Z');
    const now = new Date('2026-11-09T18:00:00Z');
    const first = await backfillMissingSnapshots(w.db, { now });
    expect(first[0]?.days.map((d) => d.businessDate)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
    expect(first[0]?.days.every((d) => d.rows > 0 && d.snapshotAt.endsWith('06:02:00.000Z'))).toBe(true);
    expect(await backfillMissingSnapshots(w.db, { now })).toEqual([]);
  });
});

describe('Productivity: busiest hour of the day', () => {
  it('averages each local hour over the active days and names the hour window', () => {
    const cells = [
      { day: '2026-11-01', hour: 10, n: 120 },
      { day: '2026-11-02', hour: 10, n: 100 },
      { day: '2026-11-01', hour: 14, n: 150 },
      { day: '2026-11-03', hour: 9, n: 30 },
    ];
    expect(busiestHourOfDay(cells)).toEqual({ hour: 10, avg: 220 / 3, days: 3, label: '10:00 to 11:00' });
    expect(busiestHourOfDay([])).toBeNull();
    expect(busiestHourOfDay([{ day: 'd', hour: 23, n: 1 }])?.label).toBe('23:00 to 00:00');
  });
});
