/**
 * M13 round 5 parity loop (critic round 4, score 6.8): static donut, rank numbering and the
 * unassigned bucket, breakdown reconciliation, the Order Line Progress drilldown, M13-local
 * Export As Excel, Export History filters, snapshot gap alert and error references.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { createOrder } from '@/server/domain/orders';
import { EMPTY_GRID_QUERY, parseGridQuery, type GridQuery } from '@/server/query/grid-query';
import { isGridKey } from '@/server/exports/grid-keys';
import { ledger } from '@/server/domain/ledger';
import { snapshotWarehouse } from '@/server/scheduler/tasks/snapshot';
import {
  BREAKDOWN_BACKLOG_STATUSES,
  dashboardDays,
  getLiveDashboard,
  rankRows,
  snapshotGaps,
} from '@/server/repositories/dashboard-live';
import { listOrderLines } from '@/server/repositories/reports-order-lines';
import {
  isLocalExportKey,
  LOCAL_EXPORT_KEYS,
  queueLocalExport,
  runLocalExport,
} from '@/server/repositories/reports-local-export';
import { exportSourceHref, listExportHistory } from '@/server/repositories/reports-logs';
import { BACKLOG_VIEW_STATUSES } from '@/lib/grid-defs/orders/shipment-orders';
import { EXPORT_HISTORY_DEF } from '@/lib/grid-defs/reports/logs';
import { LINE_STATES, ORDER_LINES_DEF } from '@/lib/grid-defs/reports/order-lines';
import { AGING_DEF, UTILIZATION_DEF } from '@/lib/grid-defs/reports/analysis';
import { donutArcs, describeNights, rankNumbers } from '@/components/dashboard/widgets';
import { CHOOSER_GUTTER_WIDTH, widestLineWidth } from '@/components/reports/report-cells';
import { errorReferenceText } from '@/components/reports/error-reference';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;
const q = (qs = ''): GridQuery => ({ ...EMPTY_GRID_QUERY, ...parseGridQuery(qs).query, pageSize: 500 });

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>([
      'fulfillment.shipment_orders.view',
      'inventory.total_inventory.view',
      'settings.locations.view',
      'reports.inventory_snapshot_report.view',
    ]),
    restrictions: [],
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
});
afterEach(() => w.close());

describe('unfulfilled donut (static SVG)', () => {
  it('lays arcs end to end around the circle, with gaps only between several slices', () => {
    const c = 100;
    const arcs = donutArcs(
      [
        { key: 'open', value: 3 },
        { key: 'inProgress', value: 1 },
      ],
      c,
      2,
    );
    expect(arcs).toEqual([
      { key: 'open', length: 73, offset: -0 },
      { key: 'inProgress', length: 23, offset: -75 },
    ]);
    expect(
      donutArcs(
        [
          { key: 'open', value: 5 },
          { key: 'inProgress', value: 0 },
        ],
        c,
        2,
      ),
    ).toEqual([{ key: 'open', length: 100, offset: -0 }]);
    expect(donutArcs([{ key: 'open', value: 0 }], c)).toEqual([]);
  });
});

describe('rank cards', () => {
  it('numbers only ranked values and moves the empty bucket to the bottom', () => {
    const rows = rankRows(
      [
        { name: null, n: 117 },
        { name: 'UPS', n: 3 },
        { name: 'USPS', n: 2 },
      ],
      (n) => `/orders?c=${n ?? 'empty'}`,
      'No carrier assigned yet',
    );
    expect(rows.map((r) => r.name)).toEqual(['UPS', 'USPS', 'No carrier assigned yet']);
    expect(rows[2]).toMatchObject({ muted: true, count: 117, href: '/orders?c=empty' });
    expect(rankNumbers(rows)).toEqual([1, 2, null]);
    expect(rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(100, 1);
  });
  it('keeps Others unnumbered and before the empty bucket', () => {
    const named = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, i) => ({ name, n: 10 - i }));
    const rows = rankRows([...named, { name: '', n: 4 }], () => '/x');
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'Others', 'Not set']);
    expect(rankNumbers(rows)).toEqual([1, 2, 3, 4, 5, null, null]);
  });
});

describe('dashboard reconciliation', () => {
  it('the breakdown lists every backlog status, so its lines add up to the backlog total', async () => {
    expect([...BREAKDOWN_BACKLOG_STATUSES].sort()).toEqual([...BACKLOG_VIEW_STATUSES].sort());
    const a = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const c = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await w.db
      .update(schema.shipmentOrders)
      .set({ status: 'Partially Shipped' })
      .where(eq(schema.shipmentOrders.id, a.id));
    await w.db
      .update(schema.shipmentOrders)
      .set({ status: 'Sorting Started' })
      .where(eq(schema.shipmentOrders.id, c.id));
    const d = await getLiveDashboard(w.db, auth, { warehouseIds: [], clientIds: [] });
    const backlogLines = d.breakdown
      .flat()
      .filter((m) => (BREAKDOWN_BACKLOG_STATUSES as readonly string[]).includes(m.label));
    expect(backlogLines.map((m) => m.label)).toEqual(
      expect.arrayContaining(['Partially Shipped', 'Sorting Started']),
    );
    expect(backlogLines.map((m) => m.label)).not.toContain('Ready to Sort'); // optional line hidden at zero
    expect(backlogLines.reduce((s, m) => s + m.count, 0)).toBe(d.backlogTotal.count);
    expect(d.backlogTotal.count).toBe(3);
    expect(d.ranks.channels.reduce((s, r) => s + r.count, 0)).toBe(d.backlogTotal.count);
    expect(d.ranks.carriers.find((r) => r.muted)?.count).toBe(3);
    expect(d.ranks.carriersShipped).toEqual([]);
  });

  it('each Order Lines part opens a line grid whose Total equals the part', async () => {
    const a = await createOrder(
      w.db,
      w.ctx,
      orderInput(w, [
        { productId: w.productId, quantity: 4 },
        { productId: w.productId, quantity: 2 },
      ]),
    );
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const lines = await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, a.id));
    await w.db
      .update(schema.orderLines)
      .set({ pickedQuantity: 4, packedQuantity: 4 })
      .where(eq(schema.orderLines.id, lines[0]!.id));
    await w.db
      .update(schema.orderLines)
      .set({ pickedQuantity: 2 })
      .where(eq(schema.orderLines.id, lines[1]!.id));
    const d = await getLiveDashboard(w.db, auth, { warehouseIds: [w.warehouseId], clientIds: [] });
    const parts = d.progress.lines.parts ?? [];
    expect(parts.map((p) => p.count)).toEqual([1, 1, 1]);
    for (const p of parts) {
      const [path, qs] = (p.href ?? '').split('?');
      expect(path).toBe('/reports/order-lines');
      expect((await listOrderLines(w.db, auth, q(qs))).total).toBe(p.count);
    }
    const all = await listOrderLines(w.db, auth, q());
    expect(all.total).toBe(d.progress.lines.total);
    expect(new Set(all.rows.map((r) => r.lineState))).toEqual(new Set(LINE_STATES));
    expect(all.rows.every((r) => r.progressScope === 'Backlog')).toBe(true);
    // Out of scope: nothing.
    const other = {
      ...auth,
      viewScope: { warehouseIds: ['nope'], clientIds: 'all' },
    } as unknown as AuthContext;
    expect((await listOrderLines(w.db, other, q())).total).toBe(0);
  });

  it('line-state values with commas survive the drilldown URL', () => {
    const p = parseGridQuery('f.lineState=in%3APicked%5C%2C%20not%20packed').query.filters[0];
    expect(p).toMatchObject({ field: 'lineState', op: 'in' });
  });
});

describe('snapshot gap alert', () => {
  it('lists recent missed nights for warehouses in the selection, only for snapshot viewers', async () => {
    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId: w.productId,
      locationId: w.loc.storageA,
      qty: 5,
    });
    for (const at of ['2026-11-04T06:02:00.000Z', '2026-11-05T06:02:00.000Z', '2026-11-09T06:02:00.000Z'])
      await snapshotWarehouse(w.db, w.warehouseId, at);
    const now = dashboardDays('UTC', new Date('2026-11-10T12:00:00Z'));
    const gaps = await snapshotGaps(w.db, auth, auth.viewScope, now);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.missingDays).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
    expect(gaps[0]?.href).toContain('/reports/inventory-snapshot?f.warehouseId=in:');
    const noPerm = { ...auth, permissions: new Set<string>() } as unknown as AuthContext;
    expect(await snapshotGaps(w.db, noPerm, auth.viewScope, now)).toEqual([]);
    expect(await snapshotGaps(w.db, auth, { warehouseIds: ['other'], clientIds: 'all' }, now)).toEqual([]);
    expect(describeNights(['2026-11-06', '2026-11-07', '2026-11-08'])).toBe('Nov 6, Nov 7 and Nov 8');
  });
});

describe('M13 local Export As Excel', () => {
  it('covers exactly the report keys missing from the shared registry', () => {
    for (const key of [AGING_DEF.gridKey, UTILIZATION_DEF.gridKey, ORDER_LINES_DEF.gridKey]) {
      expect(LOCAL_EXPORT_KEYS).toContain(key);
      expect(isLocalExportKey(key)).toBe(!isGridKey(key));
    }
  });

  it('queues a task, builds the workbook and lists it in Export History with a source link', async () => {
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 3 }]));
    const task = await queueLocalExport(w.db, {
      auth,
      gridKey: ORDER_LINES_DEF.gridKey,
      query: 'f.lineState=in:Not%20picked',
    });
    expect(task).toMatchObject({ kind: 'export', status: 'queued', title: 'Order Line Progress export' });
    const done = await runLocalExport(w.db, task.id, {
      auth,
      store: w.files,
      columns: [
        { key: 'orderCode', label: 'Order Code' },
        { key: 'bogus', label: 'x' },
      ],
    });
    expect(done).toMatchObject({ status: 'completed', rowCount: 1 });
    expect(done.fileId).toBeTruthy();
    const hist = await listExportHistory(w.db, auth, q());
    expect(hist.rows[0]).toMatchObject({
      title: 'Order Line Progress export',
      status: 'completed',
      action: 'Download',
      hasFilters: 1,
    });
    expect(exportSourceHref(ORDER_LINES_DEF.gridKey, 'f.lineState=in:Packed&page=2')).toBe(
      '/reports/order-lines?f.lineState=in%3APacked',
    );
  });

  it('rejects unknown keys, missing permission and a bad query', async () => {
    await expect(
      async () => await queueLocalExport(w.db, { auth, gridKey: 'nope', query: '' }),
    ).rejects.toThrow(/Unknown report/);
    const noPerm = { ...auth, permissions: new Set<string>() } as unknown as AuthContext;
    await expect(
      async () => await queueLocalExport(w.db, { auth: noPerm, gridKey: AGING_DEF.gridKey, query: '' }),
    ).rejects.toThrow(/permission/);
    await expect(
      async () => await queueLocalExport(w.db, { auth, gridKey: AGING_DEF.gridKey, query: 'page=abc' }),
    ).rejects.toThrow(/Invalid export query/);
  });
});

describe('Export History filters', () => {
  it('every visible column except the Download action cell is filterable', () => {
    const fields = new Set(EXPORT_HISTORY_DEF.fields.map((f) => f.field));
    for (const id of [
      'title',
      'createdAt',
      'rowCount',
      'status',
      'exportedBy',
      'finishedAt',
      'errorMessage',
      'action',
    ])
      expect(fields.has(id)).toBe(true);
    expect(fields.has('hasFilters')).toBe(true);
  });
  it('filters on Exported By and Has Filters', async () => {
    for (const query of ['', 'f.status=in:Open']) {
      await w.db
        .insert(schema.backgroundTasks)
        .values({
          kind: 'export',
          title: 'Shipment Orders export',
          gridKey: 'orders-backlog',
          query,
          status: 'completed',
          progress: 100,
          userId: w.userId,
        });
    }
    expect((await listExportHistory(w.db, auth, q('f.hasFilters=bool:true'))).total).toBe(1);
    expect((await listExportHistory(w.db, auth, q('f.hasFilters=bool:false'))).total).toBe(1);
    expect((await listExportHistory(w.db, auth, q('f.exportedBy=eq:Admin'))).total).toBe(2);
  });
});

describe('grid chrome', () => {
  it('the chooser gutter fits the chooser plus a scrollbar', () => {
    expect(CHOOSER_GUTTER_WIDTH).toBeGreaterThanOrEqual(48);
  });
  it('a wrapped header label is shrink-wrapped to its widest line', () => {
    expect(widestLineWidth([{ width: 61.2 }, { width: 80.4 }])).toBe(81);
    expect(widestLineWidth([])).toBe(0);
  });
  it('error cards show a reference even for a non-JSON 500', () => {
    expect(errorReferenceText({ status: 500, requestId: 'req-1' })).toBe('Reference req-1 · HTTP 500');
    expect(errorReferenceText({ status: 500 })).toMatch(/^HTTP 500 · the server returned an error page/);
    expect(errorReferenceText({ status: 0 })).toMatch(/No response/);
    expect(errorReferenceText(null)).toBeNull();
  });
});
