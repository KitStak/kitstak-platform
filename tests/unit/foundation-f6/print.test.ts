import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderBarcodePng } from "@/server/print/barcode";
import { PRINT_TYPES, getPrintType, isPrintImplemented } from "@/server/print/catalog";
import { pdfSafe, PdfWriter, wrapText } from "@/server/print/pdf";
import { hasRenderer, printToFile, renderPrint } from "@/server/print/render";
import { consolidatePickLines, sortPickLines } from "@/server/print/templates/pick-list";
import { manifestTotals, manifestRecordSchema } from "@/server/print/templates/manifest-bol";
import { addressLines, formatPrintDate } from "@/server/print/types";
import { zplCode128, zplField, zplLabel, zplText } from "@/server/print/zpl";
import { PNG_1X1, seededDb, tempStore, type SeededDb, type TempStore } from "./fixtures";

const address = { name: "Jane Doe", address1: "100 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const pageCount = async (bytes: Uint8Array): Promise<number> => (await PDFDocument.load(bytes)).getPageCount();

describe("catalog", () => {
  it("lists the 25 Logiwa printout types with consistent renderers", () => {
    expect(PRINT_TYPES).toHaveLength(25);
    expect(new Set(PRINT_TYPES.map((t) => t.key)).size).toBe(25);
    for (const type of PRINT_TYPES) expect(hasRenderer(type.key)).toBe(isPrintImplemented(type.key));
    expect(PRINT_TYPES.filter((t) => t.category === "billings")).toHaveLength(4);
    expect(getPrintType("lp-label")?.formats).toEqual(["pdf", "zpl"]);
  });
});

describe("primitives", () => {
  it("normalises text into WinAnsi", () => {
    expect(pdfSafe("“Café” – ok\n日本")).toBe('"Café" - ok ??');
    expect(pdfSafe(null)).toBe("");
  });

  it("wraps long text and hard-breaks long words", async () => {
    const writer = await PdfWriter.create();
    const lines = wrapText("alpha beta gamma delta epsilon", writer.regular, 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(wrapText("x".repeat(200), writer.regular, 10, 50).every((l) => writer.regular.widthOfTextAtSize(l, 10) <= 50)).toBe(true);
  });

  it("escapes ZPL field data so it cannot inject commands", () => {
    expect(zplField("^XZ~JA\\")).toBe("\\5EXZ\\7EJA\\5C");
    expect(zplField("é")).toBe("\\C3\\A9");
    expect(zplText({ x: 1, y: 2, text: "Hi" })).toBe("^FO1,2^A0N,28,28^FH\\^FDHi^FS");
    expect(zplCode128({ x: 0, y: 0, value: "LP1" })).toContain("^BCN,100,Y,N,N");
    const label = zplLabel(812, 406, ["X"], 3);
    expect(label.startsWith("^XA")).toBe(true);
    expect(label).toContain("^PQ3");
    expect(label.endsWith("^XZ")).toBe(true);
  });

  it("renders barcodes and rejects bad input", async () => {
    const png = await renderBarcodePng({ text: "LP000101" });
    expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
    await expect(renderBarcodePng({ text: "  " })).rejects.toThrow(/empty/);
    await expect(renderBarcodePng({ type: "gs1-128", text: "not-gs1" })).rejects.toThrow(/Cannot encode/);
  });

  it("formats addresses and dates", () => {
    expect(addressLines(address)).toEqual(["Jane Doe", "100 Main St", "Austin, TX 78701", "US"]);
    expect(formatPrintDate("2026-11-05T15:04:00.000Z")).toBe("11/5/2026 3:04 PM");
  });
});

describe("renderPrint", () => {
  it("validates type, format and records", async () => {
    await expect(renderPrint({ typeKey: "nope", records: [{}] })).rejects.toThrow(/Unknown printout type/);
    await expect(renderPrint({ typeKey: "contract", records: [{}] })).rejects.toThrow(/not configured yet/);
    await expect(renderPrint({ typeKey: "packing-slip", records: [{}], options: { format: "zpl", copies: 1 } })).rejects.toThrow(/cannot be printed as ZPL/);
    await expect(renderPrint({ typeKey: "packing-slip", records: [{ orderCode: "SO1" }] })).rejects.toThrow(/Record 1 is invalid/);
    await expect(renderPrint({ typeKey: "packing-slip", records: [] })).rejects.toThrow(/Invalid print request/);
  });

  it("renders a packing slip per order and copy", async () => {
    const record = { orderCode: "SO000123", shipTo: address, shipFrom: { ...address, name: "KitStaks DC" }, lines: [{ sku: "A", name: "Widget", quantity: 2, serialNumbers: ["S1"] }], giftMessage: "Enjoy" };
    const out = await renderPrint({ typeKey: "packing-slip", records: [record, { ...record, orderCode: "SO000124" }], options: { copies: 2 } });
    expect(out).toMatchObject({ mime: "application/pdf", extension: "pdf" });
    expect(text(out.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(await pageCount(out.bytes)).toBe(4);
  });

  it("paginates long pick lists and consolidates lines", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({ locationCode: `A-${String(i % 30).padStart(2, "0")}`, sku: `SKU${i % 30}`, name: "", quantity: 1, orderCode: `SO${i}` }));
    const out = await renderPrint({ typeKey: "picking-list", records: [{ code: "Job000201", lines }] });
    const standardPages = await pageCount(out.bytes);
    expect(standardPages).toBeGreaterThan(1);
    const merged = consolidatePickLines(lines);
    expect(merged).toHaveLength(30);
    expect(merged[0]).toMatchObject({ locationCode: "A-00", quantity: 4, orders: ["SO0", "SO30", "SO60", "SO90"] });
    expect(sortPickLines([{ locationCode: "B-10", sku: "x", name: "", quantity: 1 }, { locationCode: "B-9", sku: "x", name: "", quantity: 1 }]).map((l) => l.locationCode)).toEqual(["B-9", "B-10"]);
    const consolidated = await renderPrint({ typeKey: "consolidated-picking-list", records: [{ code: "Job000201", lines }] });
    expect(await pageCount(consolidated.bytes)).toBeLessThan(standardPages);
  });

  it("renders a manifest/BOL with totals", async () => {
    const record = manifestRecordSchema.parse({ bolNumber: "BOL1", carrier: "XPO", shipFrom: address, shipments: [{ orderCode: "SO1", packages: 2, weightLb: 10.25 }, { orderCode: "SO2", weightLb: 1 }] });
    expect(manifestTotals(record)).toEqual({ shipments: 2, packages: 3, weightLb: 11.25 });
    const out = await renderPrint({ typeKey: "manifest-bol", records: [record] });
    expect(await pageCount(out.bytes)).toBe(1);
  });

  it("renders LP and location labels as ZPL and PDF", async () => {
    const zpl = await renderPrint({ typeKey: "lp-label", records: [{ number: "LP000101", lpType: "Pallet" }], options: { format: "zpl", copies: 2 } });
    expect(zpl.mime).toBe("application/x-zpl");
    expect(text(zpl.bytes)).toContain("^FDLP000101^FS");
    expect(text(zpl.bytes)).toContain("^PQ2");
    const pdf = await renderPrint({ typeKey: "location-label", records: [{ code: "A-01-01" }, { code: "A-01-02" }], options: { copies: 1, labelSize: "4x6" } });
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(288);
    expect(Math.round(doc.getPage(0).getHeight())).toBe(432);
    const product = await renderPrint({ typeKey: "product-label", records: [{ sku: "A", barcode: "012345678905", name: "Widget" }] });
    expect(await pageCount(product.bytes)).toBe(1);
  });

  it("passes stored carrier labels through and draws sandbox labels otherwise", async () => {
    const base = { trackingNumber: "1Z999", carrier: "UPS", service: "Ground", shipFrom: address, shipTo: address };
    const sandbox = await renderPrint({ typeKey: "shipping-label", records: [base], options: { format: "zpl", copies: 1 } });
    expect(text(sandbox.bytes)).toContain("SANDBOX");
    const storedZpl = Buffer.from("^XA^FDREAL^FS^XZ").toString("base64");
    const passthrough = await renderPrint({ typeKey: "shipping-label", records: [{ ...base, labelData: { format: "zpl", base64: storedZpl } }], options: { format: "zpl", copies: 2 } });
    expect(text(passthrough.bytes).match(/REAL/g)).toHaveLength(2);
    const inner = await PDFDocument.create();
    inner.addPage([288, 432]);
    const storedPdf = Buffer.from(await inner.save()).toString("base64");
    const merged = await renderPrint({ typeKey: "shipping-label", records: [{ ...base, labelData: { format: "pdf", base64: storedPdf } }, base, { ...base, labelData: { format: "png", base64: PNG_1X1.toString("base64") } }] });
    expect(await pageCount(merged.bytes)).toBe(3);
    await expect(renderPrint({ typeKey: "shipping-label", records: [{ ...base, labelData: { format: "pdf", base64: storedPdf } }], options: { format: "zpl", copies: 1 } })).rejects.toThrow(/stored as PDF/);
  });
});

describe("printToFile", () => {
  let testDb: SeededDb;
  let temp: TempStore;
  beforeEach(() => {
    testDb = seededDb();
    temp = tempStore(() => new Date("2026-11-05T10:00:00.000Z"));
  });
  afterEach(() => {
    testDb.close();
    temp.cleanup();
  });

  it("stores the rendered printout as an expiring file", async () => {
    const file = await printToFile(testDb.db, { request: { typeKey: "lp-label", records: [{ number: "LP1" }], options: { format: "zpl", copies: 1 } }, userId: testDb.ids.admin, store: temp.store, now: new Date("2026-11-05T10:00:00.000Z") });
    expect(file).toMatchObject({ mime: "application/x-zpl", name: "LP Label 2026-11-05 1000.zpl", expiresAt: "2026-11-12T10:00:00.000Z" });
  });
});
