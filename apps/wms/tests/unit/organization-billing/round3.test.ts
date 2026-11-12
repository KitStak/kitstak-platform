/** M11 round 3: client SSCC serialization defaults and locale-driven billing day formatting. */
import { describe, expect, it } from "vitest";
import { dayValue } from "@/lib/grid-defs/organization/billing";
import { readSscc } from "@/lib/grid-defs/organization/clients";
import { createFormatter } from "@/lib/format";

describe("readSscc", () => {
  it("returns blank strings when settings carry no sscc (detail never crashes)", () => {
    expect(readSscc(null)).toEqual({ extensionDigit: "", gs1CompanyPrefix: "", serialNumber: "" });
    expect(readSscc({ inbound: {} })).toEqual({ extensionDigit: "", gs1CompanyPrefix: "", serialNumber: "" });
  });
  it("stringifies stored values", () => {
    expect(readSscc({ sscc: { extensionDigit: 1, gs1CompanyPrefix: "0614141", serialNumber: 42 } })).toEqual({ extensionDigit: "1", gs1CompanyPrefix: "0614141", serialNumber: "42" });
  });
});

describe("dayValue", () => {
  it("keeps the calendar day in the user's date pattern", () => {
    const f = createFormatter({ dateFormat: "M/D/YYYY h:mm A" });
    expect(f.date(dayValue("2026-10-01"))).toBe("10/1/2026");
    expect(f.date(dayValue("2026-10-31T00:00:00.000Z"))).toBe("10/31/2026");
  });
  it("is null for blanks", () => {
    expect(dayValue(null)).toBeNull();
    expect(dayValue("")).toBeNull();
  });
});
