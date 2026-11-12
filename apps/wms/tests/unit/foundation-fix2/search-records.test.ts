import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clients, jobs, locations, purchaseOrders, shipmentOrders } from "@/server/db/schema";
import { globalSearch } from "@/server/search/registry";
import { provider as jobsProvider } from "@/server/search/providers/jobs";
import { provider as locationsProvider } from "@/server/search/providers/locations";
import { provider as posProvider } from "@/server/search/providers/pos";
import { provider as lpsProvider } from "@/server/search/providers/lps";
import { resolveExportTimeZone } from "@/server/exports/runner";
import { authFor, seededDb, type SeededDb } from "../foundation-f6/fixtures";

async function seedRecords(testDb: SeededDb): Promise<void> {
  const { db, ids } = testDb;
  await db.insert(jobs).values([
    { id: "j-1", code: "Job005259", warehouseId: ids.wh1, clientId: ids.c1, jobType: "Single", status: "Pending", orderCount: 3 },
    { id: "j-2", code: "Job005260", warehouseId: ids.wh2, clientId: ids.c2, jobType: "Batch", status: "Started", orderCount: 1, waveNumber: "W-005259" },
  ]);
  await db.insert(locations).values({ id: "l-1", warehouseId: ids.wh1, code: "A-01-01-1", zone: "A", aisle: "01", bay: "01", level: "1", type: "Picking", capacityUnits: 100 });
  await db.insert(purchaseOrders).values({ id: "po-1", code: "PO002210", warehouseId: ids.wh1, clientId: ids.c1, vendorName: "Acme Supply", status: "Pending", totalQuantity: 10, purchasePrice: 100 });
}

describe("record search providers (fix2)", () => {
  let testDb: SeededDb;
  beforeEach(async () => {
    testDb = await seededDb();
    await seedRecords(testDb);
  });
  afterEach(async () => await testDb.close());

  it("finds jobs by code and wave number, ranked, with counts", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    const ctx = { db: testDb.db, auth, q: "Job005259", limit: 5 };
    const hits = await jobsProvider.search(ctx);
    expect(hits).toEqual([{ id: "j-1", title: "Job005259", subtitle: "Single · 3 orders", status: { label: "Pending", domain: "job" }, href: "/jobs/j-1", rank: 0 }]);
    const wave = await jobsProvider.search({ ...ctx, q: "005259" });
    expect(wave.map((h) => h.id).sort()).toEqual(["j-1", "j-2"]);
    expect(await jobsProvider.count?.({ ...ctx, q: "005259" })).toBe(2);
  });

  it("applies warehouse / client scope (cross-scope records never appear)", async () => {
    const viewer = await authFor(testDb, testDb.ids.viewer);
    const ctx = { db: testDb.db, auth: viewer, q: "005259", limit: 5 };
    expect((await jobsProvider.search(ctx)).map((h) => h.id)).toEqual(["j-1"]);
    expect(await jobsProvider.count?.(ctx)).toBe(1);
  });

  it("finds locations, POs and runs LPs against an empty table", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    const loc = await locationsProvider.search({ db: testDb.db, auth, q: "A-01", limit: 5 });
    expect(loc[0]).toMatchObject({ title: "A-01-01-1", subtitle: "W1 · Zone A · Picking", href: "/locations/l-1", rank: 1 });
    const po = await posProvider.search({ db: testDb.db, auth, q: "acme", limit: 5 });
    expect(po[0]).toMatchObject({ title: "PO002210", href: "/receiving/po-1", rank: 3 });
    expect(await lpsProvider.search({ db: testDb.db, auth, q: "LP0", limit: 5 })).toEqual([]);
  });

  it("returns groups best match first with totals and See-all links", async () => {
    const { db, ids } = testDb;
    await db.update(clients).set({ name: "Apex Threads Co.", code: "APX" }).where(eq(clients.id, ids.c1));
    await db.insert(shipmentOrders).values({
      id: "so-1", code: "SO010421", warehouseId: ids.wh1, clientId: ids.c1, channel: "Shopify", status: "Open",
      customerName: "Apex Fan", customerEmail: "fan@x.io", shipAddress: "1 St", shipCity: "Dallas", shipState: "TX", shipZip: "75001",
      totalQuantity: 1, totalWeightOz: 4, salesPrice: 10, orderDate: "2026-11-05T10:00:00.000Z",
    });
    const auth = await authFor(testDb, ids.admin);
    const groups = await globalSearch({ db, auth, q: "apex", limit: 5 }, ["orders", "clients"]);
    expect(groups.map((g) => g.key)).toEqual(["clients", "orders"]);
    expect(groups[0]).toMatchObject({ singular: "Client", bestRank: 1, total: 1, seeAllHref: "/clients?q=apex" });
    expect(groups[1]).toMatchObject({ singular: "Order", bestRank: 3, total: 1 });
  });
});

describe("export file-name time zone", () => {
  let testDb: SeededDb;
  beforeEach(async () => {
    testDb = await seededDb();
  });
  afterEach(async () => await testDb.close());

  it("prefers the browser zone, then the context warehouse zone", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    expect(await resolveExportTimeZone(testDb.db, auth, "Europe/Berlin")).toBe("Europe/Berlin");
    expect(await resolveExportTimeZone(testDb.db, auth, "Bogus/Zone")).toBe("America/Chicago");
    expect(await resolveExportTimeZone(testDb.db, { ...auth, context: { warehouseId: null, clientId: null }, scope: { warehouseIds: [], clientIds: "all" } })).toBe("America/Chicago");
  });
});
