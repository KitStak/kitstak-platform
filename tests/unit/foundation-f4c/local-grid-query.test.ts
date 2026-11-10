import { describe, expect, it } from "vitest";
import { applyLocalGridQuery, matchesFilter, sortRows } from "@/lib/local-grid-query";
import { EMPTY_GRID_QUERY, parseGridQuery } from "@/server/query/grid-query";

interface Row {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly qty: number;
  readonly tracking: string | null;
  readonly at: string;
  readonly rush: boolean;
}

const ROWS: readonly Row[] = [
  { id: "1", code: "SO100", status: "Open", qty: 5, tracking: null, at: "2026-11-05T12:00:00.000Z", rush: true },
  { id: "2", code: "SO101", status: "Shipped", qty: 2, tracking: "1Z9", at: "2026-10-01T12:00:00.000Z", rush: false },
  { id: "3", code: "SO200", status: "Open", qty: 12, tracking: "", at: "2026-11-04T12:00:00.000Z", rush: false },
];

const get = (row: Row, field: string) => (field in row ? row[field as keyof Row] : undefined);
const opts = { get, searchFields: ["code"], now: new Date("2026-11-05T16:00:00.000Z") };
const run = (qs: string) => applyLocalGridQuery(ROWS, parseGridQuery(new URLSearchParams(qs)).query, opts);

describe("applyLocalGridQuery", () => {
  it("returns everything for an empty query", () => {
    expect(applyLocalGridQuery(ROWS, EMPTY_GRID_QUERY, opts).total).toBe(3);
  });

  it("quick search supports Starts With and Equal", () => {
    expect(run("q=SO1").rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(run("q=so100&qm=eq").rows.map((r) => r.id)).toEqual(["1"]);
    expect(run("q=SO1&qm=eq").total).toBe(0);
  });

  it("applies enum, range, empty and date filters together", () => {
    expect(run("f.status=in:Open").total).toBe(2);
    expect(run("f.status=nin:Open").rows.map((r) => r.id)).toEqual(["2"]);
    expect(run("f.qty=rng:3..20").rows.map((r) => r.id)).toEqual(["1", "3"]);
    expect(run("f.tracking=empty").rows.map((r) => r.id)).toEqual(["1", "3"]);
    expect(run("f.tracking=ex").rows.map((r) => r.id)).toEqual(["2"]);
    expect(run("f.at=date:last7d").rows.map((r) => r.id)).toEqual(["1", "3"]);
    expect(run("f.status=in:Open&f.qty=rng:..6").rows.map((r) => r.id)).toEqual(["1"]);
  });

  it("sorts (multi-key, blanks last) and pages", () => {
    expect(run("sort=-qty").rows.map((r) => r.id)).toEqual(["3", "1", "2"]);
    expect(run("sort=status,-code").rows.map((r) => r.id)).toEqual(["3", "1", "2"]);
    const paged = applyLocalGridQuery(ROWS, { ...EMPTY_GRID_QUERY, sort: [{ field: "code", dir: "asc" }], page: 2, pageSize: 2 }, opts);
    expect(paged.rows.map((r) => r.id)).toEqual(["3"]);
    expect(paged.total).toBe(3);
    expect(sortRows([{ v: null }, { v: 1 }], [{ field: "v", dir: "asc" }], (r, f) => r[f as "v"]).map((r) => r.v)).toEqual([1, null]);
  });
});

describe("matchesFilter", () => {
  it("handles text operators and booleans", () => {
    expect(matchesFilter("Apex Threads", { field: "x", op: "ct", value: "thread" })).toBe(true);
    expect(matchesFilter("Apex Threads", { field: "x", op: "ew", value: "ADS" })).toBe(true);
    expect(matchesFilter("Apex", { field: "x", op: "sw", value: "pe" })).toBe(false);
    expect(matchesFilter("Apex", { field: "x", op: "eq", value: "apex" })).toBe(true);
    expect(matchesFilter(true, { field: "x", op: "bool", value: true })).toBe(true);
    expect(matchesFilter("abc", { field: "x", op: "rng", min: "1" })).toBe(false);
    expect(matchesFilter("not-a-date", { field: "x", op: "date", date: { kind: "fixed", preset: "today" } })).toBe(false);
  });
});
