/**
 * M13 critic round 2 fixes: analytics permission shaping (billing money, self-only labor),
 * productivity timing confidence, average-task cap flag, chart scale/layout helpers,
 * dashboard drilldown parts and report header label width.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import {
  getLaborAnalytics,
  getOperationalAnalytics,
  seesBillingMoney,
  seesTeamLabor,
} from '@/server/repositories/analytics';
import { capShare, MAX_GAP_MINUTES, MIN_TASK_MINUTES } from '@/server/repositories/analytics-labor';
import {
  addFact,
  emptyArea,
  isLowConfidence,
  unitsPerHour,
} from '@/server/repositories/analytics-operational';
import { getLiveDashboard } from '@/server/repositories/dashboard-live';
import {
  axisTick,
  barCap,
  clampRows,
  isDayAxis,
  realKey,
  shortCategory,
  withBalancedWidths,
} from '@/components/analytics/chart-layout';
import { headerLabelWidth } from '@/components/reports/report-cells';
import type { AnalyticsChart } from '@/server/repositories/analytics-types';
import { createWorld, type World } from '../foundation/domain/fixtures';
import { forEachSeq, mapSeq } from '@/server/db/sql';

let w: World;
const authWith = (
  permissions: readonly string[],
  user: { id: string; name: string; email: string },
): AuthContext => {
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  return {
    scope,
    viewScope: scope,
    permissions: new Set(permissions),
    restrictions: [],
    user,
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
};
const setApp = async (key: string, active: boolean) =>
  await w.db
    .insert(schema.apps)
    .values({ key, name: key, description: '', category: 'Analytics', isActive: active })
    .onConflictDoUpdate({ target: schema.apps.key, set: { isActive: active } });

beforeEach(async () => {
  w = await createWorld();
});
afterEach(() => w.close());

async function seedTasks(): Promise<{ ids: string[] }> {
  const ids = await mapSeq(
    ['Ann', 'Bob', 'Cy'],
    async (n) =>
      (
        await w.db
          .insert(schema.users)
          .values({ email: `${n.toLowerCase()}@t.io`, name: n, passwordHash: 'x', role: 'operator' })
          .returning()
      )[0].id,
  );
  const job = (
    await w.db
      .insert(schema.jobs)
      .values({
        id: crypto.randomUUID(),
        code: 'J9',
        warehouseId: w.warehouseId,
        jobType: 'Picking',
        status: 'Completed',
      })
      .returning()
  )[0];
  let no = 0;
  const base = Date.now() - 3_600_000;
  await forEachSeq(ids, async (uid, k) => {
    for (let i = 0; i < 20 + k; i += 1) {
      const start = new Date(base + i * 60_000);
      no += 1;
      await w.db
        .insert(schema.tasks)
        .values({
          taskNo: no,
          jobId: job.id,
          warehouseId: w.warehouseId,
          taskType: 'Picking',
          status: 'Completed',
          executedByUserId: uid,
          startedAt: start.toISOString(),
          finishedAt: new Date(start.getTime() + 30_000).toISOString(),
          actualQty: 5,
        });
    }
  });
  return { ids };
}

describe('labor analytics: team vs self-only', () => {
  it('a viewer without the team permission only sees their own row, with team medians for comparison', async () => {
    await setApp('labor-analytics', true);
    const { ids } = await seedTasks();
    const clerk = authWith(['analytics.labor_analytics.view'], {
      id: ids[0] as string,
      name: 'Ann',
      email: 'ann@t.io',
    });
    expect(seesTeamLabor(clerk)).toBe(false);
    for (const page of ['associate-task', 'performance-quadrant', 'associate', 'average-task'] as const) {
      const res = await getLaborAnalytics(w.db, clerk, page, { wh: [], cl: [] });
      expect(res.notice?.kind).toBe('self-only');
      const json = JSON.stringify(res);
      expect(json).not.toContain('Bob');
      expect(json).not.toContain('"Cy"');
    }
    const q = (await getLaborAnalytics(w.db, clerk, 'performance-quadrant', { wh: [], cl: [] })).charts[0];
    expect(q?.rows).toHaveLength(1);
    expect(q?.rows[0]?.user).toBe('Ann');
    expect(q?.medians?.x).toBe(21); // team volumes 20, 21, 22
    const card = await getLaborAnalytics(w.db, clerk, 'associate', { wh: [], cl: [] });
    expect(card.kpis[0]?.value).toBe('#3 of 3');
    // Every task drilldown is narrowed to the viewer.
    expect(card.kpis[1]?.href).toContain('f.executedBy=eq:Ann');
  });

  it('a supervisor sees every associate', async () => {
    await setApp('labor-analytics', true);
    await seedTasks();
    const sup = authWith(['analytics.labor_analytics.view', 'settings.users.view'], {
      id: w.userId,
      name: 'Sup',
      email: 's@t.io',
    });
    const res = await getLaborAnalytics(w.db, sup, 'associate-task', { wh: [], cl: [] });
    expect(res.notice).toBeNull();
    expect(res.charts[0]?.rows.map((r) => r.user).sort()).toEqual(['Ann', 'Bob', 'Cy']);
  });
});

describe('management dashboard money gate', () => {
  it('drops revenue and billing for a viewer without billing view', async () => {
    await setApp('operational-analytics', true);
    const clerk = authWith(['analytics.operational_analytics.view'], {
      id: w.userId,
      name: 'C',
      email: 'c@t.io',
    });
    expect(seesBillingMoney(clerk)).toBe(false);
    const res = await getOperationalAnalytics(w.db, clerk, 'management', { wh: [], cl: [] });
    expect(res.notice?.kind).toBe('no-billing');
    const labels = res.kpis.map((k) => k.label);
    expect(labels).not.toContain('Billed');
    expect(labels).not.toContain('Merchandise shipped');
    const cols = res.charts.flatMap((c) => c.columns.map((x) => x.key));
    expect(cols).not.toContain('billed');
    expect(cols).not.toContain('revenue');
  });

  it('keeps the money for billing viewers', async () => {
    await setApp('operational-analytics', true);
    const mgr = authWith(['analytics.operational_analytics.view', 'settings.billing_report.view'], {
      id: w.userId,
      name: 'M',
      email: 'm@t.io',
    });
    const res = await getOperationalAnalytics(w.db, mgr, 'management', { wh: [], cl: [] });
    expect(res.notice).toBeNull();
    expect(res.kpis.map((k) => k.label)).toContain('Billed');
  });
});

describe('productivity timing confidence', () => {
  it('untimed tasks add units but never inflate units/hour', () => {
    const a = emptyArea();
    addFact(a, { qty: 100, mins: 0, measured: false }, 'day');
    addFact(a, { qty: 10, mins: 6, measured: true }, 'day');
    expect(a.units).toBe(110);
    expect(unitsPerHour(a.day.u, a.day.m)).toBe(100);
  });
  it('an area whose timed tasks mostly sit on the 15 s floor is low confidence', () => {
    const a = emptyArea();
    for (let i = 0; i < 8; i += 1) addFact(a, { qty: 24, mins: MIN_TASK_MINUTES, measured: true }, 'off');
    addFact(a, { qty: 24, mins: 3, measured: true }, 'off');
    expect(isLowConfidence(a)).toBe(true);
    const b = emptyArea();
    for (let i = 0; i < 5; i += 1) addFact(b, { qty: 2, mins: 1.5, measured: true }, 'day');
    expect(isLowConfidence(b)).toBe(false);
  });
  it('average-task flags a type whose tasks hit the cap', () => {
    expect(capShare([{ mins: MAX_GAP_MINUTES }, { mins: MAX_GAP_MINUTES }, { mins: 4 }])).toBeCloseTo(2 / 3);
    expect(capShare([])).toBe(0);
  });
});

describe('chart helpers', () => {
  const chart = (rows: Record<string, number | string>[]): Pick<AnalyticsChart, 'series' | 'rows'> => ({
    series: [{ key: 'v', label: 'V', color: '#000' }],
    rows,
  });
  it('caps a bar chart when one bar is an outlier and keeps the real value', () => {
    const c = chart([
      { a: 'Repl', v: 900 },
      { a: 'Pick', v: 40 },
      { a: 'Pack', v: 55 },
      { a: 'Kit', v: 12 },
    ]);
    const cap = barCap(c);
    expect(cap).not.toBeNull();
    expect(cap as number).toBeLessThan(900);
    const out = clampRows(c.rows, ['v'], cap);
    expect(out[0]?.v).toBe(cap);
    expect(out[0]?.[realKey('v')]).toBe(900);
    expect(out[1]?.[realKey('v')]).toBeUndefined();
    expect(barCap(chart([{ v: 40 }, { v: 55 }, { v: 60 }]))).toBeNull();
  });
  it('formats money and thousands on the axis', () => {
    expect(axisTick(12000, 'money')).toBe('$12K');
    expect(axisTick(800, 'money')).toBe('$800');
    expect(axisTick(80000, 'number')).toBe('80,000');
    expect(axisTick(1_250_000, 'number')).toBe('1.3M');
  });
  it('shortens category labels and detects day axes', () => {
    expect(shortCategory('APX-HOODIE-BLK-XXL', 12)).toBe('APX-HOODIE-…');
    expect(isDayAxis([{ d: '2026-11-01' }], 'd')).toBe(true);
    expect(isDayAxis([{ d: 'SKU-1' }], 'd')).toBe(false);
  });
  it('widens a half card that would sit alone on its row', () => {
    const c = (id: string, wide?: boolean) => ({ id, wide }) as unknown as AnalyticsChart;
    expect(withBalancedWidths([c('a', true), c('b')]).map((x) => Boolean(x.wide))).toEqual([true, true]);
    expect(withBalancedWidths([c('a', true), c('b'), c('c')]).map((x) => Boolean(x.wide))).toEqual([
      true,
      false,
      false,
    ]);
    expect(withBalancedWidths([c('a'), c('b', true), c('c'), c('d')]).map((x) => Boolean(x.wide))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('dashboard progress parts', () => {
  it('every progress part carries a count and a drilldown; due parts add up to the total', async () => {
    const auth = authWith([], { id: w.userId, name: 'A', email: 'a@t.io' });
    const d = await getLiveDashboard(w.db, auth, { warehouseIds: [], clientIds: [] });
    for (const p of [d.progress.tasks, d.progress.ordersToday]) {
      expect(p.parts?.length).toBeGreaterThan(0);
      for (const part of p.parts ?? []) expect(part.href).toMatch(/^\//);
    }
    // Order lines open the Order Line Progress grid filtered to that line state (round 9).
    for (const part of d.progress.lines.parts ?? []) expect(part.href).toMatch(/^\/reports\/order-lines\?/);
    const due = d.progress.ordersToday.parts ?? [];
    // Disjoint parts: shipped + packed awaiting ship + not packed yet = total.
    expect(due.map((x) => x.label)).toEqual(['shipped today', 'packed, awaiting ship', 'not packed yet']);
    expect(due.reduce((a, x) => a + x.count, 0)).toBe(d.progress.ordersToday.total);
    expect(due.find((x) => x.label === 'shipped today')?.href).toContain('/orders/shipped');
  });
});

describe('report header labels', () => {
  it('leave room for the sort icon, grip and info icon', () => {
    expect(headerLabelWidth(140, false)).toBe(88);
    expect(headerLabelWidth(140, true)).toBe(70);
    expect(headerLabelWidth(60, true)).toBe(40);
  });
});
