/**
 * M08 judge round 1: seeded "with picking" work orders that are In Process hold real Picking tasks
 * (one per allocation, linked), so their Work Order Picking job is never a lone Kitting task.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { runSeed } from "@/server/db/seed/index";
import { createFileStore } from "@/server/files";
import { createTestDb, hasMigrations, type TestDb } from "../../setup/test-db";

describe.skipIf(!hasMigrations())("seeded with-picking work orders", () => {
  let testDb: TestDb;
  let filesRoot: string;
  beforeAll(async () => {
    filesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitstak-wo-seed-"));
    testDb = await createTestDb();
    await runSeed(testDb.db, { files: createFileStore({ root: filesRoot }) });
  }, 240_000);
  afterAll(async () => {
    await testDb?.close();
    if (filesRoot) fs.rmSync(filesRoot, { recursive: true, force: true, maxRetries: 3 });
  }, 60_000);

  it("In Process work orders have one linked Picking task per allocation, and the Kitting task last", async () => {
    const db = testDb.db;
    const wos = await db.select().from(schema.workOrders).where(and(eq(schema.workOrders.status, "In Process"), eq(schema.workOrders.type, "Work Order with Picking")));
    expect(wos.length).toBeGreaterThan(0);
    for (const wo of wos) {
      const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.workOrderId, wo.id));
      const picks = tasks.filter((t) => t.taskType === "Picking");
      const allocs = await db.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.workOrderId, wo.id));
      expect(picks.length).toBe(allocs.length);
      expect(allocs.every((a) => picks.some((t) => t.id === a.taskId && t.plannedQty === a.qty))).toBe(true);
      const kitting = tasks.find((t) => t.taskType === "Kitting");
      expect(kitting?.sequence).toBe(picks.length + 1);
      const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, wo.jobId ?? "")).limit(1))[0];
      expect(job?.taskCount).toBe(picks.length + 1);
    }
  });
});
