/** M10 mobile carts against an in-memory migrated DB: cells, derived status, duplicate, guarded delete, labels, change log. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { buildCells, cellBarcode, mobileCartInfoSchema, mobileCartSchema } from "@/lib/grid-defs/facility/mobile-carts";
import { createMobileCart, deleteMobileCarts, duplicateMobileCart, getMobileCart, listMobileCarts, mobileCartLabelRecords, updateMobileCart } from "@/server/repositories/mobile-carts";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let cartTypeId: string;
const actor = () => ({ userId: w.userId, source: "Web" });

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  cartTypeId = w.db.insert(schema.lookupValues).values({ type: "mobile_cart_type", name: "12-bin 3×4", meta: { levels: 3, columns: 4 } }).returning().get().id;
});
afterEach(() => w.close());

const input = (code = "KS-TEST-MC1", levels = 3, columns = 4) =>
  mobileCartSchema.parse({ code, warehouseId: w.warehouseId, description: "Test cart", cartTypeId, levels, columns, operationType: "Picking", allowMultipleJob: false, isDynamic: false, cells: buildCells(code, levels, columns) });

describe("mobile cart schema", () => {
  it("builds level-major cells with letter + 2-digit barcodes", () => {
    const cells = buildCells("mc-1", 2, 3);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toEqual({ level: 1, column: 1, barcode: "MC-1-A01" });
    expect(cells[5]?.barcode).toBe(cellBarcode("MC-1", 2, 3));
    expect(cells[5]?.barcode).toBe("MC-1-B03");
  });

  it("requires levels × columns cells with unique barcodes", () => {
    const bad = mobileCartSchema.safeParse({ ...input(), cells: buildCells("X", 1, 2) });
    expect(bad.error?.issues[0]?.message).toBe("Expected 12 cells (levels × columns)");
    const dup = input();
    const cells = dup.cells.map((c, i) => (i === 1 ? { ...c, barcode: dup.cells[0]?.barcode ?? "" } : c));
    expect(mobileCartSchema.safeParse({ ...dup, cells }).error?.issues[0]?.message).toBe("Cell barcodes must be unique");
    expect(mobileCartInfoSchema.safeParse({ ...dup, cartTypeId: "" }).error?.issues[0]?.path).toEqual(["cartTypeId"]);
  });
});

describe("mobile cart repository", () => {
  it("creates the cart and its cells, lists it Available with counts", () => {
    const { id } = createMobileCart(w.db, auth, actor(), input());
    const { rows, total } = listMobileCarts(w.db, auth, EMPTY_GRID_QUERY);
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ id, code: "KS-TEST-MC1", status: "Available", cellCount: 12, levels: 3, columns: 4, cartTypeName: "12-bin 3×4", taskCount: 0, orderCount: 0, jobCode: null });
    const change = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id)).all();
    expect(change.map((c) => c.type)).toEqual(["Create"]);
  });

  it("rejects duplicate codes and cell barcodes used by another cart", () => {
    createMobileCart(w.db, auth, actor(), input());
    expect(() => createMobileCart(w.db, auth, actor(), input())).toThrow(/already exists/);
    const clash = { ...input("KS-TEST-MC2"), cells: input("KS-TEST-MC1").cells };
    expect(() => createMobileCart(w.db, auth, actor(), clash)).toThrow(/already used by cart KS-TEST-MC1/);
  });

  it("derives Occupied from an open job and blocks delete and cell edits", () => {
    const { id } = createMobileCart(w.db, auth, actor(), input());
    const job = w.db.insert(schema.jobs).values({ id: crypto.randomUUID(), code: "Job900001", jobType: "Picking", warehouseId: w.warehouseId, status: "Started", mobileCartId: id }).returning().get();
    const row = listMobileCarts(w.db, auth, EMPTY_GRID_QUERY).rows[0];
    expect(row).toMatchObject({ status: "Occupied", jobCode: "Job900001", jobId: job.id });
    const del = deleteMobileCarts(w.db, auth, actor(), [id]);
    expect(del.failed[0]?.message).toMatch(/only Available carts can be deleted/);
    const detail = getMobileCart(w.db, auth, id);
    expect(() => updateMobileCart(w.db, auth, actor(), id, { ...input("KS-TEST-MC1", 2, 2), version: detail.version })).toThrow(/cells can't change/);
    w.db.update(schema.jobs).set({ status: "Completed" }).where(eq(schema.jobs.id, job.id)).run();
    expect(listMobileCarts(w.db, auth, EMPTY_GRID_QUERY).rows[0]?.status).toBe("Available");
    expect(deleteMobileCarts(w.db, auth, actor(), [id]).succeeded).toEqual([id]);
  });

  it("updates fields with a field-level change log and enforces the version", () => {
    const { id } = createMobileCart(w.db, auth, actor(), input());
    const v1 = getMobileCart(w.db, auth, id).version;
    const out = updateMobileCart(w.db, auth, actor(), id, { ...input("KS-TEST-MC1", 2, 2), description: "Smaller", version: v1 });
    expect(out.version).toBe(v1 + 1);
    expect(getMobileCart(w.db, auth, id).cells).toHaveLength(4);
    const labels = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id)).all().filter((c) => c.type === "Update").map((c) => c.field);
    expect(labels).toEqual(expect.arrayContaining(["description", "levels", "columns", "cellCount", "cellList"]));
    expect(() => updateMobileCart(w.db, auth, actor(), id, { ...input(), version: v1 })).toThrow(/changed since you opened it/);
  });

  it("duplicates with cell barcodes re-derived from the new code", () => {
    const { id } = createMobileCart(w.db, auth, actor(), input());
    const copy = duplicateMobileCart(w.db, auth, actor(), id, "ks-test-mc9");
    const d = getMobileCart(w.db, auth, copy.id);
    expect(d.code).toBe("KS-TEST-MC9");
    expect(d.cells[0]?.barcode).toBe("KS-TEST-MC9-A01");
    expect(d.cellCount).toBe(12);
  });

  it("builds cart and cell label records", () => {
    const { id } = createMobileCart(w.db, auth, actor(), input("KS-TEST-MC1", 1, 2));
    expect(mobileCartLabelRecords(w.db, auth, [id], "carts")).toEqual([{ code: "KS-TEST-MC1", name: "Test cart", cartType: "12-bin 3×4" }]);
    const both = mobileCartLabelRecords(w.db, auth, [id], "both");
    expect(both.map((r) => r.code)).toEqual(["KS-TEST-MC1", "KS-TEST-MC1-A01", "KS-TEST-MC1-A02"]);
    expect(mobileCartLabelRecords(w.db, auth, [id], "cells")).toHaveLength(2);
  });

  it("hides carts outside the warehouse scope (404)", () => {
    const { id } = createMobileCart(w.db, auth, actor(), input());
    const none = { warehouseIds: [] as string[], clientIds: "all" as const };
    const outside = { ...auth, scope: none, viewScope: none } as unknown as AuthContext;
    expect(() => getMobileCart(w.db, outside, id)).toThrow(/not found/i);
    expect(listMobileCarts(w.db, outside, EMPTY_GRID_QUERY).total).toBe(0);
  });
});
