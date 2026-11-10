/**
 * Round 9: every seeded billing contract carries a September (Approved, exported) and an October
 * bill, with Detailed lines (activity date, reference, SKU) so the contract and bill pages are never empty.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "@/server/db/seed/index";
import { createFileStore } from "@/server/files";
import { createTestDb, hasMigrations, type TestDb } from "../../setup/test-db";

describe.skipIf(!hasMigrations())("seeded billing", () => {
  let testDb: TestDb;
  let filesRoot: string;
  beforeAll(async () => {
    filesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitstak-seed-bill-"));
    testDb = createTestDb();
    await runSeed(testDb.db, { files: createFileStore({ root: filesRoot }) });
  }, 240_000);
  afterAll(() => {
    testDb?.close();
    if (filesRoot) fs.rmSync(filesRoot, { recursive: true, force: true, maxRetries: 3 });
  }, 60_000);

  it("gives each contract a September and an October bill", () => {
    const rows = testDb.db.all<{ name: string; n: number; sep: number; oct: number; exported: number }>(sql`SELECT c.name, COUNT(r.id) AS n,
      SUM(substr(r.period_start, 1, 7) = '2026-09' AND r.bill_status = 'Approved') AS sep, SUM(substr(r.period_start, 1, 7) = '2026-10') AS oct,
      SUM(r.exported_to_integration) AS exported FROM billing_contracts c LEFT JOIN billing_reports r ON r.contract_id = c.id GROUP BY c.id`);
    expect(rows.length).toBe(5);
    expect(rows.some((r) => r.name.startsWith("Copperline") && r.name.endsWith("· Ambient DTC 2026"))).toBe(true);
    for (const r of rows) expect([r.name, r.n, r.sep, r.oct, r.exported >= 1]).toEqual([r.name, 2, 1, 1, true]);
  });

  it("writes Detailed lines with reference numbers and SKUs", () => {
    const d = testDb.db.get<{ n: number; refs: number; skus: number }>(sql`SELECT COUNT(*) AS n, COUNT(reference_number) AS refs, COUNT(sku) AS skus FROM billing_report_lines WHERE is_detail = 1`);
    expect(d?.n ?? 0).toBeGreaterThan(20);
    expect(d?.refs).toBe(d?.n);
    expect(d?.skus ?? 0).toBeGreaterThan(0);
  });

  it("uses 16-digit bill numbers and Logiwa Fee by / Charge by values (repair round 1)", () => {
    const bills = testDb.db.all<{ n: string }>(sql`SELECT bill_number AS n FROM billing_reports`);
    expect(bills.length).toBeGreaterThan(0);
    for (const b of bills) expect(b.n).toMatch(/^\d{16}$/);
    const legacy = testDb.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM billing_fees WHERE charge_by LIKE 'Per %' OR fee_by IN ('Order', 'Unit')`);
    expect(legacy?.n).toBe(0);
  });

  it("gives every client a default Shipping address", () => {
    const missing = testDb.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM clients c WHERE NOT EXISTS (SELECT 1 FROM addresses a WHERE a.owner_type = 'client' AND a.owner_id = c.id AND a.usage_type = 'Shipping' AND a.is_default = 1)`);
    expect(missing?.n).toBe(0);
  });
});
