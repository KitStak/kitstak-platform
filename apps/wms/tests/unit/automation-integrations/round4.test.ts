import { describe, expect, it } from "vitest";
import { healthStatus } from "@/lib/grid-defs/integrations/monitoring";
import { servedClientOptions } from "@/lib/grid-defs/integrations/rate-shopping";
import { brandMarkSvg } from "@/components/integrations/shared/brand-marks";
import { CARRIERS, CHANNELS } from "@/lib/channel-catalog";

describe("healthStatus", () => {
  it("shows an active method that cannot run as Paused with the reason", () => {
    expect(healthStatus("Active", "No credentials stored — reconnect the store")).toEqual({ downloadStatus: "Paused", pauseReason: "No credentials stored — reconnect the store" });
  });
  it("keeps Active when runnable and Passive regardless of reason", () => {
    expect(healthStatus("Active", null)).toEqual({ downloadStatus: "Active", pauseReason: null });
    expect(healthStatus("Passive", "The store connection is inactive")).toEqual({ downloadStatus: "Passive", pauseReason: null });
  });
});

describe("servedClientOptions", () => {
  const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }];
  it("hides nothing while loading", () => {
    expect(servedClientOptions(opts, null)).toEqual({ options: opts, hidden: 0 });
  });
  it("narrows to served clients and counts the hidden ones", () => {
    const r = servedClientOptions(opts, [{ id: "b", serviceCount: 4 }]);
    expect(r.options.map((o) => o.value)).toEqual(["b"]);
    expect(r.hidden).toBe(2);
  });
  it("keeps the currently selected client", () => {
    expect(servedClientOptions(opts, [], "c").options.map((o) => o.value)).toEqual(["c"]);
  });
});

describe("brand marks", () => {
  it("draws a distinct tile for every channel and every carrier", () => {
    for (const list of [CHANNELS, CARRIERS]) {
      const marks = list.map((e) => brandMarkSvg(e.kind, e.key, e.logoSvg));
      expect(new Set(marks).size).toBe(list.length);
      for (const [i, e] of list.entries()) expect(marks[i], e.key).not.toBe(e.logoSvg);
    }
  });
});
