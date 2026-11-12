/**
 * M08 round 6 (parity loop, critic R2 score 7.4): the with-picking Create Kit gate, picks shown
 * on the WO Transactions tab, disassembly labels, kitting-consumption attributes, the time-zone
 * policy (grid/export), wizard kit-qty validation and the Disassemble defaults.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import { execute as executeTasks } from '@/server/domain/tasks';
import { kittingAreaQty, pickBlockReason, pickProgress } from '@/lib/grid-defs/work-orders/kit-steps';
import { componentStockAt, defaultKitBucket } from '@/lib/grid-defs/work-orders/source-suggest';
import { woTxnView } from '@/lib/grid-defs/work-orders/wo-transactions';
import { formatInZone, zoneLabel } from '@/lib/grid-defs/work-orders/wo-time';
import { createKitReason, createKitSchema, kitQtyError } from '@/lib/grid-defs/work-orders/work-order-model';
import { createWorkOrder, getWorkOrderDetail, listWorkOrders } from '@/server/repositories/work-orders';
import { allocateWorkOrderWith, createKit } from '@/server/repositories/work-orders-commands';
import { WORK_ORDER_EXPORT_COLUMNS } from '@/server/repositories/work-orders-export';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { createKitWorld, onHandAt, stock, woInput, type KitWorld } from './kit-world';

let w: KitWorld;
beforeEach(async () => {
  w = await createKitWorld();
  await stock(w, w.productId, 30);
  await stock(w, w.product2Id, 12);
});
afterEach(() => w.close());

const codeOf = async (fn: () => unknown): Promise<string | undefined> => {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};
const picking = () =>
  woInput(w, { code: 'KS-R6-PICK', type: 'Work Order with Picking', components: [], requestedQty: 2 });
const kitInput = (id: string, extra: Record<string, unknown> = {}) => ({
  workOrderId: id,
  qty: 2,
  locationId: w.kittingLocId,
  lpId: null,
  lotNumber: null,
  expiryDate: null,
  productionDate: null,
  ...extra,
});
const pickTasks = async (woId: string) =>
  await w.db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.workOrderId, woId), eq(schema.tasks.taskType, 'Picking')));

describe('with picking: Create Kit waits for the picks (Logiwa sequence)', () => {
  it('refuses to build while picking tasks are open, naming the progress', async () => {
    const wo = await createWorkOrder(w.db, w.wctx, picking());
    await allocateWorkOrderWith(w.db, w.wctx, wo.id, { jobTypeId: w.woJobTypeId });
    let err: unknown;
    try {
      await createKit(w.db, w.wctx, kitInput(wo.id));
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string }).code).toBe('INVALID_STATE');
    expect((err as Error).message).toMatch(/Components not yet picked to kitting area \(0\/2 picked\)/);
    // Nothing moved: no Picking rows, no consumption, still In Process.
    expect(
      await w.db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.type, 'Picking')),
    ).toHaveLength(0);
    expect(await onHandAt(w, w.productId)).toBe(30);
    expect((await pickTasks(wo.id)).every((t) => t.status === 'Pending')).toBe(true);
  });

  it('builds once the picks are done, consuming what is in the kitting area', async () => {
    const wo = await createWorkOrder(w.db, w.wctx, picking());
    await allocateWorkOrderWith(w.db, w.wctx, wo.id, { jobTypeId: w.woJobTypeId });
    await executeTasks(w.db, w.wctx, {
      taskIds: (await pickTasks(wo.id)).map((t) => t.id),
      targetLocationId: w.kittingLocId,
    });
    const before = await getWorkOrderDetail(w.db, w.scope, wo.id);
    expect(before.components.map((c) => c.inKittingAreaQty).sort()).toEqual([2, 4]);
    const res = await createKit(w.db, w.wctx, kitInput(wo.id));
    expect(res.status).toBe('Completed');
    expect(await onHandAt(w, w.kitId, w.kittingLocId)).toBe(2);
    expect(await onHandAt(w, w.productId, w.kittingLocId)).toBe(0);
  });

  it("an explicit 'Complete pending picks and build' posts the picks, logs the tasks and shows them on the WO", async () => {
    const wo = await createWorkOrder(w.db, w.wctx, picking());
    await allocateWorkOrderWith(w.db, w.wctx, wo.id, { jobTypeId: w.woJobTypeId });
    const nos = (await pickTasks(wo.id)).map((t) => t.taskNo);
    await createKit(w.db, w.wctx, kitInput(wo.id, { completePendingPicks: true }));
    expect((await pickTasks(wo.id)).every((t) => t.status === 'Completed')).toBe(true);
    const log = (
      await w.db
        .select()
        .from(schema.changeLog)
        .where(and(eq(schema.changeLog.entityId, wo.id), eq(schema.changeLog.field, 'pickingTasks')))
        .limit(1)
    )[0];
    expect(log?.message).toMatch(/Pending picks completed on Create Kit/);
    for (const n of nos) expect(log?.message).toContain(`Task #${n}`);
    const detail = await getWorkOrderDetail(w.db, w.scope, wo.id);
    const picks = detail.transactions.filter((t) => t.ledgerType === 'Picking');
    expect(picks.length).toBe(2);
    expect(picks.every((t) => t.type === 'Picking (to kitting area)')).toBe(true);
  });

  it('accepts the flag in the API schema', () => {
    expect(
      createKitSchema.safeParse({ workOrderId: 'x', qty: 1, locationId: 'l', completePendingPicks: true })
        .success,
    ).toBe(true);
  });

  it('exposes pick counts on the row, and the client guard blocks non-supervisors', async () => {
    const wo = await createWorkOrder(w.db, w.wctx, picking());
    await allocateWorkOrderWith(w.db, w.wctx, wo.id, { jobTypeId: w.woJobTypeId });
    const row = (await listWorkOrders(w.db, w.scope, { ...EMPTY_GRID_QUERY, pageSize: 50 })).rows.find(
      (r) => r.id === wo.id,
    );
    expect(row).toMatchObject({ pickTaskCount: 2, pickDoneCount: 0 });
    if (!row) throw new Error('row');
    expect(createKitReason(row)).toBe('Components not yet picked to kitting area (0/2 picked)');
    expect(createKitReason(row, { canForcePicks: true })).toBeNull();
  });
});

describe('pick progress helpers', () => {
  it('counts non-cancelled picking tasks', () => {
    const p = pickProgress([
      { taskType: 'Picking', status: 'Completed', taskNo: 1 },
      { taskType: 'Picking', status: 'Pending', taskNo: 2 },
      { taskType: 'Picking', status: 'Cancelled', taskNo: 3 },
      { taskType: 'Kitting', status: 'Pending', taskNo: 4 },
    ]);
    expect(p).toEqual({ total: 2, done: 1, pendingTaskNos: [2] });
    expect(pickBlockReason(p)).toBe('Components not yet picked to kitting area (1/2 picked)');
    expect(pickBlockReason({ total: 2, done: 2, pendingTaskNos: [] })).toBeNull();
    expect(pickBlockReason({ total: 0, done: 0, pendingTaskNos: [] })).toBeNull();
    expect(kittingAreaQty({ pickedQty: 5, consumedQty: 2 })).toBe(3);
  });
});

describe('transactions labels', () => {
  const KIT = 'kit-1';
  it("labels returned components by their DisassembleKit receipt, not 'Receiving'", () => {
    expect(
      woTxnView(
        {
          type: 'Receiving',
          qty: 2,
          productId: 'c-1',
          fromLocationId: null,
          toLocationId: 'L1',
          receiptType: 'DisassembleKit',
        },
        KIT,
      ).label,
    ).toBe('Disassembly (component returned)');
    expect(
      woTxnView(
        {
          type: 'Receiving',
          qty: 1,
          productId: KIT,
          fromLocationId: null,
          toLocationId: 'K1',
          receiptType: 'Kitting',
        },
        KIT,
      ).label,
    ).toBe('Kitting (kit output)');
    expect(
      woTxnView({ type: 'Picking', qty: 3, productId: 'c-1', fromLocationId: 'L1', toLocationId: 'K1' }, KIT)
        .label,
    ).toBe('Picking (to kitting area)');
    expect(
      woTxnView(
        { type: 'Allocation', qty: 10, productId: 'c-1', fromLocationId: 'L1', toLocationId: 'L1' },
        KIT,
      ),
    ).toMatchObject({ label: 'Allocation (reserved)', qty: 10, direction: 'move' });
  });
});

describe('kitting consumption attributes (Disassemble prefill)', () => {
  it('returns the lots consumed per component, largest first', async () => {
    await w.db
      .update(schema.inventory)
      .set({ lotNumber: 'L260804C', expiryDate: '2027-05-01' })
      .where(eq(schema.inventory.productId, w.productId));
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 2 }));
    await createKit(w.db, w.wctx, kitInput(wo.id));
    const d = await getWorkOrderDetail(w.db, w.scope, wo.id);
    const a = d.consumedAttributes.find((x) => x.productId === w.productId);
    expect(a).toMatchObject({ lotNumber: 'L260804C', expiryDate: '2027-05-01', qty: 4 });
  });
});

describe('Disassemble defaults', () => {
  const b = (id: string, locationId: string, free: number, extra: Record<string, unknown> = {}) => ({
    id,
    locationId,
    lpId: null,
    onHand: free,
    freeQty: free,
    lockedBy: null,
    ...extra,
  });
  it("prefers the work order's output location", () => {
    expect(defaultKitBucket([b('a', 'B-03', 1), b('k', 'KIT', 9)], 'KIT')?.id).toBe('k');
    expect(defaultKitBucket([b('a', 'B-03', 1), b('k', 'KIT', 9, { lockedBy: 'CNT1' })], 'KIT')?.id).toBe(
      'a',
    );
    expect(defaultKitBucket([b('a', 'B-03', 1)], null)?.id).toBe('a');
  });
  it('reads current qty at the target location (0 when none)', () => {
    const rows = [b('1', 'D-02', 1), b('2', 'B-03', 772)];
    expect(componentStockAt(rows, 'D-02', null)).toBe(1);
    expect(componentStockAt(rows, 'X-99', null)).toBe(0);
    expect(componentStockAt([b('3', 'D-02', 4, { lpId: 'LP1' }), b('4', 'D-02', 6)], 'D-02', 'LP1')).toBe(4);
  });
});

describe('time-zone policy', () => {
  it('formats every timestamp in the warehouse zone with a suffix', () => {
    expect(formatInZone('2026-11-10T05:33:00.000Z', 'America/Chicago')).toBe('11/09/2026 11:33 PM CST');
    expect(formatInZone('2026-11-10T05:33:00.000Z', 'America/New_York')).toBe('11/10/2026 12:33 AM EST');
    expect(zoneLabel('America/New_York', new Date('2026-11-10T05:33:00Z'))).toBe('EST');
  });
  it('rows carry the warehouse zone and the export sends zoned text', async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w));
    const row = (await listWorkOrders(w.db, w.scope, { ...EMPTY_GRID_QUERY, pageSize: 50 })).rows.find(
      (r) => r.id === wo.id,
    );
    expect(row?.warehouseTimeZone).toBeTruthy();
    const created = WORK_ORDER_EXPORT_COLUMNS.find((c) => c.key === 'createdAt');
    expect(created).toMatchObject({ type: 'text' });
    expect(created?.label).toMatch(/warehouse time/);
  });
});

describe('wizard kit quantity', () => {
  it('explains instead of clamping', () => {
    expect(kitQtyError(0)).toBe('At least 1');
    expect(kitQtyError(99_999_999)).toBe('At most 100,000');
    expect(kitQtyError(null)).toBe('Enter the kit quantity');
    expect(kitQtyError(1.5)).toBe('Whole kits only');
    expect(kitQtyError(5)).toBeNull();
  });
});

void codeOf;
