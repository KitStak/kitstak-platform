import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import type { AuthContext } from "@/server/auth/context";
import { destinationOptions } from "@/server/repositories/inventory-lookups";
import { bucketSubLabel, txnQtyDisplay } from "@/components/inventory/by-location-types";
import { toDestinationOption } from "@/components/inventory/destination-picker";
import { createWorld, locationRow, type World } from "../foundation/domain/fixtures";

describe("bucket drawer transaction quantity", () => {
  const fmt = (n: number) => String(n);
  it("never shows 0 for reservations", () => {
    expect(txnQtyDisplay({ type: "Allocation", qty: 3, direction: "neutral" }, fmt)).toMatchObject({ signed: 0, label: "3 reserved", kind: "reserve", tone: "neutral" });
    expect(txnQtyDisplay({ type: "Allocation Cancel", qty: -3, direction: "neutral" }, fmt)).toMatchObject({ label: "3 released", kind: "release" });
    expect(txnQtyDisplay({ type: "Attributes Change", qty: 2, direction: "neutral" }, fmt)).toMatchObject({ label: "2 changed", kind: "change" });
  });
  it("signs stock in and out", () => {
    expect(txnQtyDisplay({ type: "Inventory Movement", qty: 5, direction: "out" }, fmt)).toMatchObject({ signed: -5, label: "−5", tone: "out" });
    expect(txnQtyDisplay({ type: "Receiving", qty: 4, direction: "in" }, fmt)).toMatchObject({ signed: 4, label: "+4", tone: "in" });
    expect(txnQtyDisplay({ type: "Inventory Adjustment", qty: -2, direction: "adjust" }, fmt)).toMatchObject({ signed: -2, label: "−2" });
  });
});

describe("bucketSubLabel attributes", () => {
  const base = { lotNumber: null, lpNumber: null, status: "Stock", poNumber: null, receivedAt: "2026-11-09T10:00:00Z" };
  const iso = (v: string) => v.slice(0, 10);
  const cal = (v: string) => `${v.slice(5, 7)}/${v.slice(8, 10)}/${v.slice(0, 4)}`;
  it("names the expiry that splits otherwise identical rows, before the receipt date", () => {
    expect(bucketSubLabel({ ...base, expiryDate: "2026-02-28", trackExpiry: 1 }, iso, cal)).toBe("Exp 02/28/2026");
    expect(bucketSubLabel({ ...base, productionDate: "2026-01-02", trackProductionDate: 1, lpNumber: "LP1" }, iso, cal)).toBe("Prod 01/02/2026 · LP LP1");
    expect(bucketSubLabel(base, iso, cal)).toBe("Rcvd 2026-11-09");
  });
  it("ignores an attribute the product does not track", () => {
    expect(bucketSubLabel({ ...base, expiryDate: "2026-02-28", trackExpiry: 0 }, iso, cal)).toBe("Rcvd 2026-11-09");
  });
});

describe("destination options", () => {
  let w: World;
  let auth: AuthContext;
  beforeEach(async () => {
    w = await createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  it("badges and disables an occupied only-1-SKU location for another SKU, but not for the same SKU", async () => {
    const strict = (await w.db.insert(schema.locations).values(locationRow(w.warehouseId, "ZZ-ONE-01", { onlyOneSku: true })).returning())[0].id;
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, locationId: strict, qty: 3 });
    const other = await destinationOptions(w.db, auth, { kind: "location", q: "ZZ-ONE", warehouseId: w.warehouseId, productIds: [w.productId] });
    expect(other).toHaveLength(1);
    expect(other[0]?.blocking).toMatch(/allows only 1 SKU \(holds /);
    expect(other[0]?.badge).toMatch(/^1 SKU · holds /);
    expect(toDestinationOption(other[0]!).disabled).toBe(true);
    const same = await destinationOptions(w.db, auth, { kind: "location", q: "ZZ-ONE", warehouseId: w.warehouseId, productIds: [w.product2Id] });
    expect(same[0]?.blocking).toBeNull();
    expect(same[0]?.badge).toBe("1 SKU");
    expect(same[0]?.description).toMatch(/Only 1 SKU/);
    expect(toDestinationOption(same[0]!).disabled).toBeUndefined();
  });

  it("matches exact codes for scans and stays inside the user's warehouses", async () => {
    await w.db.insert(schema.locations).values(locationRow(w.warehouseId, "ZZ-EXACT-1"));
    await w.db.insert(schema.locations).values(locationRow(w.warehouseId, "ZZ-EXACT-10"));
    expect((await destinationOptions(w.db, auth, { kind: "location", q: "zz-exact-1", warehouseId: w.warehouseId, productIds: [], exact: true })).map((o) => o.label)).toEqual(["ZZ-EXACT-1"]);
    expect(await destinationOptions(w.db, auth, { kind: "location", q: "ZZ-EXACT", warehouseId: "other-warehouse", productIds: [] })).toEqual([]);
  });
});
