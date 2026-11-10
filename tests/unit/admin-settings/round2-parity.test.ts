/**
 * M14 round 2 parity loop: Return Process rules (model, enforcement helper, repository),
 * printout block designer (schema, normalize, PDF + ZPL rendering, field binding),
 * email uniqueness helpers and change-log copy.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AuthContext } from "@/server/auth/context";
import { companySettings, users } from "@/server/db/schema";
import { prettyLogMessage } from "@/lib/grid-defs/admin/common";
import {
  checkReturnLine, countOn, DEFAULT_RETURN_RULES, normalizeReturnRules, RETURN_RULE_KEYS, returnRulesSchema, returnRulesView, type ReturnRules,
} from "@/lib/grid-defs/admin/return-rules";
import {
  blockDefaults, blockKeyOf, blockSummary, isLabelStock, layoutSchema, normalizeLayout, templatesFor, type PrintoutLayout,
} from "@/lib/grid-defs/admin/printouts";
import { EMAIL_TAKEN_MESSAGE, looksLikeEmail, normalizeEmail, userInfoSchemaFor } from "@/lib/grid-defs/admin/users";
import { fieldValue, renderLayoutPdf, renderLayoutZpl, builtInSample } from "@/server/repositories/printouts-render";
import { getReturnRules, updateReturnRules } from "@/server/repositories/company-return-rules";
import { getCompany, updateCompanyDefaults } from "@/server/repositories/company";
import { isEmailTaken } from "@/server/repositories/users";
import { createWorld, type World } from "../foundation/domain/fixtures";

const authFor = (w: World): AuthContext => {
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  return { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
};

describe("return rules model", () => {
  it("defaults every parameter on (Logiwa ships them all on)", () => {
    expect(RETURN_RULE_KEYS).toHaveLength(8);
    expect(countOn(DEFAULT_RETURN_RULES)).toBe(8);
  });
  it("normalizes stored JSON: keeps booleans, defaults missing keys, drops junk", () => {
    const r = normalizeReturnRules({ lotNumberMatch: false, bogus: true, packTypeMatch: "no" });
    expect(r.lotNumberMatch).toBe(false);
    expect(r.packTypeMatch).toBe(true);
    expect(Object.keys(r)).toHaveLength(8);
    expect(normalizeReturnRules(null)).toEqual(DEFAULT_RETURN_RULES);
  });
  it("change-log view uses labels and On / Off", () => {
    expect(returnRulesView({ ...DEFAULT_RETURN_RULES, serialNumberMatch: false })["Serial number match"]).toBe("Off");
  });
  it("schema requires all eight switches", () => {
    expect(returnRulesSchema.safeParse({ expiryDateMatch: true }).success).toBe(false);
    expect(returnRulesSchema.safeParse({ ...DEFAULT_RETURN_RULES, version: 3 }).success).toBe(true);
  });
});

describe("checkReturnLine (M04 enforcement helper)", () => {
  const shipped = [{ productId: "p1", qty: 3, lot: "L1", expiryDate: "2027-01-01", packTypeId: "each", serials: ["S1", "S2", "S3"] }];
  const all: ReturnRules = DEFAULT_RETURN_RULES;
  it("accepts a matching return", () => {
    expect(checkReturnLine(all, shipped, { productId: "p1", qty: 2, lot: "l1", serials: ["s2"] })).toEqual([]);
  });
  it("blocks unshipped SKUs only while the rule is on", () => {
    expect(checkReturnLine(all, shipped, { productId: "p9", qty: 1 }).map((v) => v.rule)).toEqual(["preventUnspecifiedSku"]);
    expect(checkReturnLine({ ...all, preventUnspecifiedSku: false }, shipped, { productId: "p9", qty: 1 })).toEqual([]);
  });
  it("blocks exceeding the shipped quantity, counting earlier returns", () => {
    const v = checkReturnLine(all, shipped, { productId: "p1", qty: 2, alreadyReturned: 2 });
    expect(v.map((x) => x.rule)).toEqual(["preventExceedingShippedQty"]);
    expect(v[0]?.message).toMatch(/Only 1 more/);
  });
  it("flags lot, expiry, pack type and serial mismatches", () => {
    const v = checkReturnLine(all, shipped, { productId: "p1", qty: 1, lot: "L9", expiryDate: "2030-01-01", packTypeId: "case", serials: ["S9"] });
    expect(v.map((x) => x.rule).sort()).toEqual(["expiryDateMatch", "lotNumberMatch", "packTypeMatch", "serialNumberMatch"]);
  });
  it("blocks alternate warehouses unless enabled", () => {
    expect(checkReturnLine({ ...all, allowAlternateWarehouse: false }, shipped, { productId: "p1", qty: 1 }, { warehouseMismatch: true })[0]?.rule).toBe("allowAlternateWarehouse");
    expect(checkReturnLine(all, shipped, { productId: "p1", qty: 1 }, { warehouseMismatch: true })).toEqual([]);
  });
});

describe("return rules repository", () => {
  let w: World;
  beforeEach(() => { w = createWorld(); });
  afterEach(() => w.close());

  it("saves with a version check, logs the change and keeps other account defaults", () => {
    const actor = { userId: w.userId, source: "Web" };
    const v0 = getCompany(w.db).version;
    const state = updateReturnRules(w.db, authFor(w), actor, { ...DEFAULT_RETURN_RULES, lotNumberMatch: false, version: v0 });
    expect(state.rules.lotNumberMatch).toBe(false);
    expect(state.version).toBe(v0 + 1);
    expect(() => updateReturnRules(w.db, authFor(w), actor, { ...DEFAULT_RETURN_RULES, version: v0 })).toThrow(/changed/);
    // Saving the account defaults must not drop the return rules stored in the same JSON.
    const c = getCompany(w.db);
    updateCompanyDefaults(w.db, authFor(w), actor, { currency: "EUR", weightUnit: c.defaults.weightUnit, dimensionUnit: c.defaults.dimensionUnit, dateFormat: c.defaults.dateFormat, version: c.version } as never);
    expect(getReturnRules(w.db).lotNumberMatch).toBe(false);
    expect(getCompany(w.db).defaults.currency).toBe("EUR");
    const stored = w.db.select({ d: companySettings.defaults }).from(companySettings).where(eq(companySettings.id, "company")).get();
    expect((stored?.d as unknown as { returnRules: ReturnRules }).returnRules.lotNumberMatch).toBe(false);
  });
});

describe("printout block designer", () => {
  const base = (): PrintoutLayout => templatesFor("packing-slip")[0]!.layout("packing-slip");
  const label = (): PrintoutLayout => templatesFor("lp-label")[0]!.layout("lp-label");

  it("validates paper against the family and block references", () => {
    expect(layoutSchema.safeParse({ ...base(), paper: "4x6" }).success).toBe(false);
    expect(layoutSchema.safeParse({ ...label(), paper: "2x1" }).success).toBe(true);
    expect(isLabelStock("3x2")).toBe(true);
    const orphan = { ...base(), sections: [...base().sections, { key: blockKeyOf("bdead1"), enabled: true }] };
    expect(layoutSchema.safeParse(orphan).success).toBe(false);
  });

  it("rejects non-image data URLs in image blocks", () => {
    const img = { ...blockDefaults("image", "bimg01"), imageDataUrl: "data:text/html;base64,PGgxPg==" };
    expect(layoutSchema.safeParse({ ...base(), blocks: [img], sections: [...base().sections, { key: blockKeyOf("bimg01"), enabled: true }] }).success).toBe(false);
  });

  it("normalizeLayout keeps blocks in place and appends blocks without a section", () => {
    const text = blockDefaults("text", "btext1");
    const field = blockDefaults("field", "bfld01");
    const l = { ...base(), blocks: [text, field], sections: [{ key: blockKeyOf("btext1"), enabled: true }, ...base().sections] };
    const out = normalizeLayout("packing-slip", l);
    expect(out.sections[0]?.key).toBe("block:btext1");
    expect(out.sections.at(-1)).toEqual({ key: "block:bfld01", enabled: true });
  });

  it("old layouts without the new keys still parse with defaults", () => {
    const { barcodeType: _b, labelLanguage: _l, blocks: _x, ...legacy } = base();
    const parsed = layoutSchema.parse(legacy);
    expect(parsed.barcodeType).toBe("code128");
    expect(parsed.blocks).toEqual([]);
  });

  it("binds record and custom fields", () => {
    const rec = { ...builtInSample("packing-slip"), fields: { "custom:textBox1": "PO-778" } };
    expect(fieldValue(rec, "customerName", { companyName: "KS" })).toBe("Jordan Reyes");
    expect(fieldValue(rec, "totalUnits", { companyName: "KS" })).toBe("4");
    expect(fieldValue(rec, "custom:textBox1", { companyName: "KS" })).toBe("PO-778");
    expect(fieldValue(rec, "custom:textBox2", { companyName: "KS" })).toBe("");
  });

  it("renders a PDF with every block kind, including an unencodable barcode, without throwing", async () => {
    const png1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const blocks = [
      blockDefaults("text", "bt0001"), blockDefaults("field", "bf0001"), { ...blockDefaults("barcode", "bb0001"), symbology: "qrcode" as const },
      { ...blockDefaults("barcode", "bb0002"), symbology: "ean13" as const }, { ...blockDefaults("image", "bi0001"), imageDataUrl: png1x1 },
      blockDefaults("divider", "bd0001"), blockDefaults("spacer", "bs0001"),
    ];
    const layout = layoutSchema.parse({ ...base(), blocks, sections: [...base().sections, ...blocks.map((b) => ({ key: blockKeyOf(b.id), enabled: true }))] });
    const bytes = await renderLayoutPdf("packing-slip", layout, [builtInSample("packing-slip")], { companyName: "KitStaks" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(blockSummary(blocks[3]!)).toMatch(/EAN-13/);
  });

  it("renders label stock sizes, and ZPL with the chosen symbology and escaped data", async () => {
    for (const paper of ["4x6", "4x4", "3x2", "2x1"] as const) {
      const bytes = await renderLayoutPdf("lp-label", { ...label(), paper }, [builtInSample("lp-label")], { companyName: "KitStaks" });
      expect(bytes.length).toBeGreaterThan(500);
    }
    const caption = { ...blockDefaults("field", "bf0002"), text: "Client: ", field: "clientName" };
    const l = layoutSchema.parse({ ...label(), barcodeType: "qrcode", labelLanguage: "ZPL", blocks: [caption], sections: [...label().sections, { key: blockKeyOf("bf0002"), enabled: true }] });
    const zpl = renderLayoutZpl(l, [{ ...builtInSample("lp-label"), code: "LP^0001" }], { companyName: "KitStaks" }, 2);
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl).toContain("^BQN");
    expect(zpl).toContain("^PW812");
    expect(zpl).toContain("^PQ2");
    expect(zpl).toContain("Client: Apex Threads Co.");
    expect(zpl).not.toContain("LP^0001");
    expect(zpl).toContain("LP\\5E0001");
  });
});

describe("user email uniqueness", () => {
  let w: World;
  beforeEach(() => { w = createWorld(); });
  afterEach(() => w.close());

  it("normalizes and shape-checks emails", () => {
    expect(normalizeEmail("  Admin@KitStak.IO ")).toBe("admin@kitstak.io");
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("a@b")).toBe(false);
  });
  it("the step-1 schema flags an email known to be taken", () => {
    const values = { firstName: "A", lastName: "B", email: "Dup@x.io", userType: "Operation", password: "Aa1!aaaaaaaa", confirmPassword: "Aa1!aaaaaaaa", sendWelcomeEmail: false, isActive: true };
    const r = userInfoSchemaFor(false, undefined, new Set(["dup@x.io"])).safeParse(values);
    expect(r.error?.issues.find((i) => i.path[0] === "email")?.message).toBe(EMAIL_TAKEN_MESSAGE);
    expect(userInfoSchemaFor(false, undefined, new Set()).safeParse(values).success).toBe(true);
  });
  it("isEmailTaken is case-insensitive and ignores the edited user", () => {
    const row = w.db.select().from(users).get();
    expect(row).toBeTruthy();
    expect(isEmailTaken(w.db, row!.email.toUpperCase())).toBe(true);
    expect(isEmailTaken(w.db, row!.email, row!.id)).toBe(false);
    expect(isEmailTaken(w.db, "nobody-here@kitstak.io")).toBe(false);
  });
});

describe("change-log copy", () => {
  it("rewrites the wire format as readable copy", () => {
    expect(prettyLogMessage("Roles is modified. Warehouse Clerk --> KS-CRIT Role A")).toBe("Roles changed: Warehouse Clerk → KS-CRIT Role A");
    expect(prettyLogMessage("MLT-1 -> Qty is modified. 0 --> 24")).toBe("MLT-1 › Qty changed: 0 → 24");
    expect(prettyLogMessage("Role created")).toBe("Role created");
  });
});
