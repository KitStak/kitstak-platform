/** Pure M01 logic: wizard step schemas, totals, priority mapping, address attention, bulk-menu eligibility and Logiwa guard copy. */
import { describe, expect, it } from "vitest";
import {
  addressNeedsAttention, customerStepSchema, defaultOrderValues, detailsStepSchema, orderTotals, priorityFromRank, productsStepSchema, rankFromPriority,
} from "@/components/orders/wizard/order-form-model";
import { eligibility, guardChecks, LOGIWA_GUARDS, partition, shipConfirmText, type EligibilityRow } from "@/components/orders/bulk/order-eligibility";
import { REPRINT_GUARD, VOID_GUARD } from "@/server/repositories/orders-labels";
import { ORDER_BULK_ACTIONS, ORDER_BULK_PERMISSIONS, ORDER_COLUMNS, ORDER_FILTER_FIELDS, sentenceCase } from "@/lib/grid-defs/orders/shipment-orders";

const r = (over: Partial<EligibilityRow> = {}): EligibilityRow => ({
  id: "1", code: "SO1", status: "Open", jobId: null, retailerId: null, isMerged: false, hasLabel: false, hasActiveTask: false, hasSerials: false, ...over,
});

describe("wizard step schemas", () => {
  it("step 1 needs warehouse, client, code (no spaces, unique) and dates", () => {
    const v = defaultOrderValues(new Date("2026-11-06T12:00:00Z"));
    const bad = detailsStepSchema.safeParse({ ...v, warehouseId: "", clientId: "", code: "A B", orderTypeId: "", codeTaken: false });
    const paths = bad.error?.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["warehouseId", "clientId", "code", "orderTypeId"]));
    const taken = detailsStepSchema.safeParse({ ...v, warehouseId: "w", clientId: "c", code: "SO1", orderTypeId: "t", codeTaken: true });
    expect(taken.error?.issues[0]).toMatchObject({ path: ["code"], message: "Order code SO1 is already taken" });
  });

  it("step 2 validates name, US state and ZIP, tax id needs a type, and billing when not shared", () => {
    const v = defaultOrderValues();
    const res = customerStepSchema.safeParse({ ...v, customerFirstName: "", customerLastName: "", shipAddress: "1 Main", shipCity: "Memphis", shipCountry: "US", shipState: "Arkansas", shipZip: "123", taxId: "X1", taxType: null, useShipAsBilling: false });
    const paths = res.error?.issues.map((i) => i.path.join(".")) ?? [];
    expect(paths).toEqual(expect.arrayContaining(["customerFirstName", "shipState", "shipZip", "taxType", "billing.line1"]));
    const ok = customerStepSchema.safeParse({ ...v, customerFirstName: "Ann", shipAddress: "1 Main", shipCity: "Memphis", shipCountry: "US", shipState: "TN", shipZip: "38118", useShipAsBilling: true });
    expect(ok.success).toBe(true);
  });

  it("step 3 needs a line with positive qty", () => {
    expect(productsStepSchema.safeParse({ lines: [] }).error?.issues[0]?.message).toBe("Add at least one product to the order");
    expect(productsStepSchema.safeParse({ lines: [{ quantity: 0, unitPrice: 1 }] }).success).toBe(false);
  });

  it("computes the rail summary and maps priority", () => {
    const t = orderTotals([
      { productId: "a", isKit: false, quantity: 2, unitPrice: 10.005, weightOz: 8 },
      { productId: "b", isKit: true, quantity: 1, unitPrice: 5, weightOz: 4 },
    ], 3);
    expect(t).toMatchObject({ skuCount: 2, kitCount: 1, totalQuantity: 3, price: 25.01, total: 22.01, weightOz: 20 });
    expect(orderTotals([{ productId: "a", isKit: false, quantity: 1, unitPrice: 1, weightOz: 0 }], 9).total).toBe(0);
    expect([0, 1, 3, 7].map(priorityFromRank)).toEqual(["None", "Low", "High", "Urgent"]);
    expect(rankFromPriority("High", 0)).toBe(3);
    expect(rankFromPriority("Urgent", 12)).toBe(12);
    expect(rankFromPriority("High", 12)).toBe(3); // level changed after the rank: the level wins
  });

  it("flags the address step until verified or skipped", () => {
    expect(addressNeedsAttention({ skipAddressVerification: false, addressStatus: "Unverified" })).toBe(true);
    expect(addressNeedsAttention({ skipAddressVerification: false, addressStatus: "Corrected" })).toBe(false);
    expect(addressNeedsAttention({ skipAddressVerification: true, addressStatus: "Invalid" })).toBe(false);
  });
});

