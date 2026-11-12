/** M13 analytics (gate, quadrant medians, formulas) and live dashboard (counts == /orders grid). */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { createOrder } from '@/server/domain/orders';
import { EMPTY_GRID_QUERY, parseGridQuery } from '@/server/query/grid-query';
import { listOrders } from '@/server/repositories/orders';
import { getLiveDashboard } from '@/server/repositories/dashboard-live';
import { getLaborAnalytics, getOperationalAnalytics } from '@/server/repositories/analytics';
import { median, parseRange } from '@/server/repositories/analytics-common';
import {
  loadTaskFacts,
  LOW_SAMPLE,
  quadrantOf,
  quadrantPoints,
  speedOf,
  taskMinutes,
  QUADRANT_LABELS,
  MAX_GAP_MINUTES,
} from '@/server/repositories/analytics-labor';
import { agingBucket, onTimePct } from '@/server/repositories/analytics-operational';
import { chartToCsv } from '@/components/analytics/analytics-export';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';
import { forEachSeq, mapSeq } from '@/server/db/sql';

let w: World;
let auth: AuthContext;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(['settings.users.view', 'settings.billing.view']),
    restrictions: [],
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
});
afterEach(() => w.close());

const setApp = async (key: string, active: boolean) =>
  await w.db
    .insert(schema.apps)
    .values({ key, name: key, description: '', category: 'Analytics', isActive: active })
    .onConflictDoUpdate({ target: schema.apps.key, set: { isActive: active } });

