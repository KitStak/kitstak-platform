/**
 * M05 round 8 (critic round 4, score 7.8): Completed -> Started re-open through the status
 * modal, the receive API defaulting a line without a location to the warehouse receiving
 * location (with specific field errors instead of a generic union error), and the PO import
 * definitions loading for the Import ▾ pages.
 */
import { eq, or } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import {
  changePurchaseOrderStatus,
  createPurchaseOrder,
} from '@/server/repositories/purchase-orders-commands';
import { getPurchaseOrder } from '@/server/repositories/purchase-orders';
import { receiveFromApi } from '@/server/repositories/purchase-orders-receive';
import { canChangePoStatus, nextPoStatuses } from '@/server/repositories/po-status-rules';
import { cancelBlockedReason, cancelReceipt } from '@/server/repositories/receipts';
import { createVendor } from '@/server/repositories/vendors';
import { getImportDefinition, listImportBatches, summarizeImport } from '@/server/imports';
import { poCreateSchema, receiveApiBodySchema } from '@/lib/grid-defs/receiving/po-schemas';
import { vendorFormSchema } from '@/lib/grid-defs/receiving/vendors';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;
beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(),
    restrictions: [],
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
});
afterEach(() => w.close());

const address = {
  name: 'Dock',
  line1: '1 Supply Way',
  line2: '',
  postalCode: '38118',
  city: 'Memphis',
  phone: '',
  country: 'US',
  state: 'TN',
};
let seq = 0;
async function createPo(code: string, qty = 10) {
  const v = await createVendor(
    w.db,
    w.ctx,
    auth.scope,
    vendorFormSchema.parse({
      clientId: w.clientId,
      displayName: `R8 Vendor ${++seq}`,
      vendorName: 'R8 LLC',
      useShipAsBilling: true,
      shipping: address,
    }),
  );
  return await createPurchaseOrder(
    w.db,
    w.ctx,
    auth.scope,
    poCreateSchema.parse({
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      code,
      poType: 'Purchase Order',
      poDate: '2026-11-09T15:00:00.000Z',
      vendorId: v.id,
      lines: [{ productId: w.productId, packType: 'Each', orderedQuantity: qty, unitCost: 1 }],
    }),
  );
}
const apiReceive = async (poId: string, body: unknown) =>
  await receiveFromApi(w.db, w.ctx, auth.scope, poId, receiveApiBodySchema.parse(body));
const log = async (id: string) =>
  await w.db
    .select()
    .from(schema.changeLog)
    .where(or(eq(schema.changeLog.entityId, id), eq(schema.changeLog.parentEntityId, id)));

describe('status rules: Completed -> Started re-open', () => {
  it("adds Started to a Completed order's next statuses and keeps the other terminal targets blocked", () => {
    expect(nextPoStatuses('Completed')).toContain('Started');
    expect(canChangePoStatus('Completed', 'Started').ok).toBe(true);
    expect(canChangePoStatus('Completed', 'Pending').ok).toBe(false);
    expect(canChangePoStatus('Completed', 'Cancelled').ok).toBe(false);
    expect(canChangePoStatus('Cancelled', 'Started').ok).toBe(false);
    // Unchanged shared edges still answer through the wrapper.
    expect(canChangePoStatus('Pending', 'Started').ok).toBe(true);
  });

  it('re-opens a fully received PO: stamps cleared, change logged, receipts cancellable again', async () => {
    const po = await createPo('KS-R8-REOPEN', 4);
    const r = await apiReceive(po.id, { all: true });
    const done = await getPurchaseOrder(w.db, auth.scope, po.id);
    expect(done.status).toBe('Completed');
    expect(done.completedAt).toBeTruthy();
    expect(done.allowedStatuses).toContain('Started');
    expect(done.statusReasons.Started).toBeNull();
    expect(cancelBlockedReason({ cancelledAt: null, poStatus: 'Completed', type: 'Purchase Order' })).toMatch(
      /Re-open the purchase order/,
    );

    const reopened = await changePurchaseOrderStatus(w.db, w.ctx, auth.scope, po.id, {
      status: 'Started',
      reason: 'Wrong lot received',
      version: done.version,
    });
    expect(reopened.status).toBe('Started');
    expect(reopened.completedAt).toBeNull();
    const row = (
      await w.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po.id)).limit(1)
    )[0];
    expect(row?.receivedAt).toBeNull();
    const entries = await log(po.id);
    expect(
      entries.some((e) => e.field === 'status' && e.fromValue === 'Completed' && e.toValue === 'Started'),
    ).toBe(true);
    expect(entries.some((e) => e.field === 'statusChangeReason' && e.toValue === 'Wrong lot received')).toBe(
      true,
    );

    // The wrong receipt can now be cancelled; stock is reversed through the ledger.
    const cancelled = await cancelReceipt(w.db, w.ctx, auth.scope, r.receiptIds[0] ?? '');
    expect(cancelled.cancelledAt).toBeTruthy();
    expect((await getPurchaseOrder(w.db, auth.scope, po.id)).receivedQuantity).toBe(0);
  });
});

describe('receive API: default receiving location and specific errors', () => {
  it('receives a line without locationId into the warehouse receiving location', async () => {
    const po = await createPo('KS-R8-DEFLOC', 5);
    const lineId = po.lines[0]?.id ?? '';
    const res = await apiReceive(po.id, { lines: [{ lineId, quantity: 2 }] });
    const receipt = (
      await w.db
        .select()
        .from(schema.receipts)
        .where(eq(schema.receipts.id, res.receiptIds[0] ?? ''))
        .limit(1)
    )[0];
    expect(receipt?.locationId).toBe(w.loc.receiving);
    expect(res.status).toBe('Started');
  });

  it('returns field-level errors instead of a generic union error', () => {
    const parsed = receiveApiBodySchema.safeParse({ lines: [{ lineId: 'x', quantity: 0, locationId: '' }] });
    expect(parsed.success).toBe(false);
    const paths = parsed.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? [];
    expect(paths).toContain('lines.0.quantity:Quantity must be at least 1');
    expect(paths).toContain('lines.0.locationId:Choose a receiving location');
    expect(paths.some((p) => p.includes('Invalid input'))).toBe(false);
    const empty = receiveApiBodySchema.safeParse({});
    expect(empty.error?.issues[0]?.path.join('.')).toBe('lines');
    expect(receiveApiBodySchema.safeParse({ all: true }).success).toBe(true);
  });
});

describe('PO import pages', () => {
  it('registers both import definitions and lists an empty history', async () => {
    for (const key of ['purchase-orders', 'po-serials']) {
      const def = getImportDefinition(key);
      expect(def, key).toBeDefined();
      if (!def) continue;
      expect(summarizeImport(def).key).toBe(key);
      expect(await listImportBatches(w.db, key, 1, 100)).toEqual({ rows: [], total: 0 });
    }
  });
});
