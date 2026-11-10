/** M13 round 4 parity loop (critic round 3): snapshot dedupe, utilization presentation, drilldowns, analytics flags. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { snapshotWarehouse } from "@/server/scheduler/tasks/snapshot";
import { EMPTY_GRID_QUERY, parseGridQuery, type GridQuery } from "@/server/query/grid-query";
import { classifySnapshotRuns, listSnapshot, missingSnapshotDays, snapshotCoverage } from "@/server/repositories/reports-inventory";
import { listUtilization, utilizationSummary } from "@/server/repositories/reports-analysis";
import { channelSalesOrdersHref } from "@/server/repositories/reports-orders";
import { EXPORT_SOURCE_PAGES, exportSourceHref } from "@/server/repositories/reports-logs";
import { addFact, bucketConfidence, emptyArea, MIN_BUCKET_TASKS } from "@/server/repositories/analytics-operational";
import { dashboardDays, unfulfilledAgeBuckets } from "@/server/repositories/dashboard-live";
import { capacitySourceOf, formatUtilizationPct, UTILIZATION_BANDS, UTILIZATION_DEF } from "@/lib/grid-defs/reports/analysis";
import { SNAPSHOT_DEF, SNAPSHOT_DEFAULT_FILTER } from "@/lib/grid-defs/reports/inventory";
import { CHANGE_LOG_DEF, EXPORT_HISTORY_DEF } from "@/lib/grid-defs/reports/logs";
import { REPORT_CATALOG } from "@/lib/grid-defs/reports/catalog";
import { headerLabelWidth } from "@/components/reports/report-cells";
import { createWorld, type World } from "../foundation/domain/fixtures";

describe("snapshot runs", () => {
  const NY = "America/New_York";
  it("stamps each run with its warehouse-local business day and keeps one run per day", () => {
    const runs = classifySnapshotRuns([
      { warehouseId: "A", snapshotAt: "2026-11-05T05:02:00.000Z", timezone: NY },
      // Late catch-up for 11/09 (20:58 local), then the regular 11/10 run.
      { warehouseId: "A", snapshotAt: "2026-11-10T01:58:34.364Z", timezone: NY },
      { warehouseId: "A", snapshotAt: "2026-11-10T05:02:39.409Z", timezone: NY },
      // Same business day run twice: the later run wins.
      { warehouseId: "A", snapshotAt: "2026-11-10T07:00:00.000Z", timezone: NY },
      { warehouseId: "B", snapshotAt: "2026-11-10T06:02:00.000Z", timezone: "Bad/Zone" },
    ]);
    const byAt = new Map(runs.map((r) => [r.snapshotAt, r]));
    expect(byAt.get("2026-11-10T01:58:34.364Z")).toMatchObject({ businessDate: "2026-11-09", superseded: false, latest: false });
    expect(byAt.get("2026-11-10T05:02:39.409Z")).toMatchObject({ businessDate: "2026-11-10", superseded: true });
    expect(byAt.get("2026-11-10T07:00:00.000Z")).toMatchObject({ businessDate: "2026-11-10", superseded: false, latest: true });
    expect(byAt.get("2026-11-10T06:02:00.000Z")).toMatchObject({ businessDate: "2026-11-10", latest: true });
    expect(missingSnapshotDays(runs, "A")).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(missingSnapshotDays(runs, "B")).toEqual([]);
  });

  it("defaults to the latest snapshot and exposes a Snapshot Day field", () => {
    expect(SNAPSHOT_DEFAULT_FILTER).toBe("f.latest=bool:true");
    expect(SNAPSHOT_DEF.fields.map((f) => f.field)).toEqual(expect.arrayContaining(["latest", "businessDate", "snapshotAt"]));
    expect(SNAPSHOT_DEF.defaultSort[0]).toBe("-businessDate");
  });
});

describe("snapshot report on the DB", () => {
  let w: World;
  let auth: AuthContext;
  const q = (qs = ""): GridQuery => ({ ...EMPTY_GRID_QUERY, ...parseGridQuery(qs).query, pageSize: 500 });
  beforeEach(() => {
    w = createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  it("never double counts a bucket when a night ran twice, and the latest chip shows one run", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 7 });
    // Chicago: 11/08 run, then two runs on 11/09 (catch-up + regular), then 11/10.
    for (const at of ["2026-11-08T06:02:00.000Z", "2026-11-09T07:30:00.000Z", "2026-11-10T03:00:00.000Z", "2026-11-10T06:02:00.000Z"]) snapshotWarehouse(w.db, w.warehouseId, at);
    const all = listSnapshot(w.db, auth, q());
    // 4 runs, but 11/09 has two: 3 business days × 1 bucket.
    expect(all.total).toBe(3);
    expect(new Set(all.rows.map((r) => r.businessDate))).toEqual(new Set(["2026-11-08", "2026-11-09", "2026-11-10"]));
    const latest = listSnapshot(w.db, auth, q(SNAPSHOT_DEFAULT_FILTER));
    expect(latest.total).toBe(1);
    expect(latest.rows[0]).toMatchObject({ businessDate: "2026-11-10", snapshotAt: "2026-11-10T06:02:00.000Z", uomQty: 7 });
    expect(listSnapshot(w.db, auth, q("f.businessDate=date:custom:2026-11-09..2026-11-09")).rows.map((r) => r.snapshotAt)).toEqual(["2026-11-10T03:00:00.000Z"]);
    const cov = snapshotCoverage(w.db, auth);
    expect(cov).toHaveLength(1);
    expect(cov[0]).toMatchObject({ latestDay: "2026-11-10", days: 3, missingDays: [] });
  });

  it("returns an empty page (not an error) with no snapshots and out of scope", () => {
    expect(listSnapshot(w.db, auth, q(SNAPSHOT_DEFAULT_FILTER)).total).toBe(0);
    snapshotWarehouse(w.db, w.warehouseId, "2026-11-10T06:02:00.000Z");
    const other = { warehouseIds: ["nope"], clientIds: "all" as const };
    expect(listSnapshot(w.db, { ...auth, viewScope: other } as AuthContext, q()).total).toBe(0);
  });

  it("labels the capacity source, flags estimates and summarises the bands", () => {
    w.db.update(schema.locations).set({ capacityUnits: 10, maxCapacityQty: 0 }).run();
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 12 });
    const row = listUtilization(w.db, auth, q()).rows.find((r) => r.rowId === w.loc.storageA);
    expect(row).toMatchObject({ capacitySource: "Legacy Capacity Units (estimate)", estimated: 1, band: "Over Capacity" });
    expect(listUtilization(w.db, auth, q("f.estimated=bool:false")).total).toBe(0);
    const s = utilizationSummary(w.db, auth);
    expect(s.bands.map((b) => b.band)).toEqual([...UTILIZATION_BANDS]);
    expect(s.bands.reduce((a, b) => a + b.count, 0)).toBe(s.total);
    expect(s.total).toBe(listUtilization(w.db, auth, q()).total);
    expect(s.estimated).toBe(s.total);
  });
});

describe("utilization presentation helpers", () => {
  it("names the capacity source that produced the number", () => {
    expect(capacitySourceOf(50, 240)).toBe("Max Capacity Qty");
    expect(capacitySourceOf(0, 240)).toBe("Legacy Capacity Units (estimate)");
    expect(capacitySourceOf(null, 0)).toBe("Not Set");
  });
  it("formats utilization as a percent", () => {
    expect(formatUtilizationPct(1240)).toBe("1,240 %");
    expect(formatUtilizationPct(85.54)).toBe("85.5 %");
    expect(formatUtilizationPct(null)).toBe("—");
  });
  it("puts the utilization bar and band next to the location", () => {
    expect(UTILIZATION_DEF.columns.slice(0, 3).map((c) => c.id)).toEqual(["location", "utilizationPct", "band"]);
    expect(UTILIZATION_DEF.columns.find((c) => c.id === "capacityType")?.defaultHidden).toBe(true);
  });
});

describe("drilldowns and links", () => {
  it("Channel Sales orders drilldown carries the store so the opened total equals the cell", () => {
    const href = channelSalesOrdersHref({ warehouseId: "w1", clientId: "c1", sku: "SKU 1&2", channel: "Shopify", storeName: "Main, East" });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/orders/shipped?")).toBe(true);
    expect(params.get("f.storeName")).toBe("eq:Main, East");
    expect(params.get("f.sku")).toBe("eq:SKU 1&2");
    expect(params.get("f.channel")).toBe("in:Shopify");
    const blank = new URLSearchParams(channelSalesOrdersHref({ warehouseId: "w1", clientId: "c1", sku: "A", channel: null, storeName: null }).split("?")[1]);
    expect(blank.get("f.storeName")).toBe("empty");
    expect(blank.has("f.channel")).toBe(false);
  });

  it("every export type links back to its grid, including Receiving History and the analysis reports", () => {
    expect(exportSourceHref("receiving-history", "f.status=in:Completed&page=3")).toBe("/receiving/history?f.status=in%3ACompleted");
    for (const k of ["purchase-orders", "report-inventory-aging", "report-location-utilization", "tasks-count", "vendors"]) expect(EXPORT_SOURCE_PAGES[k]).toMatch(/^\//);
    expect(EXPORT_SOURCE_PAGES["tasks-count"]).toBe("/tasks/count");
  });

  it("dashboard order-age buckets are disjoint and exhaustive", () => {
    const now = new Date("2026-11-10T15:00:00Z");
    const days = dashboardDays("America/New_York", now);
    expect(days.day(-1)).toBe("2026-11-09");
    expect(unfulfilledAgeBuckets(days).map((b) => b.date)).toEqual([
      "date:custom:2026-11-10T05:00:00.000Z..",
      "date:custom:2026-11-08T05:00:00.000Z..2026-11-10T04:59:59.999Z",
      "date:custom:2026-11-04T05:00:00.000Z..2026-11-08T04:59:59.999Z",
      "date:custom:..2026-11-04T04:59:59.999Z",
    ]);
  });
});

describe("grid layout at 1440", () => {
  const visibleWidth = (cols: readonly { width?: number; defaultHidden?: boolean }[], upTo: number) =>
    cols.slice(0, upTo + 1).filter((c) => !c.defaultHidden).reduce((a, c) => a + (c.width ?? 140), 0);
  it("Export History keeps Row Count clear of the sticky row menu", () => {
    const idx = EXPORT_HISTORY_DEF.columns.findIndex((c) => c.id === "rowCount");
    expect(idx).toBeLessThan(EXPORT_HISTORY_DEF.columns.findIndex((c) => c.id === "createdAt"));
    // 1440 viewport − page gutters (48) − sticky kebab (44).
    expect(visibleWidth(EXPORT_HISTORY_DEF.columns, idx)).toBeLessThan(1440 - 48 - 44);
  });
  it("Change Log From / To columns fit typical status values", () => {
    for (const id of ["fromValue", "toValue"]) expect(CHANGE_LOG_DEF.columns.find((c) => c.id === id)?.width ?? 0).toBeGreaterThanOrEqual(170);
  });
  it("header label room accounts for the info icon", () => {
    expect(headerLabelWidth(150, true)).toBe(80);
    expect(headerLabelWidth(150, false)).toBe(98);
  });
});

describe("analytics", () => {
  it("applies the low-confidence rule per area × shift bucket", () => {
    const a = emptyArea();
    for (let i = 0; i < 20; i += 1) addFact(a, { qty: 4, mins: 6, measured: true }, "day");
    addFact(a, { qty: 40, mins: 0.2, measured: true }, "off");
    addFact(a, { qty: 40, mins: 0.2, measured: true }, "off");
    expect(bucketConfidence("Kitting", a.byShift.day)).toBe("Normal");
    expect(bucketConfidence("Kitting", a.byShift.off)).toMatch(/^Low timing confidence/);
    const few = emptyArea();
    for (let i = 0; i < MIN_BUCKET_TASKS - 1; i += 1) addFact(few, { qty: 2, mins: 5, measured: true }, "off");
    expect(bucketConfidence("Picking", few.byShift.off)).toMatch(/^Low sample/);
    expect(bucketConfidence("Replenishment", a.byShift.day)).toMatch(/^Bulk moves/);
  });

  it("the Inventory Analysis hub group has its own icon", () => {
    const g = REPORT_CATALOG.find((x) => x.heading === "Inventory Analysis");
    if (g) expect(g.icon).not.toBe(REPORT_CATALOG[0]?.icon);
  });
});

describe("Reports mega-menu parity", () => {
  it("lists Logiwa's 21 report links, Shipment History, ATP and Receiving History included", async () => {
    const { NAV_MENUS } = await import("@/config/nav-config");
    const menu = NAV_MENUS.find((m) => m.key === "reports");
    const hrefs = (menu?.columns ?? []).flatMap((c) => c.items.map((i) => i.href));
    expect(hrefs).toEqual(expect.arrayContaining(["/shipments/history", "/inventory/atp", "/receiving/history", "/reports/channel-sales", "/jobs/shortage"]));
    expect(hrefs.length).toBeGreaterThanOrEqual(21);
  });
});