describe('analytics formulas', () => {
  it('task minutes: explicit start/finish, else gap since previous task (capped), else null', () => {
    expect(taskMinutes('2026-11-06T10:00:00Z', '2026-11-06T10:06:00Z', null)).toBe(6);
    expect(taskMinutes(null, '2026-11-06T10:06:00Z', '2026-11-06T10:02:00Z')).toBe(4);
    expect(taskMinutes(null, '2026-11-06T12:00:00Z', '2026-11-06T08:00:00Z')).toBe(MAX_GAP_MINUTES);
    expect(taskMinutes(null, '2026-11-06T12:00:00Z', null)).toBeNull();
  });

  it('median, speed, quadrants, aging and on-time %', () => {
    expect(median([1, 9, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(speedOf(30, 120)).toBe(15);
    const med = { x: 100, y: 10 };
    expect(quadrantOf(12, 150, med)).toBe(QUADRANT_LABELS[0]);
    expect(quadrantOf(12, 50, med)).toBe(QUADRANT_LABELS[1]);
    expect(quadrantOf(5, 150, med)).toBe(QUADRANT_LABELS[2]);
    expect(quadrantOf(5, 50, med)).toBe(QUADRANT_LABELS[3]);
    const now = new Date('2026-11-06T00:00:00Z');
    expect(agingBucket('2026-10-30T00:00:00Z', now)).toBe('0–30 days');
    expect(agingBucket('2026-07-01T00:00:00Z', now)).toBe('90+ days');
    expect(onTimePct(4, 3)).toBe(75);
    expect(onTimePct(0, 0)).toBe(0);
  });

  it('range defaults to the last 30 days and caps at 366', () => {
    const r = parseRange({}, new Date('2026-11-06T12:00:00Z'));
    expect(r).toMatchObject({ from: '2026-10-08', to: '2026-11-06' });
    expect(r.days).toHaveLength(30);
    expect(parseRange({ from: '2020-01-01', to: '2026-11-06' }).days).toHaveLength(366);
  });

  it('CSV export neutralises spreadsheet formulas and quotes commas', () => {
    const csv = chartToCsv({
      id: 'x',
      title: 't',
      description: '',
      kind: 'bar',
      xKey: 'a',
      series: [],
      columns: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      rows: [{ a: '=HYPERLINK(1)', b: 'x,y' }],
    });
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(1)","x,y"`);
  });
});

describe('analytics app gate', () => {
  it('returns the activation gate while Labor Analytics is inactive, and data once active', async () => {
    await setApp('labor-analytics', false);
    expect((await getLaborAnalytics(w.db, auth, 'average-task', { wh: [], cl: [] })).gate).toMatchObject({
      appKey: 'labor-analytics',
    });
    await setApp('labor-analytics', true);
    const res = await getLaborAnalytics(w.db, auth, 'average-task', { wh: [], cl: [] });
    expect(res.gate).toBeNull();
    expect(res.charts.length).toBeGreaterThan(0);
    await setApp('operational-analytics', false);
    expect((await getOperationalAnalytics(w.db, auth, 'fulfillment', { wh: [], cl: [] })).gate?.appName).toBe(
      'Operational Analytics',
    );
  });

  it('Performance Quadrant renders every user with correct medians', async () => {
    await setApp('labor-analytics', true);
    const users = await mapSeq(
      ['A', 'B', 'C'],
      async (n) =>
        (
          await w.db
            .insert(schema.users)
            .values({ email: `${n}@t.io`, name: n, passwordHash: 'x', role: 'admin' })
            .returning()
        )[0].id,
    );
    const job = (
      await w.db
        .insert(schema.jobs)
        .values({
          id: crypto.randomUUID(),
          code: 'J1',
          warehouseId: w.warehouseId,
          jobType: 'Picking',
          status: 'Completed',
        })
        .returning()
    )[0];
    let no = 0;
    const base = Date.now() - 3_600_000;
    // A: 2 tasks × 6 min, B: 4 tasks × 3 min, C: 6 tasks × 2 min
    await forEachSeq(
      [
        [users[0], 2, 6],
        [users[1], 4, 3],
        [users[2], 6, 2],
      ],
      async ([uid, n, mins]) => {
        for (let i = 0; i < Number(n); i += 1) {
          const start = new Date(base + i * 600_000);
          no += 1;
          await w.db
            .insert(schema.tasks)
            .values({
              taskNo: no,
              jobId: job.id,
              warehouseId: w.warehouseId,
              taskType: 'Picking',
              status: 'Completed',
              executedByUserId: String(uid),
              startedAt: start.toISOString(),
              finishedAt: new Date(start.getTime() + Number(mins) * 60_000).toISOString(),
            });
        }
      },
    );
    const chart = (await getLaborAnalytics(w.db, auth, 'performance-quadrant', { wh: [], cl: [] })).charts[0];
    expect(chart?.rows.map((r) => r.user).sort()).toEqual(['A', 'B', 'C']);
    // Under MIN_QUADRANT_TASKS every associate is low sample: plotted, not ranked.
    expect(chart?.rows.every((r) => r.quadrant === LOW_SAMPLE)).toBe(true);
    const { med, points } = quadrantPoints(await loadTaskFacts(w.db, parseRange({}), [w.warehouseId]), 1);
    expect(med).toEqual({ x: 4, y: 20 });
    expect(points.find((r) => r.user === 'C')).toMatchObject({
      volume: 6,
      speed: 30,
      quadrant: QUADRANT_LABELS[0],
    });
  });
});

describe('live dashboard', () => {
  it('every status count equals the /orders grid total for its drilldown query', async () => {
    const a = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await w.db
      .update(schema.shipmentOrders)
      .set({ status: 'Ready to Pick' })
      .where(eq(schema.shipmentOrders.id, a.id));
    const d = await getLiveDashboard(w.db, auth, { warehouseIds: [w.warehouseId], clientIds: [] });
    for (const m of [
      ...d.breakdown.flat(),
      d.unfulfilled.total,
      d.unfulfilled.open,
      d.unfulfilled.inProgress,
    ]) {
      const [path, qs] = m.href.split('?');
      const view = path === '/orders/shipped' ? 'shipped' : 'backlog';
      const total = (
        await listOrders(w.db, auth.scope, {
          view,
          query: { ...EMPTY_GRID_QUERY, ...parseGridQuery(qs ?? '').query },
        })
      ).total;
      expect({ label: m.label, count: m.count }).toEqual({ label: m.label, count: total });
    }
    expect(d.breakdown[0]?.find((m) => m.label === 'Ready to Pick')?.count).toBe(1);
    expect(d.unfulfilled.total.count).toBe(2);
  });

  it('shift info only for exactly one warehouse; ranks link to pre-filtered orders', async () => {
    await createOrder(
      w.db,
      w.ctx,
      orderInput(w, [{ productId: w.productId, quantity: 1 }], { channel: 'Shopify' }),
    );
    const one = await getLiveDashboard(w.db, auth, { warehouseIds: [w.warehouseId], clientIds: [] });
    expect(one.shift).toMatchObject({ timeZone: 'America/Chicago' });
    expect(one.ranks.channels[0]?.href).toContain('f.channel=in');
    const two = await getLiveDashboard(
      w.db,
      {
        ...auth,
        scope: { warehouseIds: [w.warehouseId, 'w2'], clientIds: 'all' },
        viewScope: { warehouseIds: [w.warehouseId, 'w2'], clientIds: 'all' },
      } as unknown as AuthContext,
      { warehouseIds: [], clientIds: [] },
    );
    expect(two.shift).toBeNull();
  });
});
