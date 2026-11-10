/** M04 pure client models: pack screen (scans, over-pack, serials, multi-box, readiness, payload), return station capture, Create RMA steps, return label. */
import { describe, expect, it } from "vitest";
import {
  addBox, buildCompletePayload, cancelSerial, choosePackage, closeBox, completeBlocker, initialPackState, packedQty, removeOne, scanProduct, setCapture, suggestedWeightOz, totalsOf, updateBox,
  type PackLine, type PackPackageType, type PackState,
} from "@/components/packing/pack-model";
import { addManualProduct, applyScan, itemsFromRma, itemsPayload, totals, validateItems } from "@/components/returns/return-station-model";
import { buildCreatePayload, initialLines, linesStepSchema, orderStepSchema, shippingStepSchema, type RmaFormValues } from "@/components/returns/rma-form";
import { EMPTY_LABEL, labelPayload, validateLabel } from "@/components/returns/return-label-fields-model";
import type { ShippableOrder } from "@/components/returns/return-types";

const line = (id: string, sku: string, toPack: number, extra: Partial<PackLine> = {}): PackLine => ({
  orderLineId: id, productId: `p-${id}`, sku, name: sku, imageUrl: null, packType: "Each", ordered: toPack, toPack, packed: 0, weightOz: 8,
  scanCodes: [sku.toLowerCase(), `${sku.toLowerCase()}-bc`], trackSerial: false, captureLot: false, captureExpiry: false, lotNumber: null, expiryDate: null,
  pickedSerials: [], packingInstructions: null, ...extra,
});
const BOX: PackPackageType = { id: "pkg-m", code: "BOX-M", description: null, length: 12, width: 10, height: 6, emptyWeightLb: 0.5, tracksInventory: true };

function scanAll(lines: readonly PackLine[], s: PackState, codes: readonly string[]): PackState {
  return codes.reduce((acc, c) => {
    const r = scanProduct(lines, acc, c);
    if (!r.ok) throw new Error(r.error);
    return r.state;
  }, s);
}

