/**
 * Blind-judge repair round 1 (M12): nested AND/OR workflow condition groups, relative date
 * presets in workflow conditions, and honest "Live API" vs Beta catalog badges.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { channelSettingsSchema, isConditionGroup, ruleConditionNodeSchema, type RuleConditionNode } from "@/lib/domain-types";
import { evaluateConditionNode, evaluateConditions, matchesDateSpec } from "@/server/domain/conditions";
import { conditionLeaves, describeConditionNode, DATE_PRESETS } from "@/lib/grid-defs/integrations/rule-fields";
import { workflowSaveSchema } from "@/lib/grid-defs/integrations/workflows";
import { verifiedLiveProviders } from "@/server/repositories/channels";
import { createWorld, type World } from "../foundation/domain/fixtures";

const us = { field: "shipCountry", comparator: "equals" as const, value: "US" };
const ups = { field: "carrier", comparator: "equals" as const, value: "UPS" };
const fedex = { field: "carrier", comparator: "equals" as const, value: "FedEx" };
const tree: RuleConditionNode[] = [us, { group: "Any", conditions: [ups, fedex] }];

describe("nested condition groups", () => {
  it("evaluates A AND (B OR C)", () => {
    expect(evaluateConditions(tree, { shipCountry: "US", carrier: "FedEx" }, "All")).toBe(true);
    expect(evaluateConditions(tree, { shipCountry: "US", carrier: "DHL" }, "All")).toBe(false);
    expect(evaluateConditions(tree, { shipCountry: "CA", carrier: "UPS" }, "All")).toBe(false);
  });
  it("evaluates A OR (B AND C) and a single group node", () => {
    const anyTree: RuleConditionNode[] = [us, { group: "All", conditions: [ups, { field: "isPrime", comparator: "equals", value: true }] }];
    expect(evaluateConditions(anyTree, { shipCountry: "CA", carrier: "UPS", isPrime: true }, "Any")).toBe(true);
    expect(evaluateConditions(anyTree, { shipCountry: "CA", carrier: "UPS", isPrime: false }, "Any")).toBe(false);
    expect(evaluateConditionNode({ group: "Any", conditions: [ups, fedex] }, { carrier: "ups" })).toBe(true);
  });
  it("keeps flat lists working and validates groups", () => {
    expect(evaluateConditions([us], { shipCountry: "US" })).toBe(true);
    expect(isConditionGroup(tree[1] as RuleConditionNode)).toBe(true);
    expect(isConditionGroup(us)).toBe(false);
    expect(ruleConditionNodeSchema.safeParse({ group: "Any", conditions: [] }).success).toBe(false);
    expect(ruleConditionNodeSchema.safeParse(tree[1]).success).toBe(true);
  });
  it("describes and counts groups", () => {
    expect(describeConditionNode("order", tree[1] as RuleConditionNode)).toMatch(/^\(.+ OR .+\)$/);
    expect(conditionLeaves(tree)).toHaveLength(3);
  });
  it("workflow save schema accepts groups and checks fields inside them", () => {
    const base = { name: "Nested", trigger: "Shipment Order Created", match: "All", isActive: true, stopProcessing: false, actions: [{ action: "Add Tag", params: { tag: "x" } }] };
    const ok = workflowSaveSchema.safeParse({ ...base, conditions: [{ field: "orderDate", comparator: "dateIs", value: "last7d" }, { group: "Any", conditions: [{ field: "orderDate", comparator: "dateIs", value: "withinNext3d" }, { field: "orderDate", comparator: "isEmpty", value: null }] }] });
    expect(ok.success).toBe(true);
    const bad = workflowSaveSchema.safeParse({ ...base, conditions: [{ group: "Any", conditions: [{ field: "noSuchField", comparator: "equals", value: "x" }] }] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.some((i) => i.path.join(".") === "conditions.0.conditions.0.field")).toBe(true);
  });
});

describe("relative date presets in rule conditions", () => {
  it("offers Logiwa's 17 presets and resolves them at run time", () => {
    expect(DATE_PRESETS.map((p) => p.key)).toEqual(expect.arrayContaining(["today", "last3d", "last7d", "last30d", "last90d", "last12m", "ahead", "before", "withinNext", "withinPast", "mon", "sun"]));
    const now = new Date("2026-11-10T15:00:00Z");
    expect(matchesDateSpec("2026-11-10", "today", now)).toBe(true);
    expect(matchesDateSpec("2026-11-05", "last7d", now)).toBe(true);
    expect(matchesDateSpec("2026-10-01", "last7d", now)).toBe(false);
    expect(matchesDateSpec("2026-11-12", "withinNext3d", now)).toBe(true);
    expect(matchesDateSpec("2026-11-20", "ahead5d", now)).toBe(true);
    expect(matchesDateSpec("2026-11-01", "before5d", now)).toBe(true);
  });
});

describe("honest live badges", () => {
  let w: World;
  beforeEach(async () => { w = await createWorld(); });
  afterEach(() => w.close());

  it("a live adapter is verified only after a credentialed, non-sandbox store succeeds", async () => {
    const settings = channelSettingsSchema.parse({});
    const demo = (await w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "Demo", clientId: w.clientId, distribution: "Custom App", status: "Completed", settings }).returning())[0];
    const m = (await w.db.insert(schema.channelMethods).values({ connectionId: demo.id, method: "Download Orders", status: "Active", intervalMinutes: 15 }).returning())[0];
    await w.db.insert(schema.channelRuns).values({ methodId: m.id, connectionId: demo.id, method: "Download Orders", status: "Successful", successCount: 3, totalCount: 3, startedAt: "2026-11-10T00:00:00Z" });
    expect((await verifiedLiveProviders(w.db)).channels.has("shopify")).toBe(false);

    const live = (await w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "Live", clientId: w.clientId, distribution: "Custom App", status: "Completed", settings, credentialsEnc: "enc" }).returning())[0];
    const m2 = (await w.db.insert(schema.channelMethods).values({ connectionId: live.id, method: "Download Orders", status: "Active", intervalMinutes: 15 }).returning())[0];
    await w.db.insert(schema.channelRuns).values({ methodId: m2.id, connectionId: live.id, method: "Download Orders", status: "Successful", successCount: 1, totalCount: 1, startedAt: "2026-11-10T00:00:00Z" });
    expect((await verifiedLiveProviders(w.db)).channels.has("shopify")).toBe(true);
    expect((await verifiedLiveProviders(w.db)).carriers.size).toBe(0);
  });
});
