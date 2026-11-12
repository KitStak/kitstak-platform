import { describe, expect, it } from "vitest";
import { volumeShape } from "@/lib/grid-defs/integrations/monitoring";

const days = (pairs: readonly [number, number][]) => pairs.map(([channel, kitstaks]) => ({ channel, kitstaks }));

describe("volumeShape", () => {
  it("reports no activity for an all-zero series", () => {
    const s = volumeShape(days(Array.from({ length: 14 }, () => [0, 0] as [number, number])));
    expect(s).toMatchObject({ activeDays: 0, sparse: false, channelTotal: 0, kitstaksTotal: 0, yMax: 4 });
  });
  it("flags a single spike as sparse and keeps a floor on the y-axis", () => {
    const s = volumeShape(days([...Array.from({ length: 13 }, () => [0, 0] as [number, number]), [2, 1]]));
    expect(s).toMatchObject({ activeDays: 1, sparse: true, channelTotal: 2, kitstaksTotal: 1, yMax: 4 });
  });
  it("treats a populated series as dense with headroom over the peak", () => {
    const s = volumeShape(days([[10, 9], [20, 20], [5, 4], [40, 38]]));
    expect(s.sparse).toBe(false);
    expect(s.activeDays).toBe(4);
    expect(s.yMax).toBe(50);
    expect(s.yTicks).toEqual([0, 10, 20, 30, 40, 50]);
  });
});
