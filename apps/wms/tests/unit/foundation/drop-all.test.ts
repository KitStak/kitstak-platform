import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDropStatements, dropAllObjects, listUserObjects, quoteIdent } from "../../../scripts/lib/drop-all";
import { openPglite, type OpenDatabase } from "@/server/db";

describe("drop-all (db:reset step 1)", () => {
  let handle: OpenDatabase;

  beforeEach(async () => {
    handle = await openPglite(null); // in-memory, fully migrated
    const pg = (handle.db as unknown as { $client: { exec(q: string): Promise<unknown> } }).$client;
    await pg.exec(`
      CREATE TABLE parents (id TEXT PRIMARY KEY, name TEXT UNIQUE);
      CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id));
      CREATE INDEX children_parent_idx ON children(parent_id);
      CREATE VIEW parent_names AS SELECT name FROM parents;
      CREATE TABLE "odd""name" (id INTEGER);
      INSERT INTO parents VALUES ('p1', 'one');
      INSERT INTO children VALUES ('c1', 'p1');
    `);
  });

  afterEach(() => handle.close());

  it("quotes identifiers safely", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  it("lists app objects: tables, views, trigger functions and the migration journal", async () => {
    const objects = await listUserObjects(handle.db);
    const names = objects.map((o) => o.name);
    expect(names).toEqual(expect.arrayContaining(["parents", "children", "parent_names", 'odd"name', "users", "drizzle"]));
    expect(objects.some((o) => o.type === "function" && o.name.startsWith("billing_reports_period_guard("))).toBe(true);
  });

  it("orders drops views -> tables -> functions -> journal schema", () => {
    const statements = buildDropStatements([
      { type: "schema", name: "drizzle" },
      { type: "function", name: "f(integer)" },
      { type: "table", name: "t" },
      { type: "view", name: "v" },
    ]);
    expect(statements).toEqual([
      'DROP VIEW IF EXISTS "public"."v" CASCADE',
      'DROP TABLE IF EXISTS "public"."t" CASCADE',
      'DROP FUNCTION IF EXISTS "public"."f"(integer) CASCADE',
      'DROP SCHEMA IF EXISTS "drizzle" CASCADE',
    ]);
  });

  it("drops every object even with foreign keys between tables", async () => {
    const dropped = await dropAllObjects(handle.db);
    expect(dropped).toBeGreaterThanOrEqual(115);
    expect(await listUserObjects(handle.db)).toEqual([]);
  });

  it("is a no-op on an empty database", async () => {
    await dropAllObjects(handle.db);
    expect(await dropAllObjects(handle.db)).toBe(0);
  });
});
