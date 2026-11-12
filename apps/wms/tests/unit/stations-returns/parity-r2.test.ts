/**
 * M04 parity loop round 2: one rate rule for Get rate / Complete, package attributes,
 * Report Issue quantities, monotonic Create RMA progress, index-friendly scans and the
 * Return Station KPIs returned with every receive.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { closeUsedBoxes, completeStep, defaultIssueQty, initialPackState, issueLinesPayload, lineAttributes, rateBlocker, rateSpecs, scanProduct, updateBox, type PackLine } from "@/components/packing/pack-model";
import { rmaProgress } from "@/components/returns/rma-form";
import { packContext, reportIssue } from "@/server/repositories/packing";
import { codeVariants, findOrdersByCode } from "@/server/repositories/packing-scan";
import { insertRma, type ScopedCtx } from "@/server/repositories/returns";
import { lookupRmas, receiveManual, receiveManualSchema, receiveRma, receiveRmaSchema } from "@/server/repositories/returns-receive";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";
import { hospitalOf } from "./hospital-fixture";
import { withWriteTx } from "@/server/db/sql";

const line = (over: Partial<PackLine> = {}): PackLine => ({
  orderLineId: "l1", productId: "p1", sku: "SKU-1", name: "Widget", imageUrl: null, packType: "Each", ordered: 2, toPack: 2, packed: 0, weightOz: 8,
  scanCodes: ["sku-1"], trackSerial: false, captureLot: false, captureExpiry: false, lotNumber: null, expiryDate: null, pickedSerials: [], packingInstructions: null,
  ...over,
});
const pkgType = { id: "pk", code: "BOX-S", description: null, length: 10, width: 8, height: 4, emptyWeightLb: 0.5, tracksInventory: false };

describe("one rule for Get rate and Complete", () => {
  it("Get rate needs items plus size and weight on every used package, not a closed package", () => {
    const lines = [line()];
    let s = initialPackState(lines, pkgType);
    expect(rateBlocker(s)).toMatch(/Scan items/);
    const scanned = scanProduct(lines, s, "SKU-1");
    if (!scanned.ok) throw new Error(scanned.error);
    s = scanned.state;
    expect(rateBlocker(s)).toMatch(/Package 1: Enter the package weight/);
    s = updateBox(s, 0, { weightLb: 1 });
    expect(s.boxes[0]?.closed).toBe(false);
    expect(rateBlocker(s)).toBeNull();
    expect(rateSpecs(s)).toEqual([{ weightOz: 16, length: 10, width: 8, height: 4 }]);
  });

  it("Complete with a label quotes first, then buys; a failed quote does not trap the operator", () => {
    expect(completeStep({ withLabel: true, hasRate: false, quoteTried: false })).toBe("quote");
    expect(completeStep({ withLabel: true, hasRate: true, quoteTried: true })).toBe("buy");
    expect(completeStep({ withLabel: true, hasRate: false, quoteTried: true })).toBe("buy");
    expect(completeStep({ withLabel: false, hasRate: false, quoteTried: false })).toBe("buy");
  });

  it("Complete closes every package that has items and leaves empty ones open", () => {
    const lines = [line({ toPack: 1 })];
    const s0 = initialPackState(lines, pkgType);
    const scanned = scanProduct(lines, s0, "sku-1");
    if (!scanned.ok) throw new Error(scanned.error);
    const withEmpty = { ...scanned.state, boxes: [...scanned.state.boxes, { ...scanned.state.boxes[0]!, seq: 2, items: {}, closed: false }] };
    const closed = closeUsedBoxes(withEmpty);
    expect(closed.boxes.map((b) => b.closed)).toEqual([true, false]);
  });
});

describe("package contents attributes", () => {
  it("shows lot, expiry and serials", () => {
    const l = line({ lotNumber: "L-9", expiryDate: "2027-01-31T00:00:00Z" });
    const s = initialPackState([l]);
    expect(lineAttributes(l, s)).toEqual(["Lot L-9", "Exp 2027-01-31"]);
    const serial = line({ trackSerial: true });
    const st = { ...initialPackState([serial]), captures: { l1: { serials: ["S1", "S2"], lotNumber: "", expiryDate: "" } } };
    expect(lineAttributes(serial, st)).toEqual(["2 serials"]);
    expect(lineAttributes(line(), initialPackState([line()]))).toEqual([]);
  });
});

describe("Report Issue quantities", () => {
  const il = { orderLineId: "l1", sku: "A", name: "A", imageUrl: null, toPack: 3, packed: 1 };
  it("defaults to the unpacked units, else the whole line", () => {
    expect(defaultIssueQty(il)).toBe(2);
    expect(defaultIssueQty({ ...il, packed: 3 })).toBe(3);
  });
  it("sends positive, capped, whole quantities only", () => {
    expect(issueLinesPayload([il, { ...il, orderLineId: "l2" }], { l1: 9, l2: 0 })).toEqual([{ orderLineId: "l1", qty: 3 }]);
    expect(issueLinesPayload([il], { l1: 1.7 })).toEqual([{ orderLineId: "l1", qty: 1 }]);
  });
});

describe("Create RMA progress ring", () => {
  const sel = [{ orderLineId: "a", selected: true, quantity: 1, reasonId: null }];
  it("counts the order as soon as it is chosen and is 100% only with valid Return shipping", () => {
    expect(rmaProgress({ orderId: "", lines: [] }, { orderEligible: false, reachedStep: 0 }).percent).toBe(0);
    expect(rmaProgress({ orderId: "o", lines: [] }, { orderEligible: true, reachedStep: 0 })).toEqual({ percent: 33, label: "Order chosen. Continue to items" });
    // A preselected line on step 1 does not count until the Items step is reached.
    expect(rmaProgress({ orderId: "o", lines: sel }, { orderEligible: true, reachedStep: 0 }).percent).toBe(33);
    expect(rmaProgress({ orderId: "o", lines: [] }, { orderEligible: true, reachedStep: 1 })).toEqual({ percent: 33, label: "Choose the items" });
    expect(rmaProgress({ orderId: "o", lines: sel }, { orderEligible: true, reachedStep: 1 })).toEqual({ percent: 67, label: "Items chosen. Continue to return shipping" });
    expect(rmaProgress({ orderId: "o", lines: sel }, { orderEligible: true, reachedStep: 2 })).toEqual({ percent: 100, label: "Ready to create" });
  });
});

describe("index-friendly scans and receive KPIs (DB)", () => {
  let w: World;
  let scope: Scope;
  let ctx: ScopedCtx;
  beforeEach(async () => {
    w = await createWorld();
    scope = { warehouseIds: [w.warehouseId], clientIds: "all" } as unknown as Scope;
    ctx = { ...w.ctx, scope } as ScopedCtx;
  });
  afterEach(() => w.close());

  async function shipped(qty: number): Promise<{ orderId: string; lineId: string; code: string }> {
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: qty + 5 });
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const { jobIds: [jobId] } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
    for (const [type, loc] of [["Picking", w.loc.pick], ["Packing", w.loc.pack]] as const) {
      const ids = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, type)))).map((t) => t.id);
      if (ids.length) await execute(w.db, w.ctx, { taskIds: ids, targetLocationId: loc });
    }
    await shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false });
    const l = (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).limit(1))[0];
    const code = (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, o.id)).limit(1))[0]?.code ?? "";
    return { orderId: o.id, lineId: l?.id ?? "", code };
  }

  it("order scans match exactly or in any case; variants are deduped", async () => {
    expect(codeVariants(" so1 ")).toEqual(["so1", "SO1"]);
    const { orderId, code } = await shipped(1);
    expect(await findOrdersByCode(w.db, w.warehouseId, code)).toEqual([orderId]);
    expect(await findOrdersByCode(w.db, w.warehouseId, code.toLowerCase())).toEqual([orderId]);
    const mixed = code.charAt(0) + code.slice(1).toLowerCase();
    expect(await findOrdersByCode(w.db, w.warehouseId, mixed)).toEqual([orderId]);
    expect(await findOrdersByCode(w.db, w.warehouseId, "nope-0")).toEqual([]);
  });

  it("RMA lookup by RMA code (any case) and by order code", async () => {
    const { orderId, lineId, code } = await shipped(2);
    const rma = await insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    expect((await lookupRmas(w.db, scope, w.warehouseId, rma.rmaCode.toLowerCase()))[0]?.id).toBe(rma.id);
    expect((await lookupRmas(w.db, scope, w.warehouseId, code))[0]?.id).toBe(rma.id);
    expect(await lookupRmas(w.db, scope, w.warehouseId, "zzz")).toEqual([]);
  });

  it("receive and manual return return the updated station KPIs", async () => {
    const { orderId, lineId } = await shipped(2);
    const rma = await insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    const res = await receiveRma(w.db, ctx, receiveRmaSchema.parse({ returnOrderId: rma.id, stationLocationId: w.loc.returns, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }] }));
    expect(res.status).toBe("Completed");
    expect(res.kpis).toMatchObject({ returnedOrdersToday: 1, returnedProductsToday: 1, openReturns: 0 });
    const manual = await receiveManual(w.db, ctx, receiveManualSchema.parse({ warehouseId: w.warehouseId, clientId: w.clientId, stationLocationId: w.loc.returns, items: [{ productId: w.productId, quantity: 2, disposition: "Restock" }] }));
    expect(manual.kpis).toMatchObject({ returnedOrdersToday: 2, returnedProductsToday: 3 });
  });

  it("pack context carries the default hospital code; Report Issue moves only the chosen units", async () => {
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 5 });
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 3 }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const { jobIds: [jobId] } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
    const picks = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, "Picking")))).map((t) => t.id);
    await execute(w.db, w.ctx, { taskIds: picks, targetLocationId: w.loc.pick });
    await hospitalOf(w);
    const c = await packContext(w.db, scope, o.id);
    expect(c.hospital?.id).toBe(c.hospitalLocationId);
    expect(c.hospital?.code).toBe("HOSP-01");
    const lineId = c.lines[0]?.orderLineId as string;
    const hospId = await hospitalOf(w);
    const res = await withWriteTx(w.db, async (tx) => await reportIssue(tx, ctx, { orderId: o.id, hospitalLocationId: hospId, note: "1 crushed", lines: [{ orderLineId: lineId, qty: 1 }] }));
    expect(res.movedUnits).toBe(1);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });
});
