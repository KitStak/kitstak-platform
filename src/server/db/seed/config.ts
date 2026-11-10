/**
 * Operational configuration: putaway / allocation algorithms (spec 06), workflows, rate
 * shopping presets, job types (with realistic settings and conditions) and wave rules.
 */
import { jobTypeSettingsSchema, type FilterCondition, type JobTypeSettings, type RuleCondition } from "@/lib/domain-types";
import type { OPERATION_TYPES } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import type { Tx } from "@/server/domain/types";
import type { CarrierRefs } from "./integrations";
import { serviceKey } from "./integrations";
import type { OrgRefs } from "./org";
import { isoOf, utcAt } from "./runtime";
import type { Id } from "./types";

export const JOB_TYPE_CODES = ["Single Unit Orders", "Multi Item Orders", "B2B Order Picking", "Cycle Count", "Instant Count",
  "Dynamic Replenishment", "Static Replenishment", "Work Order Picking"] as const;
export type JobTypeCode = (typeof JOB_TYPE_CODES)[number];

export interface WaveRuleRef {
  readonly id: Id;
  readonly ruleSeq: number;
  readonly name: string;
  readonly warehouseId: Id;
  readonly jobTypeCodes: readonly JobTypeCode[];
}

export interface ConfigRefs {
  /** Job type id by `${warehouseId}|${code}`. */
  readonly jobTypes: ReadonlyMap<string, Id>;
  readonly allocationAlgorithms: ReadonlyMap<string, Id>;
  readonly waveRules: Readonly<Record<"d2c" | "b2b" | "rush" | "count" | "ks2", WaveRuleRef>>;
  readonly ratePresets: readonly { readonly id: Id; readonly clientId: Id; readonly name: string }[];
}

export const jobTypeKey = (warehouseId: Id, code: JobTypeCode): string => `${warehouseId}|${code}`;

const NOT_WHOLESALE: FilterCondition = { field: "channel", op: "nin", value: ["Wholesale"], label: "Channel is not Wholesale" };
const WHOLESALE: FilterCondition = { field: "channel", op: "in", value: ["Wholesale"], label: "Channel is Wholesale" };

interface JobTypeDef {
  readonly code: JobTypeCode;
  readonly description: string;
  readonly operationType: (typeof OPERATION_TYPES)[number];
  readonly settings: Parameters<typeof jobTypeSettingsSchema.parse>[0];
  readonly conditions?: readonly FilterCondition[];
}

const JOB_TYPE_DEFS: readonly JobTypeDef[] = [
  { code: "Single Unit Orders", description: "Single-unit D2C orders batched for cart picking", operationType: "Picking",
    settings: { template: "Single Item Order", orderScope: "Single Item Orders", batch: { method: "Nof Order", min: 1, max: 60 }, picking: { enablePickerSelfAssign: true } }, conditions: [NOT_WHOLESALE] },
  { code: "Multi Item Orders", description: "Multi-unit D2C orders picked to totes", operationType: "Picking",
    settings: { template: "Multi-Item Orders", orderScope: "Multi-Item Orders", batch: { method: "Nof Order", min: 1, max: 40 } }, conditions: [NOT_WHOLESALE] },
  { code: "B2B Order Picking", description: "Wholesale / retailer orders: pallet picks with a loading step", operationType: "Picking",
    settings: { template: "Retailer Compliance", orderScope: "All Orders", batch: { method: "Nof Order", min: 1, max: 6 }, picking: { createLoadingTask: true, disableFullLpPicking: false } }, conditions: [WHOLESALE] },
  { code: "Cycle Count", description: "Scheduled cycle counts by location", operationType: "Count", settings: { count: { autoUpdateNoDifferenceLines: true } } },
  { code: "Instant Count", description: "Ad-hoc instant counts from the mobile app", operationType: "Count", settings: { count: { instantCount: true, lockLocationForInstantCount: true } } },
  { code: "Dynamic Replenishment", description: "Min/max pick-face replenishment from reserve", operationType: "Replenishment", settings: { replenishment: { type: "Dynamic", flow: "Pick & Put", algorithmMethod: "FEFO", zoneBased: true } } },
  { code: "Static Replenishment", description: "Planned replenishment for promotions", operationType: "Replenishment", settings: { replenishment: { type: "Static", flow: "Direct Put", algorithmMethod: "FIFO" } } },
  { code: "Work Order Picking", description: "Component picking for kitting work orders", operationType: "Work Order", settings: { workOrder: { pickingAndKitting: true } } },
];

