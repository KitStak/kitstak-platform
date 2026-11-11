import fs from "node:fs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPermissionKey } from "@/server/auth/permission-catalog";
import { tags } from "@/server/db/schema";
import { IMPORT_DEFINITIONS, getImportDefinition, summarizeImport } from "@/server/imports/registry";
import { cellText, detectDelimiter, parseCsv, parseCsvRecords, parseImportFile } from "@/server/imports/parser";
import { batchStatus, getImportBatch, listImportBatches, listImportRows, previewImport, runImport } from "@/server/imports/pipeline";
import { buildImportTemplate, templateHeader } from "@/server/imports/template";
import { NotImplementedError, type ImportDefinition } from "@/server/imports/types";
import { coerceValue, mapHeaders, parseImportDate, validateRows } from "@/server/imports/validate";
import { authFor, seededDb, tempStore, type SeededDb, type TempStore } from "./fixtures";

const OWNERS: Readonly<Record<string, string>> = {
  "shipment-orders": "M01", "shipment-orders-update": "M01", "so-serials": "M01", "purchase-orders": "M05", "po-serials": "M05",
  inventory: "M06", "count-location": "M07", "count-sku": "M07", "work-orders": "M08", products: "M09", "products-update": "M09",
  "pack-types": "M09", "replenishment-levels": "M09", "sku-allocation": "M09", "kit-components": "M09", listings: "M09",
  locations: "M10", "locations-update": "M10", "product-capacity": "M10", "product-capacity-update": "M10", "lp-capacity": "M10",
  "lp-capacity-update": "M10", "lp-numbers": "M10", clients: "M11", "vas-operations": "M11", users: "M14", "user-roles": "M14",
  "user-warehouses": "M14", "user-clients": "M14",
};

/** A configured test handler that writes tags (a foundation-owned table). */
const tagDefinition: ImportDefinition = {
  key: "test-tags",
  title: "Import Tags",
  description: "",
  backHref: "/",
  backLabel: "Go back",
  permission: "settings.users.import_file",
  templateColumns: [
    { key: "name", header: "Tag Name", type: "text", required: true, example: "VIP" },
    { key: "color", header: "Color", type: "enum", options: ["Red", "Blue"], required: true, example: "Red" },
    { key: "weight", header: "Weight", type: "integer", min: 0, example: "1" },
  ],
  handler: {
    configured: true,
    owner: "test",
    rowSchema: z.object({ name: z.string().refine((n) => n !== "forbidden", "Name is reserved") }).loose(),
    apply: async (ctx, row) => {
      if (row.name === "explode") throw new Error("boom");
      const tag = (await ctx.db.insert(tags).values({ name: String(row.name), color: String(row.color) }).returning())[0];
      return { entityId: tag.id };
    },
  },
};

describe("import registry", () => {
  it("covers every 0.6 handler stub with a valid permission", async () => {
    expect([...IMPORT_DEFINITIONS.map((d) => d.key)].sort()).toEqual(Object.keys(OWNERS).sort());
    for (const def of IMPORT_DEFINITIONS) {
      expect(isPermissionKey(def.permission), def.permission).toBe(true);
      expect(def.handler.owner).toBe(OWNERS[def.key]);
      // Handlers start as stubs; owning modules flip `configured` once they ship the real import.
      expect(typeof def.handler.configured, def.key).toBe("boolean");
      expect(fs.existsSync(`src/server/imports/handlers/${def.key}.ts`)).toBe(true);
      const keys = def.templateColumns.map((c) => c.key);
      expect(new Set(keys).size, def.key).toBe(keys.length);
      expect(def.templateColumns.some((c) => c.required)).toBe(true);
    }
    const inventory = getImportDefinition("inventory") ?? IMPORT_DEFINITIONS[0]!;
    expect(summarizeImport(inventory)).toMatchObject({ key: "inventory", configured: inventory.handler.configured, backLabel: "Go back to inventory" });
    // Any handler still left as a stub must refuse to apply rows.
    for (const def of IMPORT_DEFINITIONS.filter((d) => !d.handler.configured)) {
      await expect(async () => await def.handler.apply({} as never, {})).rejects.toThrow(NotImplementedError);
    }
  });
});

