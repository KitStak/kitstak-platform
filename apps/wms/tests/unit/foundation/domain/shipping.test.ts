/** Carriers (sandbox, labels, registry) and shipping commands. */
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import { allocateOrders } from '@/server/domain/allocation';
import {
  code128Modules,
  getCarrierAdapter,
  registerCarrierAdapter,
  registeredCarrierProviders,
  renderZplLabel,
  sandboxCarrier,
  sandboxRate,
  sandboxTrackingNumber,
  sandboxZone,
  SANDBOX_SERVICES,
  upsCheckDigit,
  uspsCheckDigit,
  type CarrierAdapter,
} from '@/server/domain/carriers';
import { createJobsFromOrders } from '@/server/domain/jobs';
import { ledger } from '@/server/domain/ledger';
import { createOrder } from '@/server/domain/orders';
import {
  applyMarkup,
  closeEndOfDay,
  createLabel,
  createReturnLabel,
  localDate,
  rateShop,
  shipOrders,
  voidLabel,
} from '@/server/domain/shipping';
import { execute } from '@/server/domain/tasks';
import { createWorld, orderInput, type World } from './fixtures';

let w: World;
beforeEach(async () => {
  w = await createWorld();
});
afterEach(() => w.close());

const pkg = { weightOz: 20, length: 10, width: 8, height: 4 };