function seedAlgorithms(tx: Tx, warehouseId: Id): Map<string, Id> {
  const ins = (row: Omit<typeof schema.algorithms.$inferInsert, "warehouseId">): Id =>
    tx.insert(schema.algorithms).values({ warehouseId, ...row }).returning({ id: schema.algorithms.id }).get().id;
  const rule = (algorithmId: Id, sequence: number, name: string, extra: Partial<typeof schema.algorithmRules.$inferInsert>): void => {
    tx.insert(schema.algorithmRules).values({ algorithmId, sequence, name, conditions: [], orderBy: [{ field: "walkingPathPriority", dir: "asc" }], ...extra }).run();
  };
  const created = isoOf(utcAt(400, 15));
  const replen = ins({ name: "REPLENISHMENT_ALGORITHM", kind: "Putaway", isDynamicReplenishment: true, isSystem: true, createdAt: created });
  rule(replen, 1, "Replenish assigned pick faces", { actions: [{ action: "checkSameClient" }, { action: "checkAssignedSkus" }, { action: "checkLocationCapacity" }, { action: "suggestSameSku" }] });
  const sameSku = ins({ name: "SAME_SKU_EMPTY_LOCATION_ALGORITHM", kind: "Putaway", isSystem: true, enforceSuggestedLocations: false, createdAt: created });
  rule(sameSku, 1, "Same SKU in storage", {
    conditions: [{ field: "isReceivingProcess", comparator: "equals", value: true }],
    actions: [{ action: "checkSameClient" }, { action: "checkDamagedLocations" }, { action: "checkSameLotBatchNumber" }, { action: "suggestAreaType", value: "Storage" }, { action: "suggestSameSku" }],
  });
  rule(sameSku, 2, "Empty storage location", { actions: [{ action: "checkDamagedLocations" }, { action: "suggestAreaType", value: "Storage" }, { action: "suggestEmptyLocation" }] });
  const usable: RuleCondition[] = [
    { field: "inventoryDamageReason", comparator: "isEmpty", value: null },
    { field: "isAllowOnlyDamaged", comparator: "equals", value: false },
    { field: "areaType", comparator: "in", value: ["Picking", "Storage"] },
  ];
  const d2c = ins({ name: "Default", kind: "Allocation", createdAt: created });
  rule(d2c, 1, "Pick face first (FEFO)", { inventoryConditions: usable, orderBy: [
    { field: "inventoryExpiryDate", dir: "asc" }, { field: "areaType", dir: "asc" }, { field: "inventoryReceivingDate", dir: "asc" }, { field: "walkingPathPriority", dir: "asc" }] });
  const b2b = ins({ name: "B2B Default", kind: "Allocation", createdAt: isoOf(utcAt(390, 15)) });
  rule(b2b, 1, "Reserve first for wholesale", { conditions: [{ field: "channel", comparator: "equals", value: "Wholesale" }], inventoryConditions: usable, orderBy: [
    { field: "areaType", dir: "desc" }, { field: "inventoryExpiryDate", dir: "asc" }, { field: "inventoryReceivingDate", dir: "asc" }] });
  rule(b2b, 2, "Fallback (any usable stock)", { inventoryConditions: usable, orderBy: [{ field: "inventoryReceivingDate", dir: "asc" }] });
  return new Map([[`${warehouseId}|Default`, d2c], [`${warehouseId}|B2B Default`, b2b]]);
}

function seedJobTypes(tx: Tx, warehouseId: Id, algos: ReadonlyMap<string, Id>, out: Map<string, Id>): void {
  for (const def of JOB_TYPE_DEFS) {
    const settings: JobTypeSettings = jobTypeSettingsSchema.parse(def.settings);
    const id = tx.insert(schema.jobTypes).values({
      code: def.code, description: def.description, warehouseId, operationType: def.operationType, template: settings.template,
      allocationAlgorithmId: def.code === "B2B Order Picking" ? algos.get(`${warehouseId}|B2B Default`) ?? null : def.operationType === "Picking" ? algos.get(`${warehouseId}|Default`) ?? null : null,
      settings, conditions: [...(def.conditions ?? [])], createdAt: isoOf(utcAt(380, 15)),
    }).returning({ id: schema.jobTypes.id }).get().id;
    out.set(jobTypeKey(warehouseId, def.code), id);
  }
}

