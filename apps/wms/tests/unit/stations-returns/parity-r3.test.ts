/**
 * Round 3 parity loop: date-only round trip in a negative-UTC-offset timezone, the Create RMA
 * Return section (address + manual carrier / option / cost / tracking numbers), progress ring
 * honesty, line-level change log, scan misses as 200 results, pack totals, auto-print plan,
 * packing history and partial-selection notes.
 */
process.env.TZ = 'America/Chicago';

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { historySheetRows, HISTORY_HEADERS } from '@/components/packing/packing-history';
import { printPlan, printSummary } from '@/components/packing/auto-print';
import { packageTotals } from '@/components/packing/pack-model';
import { isScanMiss } from '@/components/packing/pack-types';
import { isDateOnly, isoFromLocalDate, localDateFromIso } from '@/components/returns/date-only';
import { manualCarrierOptions } from '@/components/returns/return-info-fields';
import { partialRmaNotes } from '@/components/returns/return-types';
import { EMPTY_LABEL } from '@/components/returns/return-label-fields-model';
import {
  addTrackingNumber,
  buildCreatePayload,
  EMPTY_RETURN_INFO,
  manualInfoPayload,
  rmaProgress,
  shippingIssues,
  type RmaFormValues,
} from '@/components/returns/rma-form';
import type { Scope } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { allocateOrders } from '@/server/domain/allocation';
import { createJobsFromOrders } from '@/server/domain/jobs';
import { ledger } from '@/server/domain/ledger';
import { createOrder } from '@/server/domain/orders';
import { shipOrders } from '@/server/domain/shipping';
import { execute } from '@/server/domain/tasks';
import { packingHistory, scanOutcome } from '@/server/repositories/packing-scan';
import {
  createRmaSchema,
  getReturnDetail,
  insertRma,
  joinTracking,
  selectionTransitions,
  shippableOrder,
  splitTracking,
  type ScopedCtx,
} from '@/server/repositories/returns';
import {
  receiveRma,
  receiveRmaSchema,
  returnStations,
  returnTargets,
} from '@/server/repositories/returns-receive';
import { createWorld, locationRow, orderInput, type World } from '../foundation/domain/fixtures';

describe('date-only values in America/Chicago (UTC-6)', () => {
  it('round-trips YYYY-MM-DD with no day shift', () => {
    // The bug: UTC midnight rendered west of UTC is the previous day.
    expect(new Date('2026-11-20').getDate()).toBe(19);
    const d = localDateFromIso('2026-11-20');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(10);
    expect(d?.getDate()).toBe(20);
    expect(isoFromLocalDate(d)).toBe('2026-11-20');
    // A date picked in the calendar (local midnight) is written back unchanged.
    expect(isoFromLocalDate(new Date(2026, 10, 20))).toBe('2026-11-20');
    expect(isoFromLocalDate(new Date(2026, 10, 20, 23, 30))).toBe('2026-11-20');
    expect(localDateFromIso('2026-02-30')).toBeNull();
    expect(localDateFromIso('nope')).toBeNull();
    expect(isDateOnly('2026-11-20')).toBe(true);
    expect(isDateOnly('2026-11-20T00:00:00Z')).toBe(false);
  });
  it('the API rejects non-calendar dates', () => {
    const base = { shipmentOrderId: 'o', lines: [{ orderLineId: 'l', quantity: 1 }] };
    expect(createRmaSchema.safeParse({ ...base, expectedReturnDate: '2026-11-20' }).success).toBe(true);
    expect(createRmaSchema.safeParse({ ...base, expectedReturnDate: '2026-02-30' }).success).toBe(false);
    expect(createRmaSchema.safeParse({ ...base, expectedReturnDate: '11/20/2026' }).success).toBe(false);
  });
});

