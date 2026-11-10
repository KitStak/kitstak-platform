/** M14 Printouts & Labels: layout model helpers and the template repository (in-memory DB). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { PRINT_TYPES } from "@/server/print/catalog";
import {
  categoryCounts, columnsFor, familyOf, moveItem, normalizeLayout, printoutDefaults, printoutSchema, templatesFor,
} from "@/lib/grid-defs/admin/printouts";
import { createPrintout, deletePrintouts, duplicatePrintout, getPrintout, listPrintouts, printoutTypes, printTemplatesFor, updatePrintout } from "@/server/repositories/printouts";
import { createWorld, type World } from "../foundation/domain/fixtures";

describe("printout layout helpers", () => {
  it("counts categories from the catalog (the sum matches All)", () => {
    const c = categoryCounts();
    expect(c.all).toBe(PRINT_TYPES.length);
    expect(c.lists + c.labels + c.billings + c.others).toBe(c.all);
  });
  it("labels use the label family and have no line columns", () => {
    expect(familyOf("lp-label")).toBe("label");
    expect(columnsFor("lp-label")).toEqual([]);
    expect(columnsFor("picking-list").map((c) => c.key)).toContain("location");
    expect(columnsFor("packing-slip").map((c) => c.key)).toContain("price");
  });
  it("moveItem reorders without mutating and ignores out-of-range moves", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
  it("normalizeLayout fills missing sections, drops unknown ones and falls back on bad input", () => {
    const base = templatesFor("packing-slip")[0]!.layout("packing-slip");
    const partial = { ...base, sections: [{ key: "footer", enabled: true }, { key: "bogus", enabled: true }] };
    const out = normalizeLayout("packing-slip", partial);
    expect(out.sections[0]).toEqual({ key: "footer", enabled: true });
    expect(out.sections.some((s) => s.key === "bogus")).toBe(false);
    expect(out.sections.find((s) => s.key === "logo")?.enabled).toBe(false);
    expect(normalizeLayout("packing-slip", { nope: true })).toEqual(base);
  });
  it("schema requires a client when access is manual", () => {
    const r = printoutSchema.safeParse({ ...printoutDefaults("packing-slip"), name: "X", description: "Y", allClients: false, clientIds: [] });
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain("clientIds");
  });
});

describe("printout repository", () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: "Web" });
  const save = (over: Record<string, unknown> = {}) => printoutSchema.parse({ ...printoutDefaults("packing-slip"), name: "KS-TEST Retail slip", description: "Gift orders", ...over });

  beforeEach(() => {
    w = createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  it("creates a template with a moved logo and hidden price column, then edits it with a version check", () => {
    const base = printoutDefaults("packing-slip").layout;
    const layout = { ...base, logoPosition: "right" as const, columns: base.columns.map((c) => (c.key === "price" ? { ...c, enabled: false } : c)) };
    const { id } = createPrintout(w.db, auth, actor(), save({ layout }));
    const d = getPrintout(w.db, id);
    expect(d.layout.logoPosition).toBe("right");
    expect(d.layout.columns.find((c) => c.key === "price")?.enabled).toBe(false);
    expect(listPrintouts(w.db, EMPTY_GRID_QUERY, "packing-slip").rows.some((r) => r.id === id)).toBe(true);
    expect(printoutTypes(w.db).find((t) => t.key === "packing-slip")?.count).toBeGreaterThan(0);

    updatePrintout(w.db, auth, actor(), id, save({ name: "KS-TEST Retail slip v2", layout, version: d.version }));
    expect(() => updatePrintout(w.db, auth, actor(), id, save({ layout, version: d.version }))).toThrow(/changed since you opened it/);
  });

  it("restricts client access, duplicates, and lists only usable templates in the print modal", () => {
    const { id } = createPrintout(w.db, auth, actor(), save({ allClients: false, clientIds: [w.clientId] }));
    expect(printTemplatesFor(w.db, ["packing-slip"], w.otherClientId).some((t) => t.id === id)).toBe(false);
    expect(printTemplatesFor(w.db, ["packing-slip"], w.clientId).some((t) => t.id === id)).toBe(true);
    const copy = duplicatePrintout(w.db, auth, actor(), id);
    expect(copy.name).toBe("KS-TEST Retail slip (copy)");
    expect(getPrintout(w.db, copy.id).clientIds).toEqual([w.clientId]);
    expect(() => createPrintout(w.db, auth, actor(), save({ allClients: false, clientIds: [w.clientId] }))).toThrow(/already exists/);
  });

  it("deletes templates in bulk", () => {
    const { id } = createPrintout(w.db, auth, actor(), save());
    const res = deletePrintouts(w.db, auth, actor(), [id, "missing"]);
    expect(res.succeeded).toEqual([id]);
    expect(res.failed).toHaveLength(1);
  });
});
