import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { eq, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "@/server/db/schema";
import { LEGACY_BUCKET_KEY_PREFIX } from "@/server/db/schema";
import { runMigrations } from "@/server/db/migrate";
import { createTestDb, type TestDb } from "../../setup/test-db";

function tableNames(sqlite: Database.Database): Set<string> {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function indexNames(sqlite: Database.Database): Set<string> {
  const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

const schemaTables: SQLiteTable[] = (Object.values(schema) as unknown[]).flatMap((v) =>
  is(v, SQLiteTable) ? [v] : []
);

describe("F1 schema migrations", () => {
  let testDb: TestDb | undefined;
  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  it("creates every table exported from the schema barrel", () => {
    testDb = createTestDb();
    const created = tableNames(testDb.sqlite);
    const missing = schemaTables.map((t) => getTableName(t)).filter((name) => !created.has(name));
    expect(missing).toEqual([]);
    expect(schemaTables.length).toBeGreaterThanOrEqual(110);
  });

  it("creates the specified ledger, outbound and platform indexes", () => {
    testDb = createTestDb();
    const indexes = indexNames(testDb.sqlite);
    for (const name of ["inventory_bucket_idx", "itx_seq_idx", "alloc_order_idx", "orders_code_idx",
      "change_log_entity_idx", "lookup_unique_idx", "tasks_no_idx", "receipts_master_idx", "serial_unique_idx"]) {
      expect(indexes.has(name), name).toBe(true);
    }
  });

  it("is idempotent when re-run on a migrated database", () => {
    const sqlite = new Database(":memory:");
    try {
      const first = runMigrations(sqlite);
      const second = runMigrations(sqlite);
      expect(first.applied).toBe(first.total);
      expect(second.applied).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("enforces foreign keys and cascades", () => {
    testDb = createTestDb();
    const { db } = testDb;
    expect(() =>
      db.insert(schema.customers).values({ clientId: "missing", firstName: "A", lastName: "B", email: "a@b.c", phone: "1" }).run()
    ).toThrow(/FOREIGN KEY/);

    db.insert(schema.roles).values({ id: "r1", key: "admin", name: "Admin" }).run();
    db.insert(schema.rolePermissions).values({ roleId: "r1", permission: "orders.read" }).run();
    db.delete(schema.roles).where(eq(schema.roles.id, "r1")).run();
    expect(db.select().from(schema.rolePermissions).all()).toEqual([]);
  });

  it("applies column defaults: stamps, JSON objects, legacy bucket keys", () => {
    testDb = createTestDb();
    const { db } = testDb;
    db.insert(schema.warehouses).values({ id: "wh1", code: "W1", name: "W1", addressLine: "1 Main", city: "X", state: "KY" }).run();
    db.insert(schema.clients).values({
      id: "c1", code: "C1", name: "Client", contactName: "n", contactEmail: "e", phone: "p", billingPlan: "monthly", status: "Active",
    }).run();
    const client = db.select().from(schema.clients).where(eq(schema.clients.id, "c1")).get();
    expect(client?.settings).toEqual({});
    expect(client?.customFields).toEqual({});
    expect(client?.version).toBe(1);
    expect(client?.currency).toBe("USD");
    expect(Date.parse(client?.createdAt ?? "")).not.toBeNaN();

    db.insert(schema.products).values({
      id: "p1", clientId: "c1", sku: "S", barcode: "B", name: "N", category: "C", weightOz: 1, lengthIn: 1, widthIn: 1,
      heightIn: 1, price: 1, status: "Active",
    }).run();
    db.insert(schema.locations).values({
      id: "l1", warehouseId: "wh1", code: "A", zone: "A", aisle: "1", bay: "1", level: "1", type: "Picking", capacityUnits: 10,
    }).run();
    db.insert(schema.inventory).values([
      { warehouseId: "wh1", productId: "p1", locationId: "l1", onHand: 5, receivedAt: "2026-01-01T00:00:00.000Z" },
      { warehouseId: "wh1", productId: "p1", locationId: "l1", onHand: 3, receivedAt: "2026-01-01T00:00:00.000Z" },
    ]).run();
    const rows = db.select().from(schema.inventory).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.bucketKey.startsWith(LEGACY_BUCKET_KEY_PREFIX))).toBe(true);
    expect(rows.every((r) => r.status === "Stock" && r.packType === "Each")).toBe(true);
  });

  it("rejects duplicate global lookup values (NULL scope is not distinct)", () => {
    testDb = createTestDb();
    const { db } = testDb;
    db.insert(schema.lookupValues).values({ type: "damage_reason", name: "Crushed" }).run();
    expect(() => db.insert(schema.lookupValues).values({ type: "damage_reason", name: "Crushed" }).run()).toThrow(/UNIQUE/);
  });
});