describe('Create RMA Return section model', () => {
  const values = (over: Partial<RmaFormValues> = {}): RmaFormValues => ({
    orderId: 'o',
    lines: [{ orderLineId: 'l', selected: true, quantity: 1, reasonId: null }],
    expectedReturnDate: null,
    note: '',
    createLabel: false,
    label: EMPTY_LABEL,
    returnAddressId: 'a1',
    returnInfo: EMPTY_RETURN_INFO,
    ...over,
  });
  it('adds tracking numbers with Add: trims, rejects duplicates, caps at 10', () => {
    let list: readonly string[] = [];
    list = addTrackingNumber(list, ' 1Z999 ').list;
    expect(list).toEqual(['1Z999']);
    expect(addTrackingNumber(list, '1z999').error).toMatch(/already added/);
    expect(addTrackingNumber(list, '  ').error).toBe('Enter a tracking number');
    expect(addTrackingNumber(list, 'x'.repeat(61)).error).toBe('Max 60 characters');
    const full = Array.from({ length: 10 }, (_, i) => `T${i}`);
    expect(addTrackingNumber(full, 'T10').error).toMatch(/Up to 10/);
  });
  it('sends manual return info only without a label, and only when something was entered', () => {
    expect(manualInfoPayload(EMPTY_RETURN_INFO)).toBeNull();
    const info = {
      carrierCode: 'UPS',
      carrierServiceName: ' Ground ',
      shippingCost: 7.5,
      trackingNumbers: ['1Z1', '1Z2'],
    };
    expect(buildCreatePayload(values({ returnInfo: info }))).toMatchObject({
      returnAddressId: 'a1',
      label: null,
      returnInfo: {
        carrierCode: 'UPS',
        carrierServiceName: 'Ground',
        shippingCost: 7.5,
        trackingNumbers: ['1Z1', '1Z2'],
      },
    });
    expect(buildCreatePayload(values({ createLabel: true, returnInfo: info })).returnInfo).toBeNull();
  });
  it('flags a negative cost and missing label fields', () => {
    expect(shippingIssues(values({ returnInfo: { ...EMPTY_RETURN_INFO, shippingCost: -1 } }))).toHaveProperty(
      'returnInfo.shippingCost',
    );
    expect(Object.keys(shippingIssues(values({ createLabel: true, label: { ...EMPTY_LABEL } })))).toEqual(
      expect.arrayContaining(['label.carrierKey', 'label.carrierServiceId']),
    );
  });
  it('progress: order counts at once; never 100% while a visible required field is empty', () => {
    const sel = values().lines;
    expect(rmaProgress({ orderId: 'o', lines: [] }, { orderEligible: true, reachedStep: 0 }).percent).toBe(
      33,
    );
    const missingLabel = rmaProgress(
      { orderId: 'o', lines: sel, createLabel: true, label: EMPTY_LABEL },
      { orderEligible: true, reachedStep: 2 },
    );
    expect(missingLabel).toEqual({ percent: 67, label: 'Complete the return label fields' });
    const ok = rmaProgress(
      {
        orderId: 'o',
        lines: sel,
        createLabel: true,
        label: { ...EMPTY_LABEL, carrierKey: 'c|UPS', carrierServiceId: 's' },
      },
      { orderEligible: true, reachedStep: 2 },
    );
    expect(ok).toEqual({ percent: 100, label: 'Ready to create' });
  });
  it('manual carriers: warehouse connections first, common carriers, Other last', () => {
    expect(manualCarrierOptions([{ carrierCode: 'Stamps' }, { carrierCode: 'ups' }])).toEqual([
      'Stamps',
      'ups',
      'FedEx',
      'USPS',
      'DHL',
      'OnTrac',
      'Amazon Shipping',
      'Other',
    ]);
  });
  it('tracking numbers are stored comma-separated and split back', () => {
    expect(joinTracking([' 1Z1 ', '1Z2', '1Z1', ''])).toBe('1Z1, 1Z2');
    expect(joinTracking([])).toBeNull();
    expect(splitTracking('1Z1, 1Z2')).toEqual(['1Z1', '1Z2']);
  });
  it('partial-line selection notes name the RMA and its line count', () => {
    expect(
      partialRmaNotes([{ id: 'r', rmaCode: 'RMA000322', status: 'Pending', lineCount: 2, selectedLines: 1 }]),
    ).toEqual(['Applies to RMA RMA000322 (2 lines), not only the selected line.']);
    expect(
      partialRmaNotes([{ id: 'r', rmaCode: 'RMA1', status: 'Pending', lineCount: 2, selectedLines: 2 }]),
    ).toEqual([]);
    expect(
      partialRmaNotes([{ id: 'r', rmaCode: 'RMA1', status: 'Pending', lineCount: 2, selectedLines: null }]),
    ).toEqual([]);
  });
});

