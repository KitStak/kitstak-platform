import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provider as clientsProvider } from "@/server/search/providers/clients";
import { provider as ordersProvider } from "@/server/search/providers/orders";
import { provider as productsProvider } from "@/server/search/providers/products";
import { authFor, seededDb, type SeededDb } from "../foundation-f6/fixtures";

describe("record search providers", () => {
  let testDb: SeededDb;
  beforeEach(() => {
    testDb = seededDb();
  });
  afterEach(() => testDb.close());

  it("finds clients by name and code, ranking prefix matches", async () => {
    const auth = authFor(testDb, testDb.ids.admin);
    const hits = await clientsProvider.search({ db: testDb.db, auth, q: "acm", limit: 5 });
    expect(hits).toEqual([{ id: testDb.ids.c1, title: "Acme", subtitle: "C1", href: `/clients/${testDb.ids.c1}`, rank: 1 }]);
    expect((await clientsProvider.search({ db: testDb.db, auth, q: "c2", limit: 5 })).map((h) => h.title)).toEqual(["Beta"]);
  });

  it("treats LIKE wildcards literally and respects client scope", async () => {
    const auth = authFor(testDb, testDb.ids.admin);
    expect(await clientsProvider.search({ db: testDb.db, auth, q: "%%", limit: 5 })).toEqual([]);
    const scoped = { ...auth, scope: { warehouseIds: [testDb.ids.wh1], clientIds: [testDb.ids.c2] } };
    expect((await clientsProvider.search({ db: testDb.db, auth: scoped, q: "a", limit: 5 })).map((h) => h.title)).toEqual(["Beta"]);
    const none = { ...auth, scope: { warehouseIds: [testDb.ids.wh1], clientIds: [] } };
    expect(await clientsProvider.search({ db: testDb.db, auth: none, q: "a", limit: 5 })).toEqual([]);
  });

  it("orders and products run scoped queries without error on an empty catalog", async () => {
    const auth = authFor(testDb, testDb.ids.admin);
    expect(await ordersProvider.search({ db: testDb.db, auth, q: "SO01", limit: 5 })).toEqual([]);
    expect(await productsProvider.search({ db: testDb.db, auth, q: "SKU", limit: 5 })).toEqual([]);
  });
});
