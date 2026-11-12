/**
 * Round 6 parity-loop fixes (critic r5): create rejects non-Open status with a field error,
 * "Open printed report" always yields a report for a printed manifest (regenerated on demand),
 * and the pure guard for the row action.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { allocateOrders } from '@/server/domain/allocation';
import { createJobsFromOrders } from '@/server/domain/jobs';
import { ledger } from '@/server/domain/ledger';
import { createOrder } from '@/server/domain/orders';
import { createLabel } from '@/server/domain/shipping';
import { execute } from '@/server/domain/tasks';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { closeManifests, listEndOfDay, openManifestReport } from '@/server/repositories/end-of-day';
import { createPlan, createPlanSchema } from '@/server/repositories/shipment-plans';
import { openReportBlockReason } from '@/lib/grid-defs/shipping/end-of-day';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';

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

const pkg = { weightOz: 20, length: 10, width: 8, height: 4 };

async function packedOrder(qty = 2): Promise<string> {
  await ledger.add(w.db, w.ctx, {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    productId: w.productId,
    locationId: w.loc.storageA,
    qty,
  });
  const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const {
    jobIds: [jobId],
  } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const tasks = await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId));
  await execute(w.db, w.ctx, {
    taskIds: tasks.filter((t) => t.taskType === 'Picking').map((t) => t.id),
    targetLocationId: w.loc.pick,
  });
  await execute(w.db, w.ctx, {
    taskIds: tasks.filter((t) => t.taskType === 'Packing').map((t) => t.id),
    targetLocationId: w.loc.pack,
  });
  return o.id;
}
const label = (orderId: string) =>
  createLabel(
    w.db,
    w.ctx,
    {
      orderId,
      carrierConnectionId: w.carrierConnectionId,
      carrierServiceId: w.serviceIds.ground,
      packages: [pkg],
    },
    { files: w.files },
  );
const eodRows = async () => (await listEndOfDay(w.db, auth, { ...EMPTY_GRID_QUERY, pageSize: 100 })).rows;

describe('POST /api/shipment-plans create status (critic r5 minor)', () => {
  const base = () => ({ code: null, warehouseId: w.warehouseId, orderIds: [] as string[] });

  it('schema rejects a non-Open status with a status field error and defaults a missing one to Open', () => {
    const bad = createPlanSchema.safeParse({ ...base(), status: 'Shipped' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path[0]).toBe('status');
    expect(bad.error?.issues[0]?.message).toMatch(/starts as Open/);
    const ok = createPlanSchema.safeParse(base());
    expect(ok.success && ok.data.status).toBe('Open');
  });

  it('domain create throws VALIDATION with fieldErrors.status instead of coercing', async () => {
    let err: unknown;
    try {
      await createPlan(w.db, auth, w.ctx, { ...base(), status: 'Shipped' } as unknown as Parameters<
        typeof createPlan
      >[3]);
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string }).code).toBe('VALIDATION');
    expect((err as { fieldErrors?: Record<string, string[]> }).fieldErrors?.status?.[0]).toMatch(
      /starts as Open/,
    );
    expect(await w.db.select().from(schema.shipmentPlans)).toHaveLength(0);
  });
});

describe('EOD Open printed report (critic r5 minor)', () => {
  it('guard: only open manifests are blocked', () => {
    expect(openReportBlockReason({ status: 'Open', totalPackages: 2, isPrinted: false })).toMatch(
      /still open/,
    );
    expect(openReportBlockReason({ status: 'Closed', totalPackages: 2, isPrinted: true })).toBeNull();
  });

  it('returns the stored report when it exists', async () => {
    await label(await packedOrder());
    const open = (await eodRows())[0];
    if (!open) throw new Error('no manifest');
    const closed = await closeManifests(w.db, auth, w.ctx, [open.id], w.files);
    const row = (await eodRows()).find((r) => r.status === 'Closed');
    const res = await openManifestReport(w.db, auth, w.ctx, row?.id as string, w.files);
    expect(res).toEqual({ fileId: closed.fileId, regenerated: false });
  });

  it('regenerates and links the report for a printed manifest without a file (seed rows)', async () => {
    await label(await packedOrder());
    const open = (await eodRows())[0];
    if (!open) throw new Error('no manifest');
    await closeManifests(w.db, auth, w.ctx, [open.id], w.files);
    const row = (await eodRows()).find((r) => r.status === 'Closed');
    if (!row?.manifestId) throw new Error('no closed manifest');
    // Simulate a seeded / migrated manifest: printed, but no report file.
    await w.db
      .update(schema.endOfDayManifests)
      .set({ reportFileId: null })
      .where(eq(schema.endOfDayManifests.id, row.manifestId));
    expect((await eodRows()).find((r) => r.id === row.id)).toMatchObject({
      isPrinted: true,
      reportFileId: null,
    });

    const res = await openManifestReport(w.db, auth, w.ctx, row.id, w.files);
    expect(res.regenerated).toBe(true);
    expect((await w.files.read(w.db, res.fileId)).record.mime).toBe('application/pdf');
    expect((await eodRows()).find((r) => r.id === row.id)?.reportFileId).toBe(res.fileId);
    // Second open reuses the linked file.
    expect(await openManifestReport(w.db, auth, w.ctx, row.id, w.files)).toEqual({
      fileId: res.fileId,
      regenerated: false,
    });
  });

  it('regenerates when the linked file no longer exists', async () => {
    await label(await packedOrder());
    const open = (await eodRows())[0];
    if (!open) throw new Error('no manifest');
    const closed = await closeManifests(w.db, auth, w.ctx, [open.id], w.files);
    await w.files.remove(w.db, closed.fileId as string);
    const row = (await eodRows()).find((r) => r.status === 'Closed');
    const res = await openManifestReport(w.db, auth, w.ctx, row?.id as string, w.files);
    expect(res.regenerated).toBe(true);
    expect(res.fileId).not.toBe(closed.fileId);
  });

  it("refuses an open manifest and one outside the caller's scope", async () => {
    await label(await packedOrder());
    const open = (await eodRows())[0];
    await expect(openManifestReport(w.db, auth, w.ctx, open?.id as string, w.files)).rejects.toThrow(
      /still open/,
    );
    const outsider = { ...auth, scope: { warehouseIds: [], clientIds: 'all' } } as unknown as AuthContext;
    await expect(openManifestReport(w.db, outsider, w.ctx, open?.id as string, w.files)).rejects.toThrow(
      /not found/i,
    );
  });
});