describe('pack screen helpers', () => {
  it('package footer totals: Total SKU and Total quantity', () => {
    expect(packageTotals({ a: 2, b: 1, c: 0 })).toEqual({ skus: 2, quantity: 3 });
    expect(packageTotals({})).toEqual({ skus: 0, quantity: 0 });
  });
  it('auto-print plan: every label to the barcode printer, slip to the laser printer', () => {
    const docs = {
      shipments: [
        { packageSeq: 1, trackingNumber: '1Z1', labelFileId: 'f1' },
        { packageSeq: 2, trackingNumber: '1Z2', labelFileId: null },
      ],
      packingSlipFileId: 's1',
    };
    const jobs = printPlan(docs, { barcodePrinter: 'ZEBRA-01', laserPrinter: 'HP-LASER' });
    expect(jobs.map((j) => [j.kind, j.fileId, j.printer])).toEqual([
      ['label', 'f1', 'ZEBRA-01'],
      ['slip', 's1', 'HP-LASER'],
    ]);
    expect(printSummary(jobs, 'agent')).toBe('Label → ZEBRA-01 · Packing slip → HP-LASER');
    expect(printSummary(jobs, 'browser')).toBe('Label → print dialog · Packing slip → print dialog');
    expect(printPlan({ shipments: [], packingSlipFileId: null }, null)).toEqual([]);
  });
  it('scan miss type guard', () => {
    expect(isScanMiss({ miss: { code: 'x', message: 'No order found', kind: 'NOT_FOUND' } })).toBe(true);
  });
  it('history sheet rows follow the headers', () => {
    const rows = historySheetRows([
      {
        orderId: 'o',
        orderCode: 'SO1',
        status: 'Ready to Ship',
        clientName: 'C',
        customerName: null,
        units: 2,
        packages: 1,
        trackingNumber: null,
        stationCode: 'PACK-01',
        packedAt: '2026-11-10T15:00:00.000Z',
      },
    ]);
    expect(rows[0]).toHaveLength(HISTORY_HEADERS.length);
    expect(rows[0]?.[0]).toBe('SO1');
  });
});