describe("pack model", () => {
  const lines = [line("a", "SKU-A", 2), line("b", "SKU-B", 1)];

  it("packs by SKU or barcode, rejects wrong items and blocks over-pack", () => {
    let s = initialPackState(lines, BOX);
    expect(s.boxes[0]?.length).toBe(12);
    s = scanAll(lines, s, ["SKU-A", "sku-a-bc"]);
    expect(packedQty(s, "a")).toBe(2);
    const over = scanProduct(lines, s, "SKU-A");
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error).toMatch(/Over-packing is blocked/);
    const wrong = scanProduct(lines, s, "NOPE-1");
    expect(!wrong.ok && wrong.error).toMatch(/Wrong item/);
    expect(totalsOf(lines, s)).toEqual({ packed: 2, toPack: 3 });
  });

  it("requires a serial per unit of serial-tracked lines and rejects duplicates / unpicked serials", () => {
    const ls = [line("s", "SER-1", 2, { trackSerial: true, pickedSerials: ["SN1", "SN2"] })];
    let s = initialPackState(ls, BOX);
    const r1 = scanProduct(ls, s, "SER-1");
    expect(r1.ok && r1.state.awaitingSerialFor).toBe("s");
    s = r1.ok ? r1.state : s;
    expect(packedQty(s, "s")).toBe(0);
    const bad = scanProduct(ls, s, "SN9");
    expect(!bad.ok && bad.error).toMatch(/not picked/);
    s = scanAll(ls, s, ["SN1"]);
    expect(packedQty(s, "s")).toBe(1);
    s = scanAll(ls, s, ["SER-1"]);
    const dup = scanProduct(ls, s, "SN1");
    expect(!dup.ok && dup.error).toMatch(/already scanned/);
    expect(cancelSerial(s).awaitingSerialFor).toBeNull();
    s = scanAll(ls, s, ["SN2"]);
    expect(s.captures.s?.serials).toEqual(["SN1", "SN2"]);
    expect(removeOne(ls, s, 0, "s").captures.s?.serials).toEqual(["SN1"]);
  });

  it("multi-box: closing a package with items left opens the next; complete payload has 2 packages", () => {
    let s = initialPackState(lines, BOX);
    s = scanAll(lines, s, ["SKU-A"]);
    const fail = closeBox(lines, s);
    expect(fail.error).toMatch(/weight/);
    s = updateBox(s, 0, { weightLb: 1 });
    const closed = closeBox(lines, s);
    expect(closed.error).toBeNull();
    expect(closed.openedNext).toBe(true);
    s = closed.state;
    expect(s.boxes).toHaveLength(2);
    s = scanAll(lines, s, ["SKU-A", "SKU-B"]);
    expect(completeBlocker(lines, s, { withLabel: true, carrierServiceId: "svc" })).toMatch(/Package 2: Enter the package weight/);
    s = updateBox(s, 1, { weightOz: 12 });
    expect(completeBlocker(lines, s, { withLabel: true, carrierServiceId: null })).toMatch(/carrier/);
    expect(completeBlocker(lines, s, { withLabel: false, carrierServiceId: null })).toBeNull();
    const p = buildCompletePayload({ orderId: "o", stationId: "st", withLabel: true, carrierConnectionId: "c", carrierServiceId: "svc" }, s);
    expect(p.packages).toHaveLength(2);
    expect(p.packages[0]).toMatchObject({ weightOz: 16, items: [{ orderLineId: "a", qty: 1 }] });
    expect(p.packages[1]?.items).toEqual([{ orderLineId: "a", qty: 1 }, { orderLineId: "b", qty: 1 }]);
  });

  it("requires lot and expiry when captured during packing; suggests weight from products + package", () => {
    const ls = [line("l", "LOT-1", 1, { captureLot: true, captureExpiry: true })];
    let s = scanAll(ls, initialPackState(ls, BOX), ["LOT-1"]);
    s = updateBox(s, 0, { weightLb: 1 });
    expect(completeBlocker(ls, s, { withLabel: false, carrierServiceId: null })).toMatch(/lot number/);
    s = setCapture(s, "l", { lotNumber: "L1", expiryDate: "2027-01-01" });
    expect(completeBlocker(ls, s, { withLabel: false, carrierServiceId: null })).toBeNull();
    expect(suggestedWeightOz(ls, s.boxes[0] ?? addBox(s).boxes[0]!, BOX)).toBe(16);
    expect(choosePackage(s, 0, null).boxes[0]?.length).toBeNull();
  });
});

describe("return station model", () => {
  const items = itemsFromRma([
    { id: "l1", productId: "p1", sku: "SKU-1", name: "One", imageUrl: null, requestedQty: 2, returnedQty: 0 },
    { id: "l2", productId: "p2", sku: "SKU-2", name: "Two", imageUrl: null, requestedQty: 1, returnedQty: 1 },
  ]);

  it("loads only open lines and increments on scan up to the remaining qty", () => {
    expect(items).toHaveLength(1);
    const a = applyScan(items, "sku-1");
    expect(a.ok).toBe(true);
    const b = a.ok ? applyScan(a.items, "SKU-1") : a;
    expect(b.ok && b.items[0]?.quantity).toBe(2);
    const c = b.ok ? applyScan(b.items, "SKU-1") : b;
    expect(!c.ok && c.error).toMatch(/already scanned/);
    expect(applyScan(items, "OTHER").ok).toBe(false);
  });

  it("validates quantities and damage reasons and builds the payload", () => {
    expect(validateItems(items).message).toBe("Scan at least one item");
    const damaged = items.map((i) => ({ ...i, quantity: 1, disposition: "Damaged" as const }));
    expect(validateItems(damaged).errors.l1?.damageReasonId).toBeDefined();
    const over = items.map((i) => ({ ...i, quantity: 3 }));
    expect(validateItems(over).errors.l1?.quantity).toMatch(/Max 2/);
    const ok = damaged.map((i) => ({ ...i, damageReasonId: "dr" }));
    expect(validateItems(ok).message).toBeNull();
    expect(itemsPayload(ok, true)[0]).toMatchObject({ returnOrderLineId: "l1", disposition: "Damaged", damageReasonId: "dr" });
    expect(totals(ok)).toEqual({ scanned: 1, expected: 2 });
  });

  it("manual returns merge repeat scans of the same product", () => {
    const p = { id: "p9", sku: "SKU-9", name: "Nine", imageUrl: null };
    const one = addManualProduct([], p, "BC9");
    const two = addManualProduct(one.items, p, "BC9");
    expect(two.items).toHaveLength(1);
    expect(two.items[0]?.quantity).toBe(2);
    expect(itemsPayload(two.items, false)[0]).not.toHaveProperty("returnOrderLineId");
    expect(totals(two.items).expected).toBeNull();
  });
});

