/** M04 round 3: Items-step qty/checkbox sync, station start reasons, default picks, bulk return info patch + DB update. */
import { describe, expect, it } from "vitest";
import { lineEdit, type RmaLineValue } from "@/components/returns/rma-form";
import { defaultPick, stationStartReason } from "@/components/returns/return-station-model";
import { bulkInfoPayload } from "@/components/returns/bulk-return-info-modal";
import { returnInfoPatch } from "@/server/repositories/returns";

const line: RmaLineValue = { orderLineId: "ol1", selected: false, quantity: null, reasonId: null };

describe("Create RMA Items step: qty and checkbox stay in sync", () => {
  it("checking fills the full returnable qty, unchecking clears it", () => {
    const on = lineEdit(line, 2, { selected: true });
    expect(on).toMatchObject({ selected: true, quantity: 2 });
    expect(lineEdit(on, 2, { selected: false })).toMatchObject({ selected: false, quantity: null });
  });
  it("typing a qty above 0 selects the line; 0 or empty deselects it", () => {
    expect(lineEdit(line, 5, { quantity: 3 })).toMatchObject({ selected: true, quantity: 3 });
    expect(lineEdit({ ...line, selected: true, quantity: 3 }, 5, { quantity: 0 })).toMatchObject({ selected: false, quantity: null });
    expect(lineEdit({ ...line, selected: true, quantity: 3 }, 5, { quantity: null })).toMatchObject({ selected: false });
  });
  it("re-checking keeps a qty already typed", () => {
    expect(lineEdit({ ...line, quantity: 1 }, 4, { selected: true }).quantity).toBe(1);
  });
});

describe("Return Station start cards", () => {
  const base = { permLoading: false, canReceive: true, warehouseId: "w", stationId: "s", stationsLoading: false };
  it("names the missing input before any permission message", () => {
    expect(stationStartReason({ ...base, warehouseId: null, canReceive: false })).toBe("Choose a receiving warehouse and return station");
    expect(stationStartReason({ ...base, stationId: null, canReceive: false })).toBe("Choose a return station");
    expect(stationStartReason({ ...base, stationId: null, stationsLoading: true })).toMatch(/Loading/);
  });
  it("shows the permission message only to users who lack execute_task once loaded", () => {
    expect(stationStartReason({ ...base, permLoading: true, canReceive: false })).toMatch(/Checking/);
    expect(stationStartReason({ ...base, canReceive: false })).toMatch(/Receive Return permission/);
    expect(stationStartReason(base)).toBeNull();
  });
  it("defaults to the remembered/context option, else the first", () => {
    const opts = [{ id: "a" }, { id: "b" }];
    expect(defaultPick(opts, "b")?.id).toBe("b");
    expect(defaultPick(opts, "zzz", null, "b")?.id).toBe("b");
    expect(defaultPick(opts, null)?.id).toBe("a");
    expect(defaultPick([], "a")).toBeNull();
  });
});

describe("Bulk Update Return Info", () => {
  it("client sends only ticked fields; a ticked empty field clears", () => {
    expect(bulkInfoPayload({ trackingNumber: true, note: true }, { trackingNumber: " 1Z9 ", note: "  ", carrierCode: "UPS" })).toEqual({ trackingNumber: "1Z9", note: null });
    expect(bulkInfoPayload({}, { carrierCode: "UPS" })).toEqual({});
  });
  it("server patch keeps omitted fields and maps empty strings to null", () => {
    expect(returnInfoPatch({ carrierCode: "UPS", trackingNumber: "", note: undefined })).toEqual({ carrierCode: "UPS", trackingNumber: null });
  });
});