describe('returns and packing (DB)', () => {
  let w: World;
  let scope: Scope;
  let ctx: ScopedCtx;
  beforeEach(async () => {
    w = await createWorld();
    scope = { warehouseIds: [w.warehouseId], clientIds: 'all' } as unknown as Scope;
    ctx = { ...w.ctx, scope } as ScopedCtx;
  });
  afterEach(() => w.close());

  async function shipped(qty: number, pack = true) {
    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId: w.productId,
      locationId: w.loc.storageA,
      qty: qty + 5,
    });
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const {
      jobIds: [jobId],
    } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
    for (const [type, loc] of [
      ['Picking', w.loc.pick],
      ['Packing', w.loc.pack],
    ] as const) {
      if (type === 'Packing' && !pack) continue;
      const ids = (
        await w.db
          .select()
          .from(schema.tasks)
          .where(and(eq(schema.tasks.jobId, jobId ?? ''), eq(schema.tasks.taskType, type)))
      ).map((t) => t.id);
      if (ids.length) await execute(w.db, w.ctx, { taskIds: ids, targetLocationId: loc });
    }
    if (pack) await shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false });
    const l = (
      await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).limit(1)
    )[0];
    const code =
      (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, o.id)).limit(1))[0]
        ?.code ?? '';
    return { orderId: o.id, lineId: l?.id ?? '', code };
  }

  it('creates an RMA with a return address and manual return info, logs line creation', async () => {
    const addr = (
      await w.db
        .insert(schema.addresses)
        .values({
          ownerType: 'warehouse',
          ownerId: w.warehouseId,
          name: 'Returns dock',
          usageType: 'Return',
          line1: '1 Dock Rd',
          city: 'Louisville',
          postalCode: '40201',
          country: 'US',
        })
        .returning()
    )[0];
    const { orderId, lineId } = await shipped(2);
    const order = await shippableOrder(w.db, scope, orderId);
    expect(order.returnAddresses[0]).toMatchObject({
      id: addr.id,
      label: 'Returns dock',
      owner: 'warehouse',
    });
    expect(order.defaultReturnAddressId).toBe(addr.id);
    const input = createRmaSchema.parse({
      shipmentOrderId: orderId,
      lines: [{ orderLineId: lineId, quantity: 1 }],
      expectedReturnDate: '2026-11-20',
      returnAddressId: addr.id,
      returnInfo: {
        carrierCode: 'UPS',
        carrierServiceName: 'Ground',
        shippingCost: 8.25,
        trackingNumbers: ['1ZA', '1ZB'],
      },
    });
    const rma = await insertRma(w.db, ctx, input);
    const d = await getReturnDetail(w.db, scope, rma.id);
    expect(d).toMatchObject({
      expectedReturnDate: '2026-11-20',
      carrierCode: 'UPS',
      carrierServiceName: 'Ground',
      trackingNumber: '1ZA, 1ZB',
      trackingNumbers: ['1ZA', '1ZB'],
      returnShippingCost: 8.25,
      returnAddressId: addr.id,
    });
    expect(d.returnAddress).toContain('1 Dock Rd');
    const log = (
      await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, rma.id))
    ).map((r) => r.message);
    expect(log).toContain('SKU-1 -> Return Order Line is created.'.replace('SKU-1', d.lines[0]?.sku ?? ''));
    // An address of another owner is refused.
    const foreign = (
      await w.db
        .insert(schema.addresses)
        .values({
          ownerType: 'customer',
          ownerId: 'x',
          line1: '9 Elsewhere',
          city: 'X',
          postalCode: '1',
          country: 'US',
        })
        .returning()
    )[0];
    await expect(
      async () =>
        await insertRma(w.db, ctx, {
          ...input,
          lines: [{ orderLineId: lineId, quantity: 1 }],
          returnAddressId: foreign.id,
        }),
    ).rejects.toThrow(/return address/);
  });

  it('logs disposition per line with the SKU', async () => {
    const { orderId, lineId } = await shipped(1);
    const rma = await insertRma(w.db, ctx, {
      shipmentOrderId: orderId,
      lines: [{ orderLineId: lineId, quantity: 1 }],
    });
    await receiveRma(
      w.db,
      ctx,
      receiveRmaSchema.parse({
        returnOrderId: rma.id,
        stationLocationId: w.loc.returns,
        items: [{ productId: w.productId, quantity: 1, disposition: 'Quarantine' }],
      }),
    );
    const sku =
      (await w.db.select().from(schema.products).where(eq(schema.products.id, w.productId)).limit(1))[0]
        ?.sku ?? '';
    const msgs = (
      await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, rma.id))
    ).map((r) => r.message);
    expect(msgs).toContain(`${sku} -> Disposition is modified. None → Quarantine`);
    expect(msgs.some((m) => m.startsWith('Disposition is modified'))).toBe(false);
  });

  it('selection transitions report line counts for partial selections', async () => {
    const { orderId, lineId } = await shipped(2);
    const rma = await insertRma(w.db, ctx, {
      shipmentOrderId: orderId,
      lines: [{ orderLineId: lineId, quantity: 1 }],
    });
    const lines = await w.db
      .select()
      .from(schema.returnOrderLines)
      .where(eq(schema.returnOrderLines.returnOrderId, rma.id));
    const res = await selectionTransitions(w.db, scope, [rma.id], [lines[0]?.id ?? '']);
    expect(res.returns[0]).toMatchObject({ lineCount: 1, selectedLines: 1 });
    expect((await selectionTransitions(w.db, scope, [rma.id])).returns[0]?.selectedLines).toBeNull();
  });

  it('scan misses are typed results, not errors; out-of-scope warehouse still throws', async () => {
    const miss = await scanOutcome(w.db, scope, {
      warehouseId: w.warehouseId,
      mode: 'order',
      code: 'SO000000',
    });
    expect(miss).toMatchObject({
      miss: { kind: 'NOT_FOUND', message: expect.stringMatching(/No order found/) },
    });
    expect(
      await scanOutcome(w.db, scope, { warehouseId: w.warehouseId, mode: 'tote', code: 'LP-NOPE' }),
    ).toHaveProperty('miss');
    await expect(
      async () =>
        await scanOutcome(w.db, { warehouseIds: [], clientIds: 'all' } as unknown as Scope, {
          warehouseId: w.warehouseId,
          mode: 'order',
          code: 'x',
        }),
    ).rejects.toThrow(/Warehouse not found/);
  });

  it("packing history lists today's packed orders for the user and honours the clear mark", async () => {
    const { code } = await shipped(2);
    const rows = await packingHistory(w.db, scope, w.warehouseId, w.ctx.userId);
    expect(rows.map((r) => r.orderCode)).toContain(code);
    expect(rows[0]?.units).toBe(2);
    const later = new Date(Date.now() + 60_000).toISOString();
    expect(await packingHistory(w.db, scope, w.warehouseId, w.ctx.userId, { since: later })).toEqual([]);
    expect(await packingHistory(w.db, scope, w.warehouseId, 'someone-else')).toEqual([]);
  });

  it('return stations list physical stations before virtual ones; targets skip packing / virtual', async () => {
    await w.db
      .insert(schema.locations)
      .values(
        locationRow(w.warehouseId, 'AAA-RTN-V', { areaType: 'Returns', locationType: 'Virtual' } as never),
      );
    const st = await returnStations(w.db, scope, w.warehouseId);
    const virtualIdx = st.findIndex((s) => s.code === 'AAA-RTN-V');
    expect(virtualIdx).toBe(st.length - 1);
    const targets = await returnTargets(w.db, scope, { warehouseId: w.warehouseId, kind: 'location' });
    expect(targets.some((t) => t.code === 'AAA-RTN-V')).toBe(false);
    expect(targets.every((t) => !/^Packing/.test(t.detail ?? ''))).toBe(true);
  });
});
