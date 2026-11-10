import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDropStatements, dropAllObjects, listUserObjects, quoteIdent } from "../../../scripts/lib/drop-all";

describe("drop-all (db:reset step 1)", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE parents (id TEXT PRIMARY KEY, name TEXT UNIQUE);
      CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id));
      CREATE INDEX children_parent_idx ON children(parent_id);
      CREATE VIEW parent_names AS SELECT name FROM parents;
      CREATE TRIGGER parents_touch AFTER INSERT ON parents BEGIN SELECT 1; END;
      CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT);
      CREATE TABLE "odd""name" (id INTEGER);
      INSERT INTO parents VALUES ('p1', 'one');
      INSERT INTO children VALUES ('c1', 'p1');
    `);
  });

  afterEach(() => sqlite.close());

  it("quotes identifiers safely", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  it("lists user objects but not sqlite internals", () => {
    const names = listUserObjects(sqlite).map((o) => o.name);
    expect(names).toEqual(expect.arrayContaining(["parents", "children", "children_parent_idx", "parent_names", "parents_touch", "__drizzle_migrations"]));
    expect(names.some((n) => n.startsWith("sqlite_"))).toBe(false);
  });

  it("orders drops triggers -> views -> indexes -> tables", () => {
    const statements = buildDropStatements([
      { type: "table", name: "t" },
      { type: "index", name: "i" },
      { type: "view", name: "v" },
      { type: "trigger", name: "g" },
    ]);
    expect(statements).toEqual([
      'DROP TRIGGER IF EXISTS "g"',
      'DROP VIEW IF EXISTS "v"',
      'DROP INDEX IF EXISTS "i"',
      'DROP TABLE IF EXISTS "t"',
    ]);
  });

  it("drops every object even with foreign keys on, and restores the FK pragma", () => {
    const dropped = dropAllObjects(sqlite);
    expect(dropped).toBeGreaterThanOrEqual(7);
    expect(listUserObjects(sqlite)).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("is a no-op on an empty database", () => {
    dropAllObjects(sqlite);
    expect(dropAllObjects(sqlite)).toBe(0);
  });
});