describe("parser", () => {
  it("parses RFC 4180 CSV with quotes, newlines and BOM", () => {
    expect(parseCsvRecords('a,"b,c","d ""q"""\r\n1,"x\ny",3', ",")).toEqual([["a", "b,c", 'd "q"'], ["1", "x\ny", "3"]]);
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb")).toBe("\t");
    const parsed = parseCsv(Buffer.from("﻿Tag Name *,Color\nVIP,Red\n,\nNew,Blue\n"));
    expect(parsed.headers).toEqual(["Tag Name *", "Color"]);
    expect(parsed.rows).toEqual([
      { rowNumber: 2, values: { "Tag Name *": "VIP", Color: "Red" } },
      { rowNumber: 4, values: { "Tag Name *": "New", Color: "Blue" } },
    ]);
    expect(() => parseCsvRecords('"open', ",")).toThrow(/unterminated/);
    expect(() => parseCsv(Buffer.from("a,a\n1,2"))).toThrow(/Duplicate column/);
  });

  it("reads exceljs cell values", () => {
    expect(cellText(new Date("2026-11-05T00:00:00.000Z"))).toBe("2026-11-05");
    expect(cellText({ formula: "1+1", result: 2 } as never)).toBe("2");
    expect(cellText({ richText: [{ text: "a" }, { text: "b" }] } as never)).toBe("ab");
    expect(cellText(null)).toBe("");
  });

  it("round-trips the generated template through the xlsx parser", async () => {
    const def = getImportDefinition("inventory");
    if (!def) throw new Error("missing");
    const bytes = await buildImportTemplate(def);
    const parsed = await parseImportFile(bytes, "inventory.xlsx");
    expect(parsed.headers).toEqual(def.templateColumns.map(templateHeader));
    expect(parsed.rows).toHaveLength(1);
    const validation = validateRows(def, parsed);
    expect(validation.missingColumns).toEqual([]);
    expect(validation.errorCount).toBe(0);
    await expect(parseImportFile(Buffer.from([1, 2, 3]), "x.bin")).rejects.toThrow(/Unsupported/);
  });
});

describe("validation", () => {
  it("coerces each column type", () => {
    const col = { key: "k", header: "K", example: "" };
    expect(coerceValue({ ...col, type: "integer" }, "1,200")).toEqual({ ok: true, value: 1200 });
    expect(coerceValue({ ...col, type: "integer" }, "1.5").ok).toBe(false);
    expect(coerceValue({ ...col, type: "number", max: 10 }, "11").ok).toBe(false);
    expect(coerceValue({ ...col, type: "boolean" }, "Y")).toEqual({ ok: true, value: true });
    expect(coerceValue({ ...col, type: "boolean" }, "maybe").ok).toBe(false);
    expect(coerceValue({ ...col, type: "enum", options: ["Kit"] }, "kit")).toEqual({ ok: true, value: "Kit" });
    expect(coerceValue({ ...col, type: "text", maxLength: 2 }, "abc").ok).toBe(false);
    expect(coerceValue({ ...col, type: "text", required: true }, "")).toEqual({ ok: false, error: "K is required" });
    expect(coerceValue({ ...col, type: "text" }, "")).toEqual({ ok: true, value: null });
    expect(parseImportDate("2026/2/3")).toBe("2026-02-03");
    expect(parseImportDate("11/5/2026")).toBe("2026-11-05");
    expect(parseImportDate("2026-02-30")).toBeNull();
    expect(parseImportDate("2026-11-05T12:00:00Z")).toBe("2026-11-05");
  });

  it("maps headers by label (ignoring * and case) or key", () => {
    const mapping = mapHeaders(tagDefinition.templateColumns, ["tag name *", "weight", "Extra"]);
    expect(mapping.mapping.get("name")).toBe("tag name *");
    expect(mapping.missingRequired).toEqual(["Color"]);
    expect(mapping.unknown).toEqual(["Extra"]);
  });
});

