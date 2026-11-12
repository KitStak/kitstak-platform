/** Orders-outbound parity loop round 4 (critic r3, 7.3): readable change log, grid resilience, ship date, job defaults. */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/server/db/schema';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { listOrders } from '@/server/repositories/orders';
import { runOrderBulk } from '@/server/repositories/orders-bulk';
import {
  createOrder,
  createOrderBodySchema,
  updateOrder,
  updateOrderBodySchema,
} from '@/server/repositories/orders-commands';
import { formatLogDateTime, logSide, priorityDisplay } from '@/server/repositories/orders-change-log';
import { compileOrderGrid, tryOrderExpr } from '@/server/repositories/orders-grid';
import { columnsForView, defaultVisibleFor } from '@/lib/grid-defs/orders/shipment-orders';
import { clampBatch } from '@/components/orders/bulk/order-job-modal';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';

let w: World;
beforeEach(async () => {
  w = await createWorld();
});
afterEach(() => w.close());

const mk = async (extra: Record<string, unknown> = {}) =>
  await createOrder(
    w.db,
    w.ctx,
    createOrderBodySchema.parse(orderInput(w, [{ productId: w.productId, quantity: 2 }], extra)),
  );
const logs = async (id: string) =>
  await w.db
    .select()
    .from(schema.changeLog)
    .where(and(eq(schema.changeLog.entityType, 'shipment_order'), eq(schema.changeLog.entityId, id)));
const scope = () => ({ warehouseIds: [w.warehouseId], clientIds: [w.clientId, w.otherClientId] });
const reason = async () =>
  (
    await w.db
      .insert(schema.lookupValues)
      .values({
        type: 'so_cancel_reason',
        name: 'Customer request',
      } as typeof schema.lookupValues.$inferInsert)
      .returning()
  )[0];

describe('change-log formatting helpers', () => {
  it('formats ISO timestamps in the warehouse time zone, Logiwa style', () => {
    expect(formatLogDateTime('2026-11-10T06:49:02.797Z', 'America/Chicago')).toBe(
      '11/10/2026 12:49:02 AM CST',
    );
    expect(formatLogDateTime('2026-11-10T18:05:09Z', 'UTC')).toBe('11/10/2026 6:05:09 PM UTC');
    expect(formatLogDateTime('High')).toBe('High');
    expect(formatLogDateTime('2026-11-10')).toBe('2026-11-10');
  });

  it('writes the empty-value glyph for an empty side', () => {
    expect(logSide('')).toBe('—');
    expect(logSide(null)).toBe('—');
    expect(logSide('Job005302')).toBe('Job005302');
  });

  it("shows priority as one 'rank · level' value", () => {
    expect(priorityDisplay('3', 'High')).toBe('3 · High');
    expect(priorityDisplay('5', 'Urgent')).toBe('5 · Urgent');
    expect(priorityDisplay('', 'High')).toBe('3 · High');
    expect(priorityDisplay('0', 'None')).toBe('0 · None');
    expect(priorityDisplay(null, null)).toBe('—');
  });
});

describe('change log written by order commands', () => {
  it("one priority edit writes one 'Priority' entry, never the internal Priority Rank", async () => {
    const o = await mk({ priority: 'High', priorityRank: 3 });
    await updateOrder(
      w.db,
      w.ctx,
      o.id,
      updateOrderBodySchema.parse({ version: o.version, patch: { priority: 'Urgent', priorityRank: 5 } }),
    );
    const entries = (await logs(o.id)).filter((l) => l.type === 'Update');
    expect(entries.some((l) => l.field === 'priorityRank' || /Priority Rank/.test(l.message))).toBe(false);
    expect(entries.filter((l) => l.field === 'priority').map((l) => l.message)).toEqual([
      'Priority is modified. 3 · High --> 5 · Urgent',
    ]);
  });

  it("cancel keeps the order Note, logs 'Cancel note:' and formats Cancelled At", async () => {
    const o = await mk({ note: 'Leave at door' });
    expect(
      (
        await runOrderBulk('cancel', w.db, w.ctx, {
          ids: [o.id],
          reasonId: (await reason()).id,
          note: 'Customer called',
        })
      ).succeeded,
    ).toEqual([o.id]);
    const after = (
      await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, o.id)).limit(1)
    )[0];
    expect(after?.note).toBe('Leave at door');
    const messages = (await logs(o.id)).map((l) => l.message);
    expect(messages).toContain('Cancel note: Customer called');
    expect(messages.some((m) => /Note is modified/.test(m))).toBe(false);
    const cancelledAt = (await logs(o.id)).find((l) => l.field === 'cancelledAt');
    expect(cancelledAt?.message).toMatch(
      /^Cancelled At is modified\. — --> \d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} (AM|PM) [A-Z]{2,5}$/,
    );
    expect(messages.some((m) => /\d{4}-\d{2}-\d{2}T/.test(m))).toBe(false);
    expect(messages.some((m) => m.includes('  -->'))).toBe(false);
  });
});

describe('shipped grid: Actual Shipment Date', () => {
  it("is empty for a cancelled order, while the default 'last 7 days' chip still matches it", async () => {
    const o = await mk();
    await runOrderBulk('cancel', w.db, w.ctx, { ids: [o.id], reasonId: (await reason()).id });
    const res = await listOrders(w.db, scope() as never, {
      view: 'shipped',
      query: {
        ...EMPTY_GRID_QUERY,
        filters: [{ field: 'shippedAt', op: 'date', date: { kind: 'fixed', preset: 'last7d' } }],
        sort: [{ field: 'shippedAt', dir: 'desc' }],
      } as never,
    });
    const row = res.rows.find((r) => r.id === o.id) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.shippedAt ?? null).toBeNull();
    expect(row?.cancelledAt).toBeTruthy();
  });
});

describe('grid resilience', () => {
  it('an unmapped field is skipped and logged, never a thrown error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(tryOrderExpr('noSuchField', 'test')).toBeUndefined();
    expect(() =>
      compileOrderGrid({
        ...EMPTY_GRID_QUERY,
        filters: [{ field: 'noSuchField', op: 'in', values: ['x'] }],
      } as never),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('defaults', () => {
  it('shows the Logiwa columns on the backlog by default (Company Name in the chooser), plus the extras on Shipped & Canceled', () => {
    const backlog = columnsForView('backlog').filter((c) => defaultVisibleFor('backlog', c));
    const shipped = columnsForView('shipped').filter((c) => defaultVisibleFor('shipped', c));
    expect(columnsForView('backlog').length).toBeGreaterThanOrEqual(58);
    expect(backlog.length).toBe(columnsForView('backlog').length - 1);
    expect(backlog.some((c) => c.id === 'companyName')).toBe(false);
    expect(shipped.length).toBe(backlog.length + 5);
  });

  it('job batch size defaults to 1 and stays inside the job type range', () => {
    expect(clampBatch(null, { batchMin: 1, batchMax: 40 })).toBe(1);
    expect(clampBatch(1, { batchMin: 5, batchMax: 40 })).toBe(5);
    expect(clampBatch(80, { batchMin: 1, batchMax: 40 })).toBe(40);
    expect(clampBatch(12, { batchMin: 1, batchMax: 40 })).toBe(12);
  });
});
