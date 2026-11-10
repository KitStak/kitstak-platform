import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { backgroundTasks, files } from "@/server/db/schema";
import { MAX_UPLOAD_BYTES, sanitizeFileName, sha256Hex, validateFile } from "@/server/files/files";
import { MIME, extensionForMime, looksLikeText, sniffMime } from "@/server/files/mime";
import { PNG_1X1, seededDb, tempStore, type SeededDb, type TempStore } from "./fixtures";

describe("sniffMime", () => {
  it("detects binary formats from magic bytes regardless of the name", () => {
    expect(sniffMime(PNG_1X1, "evil.pdf")).toBe(MIME.png);
    expect(sniffMime(Buffer.from("%PDF-1.7\n..."), "x.png")).toBe(MIME.pdf);
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(MIME.jpeg);
    expect(sniffMime(Buffer.from("GIF89a"))).toBe(MIME.gif);
    expect(sniffMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe(MIME.webp);
  });

  it("uses the extension only to disambiguate zip and text", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]);
    expect(sniffMime(zip, "book.xlsx")).toBe(MIME.xlsx);
    expect(sniffMime(zip, "book.zip")).toBe(MIME.zip);
    expect(sniffMime(Buffer.from("a,b\n1,2"), "data.csv")).toBe(MIME.csv);
    expect(sniffMime(Buffer.from("^XA^FO10,10^FDx^FS^XZ"))).toBe(MIME.zpl);
    expect(sniffMime(Buffer.from([0, 1, 2, 3]))).toBe(MIME.binary);
  });

  it("text detection rejects NUL bytes", () => {
    expect(looksLikeText(Buffer.from("héllo"))).toBe(true);
    expect(looksLikeText(Buffer.from([104, 0, 105]))).toBe(false);
    expect(extensionForMime(MIME.xlsx)).toBe("xlsx");
    expect(extensionForMime("application/x-unknown")).toBe("bin");
  });
});

describe("validateFile / sanitizeFileName", () => {
  it("enforces the per-purpose policy", () => {
    expect(validateFile("attachment", "a.png", PNG_1X1)).toBe(MIME.png);
    expect(() => validateFile("attachment", "a.csv", Buffer.from("a,b"))).toThrow(/Unsupported file type/);
    expect(() => validateFile("import", "a.png", PNG_1X1)).toThrow(/Excel/);
    expect(() => validateFile("import", "a.csv", Buffer.alloc(0))).toThrow(/empty/);
    expect(() => validateFile("import", "a.csv", Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61))).toThrow(/10 MB/);
  });

  it("strips paths and control characters", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\x\\report<1>.xlsx")).toBe("report1.xlsx");
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName(`${"a".repeat(300)}.xlsx`)).toHaveLength(200);
    expect(sanitizeFileName(`${"a".repeat(300)}.xlsx`).endsWith(".xlsx")).toBe(true);
  });
});

describe("file store", () => {
  let testDb: SeededDb;
  let temp: TempStore;
  let clock: Date;
  beforeEach(() => {
    testDb = seededDb();
    clock = new Date("2026-11-01T00:00:00.000Z");
    temp = tempStore(() => clock);
  });
  afterEach(() => {
    testDb.close();
    temp.cleanup();
  });

  it("stores bytes with sha256 and sniffed mime, then reads them back", () => {
    const record = temp.store.store(testDb.db, { name: "photo.jpg", bytes: PNG_1X1, purpose: "attachment", uploadedBy: testDb.ids.admin });
    expect(record.mime).toBe(MIME.png);
    expect(record.sha256).toBe(sha256Hex(PNG_1X1));
    expect(record.expiresAt).toBeNull();
    expect(fs.existsSync(path.join(temp.root, record.id))).toBe(true);
    const { bytes } = temp.store.read(testDb.db, record.id);
    expect(Buffer.compare(bytes, PNG_1X1)).toBe(0);
  });

  it("rejects unknown and malformed ids as NOT_FOUND", () => {
    expect(() => temp.store.read(testDb.db, "../../secret")).toThrow(/not found/i);
    expect(() => temp.store.read(testDb.db, "00000000-0000-4000-8000-000000000000")).toThrow(/not found/i);
  });

  it("expires export files after 7 days and cleans them up", () => {
    const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]);
    const record = temp.store.store(testDb.db, { name: "e.xlsx", bytes: xlsx, purpose: "export", uploadedBy: testDb.ids.admin });
    expect(record.expiresAt).toBe("2026-11-08T00:00:00.000Z");
    testDb.db.insert(backgroundTasks).values({ kind: "export", title: "t", userId: testDb.ids.admin, fileId: record.id, status: "completed" }).run();
    expect(temp.store.deleteExpired(testDb.db)).toBe(0);
    clock = new Date("2026-11-08T00:00:01.000Z");
    expect(() => temp.store.read(testDb.db, record.id)).toThrow(/not found/i);
    expect(temp.store.deleteExpired(testDb.db)).toBe(1);
    expect(testDb.db.select().from(files).where(eq(files.id, record.id)).get()).toBeUndefined();
    expect(testDb.db.select().from(backgroundTasks).get()?.fileId).toBeNull();
    expect(fs.existsSync(path.join(temp.root, record.id))).toBe(false);
  });
});
