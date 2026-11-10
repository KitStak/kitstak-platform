import { describe, expect, it } from "vitest";
import { statusLabel } from "@/lib/status-colors";
import { RECORD_SEARCH_TIMEOUT_MS, withTimeout } from "@/components/layout/search-utils";
import { internalTargetPath, trickle } from "@/components/layout/route-progress";
import { isTaskFinished, visibleTasks, type BackgroundTask } from "@/components/layout/transactions-tray";
import { supportMailto } from "@/components/layout/support-contact";
import { DATE_TIME_COLUMN_WIDTH, PRIORITY_COLUMN_WIDTH } from "@/components/grid/cells";
import { ACTIONS_COLUMN_WIDTH, EXPAND_COLUMN_WIDTH, actionsColumn, expandColumn } from "@/components/grid/data-grid-columns";
import { isGridRequest, orderGridParams } from "@/server/repositories/orders-grid";
import { breadcrumbsFor } from "@/config/route-registry";

describe("statusLabel (single casing source)", () => {
  it.each([
    ["Ready To Pick", "Ready to Pick"],
    ["ready to ship", "Ready to Ship"],
    ["Ready to Pick", "Ready to Pick"],
    ["On Hold", "On Hold"],
    ["Partially Shipped", "Partially Shipped"],
    ["EOD closed", "EOD Closed"],
  ])("%s → %s", (input, expected) => expect(statusLabel(input)).toBe(expected));
});

describe("record search timeout", () => {
  it("is 10 seconds and aborts with a TimeoutError", async () => {
    expect(RECORD_SEARCH_TIMEOUT_MS).toBe(10_000);
    const signal = withTimeout(undefined, 5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe("TimeoutError");
  });

  it("still aborts when the caller's signal aborts", () => {
    const controller = new AbortController();
    const signal = withTimeout(controller.signal, 60_000);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe("route progress", () => {
  const here = new URL("http://localhost:3000/dev/ui?x=1");
  it("starts only for in-app navigations to another pathname", () => {
    expect(internalTargetPath("/orders/SO010842", here)).toBe("/orders/SO010842");
    expect(internalTargetPath("/dev/ui?x=2", here)).toBeNull();
    expect(internalTargetPath("https://example.com/a", here)).toBeNull();
    expect(internalTargetPath("/api/files/1?download=1", here)).toBeNull();
  });
  it("trickles toward 90% and never reaches 100%", () => {
    let v = 0.08;
    for (let i = 0; i < 200; i += 1) v = trickle(v);
    expect(v).toBeLessThanOrEqual(0.9);
    expect(v).toBeGreaterThan(0.85);
  });
});

describe("transactions tray clear completed", () => {
  const task = (id: string, status: BackgroundTask["status"]): BackgroundTask => ({
    id, kind: "export", title: id, status, progress: 0, rowCount: null, errorMessage: null, fileId: null, fileName: null, createdAt: "2026-11-06T10:00:00Z", finishedAt: null,
  });
  it("hides cleared finished tasks but never running ones", () => {
    const tasks = [task("a", "completed"), task("b", "error"), task("c", "started")];
    expect(tasks.map(isTaskFinished)).toEqual([true, true, false]);
    expect(visibleTasks(tasks, new Set(["a", "b", "c"])).map((t) => t.id)).toEqual(["c"]);
  });
});

describe("support contact", () => {
  it("builds an encoded mailto", () => {
    expect(supportMailto("help@x.io")).toBe("mailto:help@x.io?subject=KitStak%20support");
  });
});

describe("grid system column widths", () => {
  it("fit their 24px controls with px-1 and never clip", () => {
    expect(EXPAND_COLUMN_WIDTH).toBe(40);
    expect(ACTIONS_COLUMN_WIDTH).toBe(44);
    const expand = expandColumn<unknown>();
    const actions = actionsColumn<unknown>(() => []);
    expect(expand.minSize).toBe(40);
    expect(actions.minSize).toBe(44);
    expect(expand.meta).toMatchObject({ cellPadding: "px-1", clip: false });
    expect(actions.meta).toMatchObject({ cellPadding: "px-1", clip: false, justify: "center", sticky: "right" });
    expect(DATE_TIME_COLUMN_WIDTH).toBeGreaterThanOrEqual(172);
    expect(PRIORITY_COLUMN_WIDTH).toBeGreaterThanOrEqual(104);
  });
});

describe("/api/orders grid grammar", () => {
  it("detects grammar requests and leaves legacy ones alone", () => {
    expect(isGridRequest(new URLSearchParams("ps=100&tab=backlog"))).toBe(true);
    expect(isGridRequest(new URLSearchParams("f.status=in:Open"))).toBe(true);
    expect(isGridRequest(new URLSearchParams("page=1&pageSize=50&search=SO"))).toBe(false);
  });
  it("compiles search, filters and sort", () => {
    const p = orderGridParams(new URLSearchParams("q=SO01&qm=sw&f.status=in:Open,Shortage&sort=-salesPrice,code&ps=300"));
    expect(p.query.pageSize).toBe(300);
    expect(p.where).toBeDefined();
    expect(p.orderBy).toHaveLength(2);
  });
  it("rejects unknown filter and sort fields", () => {
    expect(() => orderGridParams(new URLSearchParams("f.bogus=eq:1"))).toThrow(/Unknown filter field/);
    expect(() => orderGridParams(new URLSearchParams("sort=firstSku"))).toThrow(/Cannot sort/);
  });
});

describe("breadcrumbs from nav-config", () => {
  it("record, list and 404 trails share Fulfillment › Shipment Orders", () => {
    expect(breadcrumbsFor("/orders").map((c) => c.label)).toEqual(["Fulfillment", "Shipment Orders"]);
    expect(breadcrumbsFor("/orders/SO010842", "SO010842").map((c) => c.label)).toEqual(["Fulfillment", "Shipment Orders", "SO010842"]);
    expect(breadcrumbsFor("/orders/nope", "Not found").map((c) => c.label)).toEqual(["Fulfillment", "Shipment Orders", "Not found"]);
  });
});