/** Order taken through allocation, pick and pack -> Ready to Ship. */
async function packedOrder(qty = 2): Promise<string> {
  await ledger.add(w.db, w.ctx, {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    productId: w.productId,
    locationId: w.loc.storageA,
    qty: qty + 3,
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
const status = async (id: string) =>
  (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0]
    ?.status;

describe('sandbox carrier', () => {
  it('computes zones, rates and valid tracking numbers', () => {
    expect(sandboxZone('381', '382', false)).toBe(2);
    expect(sandboxZone('100', '900', false)).toBe(7);
    expect(sandboxZone('abc', '900', false)).toBe(8);
    expect(sandboxZone('100', '900', true)).toBe(9);
    const ground = SANDBOX_SERVICES[0];
    expect(sandboxRate(ground, 2, { weightOz: 16, length: 1, width: 1, height: 1 })).toBe(9.07);
    const ups = sandboxTrackingNumber(ground, 'seed');
    expect(ups).toMatch(/^1ZKS\d{4}03\d{7}\d$/);
    expect(Number(ups.at(-1))).toBe(upsCheckDigit(ups.slice(2, -1)));
    const usps = sandboxTrackingNumber(SANDBOX_SERVICES[3], 'seed');
    expect(usps).toMatch(/^9400111\d{15}$/);
    expect(Number(usps.at(-1))).toBe(uspsCheckDigit(usps.slice(0, -1)));
    expect(sandboxTrackingNumber(ground, 'seed')).toBe(ups);
  });

  it('renders ZPL and barcodes; validates and voids', async () => {
    const zpl = renderZplLabel({
      from: { name: 'W', line1: '1', city: 'c', state: 'TN', postalCode: '38118', country: 'US' },
      to: { name: 'J^D', line1: '2', city: 'd', postalCode: '72201', country: 'US' },
      carrierCode: 'UPS',
      serviceName: 'Ground',
      trackingNumber: '1Z123',
      orderCode: 'SO1',
      weightOz: 3,
      packageSeq: 1,
      packageCount: 1,
      shipDate: '2026-11-05',
      labelType: 'Return Label',
    });
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl).toContain('^BCN');
    expect(zpl).toContain('RETURN TO:');
    expect(zpl).toContain('J D');
    expect(code128Modules('ABC').length).toBeGreaterThan(10);
    expect(
      (await sandboxCarrier.validateAddress({ line1: 'x', city: 'y', postalCode: '1', country: 'US' }))
        .status,
    ).toBe('Failed');
    await expect(
      sandboxCarrier.voidLabel({ connection: {} as never, trackingNumber: 'bad' }),
    ).rejects.toThrow(/Unknown tracking/);
    expect(getCarrierAdapter('kitstaks-sandbox')).toBe(sandboxCarrier);
    expect(registeredCarrierProviders()).toContain('kitstaks-sandbox');
  });
});

describe('rate shopping', () => {
  it('returns sorted quotes with markup and logs calls', async () => {
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const r = await rateShop(w.db, w.ctx, { orderId: o.id, packages: [pkg] });
    expect(r.errors).toEqual([]);
    expect(r.quotes.length).toBe(3);
    expect(r.selected?.price).toBe(Math.min(...r.quotes.map((q) => q.price)));
    await w.db
      .insert(schema.carrierConnectionClients)
      .values({
        connectionId: w.carrierConnectionId,
        clientId: w.clientId,
        markupType: 'Percentage',
        markupAmount: 10,
      });
    const conn = (await w.db.select().from(schema.carrierConnections).limit(1))[0];
    expect(await applyMarkup(w.db, conn as NonNullable<typeof conn>, w.clientId, 10)).toBe(11);
    expect(
      await applyMarkup(
        w.db,
        {
          ...(conn as NonNullable<typeof conn>),
          settings: { generalMarkup: { type: 'Fixed Price', amount: 2 } },
        },
        w.otherClientId,
        10,
      ),
    ).toBe(12);
    const preset = (
      await w.db
        .insert(schema.rateShoppingPresets)
        .values({
          name: 'Fast',
          description: 'f',
          warehouseId: w.warehouseId,
          clientId: w.clientId,
          method: 'Fastest',
        })
        .returning()
    )[0];
    await w.db.insert(schema.rateShoppingPresetServices).values([
      { presetId: preset.id, carrierServiceId: w.serviceIds.nextDay },
      { presetId: preset.id, carrierServiceId: w.serviceIds.ground },
    ]);
    const fast = await rateShop(w.db, w.ctx, { orderId: o.id, packages: [pkg], presetId: preset.id });
    expect(fast.selected?.serviceCode).toBe('SBX_NEXT_DAY');
    const inTime = (
      await w.db
        .insert(schema.rateShoppingPresets)
        .values({
          name: 'T',
          description: 't',
          warehouseId: w.warehouseId,
          clientId: w.clientId,
          method: 'Cheapest In Time',
          transitDays: 3,
          useAllServices: true,
        })
        .returning()
    )[0];
    expect(
      (await rateShop(w.db, w.ctx, { orderId: o.id, packages: [pkg], presetId: inTime.id })).quotes.every(
        (q) => q.transitDays <= 3,
      ),
    ).toBe(true);
    const bad = await rateShop(w.db, w.ctx, { orderId: o.id, packages: [{ ...pkg, weightOz: 0 }] });
    expect(bad.errors[0].message).toMatch(/weight/);
    expect((await w.db.select().from(schema.carrierCallLogs)).some((l) => l.status === 'Error')).toBe(true);
    await expect(rateShop(w.db, w.ctx, { orderId: o.id, packages: [pkg], presetId: 'nope' })).rejects.toThrow(
      /preset not found/,
    );
  });
});

describe('labels and shipping', () => {
  it('creates a multi-package ZPL label with a master tracking number, voids it and relabels', async () => {
    const id = await packedOrder();
    await expect(
      createLabel(
        w.db,
        w.ctx,
        {
          orderId: id,
          carrierConnectionId: w.carrierConnectionId,
          carrierServiceId: w.serviceIds.ground,
          packages: [],
        },
        { files: w.files },
      ),
    ).rejects.toThrow(/At least one/);
    const r = await createLabel(
      w.db,
      w.ctx,
      {
        orderId: id,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: w.serviceIds.priority,
        packages: [pkg, pkg],
        format: 'ZPL',
      },
      { files: w.files },
    );
    expect(r.shipments).toHaveLength(2);
    expect(new Set(r.shipments.map((s) => s.masterTrackingNumber))).toEqual(
      new Set([r.masterTrackingNumber]),
    );
    const file = (
      await w.db
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, r.shipments[1].labelFileId as string))
        .limit(1)
    )[0];
    expect(fs.readFileSync(path.join(w.filesRoot, file?.id as string), 'utf8').startsWith('^XA')).toBe(true);
    await expect(
      createLabel(
        w.db,
        w.ctx,
        {
          orderId: id,
          carrierConnectionId: w.carrierConnectionId,
          carrierServiceId: w.serviceIds.ground,
          packages: [pkg],
        },
        { files: w.files },
      ),
    ).rejects.toThrow(/already has an active/);
    expect((await voidLabel(w.db, w.ctx, { shipmentId: r.shipments[0].id })).voided).toBe(2);
    await expect(voidLabel(w.db, w.ctx, { shipmentId: r.shipments[0].id })).rejects.toThrow(/already voided/);
    const again = await createLabel(
      w.db,
      w.ctx,
      {
        orderId: id,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: w.serviceIds.ground,
        packages: [pkg],
      },
      { files: w.files },
    );
    expect(again.masterTrackingNumber).not.toBe(r.masterTrackingNumber);
  });

  it('rejects labels for unready orders and bad carriers; logs carrier errors', async () => {
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    // Pre-pack labels are allowed on Open orders (REQ-R4-4); a second active label is refused.
    await createLabel(w.db, w.ctx, {
      orderId: o.id,
      carrierConnectionId: w.carrierConnectionId,
      carrierServiceId: w.serviceIds.ground,
      packages: [pkg],
    });
    await expect(
      createLabel(w.db, w.ctx, {
        orderId: o.id,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: w.serviceIds.ground,
        packages: [pkg],
      }),
    ).rejects.toThrow(/already has an active shipping label/);
    const id = await packedOrder();
    await expect(
      createLabel(w.db, w.ctx, {
        orderId: id,
        carrierConnectionId: 'nope',
        carrierServiceId: w.serviceIds.ground,
        packages: [pkg],
      }),
    ).rejects.toThrow(/Carrier connection not found/);
    await expect(
      createLabel(w.db, w.ctx, {
        orderId: id,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: 'nope',
        packages: [pkg],
      }),
    ).rejects.toThrow(/service not found/);
    await expect(
      createLabel(
        w.db,
        w.ctx,
        {
          orderId: id,
          carrierConnectionId: w.carrierConnectionId,
          carrierServiceId: w.serviceIds.ground,
          packages: [{ ...pkg, weightOz: 99999 }],
        },
        { files: w.files },
      ),
    ).rejects.toThrow(/150 lb/);
    expect(
      (await w.db.select().from(schema.carrierCallLogs)).find(
        (l) => l.step === 'LabelGeneration' && l.status === 'Error',
      ),
    ).toBeDefined();
    const other = (
      await w.db
        .insert(schema.carrierConnections)
        .values({
          provider: 'acme-freight',
          setupName: 'Acme Freight',
          accountPrefix: 'ACM',
          warehouseId: w.warehouseId,
          settings: {},
        })
        .returning()
    )[0];
    await expect(
      createLabel(w.db, w.ctx, {
        orderId: id,
        carrierConnectionId: other.id,
        carrierServiceId: w.serviceIds.ground,
        packages: [pkg],
      }),
    ).rejects.toThrow(/not configured yet/);
    await w.db
      .update(schema.carrierConnections)
      .set({ allClients: false })
      .where(eq(schema.carrierConnections.id, w.carrierConnectionId));
    await expect(
      createLabel(w.db, w.ctx, {
        orderId: id,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: w.serviceIds.ground,
        packages: [pkg],
      }),
    ).rejects.toThrow(/not available for this client/);
  });

  it('ships, maintains the EOD manifest from label time, opens a new one after close and creates a return label', async () => {
    const id = await packedOrder();
    expect((await shipOrders(w.db, w.ctx, { orderIds: [id] })).failed[0].message).toMatch(
      /no active shipping label/,
    );
    await createLabel(
      w.db,
      w.ctx,
      {
        orderId: id,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: w.serviceIds.ground,
        packages: [pkg],
      },
      { files: w.files },
    );
    const r = await shipOrders(w.db, w.ctx, { orderIds: [id], shipDate: '2026-11-05T15:00:00Z' });
    expect(r.succeeded).toEqual([id]);
    expect(await status(id)).toBe('Shipped');
    // The label joins the open manifest of its (warehouse-local) label date when it is created.
    const labelDay = localDate(new Date(), 'America/Chicago');
    const eod = (await w.db.select().from(schema.endOfDayManifests).limit(1))[0];
    expect(eod).toMatchObject({
      shipDate: labelDay,
      totalPackages: 1,
      carrierPrefix: 'SBX',
      sequence: 1,
      status: 'Open',
    });
    await expect(
      voidLabel(w.db, w.ctx, {
        shipmentId: (await w.db.select().from(schema.shipments).limit(1))[0]?.id as string,
      }),
    ).rejects.toThrow(/shipped/);
    expect((await closeEndOfDay(w.db, w.ctx, { manifestId: eod?.id as string })).status).toBe('Closed');
    await expect(
      async () => await closeEndOfDay(w.db, w.ctx, { manifestId: eod?.id as string }),
    ).rejects.toThrow(/already closed/);
    await expect(async () => await closeEndOfDay(w.db, w.ctx, { manifestId: 'x' })).rejects.toThrow(
      /not found/,
    );
    const id2 = await packedOrder(1);
    await createLabel(
      w.db,
      w.ctx,
      {
        orderId: id2,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: w.serviceIds.ground,
        packages: [pkg],
      },
      { files: w.files },
    );
    // After close, the next label opens a second manifest for the same carrier/day (shipping REQ-2).
    expect(
      (await shipOrders(w.db, w.ctx, { orderIds: [id2], shipDate: '2026-11-05T16:00:00Z' })).succeeded,
    ).toEqual([id2]);
    const manifests = await w.db.select().from(schema.endOfDayManifests);
    expect(manifests.map((m) => [m.sequence, m.status, m.totalPackages])).toEqual([
      [1, 'Closed', 1],
      [2, 'Open', 1],
    ]);
    const ro = (
      await w.db
        .insert(schema.returnOrders)
        .values({ rmaCode: 'RMA9', shipmentOrderId: id, warehouseId: w.warehouseId, clientId: w.clientId })
        .returning()
    )[0];
    const ret = await createReturnLabel(
      w.db,
      w.ctx,
      {
        orderId: id,
        returnOrderId: ro.id,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: w.serviceIds.priority,
        package: pkg,
      },
      { files: w.files },
    );
    expect(ret.shipment.labelType).toBe('Return Label');
    expect(
      (await w.db.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, ro.id)).limit(1))[0],
    ).toMatchObject({ status: 'In Transit', trackingNumber: ret.trackingNumber });
    expect(
      (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0]
        ?.returnTrackingNumbers,
    ).toEqual([ret.trackingNumber]);
    expect((await voidLabel(w.db, w.ctx, { shipmentId: ret.shipment.id })).voided).toBe(1);
    const unshipped = await packedOrder(1);
    await expect(
      createReturnLabel(w.db, w.ctx, {
        orderId: unshipped,
        carrierConnectionId: w.carrierConnectionId,
        carrierServiceId: w.serviceIds.priority,
        package: pkg,
      }),
    ).rejects.toThrow(/shipped orders/);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it('partially ships after a pack short and ships without a label when allowed', async () => {
    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId: w.productId,
      locationId: w.loc.storageA,
      qty: 5,
    });
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 3 }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const {
      jobIds: [jobId],
    } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
    const tasks = await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId));
    await execute(w.db, w.ctx, {
      taskIds: [tasks.find((t) => t.taskType === 'Picking')?.id as string],
      targetLocationId: w.loc.pick,
    });
    await execute(w.db, w.ctx, {
      taskIds: [tasks.find((t) => t.taskType === 'Packing')?.id as string],
      targetLocationId: w.loc.pack,
      qty: 2,
    });
    expect((await shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false })).succeeded).toEqual([
      o.id,
    ]);
    expect(await status(o.id)).toBe('Partially Shipped');
    expect(localDate(new Date('2026-11-05T03:00:00Z'), 'America/Chicago')).toBe('2026-11-04');
    expect(localDate(new Date('2026-11-05T03:00:00Z'), 'Not/AZone')).toBe('2026-11-05');
  });

  it('uses a registered third-party adapter', async () => {
    const fake: CarrierAdapter = {
      ...sandboxCarrier,
      provider: 'fake-co',
      async createLabel() {
        throw new Error('boom');
      },
    };
    registerCarrierAdapter(fake);
    const conn = (
      await w.db
        .insert(schema.carrierConnections)
        .values({
          provider: 'fake-co',
          setupName: 'Fake',
          accountPrefix: 'FK',
          warehouseId: w.warehouseId,
          settings: {},
        })
        .returning()
    )[0];
    const svc = (
      await w.db
        .insert(schema.carrierServices)
        .values({
          connectionId: conn.id,
          carrierCode: 'FK',
          serviceCode: 'SBX_GROUND',
          name: 'G',
          transitDays: 2,
        })
        .returning()
    )[0];
    const id = await packedOrder();
    await expect(
      createLabel(w.db, w.ctx, {
        orderId: id,
        carrierConnectionId: conn.id,
        carrierServiceId: svc.id,
        packages: [pkg],
      }),
    ).rejects.toThrow(/Carrier error: boom/);
  });
});