describe("pipeline", () => {
  let testDb: SeededDb;
  let temp: TempStore;
  beforeEach(async () => {
    testDb = await seededDb();
    temp = tempStore();
  });
  afterEach(async () => {
    await testDb.close();
    temp.cleanup();
  });

  const csv = (text: string) => Buffer.from(text);

  it("previews without writing", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    const preview = await previewImport({ def: tagDefinition, auth, fileName: "t.csv", bytes: csv("Tag Name,Color\nA,Red\nB,Green\nforbidden,Blue") });
    expect(preview).toMatchObject({ configured: true, totalRows: 3, validCount: 1, errorCount: 2 });
    expect(preview.rows[0]?.valid).toBe(false);
    expect(preview.rows.flatMap((r) => r.errors)).toEqual(["Color must be one of: Red, Blue", "Name is reserved"]);
    expect(await testDb.db.select().from(tags)).toHaveLength(0);
  });

  it("applies valid rows, isolates failing rows and writes an error file", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    const batch = await runImport(testDb.db, {
      def: tagDefinition, auth, fileName: "tags.csv",
      bytes: csv("Tag Name,Color,Weight\nA,Red,1\nB,Green,2\nexplode,Blue,3\nC,Blue,\nA,Red,1"),
    }, { store: temp.store });
    expect(batch).toMatchObject({ status: "Partially Successful", masterRowCount: 5, successCount: 2, errorCount: 3 });
    expect((await testDb.db.select().from(tags)).map((t) => t.name).sort()).toEqual(["A", "C"]);
    const rows = await listImportRows(testDb.db, batch.id, { page: 1, pageSize: 100 });
    expect(rows.total).toBe(5);
    const errors = await listImportRows(testDb.db, batch.id, { errorsOnly: true, page: 1, pageSize: 100 });
    expect(errors.rows.map((r) => r.rowNumber)).toEqual([3, 4, 6]);
    expect(errors.rows[1]?.message).toBe("Unexpected error while importing this row");
    expect(errors.rows[2]?.message).toMatch(/UNIQUE|Internal|Unexpected/i);
    expect(batch.errorFileId).toBeTruthy();
    const errorFile = await parseImportFile((await temp.store.read(testDb.db, batch.errorFileId ?? "")).bytes, "e.xlsx");
    expect(errorFile.headers).toEqual(["Row", "Tag Name", "Color", "Weight", "Error"]);
    expect(errorFile.rows).toHaveLength(3);
    expect((await getImportBatch(testDb.db, batch.id))?.finishedAt).toBeTruthy();
    expect((await listImportBatches(testDb.db, "test-tags", 1, 10)).rows[0]?.uploadedByName).toBe("Admin");
  });

  it("refuses stubs, missing columns, empty files and unauthorized users", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    const base = getImportDefinition("products");
    if (!base) throw new Error("missing");
    // The products import has since been configured by its module; force a stub to cover the refusal path.
    const stub = { ...base, handler: { ...base.handler, configured: false } };
    await expect(runImport(testDb.db, { def: stub, auth, fileName: "p.csv", bytes: csv("SKU\nA") }, { store: temp.store })).rejects.toThrow(/not configured yet/);
    await expect(runImport(testDb.db, { def: tagDefinition, auth, fileName: "t.csv", bytes: csv("Tag Name\nA") }, { store: temp.store })).rejects.toThrow(/Missing required column: Color/);
    await expect(runImport(testDb.db, { def: tagDefinition, auth, fileName: "t.csv", bytes: csv("Tag Name,Color\n") }, { store: temp.store })).rejects.toThrow(/no data rows/);
    const noPerms = { ...(await authFor(testDb, testDb.ids.viewer)), permissions: new Set<string>() };
    await expect(previewImport({ def: tagDefinition, auth: noPerms, fileName: "t.csv", bytes: csv("Tag Name,Color\nA,Red") })).rejects.toThrow(/permission/);
    expect(await testDb.db.select().from(tags).where(eq(tags.name, "A"))).toHaveLength(0);
  });

  it("derives batch status", () => {
    expect(batchStatus(3, 0)).toBe("Successful");
    expect(batchStatus(0, 3)).toBe("Failed");
    expect(batchStatus(1, 1)).toBe("Partially Successful");
  });
});