describe("bulk menu eligibility", () => {
  it("keeps guarded actions enabled so the guard modal shows Logiwa's exact copy", () => {
    expect(LOGIWA_GUARDS.reprint).toBe(REPRINT_GUARD);
    expect(LOGIWA_GUARDS.void).toBe(VOID_GUARD);
    const { eligible, skipped } = partition([r(), r({ id: "2", hasLabel: true })], guardChecks.reprint);
    expect([eligible.length, skipped.length]).toEqual([1, 1]);
  });

  it("returns reasons only when no selected row qualifies", () => {
    expect(eligibility.ship([r()])).toBe("Only Ready to Ship orders can be shipped.");
    expect(eligibility.ship([r(), r({ status: "Ready to Ship" })])).toBeNull();
    expect(eligibility.release([r({ status: "On Hold" })])).toBeNull();
    expect(eligibility.delete([r({ jobId: "j" })])).toMatch(/Only Open orders without a job/);
    expect(eligibility.unmerge([r()])).toBe("Enabled only for merged orders.");
    expect(eligibility.resolvePickShort([r({ pickShortStatus: "Open" })])).toBeNull();
    expect(eligibility.retailerLabel([r()])).toMatch(/need a retailer/);
  });

  it("lets Change warehouse run on orders with a job so they are reported as skipped", () => {
    expect(eligibility.changeWarehouse([r({ status: "Ready to Pick", jobId: "j" })])).toBeNull();
    expect(eligibility.changeWarehouse([r({ status: "Shipped" })])).toMatch(/Only Open/);
  });

  it("ship confirm copy pluralises", () => {
    expect(shipConfirmText(1)).toMatch(/^1 order will be shipped/);
    expect(shipConfirmText(3)).toMatch(/^3 orders will be shipped/);
  });
});

describe("grid definitions", () => {
  it("carries the 58 Logiwa columns, 67+ filter fields, sentence-case labels and a permission per bulk action", () => {
    expect(ORDER_COLUMNS.length).toBeGreaterThanOrEqual(58);
    expect(ORDER_FILTER_FIELDS.length).toBeGreaterThanOrEqual(67);
    expect(new Set(ORDER_COLUMNS.map((c) => c.id)).size).toBe(ORDER_COLUMNS.length);
    expect(sentenceCase("Expected Ship Date")).toBe("Expected ship date");
    for (const a of ORDER_BULK_ACTIONS) expect(ORDER_BULK_PERMISSIONS[a]).toMatch(/^fulfillment\./);
  });
});

describe("order job modal helpers", () => {
  const ref = (id: string, status: string, warehouseId = "w1") => ({ id, code: id.toUpperCase(), status, warehouseId });
  it("groups only Open / Shortage orders for allocation, per warehouse", async () => {
    const { allocationBatches } = await import("@/components/orders/bulk/order-job-modal");
    const map = allocationBatches([ref("a", "Open"), ref("b", "Ready to Pick"), ref("c", "Shortage", "w2")]);
    expect([...map.entries()]).toEqual([["w1", ["a"]], ["w2", ["c"]]]);
  });
  it("blocks mixed warehouses and skips statuses that cannot get a job", async () => {
    const { jobPrecheck } = await import("@/components/orders/bulk/order-job-modal");
    expect(jobPrecheck([ref("a", "Open"), ref("b", "Open", "w2")]).blocked).toMatch(/one warehouse/);
    const r = jobPrecheck([ref("a", "Open"), ref("b", "Shipped")]);
    expect(r.blocked).toBeNull();
    expect(r.skipped.map((s) => s.id)).toEqual(["b"]);
    expect(jobPrecheck([ref("b", "Cancelled")]).blocked).toMatch(/None/);
  });
  it("plans job batches with the remainder last", async () => {
    const { jobBatches } = await import("@/components/orders/bulk/order-job-modal");
    expect(jobBatches(7, 3)).toEqual([3, 3, 1]);
    expect(jobBatches(0, 3)).toEqual([]);
    expect(jobBatches(5, null)).toEqual([]);
  });
});
