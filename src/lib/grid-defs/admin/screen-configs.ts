/**
 * Screen Configuration (M14 #9): Receiving mobile-screen step catalog, the create/edit schema
 * (General / Conditions / Configuration), condition matching and the grid fields. PURE.
 *
 * Step keys are read by M05's receive flow (`receivingRequirements`): a tracked attribute
 * (lot, expiry, production date) is required unless an active config switches the step off
 * or marks it optional.
 */
import { z } from "zod";
import { PO_TYPES } from "@/lib/enums";
import { idField, requiredText, versionField, type AdminField } from "./common";

export const SCREEN_CONFIGS_GRID_KEY = "screen-configs";
export const OPERATION_TYPES = ["Receiving"] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];
export const OPERATION_SLUGS: Readonly<Record<string, OperationType>> = { receiving: "Receiving" };
export const RECEIVING_SCREEN_NAME = "Receiving";

export interface ScreenStepDef {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** Default when a new configuration starts. */
  readonly enabled: boolean;
  readonly required: boolean;
  /** Whether "Required" makes sense (scan steps are always mandatory when shown). */
  readonly canBeOptional: boolean;
}

export const RECEIVING_STEPS: readonly ScreenStepDef[] = [
  { key: "scanLp", label: "Scan LP", description: "Scan or create the license plate the units go onto.", enabled: true, required: true, canBeOptional: true },
  { key: "lot", label: "Lot number", description: "Ask for the lot / batch of lot-tracked products.", enabled: true, required: true, canBeOptional: true },
  { key: "expiry", label: "Expiry date", description: "Ask for the expiry date of expiry-tracked products.", enabled: true, required: true, canBeOptional: true },
  { key: "productionDate", label: "Production date", description: "Ask for the production date of products that track it.", enabled: false, required: false, canBeOptional: true },
  { key: "photo", label: "Capture photo", description: "Take a photo of the received units or damage.", enabled: false, required: false, canBeOptional: true },
  { key: "dimensions", label: "Verify dimensions", description: "Confirm or update the product weight and dimensions.", enabled: false, required: false, canBeOptional: true },
  { key: "printLabel", label: "Print label on receive", description: "Print the LP or product label when a line is received.", enabled: true, required: false, canBeOptional: false },
];

export const stepSchema = z.object({ key: z.string().min(1).max(40), enabled: z.boolean(), required: z.boolean() });

export const CONDITION_JOINS = ["And", "Or"] as const;

export const conditionsSchema = z.object({
  when: z.literal("Operation Starting").default("Operation Starting"),
  join: z.enum(CONDITION_JOINS).default("And"),
  clientIds: z.array(idField).max(500).default([]),
  poTypes: z.array(z.enum(PO_TYPES)).max(PO_TYPES.length).default([]),
  vendorIds: z.array(idField).max(500).default([]),
});

export const screenGeneralSchema = z.object({
  warehouseId: z.string({ error: "Choose a warehouse" }).trim().min(1, "Choose a warehouse").max(64),
  name: requiredText("Configuration name", 80),
  isActive: z.boolean(),
});

export const screenConfigSchema = screenGeneralSchema.extend({
  operationType: z.enum(OPERATION_TYPES).default("Receiving"),
  conditions: conditionsSchema,
  steps: z.array(stepSchema).min(1).max(20),
  version: versionField,
}).superRefine((v, ctx) => {
  const known = new Set(RECEIVING_STEPS.map((s) => s.key));
  v.steps.forEach((s, i) => { if (!known.has(s.key)) ctx.addIssue({ code: "custom", path: ["steps", i, "key"], message: `Unknown step ${s.key}` }); });
  if (!v.steps.some((s) => s.enabled)) ctx.addIssue({ code: "custom", path: ["steps"], message: "Switch on at least one step" });
});

export type ScreenConfigFormValues = z.input<typeof screenConfigSchema>;
export type ScreenConfigSave = z.output<typeof screenConfigSchema>;
export type ScreenConditions = z.output<typeof conditionsSchema>;
export type ScreenStep = z.output<typeof stepSchema>;

export function defaultSteps(): ScreenStep[] {
  return RECEIVING_STEPS.map((s) => ({ key: s.key, enabled: s.enabled, required: s.required }));
}

/** Known steps in catalog order; missing ones take the catalog default, unknown ones drop. */
export function normalizeSteps(raw: readonly { key: string; enabled: boolean; required: boolean }[] | null | undefined): ScreenStep[] {
  const byKey = new Map((raw ?? []).map((s) => [s.key, s]));
  return RECEIVING_STEPS.map((d) => {
    const s = byKey.get(d.key);
    return s ? { key: d.key, enabled: s.enabled, required: d.canBeOptional ? s.enabled && s.required : false } : { key: d.key, enabled: d.enabled, required: d.required };
  });
}

export function screenConfigDefaults(warehouseId: string | null): ScreenConfigFormValues {
  return { warehouseId: warehouseId ?? "", name: "", isActive: true, operationType: "Receiving", conditions: { when: "Operation Starting", join: "And", clientIds: [], poTypes: [], vendorIds: [] }, steps: defaultSteps() };
}

export function hasConditions(c: Pick<ScreenConditions, "clientIds" | "poTypes" | "vendorIds">): boolean {
  return c.clientIds.length + c.poTypes.length + c.vendorIds.length > 0;
}

export interface PoFacts {
  readonly clientId: string;
  readonly poType: string;
  readonly vendorId: string | null;
}

/**
 * Does a configuration apply to a purchase order? No conditions = every PO. "And" needs every
 * condition group that has values to match; "Or" needs any one.
 */
export function conditionsMatch(c: Pick<ScreenConditions, "join" | "clientIds" | "poTypes" | "vendorIds">, po: PoFacts): boolean {
  const checks: boolean[] = [];
  if (c.clientIds.length) checks.push(c.clientIds.includes(po.clientId));
  if (c.poTypes.length) checks.push(c.poTypes.includes(po.poType as (typeof PO_TYPES)[number]));
  if (c.vendorIds.length) checks.push(po.vendorId !== null && c.vendorIds.includes(po.vendorId));
  if (checks.length === 0) return true;
  return c.join === "And" ? checks.every(Boolean) : checks.some(Boolean);
}

/** "If the PO is Client is Apex Threads Co. And PoType is Purchase Order" (names resolved by caller). */
export function conditionSentence(c: Pick<ScreenConditions, "join">, groups: { readonly clients: readonly string[]; readonly poTypes: readonly string[]; readonly vendors: readonly string[] }): string {
  const parts = [
    groups.clients.length ? `Client is ${groups.clients.join(" or ")}` : null,
    groups.poTypes.length ? `PO type is ${groups.poTypes.join(" or ")}` : null,
    groups.vendors.length ? `Vendor is ${groups.vendors.join(" or ")}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(` ${c.join.toLowerCase()} `) : "Every purchase order";
}

/* ---------------- grid ---------------- */

export const SCREEN_CONFIG_FIELDS: readonly AdminField[] = [
  { field: "name", label: "Configuration name", type: "text" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "operationType", label: "Operation type", type: "enum", options: OPERATION_TYPES },
  { field: "screenName", label: "Screen name", type: "text" },
  { field: "isActive", label: "Is active", type: "boolean" },
  { field: "createdAt", label: "Created date", type: "date" },
];

export const SCREEN_CONFIG_SORT_FIELDS = ["name", "warehouseName", "operationType", "screenName", "isActive", "createdAt", "createdByName", "updatedAt"] as const;
export const SCREEN_CONFIG_SEARCH_FIELDS = ["name"] as const;