function seedWaveRules(tx: Tx, org: OrgRefs, jobTypes: ReadonlyMap<string, Id>): ConfigRefs["waveRules"] {
  const make = (ruleSeq: number, name: string, warehouseId: Id, jobTypeCodes: readonly JobTypeCode[], extra: Partial<typeof schema.waveRules.$inferInsert>): WaveRuleRef => {
    const id = tx.insert(schema.waveRules).values({
      ruleSeq, name, warehouseId, operationType: "Picking", jobTypeIds: jobTypeCodes.map((c) => jobTypes.get(jobTypeKey(warehouseId, c)) as Id),
      orderBy: [{ field: "priority", dir: "desc" }, { field: "orderDate", dir: "asc" }], createdAt: isoOf(utcAt(120, 15)), ...extra,
    }).returning({ id: schema.waveRules.id }).get().id;
    return { id, ruleSeq, name, warehouseId, jobTypeCodes };
  };
  return {
    d2c: make(101, "D2C Daily Waves", org.mlt1, ["Single Unit Orders", "Multi Item Orders"], {
      filters: [NOT_WHOLESALE], scheduleDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], scheduleTimes: ["09:30", "14:30"],
      deleteIfNotStarted: true, deleteMethod: "After Hours", deleteTime: "8", softAllocation: false,
    }),
    b2b: make(102, "B2B Wholesale Wave", org.mlt1, ["B2B Order Picking"], {
      filters: [WHOLESALE], priority: "High", scheduleDays: ["Mon", "Wed", "Fri"], scheduleTimes: ["11:00"], assignMode: "Users",
    }),
    rush: make(103, "Rush - Prime & Urgent", org.mlt1, ["Single Unit Orders", "Multi Item Orders"], {
      filters: [{ field: "priority", op: "in", value: ["High", "Urgent"], label: "Priority is High or Urgent" }, NOT_WHOLESALE], priority: "Urgent",
    }),
    count: make(104, "Cycle Count - Zone Rotation", org.mlt1, ["Cycle Count"], { operationType: "Cycle Count", countType: "Location", lockLocations: true }),
    ks2: make(105, "KS2 Overflow Wave", org.ks2, ["Single Unit Orders", "Multi Item Orders"], { filters: [NOT_WHOLESALE], assignMode: "Pool" }),
  };
}

function seedWorkflows(tx: Tx, org: OrgRefs): void {
  const smt = org.clientByCode.get("SMT");
  const rows: (typeof schema.workflows.$inferInsert)[] = [
    { name: "Block PO box addresses", description: "Hold orders shipping to a PO box until CS confirms a street address.", trigger: "Shipment Order Created",
      match: "Any", conditions: [{ field: "shipAddress", comparator: "contains", value: "PO Box" }, { field: "shipAddress", comparator: "contains", value: "P.O. Box" }],
      actions: [{ action: "Block Order", params: { reason: "PO box address" } }], sequence: 1 },
    { name: "Prime orders ship High priority", description: "Amazon Prime orders jump the wave queue.", trigger: "Shipment Order Created",
      conditions: [{ field: "isPrime", comparator: "equals", value: true }], actions: [{ action: "Set Priority", params: { priority: "High" } }], sequence: 2 },
    { name: "Tag Summit Trail Gear VIP orders", description: "Every Summit Trail Gear order gets the VIP tag for white-glove packing.", trigger: "Shipment Order Created",
      clientId: smt?.id ?? null, conditions: [], actions: [{ action: "Add Tag", params: { tag: "VIP" } }], sequence: 3 },
  ];
  tx.insert(schema.workflows).values(rows.map((r) => ({ ...r, warehouseId: org.mlt1, createdAt: isoOf(utcAt(90, 15)) }))).run();
}

function seedRatePresets(tx: Tx, org: OrgRefs, carriers: CarrierRefs): ConfigRefs["ratePresets"] {
  const conn = carriers.sandboxByWarehouse.get(org.mlt1) as Id;
  const apx = org.clientByCode.get("APX");
  const nova = org.clientByCode.get("NVF");
  const out: { id: Id; clientId: Id; name: string }[] = [];
  if (apx) {
    const id = tx.insert(schema.rateShoppingPresets).values({ name: "Cheapest Domestic", description: "Lowest sandbox rate across UPS and USPS ground services",
      warehouseId: org.mlt1, clientId: apx.id, method: "Cheapest", useAllServices: true }).returning({ id: schema.rateShoppingPresets.id }).get().id;
    out.push({ id, clientId: apx.id, name: "Cheapest Domestic" });
  }
  if (nova) {
    const id = tx.insert(schema.rateShoppingPresets).values({ name: "Cheapest in 3 Days", description: "Cheapest service that delivers within 3 business days",
      warehouseId: org.mlt1, clientId: nova.id, method: "Cheapest In Time", transitDays: 3, showErrors: true }).returning({ id: schema.rateShoppingPresets.id }).get().id;
    tx.insert(schema.rateShoppingPresetServices).values(["SBX_2DAY", "SBX_NEXT_DAY", "SBX_PRIORITY", "SBX_GROUND"].map((code) => ({
      presetId: id, carrierServiceId: carriers.services.get(serviceKey(conn, code)) as Id }))).run();
    out.push({ id, clientId: nova.id, name: "Cheapest in 3 Days" });
  }
  return out;
}

export function seedConfig(tx: Tx, org: OrgRefs, carriers: CarrierRefs): ConfigRefs {
  const allocationAlgorithms = new Map<string, Id>();
  const jobTypes = new Map<string, Id>();
  for (const wh of [org.mlt1, org.ks2]) {
    const algos = seedAlgorithms(tx, wh);
    for (const [k, v] of algos) allocationAlgorithms.set(k, v);
    seedJobTypes(tx, wh, algos, jobTypes);
  }
  seedWorkflows(tx, org);
  return { jobTypes, allocationAlgorithms, waveRules: seedWaveRules(tx, org, jobTypes), ratePresets: seedRatePresets(tx, org, carriers) };
}
