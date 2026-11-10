/**
 * M05 round 6 parity loop (critic round 5, score 8.2): partial bulk Cancel / Receive PO,
 * the receive API contract (optional suggestBasis.qty, inferred directed putaway, human
 * messages) and the date field that always mirrors the typed text.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { createPurchaseOrder } from "@/server/repositories/purchase-orders-commands";
import { receivePurchaseOrder, suggestForLine } from "@/server/repositories/purchase-orders-receive";
import { createVendor } from "@/server/repositories/vendors";
import { poCreateSchema, receiveApiBodySchema, receiveBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { vendorFormSchema } from "@/lib/grid-defs/receiving/vendors";
import { cancelReason, partialActionReason, partitionPos, receiveAllReason, skippedSummary } from "@/components/receiving/po-action-rules";
import { dateTextValue } from "@/components/receiving/fields";
import { INVALID_DAY_MESSAGE, receiveBlockedReason } from "@/components/receiving/receive-items-drawer";
import type { PoLineRow, PoRow } from "@/components/receiving/receiving-shared";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const address = { name: "Dock", line1: "1 Supply Way", line2: "", postalCode: "38118", city: "Memphis", phone: "", country: "US", state: "TN" };
function createPo(code: string, qty = 10) {
  const v = createVendor(w.db, w.ctx, auth.scope, vendorFormSchema.parse({ clientId: w.clientId, displayName: `Acme ${code}`, vendorName: "Acme LLC", useShipAsBilling: true, shipping: address }));
  return createPurchaseOrder(w.db, w.ctx, auth.scope, poCreateSchema.parse({
    warehouseId: w.warehouseId, clientId: w.clientId, code, poType: "Purchase Order", poDate: "2026-11-09T15:00:00.000Z", vendorId: v.id,
    lines: [{ productId: w.productId, packType: "Each", orderedQuantity: qty, unitCost: 1 }],
  }));
}
const txnOf = (receiptId: string) => w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.receiptId, receiptId)).get();

const po = (code: string, status: string, extra: Partial<PoRow> = {}): PoRow =>
  ({ id: code, code, status, totalQuantity: 10, receivedQuantity: 0, activeReceipts: 0, receiveAllBlockedReason: null, ...extra }) as unknown as PoRow;

describe("partial bulk actions", () => {
  const rows = [po("KS-1", "Pending"), po("KS-2", "Completed"), po("KS-3", "Started")];

  it("acts on the eligible rows of a mixed selection", () => {
    expect(partialActionReason(rows, cancelReason)).toBeNull();
    const { eligible, skipped } = partitionPos(rows, cancelReason);
    expect(eligible.map((r) => r.code)).toEqual(["KS-1", "KS-3"]);
    expect(skipped).toEqual([{ id: "KS-2", code: "KS-2", reason: expect.stringMatching(/Completed/) }]);
    expect(skippedSummary(skipped, 3)).toBe("1 of 3 selected orders is skipped. Only Pending or Started orders can be cancelled (KS-2 is Completed).");
  });

  it("is disabled only when no row is eligible, with the row's reason", () => {
    expect(partialActionReason([po("KS-2", "Completed")], cancelReason)).toMatch(/KS-2 is Completed/);
    expect(partialActionReason([po("KS-2", "Completed"), po("KS-4", "Cancelled")], receiveAllReason)).toMatch(/^None of the selected purchase orders can be processed\. KS-2:/);
    expect(partialActionReason([po("KS-5", "Pending", { receivedQuantity: 10 })], receiveAllReason)).toMatch(/fully received/);
    expect(skippedSummary([], 2)).toBeNull();
  });
});

describe("receive API contract", () => {
  it("defaults suggestBasis.qty and speaks human messages", () => {
    const ok = receiveApiBodySchema.safeParse({ lines: [{ lineId: "l1", quantity: 2, suggestBasis: { lot: null } }] });
    expect(ok.success).toBe(true);
    const bad = receiveApiBodySchema.safeParse({ lines: [{ lineId: "l1", quantity: 2, suggestBasis: { qty: "x" } }] });
    expect(bad.success ? "" : bad.error.issues[0]?.message).toBe("suggestBasis.qty must be a whole number of units");
    const noLine = receiveApiBodySchema.safeParse({ lines: [{ quantity: 2 }] });
    expect(noLine.success ? "" : noLine.error.issues[0]?.message).toBe("Choose the purchase order line");
    expect(JSON.stringify(bad.success ? {} : bad.error.issues)).not.toMatch(/Invalid input/);
  });

  it("stamps the algorithm when an API caller posts a suggested location without fromSuggestion", () => {
    const p = createPo("KS-R9-ALG");
    const lineId = p.lines[0]?.id ?? "";
    const s = suggestForLine(w.db, auth.scope, p.id, lineId, 3, {});
    const top = s.suggestions[0];
    expect(top).toBeDefined();
    const r = receivePurchaseOrder(w.db, w.ctx, auth.scope, p.id, receiveBodySchema.parse({ lines: [{ lineId, quantity: 3, locationId: top?.locationId ?? "", suggestBasis: { lot: null } }] }));
    expect(txnOf(r.receiptIds[0] ?? "")?.algorithmName).toBe(s.algorithm);
  });

  it("still never stamps an explicit override", () => {
    const p = createPo("KS-R9-ALG2");
    const lineId = p.lines[0]?.id ?? "";
    const top = suggestForLine(w.db, auth.scope, p.id, lineId, 1, {}).suggestions[0];
    const r = receivePurchaseOrder(w.db, w.ctx, auth.scope, p.id, receiveBodySchema.parse({ lines: [{ lineId, quantity: 1, locationId: top?.locationId ?? "", fromSuggestion: false }] }));
    expect(txnOf(r.receiptIds[0] ?? "")?.algorithmName ?? null).toBeNull();
  });
});

describe("date field mirrors the typed text", () => {
  it("commits valid text as a day and keeps unparseable text as typed", () => {
    expect(dateTextValue("2027/06/30")).toBe("2027-06-30");
    expect(dateTextValue("2027-6-3")).toBe("2027-06-03");
    expect(dateTextValue("2027/06/304")).toBe("2027/06/304");
    expect(dateTextValue("2027/02/30")).toBe("2027/02/30");
    expect(dateTextValue("  ")).toBeNull();
  });

  it("blocks Receive while the expiry text is not a date", () => {
    const line = {
      id: "l1", sku: "CPL-MUG", orderedQuantity: 10, receivedQuantity: 0, uomQuantity: 1,
      tracking: { lot: false, expiry: true, production: false, serial: false, lotReceivingOnly: false, expiryReceivingOnly: false, productionReceivingOnly: false },
    } as unknown as PoLineRow;
    const values = (expiryDate: string | null) => ({
      allowOverReceipt: false, allowExpired: false,
      lines: [{ lineId: "l1", include: true, quantity: 2, locationId: "loc", locationCode: "A-01", lpMode: "none", lpId: null, lpLabel: null, lpTypeId: null, lotNumber: null, expiryDate, productionDate: null, damageReason: null, damageImageFileId: null, damageImageName: null, serials: [], note: null, fromSuggestion: false, suggestBasis: null, suggestedIds: [] }],
    });
    expect(receiveBlockedReason([line], values("2027/06/304"), "2026-11-10")).toBe(`CPL-MUG: ${INVALID_DAY_MESSAGE}`);
    expect(receiveBlockedReason([line], values("2027-06-30"), "2026-11-10")).toBeNull();
  });
});
