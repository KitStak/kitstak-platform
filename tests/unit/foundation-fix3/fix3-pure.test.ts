import { describe, expect, it } from "vitest";
import { pickMostVisibleSection, visibleHeight } from "@/app/(app)/dev/ui/_components/showcase-nav";
import { GOTO_SHORTCUTS, STATIC_SHORTCUTS, WHATS_NEW } from "@/components/layout/help-content";
import { gotoTarget } from "@/components/layout/goto-shortcuts";
import { withIntrinsicSize, renderBarcodeSvg } from "@/components/ui/barcode";
import { BRAND_NAME, PRODUCT_NAME } from "@/config/brand";
import { formatGridDateTime, gridDateTimePattern } from "@/lib/format";
import { documentStatusFor, isDocumentRequest, matchRecordGate, type RecordGate } from "@/server/http/status-gates";

describe("barcode intrinsic size", () => {
  it("copies the viewBox size onto the root svg", () => {
    const svg = '<svg viewBox="0 0 202 83" xmlns="http://www.w3.org/2000/svg"><path stroke-width="4"/></svg>';
    expect(withIntrinsicSize(svg)).toBe('<svg width="202" height="83" viewBox="0 0 202 83" xmlns="http://www.w3.org/2000/svg"><path stroke-width="4"/></svg>');
  });

  it("leaves an svg that already has a width (or no viewBox) unchanged", () => {
    const sized = '<svg width="10" viewBox="0 0 202 83"></svg>';
    expect(withIntrinsicSize(sized)).toBe(sized);
    expect(withIntrinsicSize("<svg></svg>")).toBe("<svg></svg>");
  });

  it("renders bwip-js output with a real width", () => {
    const { svg } = renderBarcodeSvg({ value: "SO010421" });
    expect(svg).toMatch(/^<svg width="\d+(\.\d+)?" height="\d+(\.\d+)?"/);
  });
});

describe("grid date-time format", () => {
  it("drops seconds and pads month/day so the column is fixed width", () => {
    expect(gridDateTimePattern("M/D/YYYY h:mm:ss A")).toBe("MM/DD/YYYY h:mm A");
    expect(gridDateTimePattern("DD.MM.YYYY HH:mm:ss")).toBe("DD.MM.YYYY HH:mm");
    expect(gridDateTimePattern("MMM D, YYYY h:mm A")).toBe("MMM DD, YYYY h:mm A");
  });

  it("formats with the user's 12h/24h preference", () => {
    const at = new Date(2026, 10, 5, 8, 49, 7);
    expect(formatGridDateTime(at)).toBe("11/05/2026 8:49 AM");
    expect(formatGridDateTime(at, { dateFormat: "M/D/YYYY h:mm:ss A", timeFormat: "24h", numberFormat: "1,025.00" })).toBe("11/05/2026 08:49");
  });
});

describe("status gates", () => {
  const gate = (existing: readonly string[]): RecordGate => ({ pattern: /^\/orders\/([^/]+)\/?$/, exists: async (key) => existing.includes(key) });

  it("maps record routes to keys and skips sibling pages", () => {
    expect(matchRecordGate("/orders/SO010840", [gate([])])?.key).toBe("SO010840");
    expect(matchRecordGate("/orders/new", [gate([])])).toBeNull();
    expect(matchRecordGate("/orders", [gate([])])).toBeNull();
    expect(matchRecordGate("/orders/a/b", [gate([])])).toBeNull();
  });

  it("returns 403 for /forbidden and 404 only for missing records", async () => {
    const gates = [gate(["SO010840"])];
    expect(await documentStatusFor("/forbidden", gates)).toBe(403);
    expect(await documentStatusFor("/orders/999999999", gates)).toBe(404);
    expect(await documentStatusFor("/orders/SO010840", gates)).toBeNull();
    expect(await documentStatusFor("/dashboard", gates)).toBeNull();
  });

  it("never blocks the page when the lookup fails", async () => {
    const broken: RecordGate = { pattern: /^\/orders\/([^/]+)$/, exists: async () => Promise.reject(new Error("db busy")) };
    expect(await documentStatusFor("/orders/x", [broken])).toBeNull();
  });

  it("gates document loads only, not client-router RSC fetches", () => {
    expect(isDocumentRequest("GET", new Headers())).toBe(true);
    expect(isDocumentRequest("GET", new Headers({ rsc: "1" }))).toBe(false);
    expect(isDocumentRequest("GET", new Headers({ "next-router-prefetch": "1" }))).toBe(false);
    expect(isDocumentRequest("POST", new Headers())).toBe(false);
  });
});

describe("showcase scroll-spy", () => {
  it("measures the section's visible height under the sticky header", () => {
    expect(visibleHeight({ key: "forms", top: -494, bottom: 58 }, 900)).toBe(0);
    expect(visibleHeight({ key: "wizard", top: 82, bottom: 849 }, 900)).toBe(767);
  });

  it("highlights the section that occupies the most screen", () => {
    const rects = [
      { key: "forms", top: -300, bottom: 260 },
      { key: "wizard", top: 284, bottom: 1050 },
    ] as const;
    expect(pickMostVisibleSection(rects, 900)).toBe("wizard");
    expect(pickMostVisibleSection([{ key: "forms", top: -100, bottom: 700 }, { key: "wizard", top: 724, bottom: 1500 }], 900)).toBe("forms");
  });
});

describe("help content", () => {
  it("lists every goto shortcut with a unique key and a resolvable target", () => {
    const keys = GOTO_SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["d", "o", "i", "p", "r", "j"]));
    for (const s of GOTO_SHORTCUTS) expect(gotoTarget(s.key)).toBe(s.href);
    expect(STATIC_SHORTCUTS.filter((s) => s.group === "Navigation")).toHaveLength(GOTO_SHORTCUTS.length);
    expect(STATIC_SHORTCUTS.some((s) => s.group === "Grids")).toBe(true);
  });

  it("dates and versions every What's new entry", () => {
    for (const entry of WHATS_NEW) {
      expect(entry.date).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      expect(entry.version).toMatch(/^v\d+\.\d+/);
    }
  });
});

describe("brand", () => {
  it("uses one product name", () => {
    expect(BRAND_NAME).toBe("KitStak");
    expect(PRODUCT_NAME).toBe("KitStak WMS");
  });
});
