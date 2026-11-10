/** M04 round 4: pack-mode URL aliases, station code alias, deterministic Create RMA progress. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { canonicalPackMode } from "@/components/packing/pack-types";
import { rmaProgress } from "@/components/returns/rma-form";
import type { Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { loadStation } from "@/server/repositories/packing-scan";
import { createWorld } from "../foundation/domain/fixtures";

describe("pack-mode URL aliases", () => {
  it("keeps real modes and maps aliases instead of a 404", () => {
    expect(canonicalPackMode("tote")).toBe("tote");
    expect(canonicalPackMode("PUTWALL")).toBe("putwall");
    expect(canonicalPackMode("list")).toBe("order");
    expect(canonicalPackMode("cart")).toBe("putwall");
    expect(canonicalPackMode("mobile-cart")).toBe("putwall");
    expect(canonicalPackMode("whatever")).toBe("tote");
  });
});

describe("packing station by code (DB)", () => {
  it("resolves a station code in the user's warehouses and still 404s outside scope", () => {
    const w = createWorld();
    const pack = w.db.select().from(schema.locations).where(eq(schema.locations.id, w.loc.pack)).get();
    expect(pack).toBeTruthy();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" } as unknown as Scope;
    expect(loadStation(w.db, scope, w.loc.pack).id).toBe(w.loc.pack);
    expect(loadStation(w.db, scope, pack!.code.toLowerCase()).id).toBe(w.loc.pack);
    const none = { warehouseIds: [], clientIds: "all" } as unknown as Scope;
    expect(() => loadStation(w.db, none, pack!.code)).toThrow(/not found/i);
    expect(() => loadStation(w.db, scope, "NO-SUCH-STATION")).toThrow(/not found/i);
  });
});

describe("Create RMA progress ring is tied to completed steps", () => {
  const sel = [{ orderLineId: "l", selected: true, quantity: 1, reasonId: null }];
  it("never shows progress before a step is passed, whatever loads first", () => {
    expect(rmaProgress({ orderId: "", lines: [] }, { orderEligible: false, reachedStep: 0 }).percent).toBe(0);
    expect(rmaProgress({ orderId: "o", lines: sel }, { orderEligible: true, reachedStep: 0 }).percent).toBe(33);
    expect(rmaProgress({ orderId: "o", lines: sel }, { orderEligible: true, reachedStep: 1 }).percent).toBe(67);
    expect(rmaProgress({ orderId: "o", lines: sel }, { orderEligible: true, reachedStep: 2 }).percent).toBe(100);
  });
});
