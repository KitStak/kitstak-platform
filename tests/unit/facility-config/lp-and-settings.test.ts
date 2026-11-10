/** M10 LP types, LP numbers (sequence, SSCC18, custom, import), warehouses and shipment packages against an in-memory DB. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { LP_TYPE_DEFAULTS, lpNumberPreview, lpTypeSchema } from "@/lib/grid-defs/facility/lp-types";
import { buildSscc18, gs1CheckDigit, isValidSscc18, lpCreateSchema } from "@/lib/grid-defs/facility/lp-numbers";
import { WAREHOUSE_DEFAULTS, warehouseSchema } from "@/lib/grid-defs/facility/warehouses";
import { SHIPMENT_PACKAGE_DEFAULTS, shipmentPackageSchema } from "@/lib/grid-defs/facility/shipment-packages";
import { createLpType, deleteLpTypes, listLpTypes } from "@/server/repositories/lp-types";
import { createLpNumbers, listLpNumbers } from "@/server/repositories/lp-numbers";
import { applyLpNumberImport } from "@/server/repositories/lp-numbers-import";
import { createWarehouse, setDefaultWarehouse, setWarehousesActive } from "@/server/repositories/warehouses";
import { createShipmentPackage, deleteShipmentPackages, listShipmentPackages } from "@/server/repositories/shipment-packages";
import { lpNumbersExport } from "@/server/repositories/lp-numbers-export";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const actor = () => ({ userId: w.userId, source: "Web" });

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const toteType = () => createLpType(w.db, auth, actor(), lpTypeSchema.parse({ ...LP_TYPE_DEFAULTS, warehouseId: w.warehouseId, code: "KS-E2E-TOTE", numberPrefix: "KSE-", numberLength: 5 }));

describe("GS1 / SSCC18", () => {
  it("computes the mod-10 check digit and builds valid 18-digit codes", () => {
    expect(gs1CheckDigit("00614141123456789")).toBe(0);
    const code = buildSscc18(0, "1234567", 42);
    expect(code).toHaveLength(18);
    expect(isValidSscc18(code)).toBe(true);
    expect(isValidSscc18(`${code.slice(0, 17)}${(Number(code[17]) + 1) % 10}`)).toBe(false);
  });

  it("requires a client for an SSCC18 sequence run (inline error path)", () => {
    const r = lpCreateSchema.safeParse({ warehouseId: "w", lpTypeId: "t", method: "sequence", count: 3, isSscc18: true, clientId: null });
    expect(r.error?.issues[0]).toMatchObject({ path: ["clientId"], message: "Client is required for SSCC18 numbers" });
  });
});

describe("LP types and numbers", () => {
  it("previews and issues KSE-00001..00003 from sequence, logging each create", () => {
    expect(lpNumberPreview("KSE-", 5, 1)).toBe("KSE-00001");
    const type = toteType();
    const result = createLpNumbers(w.db, auth, actor(), lpCreateSchema.parse({ warehouseId: w.warehouseId, lpTypeId: type.id, method: "sequence", count: 3 }));
    expect(result.numbers).toEqual(["KSE-00001", "KSE-00002", "KSE-00003"]);
    const logs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, result.ids[0] ?? "")).all();
    expect(logs.map((l) => l.type)).toEqual(["Create"]);
    expect(listLpNumbers(w.db, auth, EMPTY_GRID_QUERY).total).toBe(3);
    const page = lpNumbersExport.fetchPage({ db: w.db, auth, gridKey: "lp-numbers", query: EMPTY_GRID_QUERY, rawQuery: "" }, 1, 100);
    expect("total" in page && page.total).toBe(3);
  });

  it("issues SSCC18 numbers for a client", () => {
    const type = toteType();
    const r = createLpNumbers(w.db, auth, actor(), lpCreateSchema.parse({ warehouseId: w.warehouseId, lpTypeId: type.id, method: "sequence", count: 2, isSscc18: true, clientId: w.clientId }));
    expect(r.numbers.every(isValidSscc18)).toBe(true);
  });

  it("rejects a duplicate custom number and blocks deleting a type that has LPs", () => {
    const type = toteType();
    createLpNumbers(w.db, auth, actor(), lpCreateSchema.parse({ warehouseId: w.warehouseId, lpTypeId: type.id, method: "custom", number: "KS-TEST-LP1" }));
    expect(() => createLpNumbers(w.db, auth, actor(), lpCreateSchema.parse({ warehouseId: w.warehouseId, lpTypeId: type.id, method: "custom", number: "ks-test-lp1" }))).toThrow();
    const del = deleteLpTypes(w.db, auth, actor(), [type.id]);
    expect(del.failed).toHaveLength(1);
    expect(listLpTypes(w.db, auth, EMPTY_GRID_QUERY).rows[0]).toMatchObject({ code: "KS-E2E-TOTE", lpCount: 1 });
  });

  it("imports custom LP numbers and rejects unknown types and SSCC rows", () => {
    toteType();
    const ctx = { db: w.db, auth, actor: actor(), batchId: "b", rowNumber: 1 };
    expect(applyLpNumberImport(ctx, { warehouseCode: "MLT1", lpType: "ks-e2e-tote", number: "KS-TEST-IMP1" }).message).toBe("Created LP KS-TEST-IMP1");
    expect(() => applyLpNumberImport(ctx, { warehouseCode: "MLT1", lpType: "NOPE", number: "X1" })).toThrow(/not found/);
    expect(() => applyLpNumberImport(ctx, { warehouseCode: "MLT1", lpType: "KS-E2E-TOTE", number: "X2", isSscc18: "yes" })).toThrow(/SSCC-18/);
  });
});

describe("warehouses", () => {
  it("sets a new default and blocks deactivating the default", () => {
    const input = warehouseSchema.parse({ ...WAREHOUSE_DEFAULTS, code: "KST2", name: "KS Test 2", prefix: "K2", addressLine: "1 Test Rd", postalCode: "38118", city: "Memphis", state: "TN", contactName: "Dana Ortiz", contactPhone: "901-555-0142" });
    expect(() => createWarehouse(w.db, auth, actor(), input)).toThrow(/Only administrators/);
    const admin = { ...auth, user: { id: w.userId, role: "admin" } } as unknown as AuthContext;
    const { id } = createWarehouse(w.db, admin, actor(), input);
    const scoped = { ...admin, scope: { warehouseIds: [w.warehouseId, id], clientIds: "all" }, viewScope: { warehouseIds: [w.warehouseId, id], clientIds: "all" } } as unknown as AuthContext;
    setDefaultWarehouse(w.db, scoped, actor(), id);
    expect(w.db.select().from(schema.warehouses).where(eq(schema.warehouses.id, id)).get()?.isDefault).toBe(true);
    expect(setWarehousesActive(w.db, scoped, actor(), [id], false).failed[0]?.message).toMatch(/default warehouse/);
    expect(setWarehousesActive(w.db, scoped, actor(), [w.warehouseId], false).succeeded).toEqual([w.warehouseId]);
  });
});

describe("shipment packages", () => {
  it("creates an all-clients package and deletes an unused one", () => {
    const input = shipmentPackageSchema.parse({ ...SHIPMENT_PACKAGE_DEFAULTS, warehouseId: w.warehouseId, code: "KS-TEST-BOX12", description: "12x10x8 box", length: 12, width: 10, height: 8, emptyWeight: 0.4 });
    const { id } = createShipmentPackage(w.db, auth, actor(), input);
    expect(listShipmentPackages(w.db, auth, EMPTY_GRID_QUERY).rows.find((r) => r.id === id)).toMatchObject({ code: "KS-TEST-BOX12" });
    expect(() => createShipmentPackage(w.db, auth, actor(), input)).toThrow();
    expect(deleteShipmentPackages(w.db, auth, actor(), [id]).succeeded).toEqual([id]);
  });

  it("requires tracking fields when inventory tracking is on", () => {
    const r = shipmentPackageSchema.safeParse({ ...SHIPMENT_PACKAGE_DEFAULTS, warehouseId: "w", code: "X", length: 1, width: 1, height: 1, trackInventory: true });
    expect(r.success).toBe(false);
  });
});
