import { afterEach, describe, expect, it } from "vitest";
import { and, count, sql } from "drizzle-orm";
import { clients } from "@/server/db/schema";
import { compileFilters, compileQuickSearch, escapeLike, type FilterFieldDef } from "@/server/query/filters";
import { parseGridQuery } from "@/server/query/grid-query";
import { normalizePage, pageMeta, paginate } from "@/server/query/paginate";
import { compileSort } from "@/server/query/sort";
import { createTestDb, type TestDb } from "../../setup/test-db";

const DEFS: readonly FilterFieldDef[] = [
  { key: "status", label: "Status", type: "enum", column: clients.status, options: [{ value: "Active", label: "Active" }] },
  { key: "code", label: "Code", type: "text", column: clients.code },
  { key: "taxId", label: "Tax ID", type: "text", column: clients.taxId, nullable: true },
  { key: "version", label: "Version", type: "number", column: clients.version },
  { key: "createdAt", label: "Created", type: "date", column: clients.createdAt },
  { key: "tier", label: "Tier", type: "text", customField: { column: clients.customFields, key: "dropDown1" } },
  { key: "isA", label: "Is A", type: "boolean", sql: sql`(${clients.code} ILIKE 'A%')` },
];

async function seed(t: TestDb): Promise<void> {
  const base = { contactName: "x", contactEmail: "x@x.io", phone: "1", billingPlan: "monthly" as const };
  const rows: (typeof clients.$inferInsert)[] = [
    { ...base, id: "1", code: "ACME", name: "Acme", status: "Active", version: 1, taxId: "T1", customFields: { dropDown1: "gold" }, createdAt: "2026-11-05T10:00:00.000Z" },
    { ...base, id: "2", code: "AB_1", name: "Ab", status: "Active", version: 5, taxId: null, customFields: { dropDown1: "silver" }, createdAt: "2026-10-01T10:00:00.000Z" },
    { ...base, id: "3", code: "ZED", name: "Zed", status: "Inactive", version: 9, taxId: "", customFields: {}, createdAt: "2025-01-01T10:00:00.000Z" },
  ];
  await t.db.insert(clients).values(rows);
}

const NOW = new Date("2026-11-05T15:00:00.000Z");

async function ids(t: TestDb, qs: string): Promise<string[]> {
  const { query, issues } = parseGridQuery(qs);
  expect(issues).toEqual([]);
  const where = and(compileFilters(DEFS, query.filters, { now: NOW }), compileQuickSearch(query.q, query.qm, [clients.code, clients.name]));
  return (await t.db.select({ id: clients.id }).from(clients).where(where).orderBy(clients.id)).map((r) => r.id);
}

describe("compileFilters", () => {
  let t: TestDb;
  afterEach(async () => await t.close());

  it("compiles every operator against SQLite", async () => {
    t = await createTestDb();
    await seed(t);
    expect(await ids(t, "f.status=in:Active")).toEqual(["1", "2"]);
    expect(await ids(t, "f.status=nin:Active")).toEqual(["3"]);
    expect(await ids(t, "f.code=eq:acme")).toEqual(["1"]);
    expect(await ids(t, "f.code=ct:E")).toEqual(["1", "3"]);
    expect(await ids(t, "f.code=sw:A")).toEqual(["1", "2"]);
    expect(await ids(t, "f.code=ew:ED")).toEqual(["3"]);
    expect(await ids(t, "f.code=ct:_")).toEqual(["2"]); // LIKE wildcard is escaped
    expect(await ids(t, "f.taxId=ex")).toEqual(["1"]);
    expect(await ids(t, "f.taxId=empty")).toEqual(["2", "3"]);
    expect(await ids(t, "f.version=rng:2..9")).toEqual(["2", "3"]);
    expect(await ids(t, "f.version=rng:..4")).toEqual(["1"]);
    expect(await ids(t, "f.version=in:1,9")).toEqual(["1", "3"]);
    expect(await ids(t, "f.createdAt=date:today")).toEqual(["1"]);
    expect(await ids(t, "f.createdAt=date:last90d")).toEqual(["1", "2"]);
    expect(await ids(t, "f.createdAt=date:custom:2025-01-01..2025-01-01")).toEqual(["3"]);
    expect(await ids(t, "f.tier=eq:gold")).toEqual(["1"]);
    expect(await ids(t, "f.isA=bool:true")).toEqual(["1", "2"]);
    expect(await ids(t, "f.status=in:Active&f.version=rng:3..")).toEqual(["2"]);
  });

  it("quick search Equal vs Starts With", async () => {
    t = await createTestDb();
    await seed(t);
    expect(await ids(t, "q=ac&qm=sw")).toEqual(["1"]);
    expect(await ids(t, "q=ac&qm=eq")).toEqual([]);
    expect(await ids(t, "q=zed&qm=eq")).toEqual(["3"]);
  });

  it("rejects unknown fields, wrong operators and bad numbers", () => {
    const parse = (qs: string) => parseGridQuery(qs).query.filters;
    expect(() => compileFilters(DEFS, parse("f.nope=eq:1"))).toThrow(/Unknown filter field/);
    expect(() => compileFilters(DEFS, parse("f.status=ct:A"))).toThrow(/not supported/);
    expect(() => compileFilters(DEFS, parse("f.version=rng:a..b"))).toThrow(/not a number/);
    expect(compileFilters(DEFS, [])).toBeUndefined();
  });

  it("escapeLike escapes wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("sort + paginate", () => {
  let t: TestDb;
  afterEach(async () => await t.close());

  it("whitelists sort keys and pages with a total", async () => {
    t = await createTestDb();
    await seed(t);
    const order = compileSort({ code: clients.code, version: clients.version }, parseGridQuery("sort=-version").query.sort, { tiebreaker: clients.id });
    const page = await paginate(
      t.db.select({ id: clients.id }).from(clients).orderBy(...order).$dynamic(),
      async () => (await t.db.select({ n: count() }).from(clients).limit(1))[0]?.n ?? 0,
      { page: 2, pageSize: 2 },
    );
    expect(page).toEqual({ rows: [{ id: "1" }], total: 3 });
    expect(() => compileSort({ code: clients.code }, [{ field: "passwordHash", dir: "asc" }])).toThrow(/Cannot sort/);
    expect(compileSort({ code: clients.code }, [], { defaultSort: [{ field: "code", dir: "asc" }] })).toHaveLength(2);
  });

  it("caps page size at 1000", () => {
    expect(normalizePage({ page: 0, pageSize: 5000 })).toEqual({ page: 1, pageSize: 1000 });
    expect(pageMeta(10, { page: 2, pageSize: 100 })).toEqual({ total: 10, page: 2, pageSize: 100 });
  });
});