describe("create RMA form", () => {
  const order: ShippableOrder = {
    id: "o1", code: "SO1", status: "Shipped", warehouseId: "w", clientId: "c", clientName: "C", customerName: "Jane", storeOrderNumber: null, shippedAt: null, deliveredAt: null,
    shipTo: "", shipCountry: "US", eligible: true, reason: null,
    lines: [
      { orderLineId: "ol1", productId: "p1", sku: "A", name: "A", imageUrl: null, packType: "Each", shippedQty: 2, alreadyReturned: 0, returnable: 2, isNonReturnable: false },
      { orderLineId: "ol2", productId: "p2", sku: "B", name: "B", imageUrl: null, packType: "Each", shippedQty: 1, alreadyReturned: 1, returnable: 0, isNonReturnable: false },
    ],
  };
  const base = (): RmaFormValues => ({ orderId: "o1", lines: initialLines(order), expectedReturnDate: null, note: "", createLabel: false, label: EMPTY_LABEL });

  it("preselects the single returnable line and validates each step", () => {
    const v = base();
    expect(v.lines[0]).toMatchObject({ selected: true, quantity: 2 });
    expect(v.lines[1]?.selected).toBe(false);
    expect(orderStepSchema(order).safeParse(v).success).toBe(true);
    expect(orderStepSchema({ ...order, eligible: false, reason: "No" }).safeParse(v).success).toBe(false);
    expect(orderStepSchema(null).safeParse({ ...v, orderId: "" }).success).toBe(false);
    expect(linesStepSchema(order, false).safeParse(v).success).toBe(true);
    const over = linesStepSchema(order, false).safeParse({ ...v, lines: [{ ...v.lines[0], quantity: 3 }, v.lines[1]] });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.path).toEqual(["lines", 0, "quantity"]);
    expect(linesStepSchema(order, false).safeParse({ ...v, lines: v.lines.map((l) => ({ ...l, selected: false })) }).success).toBe(false);
    expect(linesStepSchema(order, true).safeParse(v).success).toBe(false);
  });

  it("validates the return label only when requested and builds the payload", () => {
    const v = { ...base(), createLabel: true, label: { ...EMPTY_LABEL, carrierKey: null } };
    const res = shippingStepSchema.safeParse(v);
    expect(res.success).toBe(false);
    expect(shippingStepSchema.safeParse({ ...v, createLabel: false }).success).toBe(true);
    const good = { ...v, label: { ...EMPTY_LABEL, carrierKey: "conn|UPS", carrierServiceId: "svc" }, note: "  hi " };
    expect(shippingStepSchema.safeParse(good).success).toBe(true);
    const p = buildCreatePayload(good);
    expect(p.lines).toEqual([{ orderLineId: "ol1", quantity: 2, customerReturnReasonId: null }]);
    expect(p.note).toBe("hi");
    expect(p.label).toEqual({ carrierConnectionId: "conn", carrierServiceId: "svc", package: { weightOz: 16, length: 12, width: 10, height: 6 } });
  });

  it("label validation flags every missing field", () => {
    const e = validateLabel({ carrierKey: null, carrierServiceId: null, weightLb: 200, length: null, width: 0, height: 1 });
    expect(Object.keys(e).sort()).toEqual(["carrierKey", "carrierServiceId", "length", "weightLb", "width"]);
    expect(labelPayload({ ...EMPTY_LABEL, carrierKey: "x|y", carrierServiceId: "s", weightLb: 0.5 }).package.weightOz).toBe(8);
  });
});
