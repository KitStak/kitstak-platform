/** Rate Shopping Presets grid + 3-step drawer schemas (M12, spec 06 §6). PURE. */
import { z } from "zod";
import { RATE_SHOPPING_METHODS } from "@/lib/enums";
import { requiredId, requiredText, versionField, type IntegrationField } from "./common";

export const RATE_SHOPPING_GRID_KEY = "rate-shopping-presets";

export const RATE_SHOPPING_FIELDS: readonly IntegrationField[] = [
  { field: "name", label: "Name", type: "text" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "method", label: "Rate calculation method", type: "enum", options: RATE_SHOPPING_METHODS },
  { field: "isActive", label: "Active", type: "boolean" },
  { field: "useAllServices", label: "Use all available services", type: "boolean" },
  { field: "showErrors", label: "Show error messages", type: "boolean" },
];
export const RATE_SHOPPING_SORT_FIELDS = ["name", "method", "description", "showErrors", "useAllServices", "isActive", "transitDays", "clientCode", "warehouseCode", "serviceCount"] as const;
export const RATE_SHOPPING_SEARCH_FIELDS = ["name", "description"] as const;

export const METHOD_COPY: Readonly<Record<(typeof RATE_SHOPPING_METHODS)[number], string>> = {
  Cheapest: "The system will find the cheapest rate among available shipment methods.",
  Fastest: "The system will find the fastest transit time among available shipment options.",
  "Cheapest In Time": "The system will find the cheapest rate that arrives within the given transit time among available shipment methods.",
};

export const presetGeneralSchema = z.object({
  name: requiredText("RS preset name", 60),
  description: requiredText("Description", 250),
  warehouseId: requiredId("Warehouse"),
  clientId: requiredId("Client"),
  isActive: z.boolean(),
});

const SETTINGS_SHAPE = {
  method: z.enum(RATE_SHOPPING_METHODS, { error: "Select a rate calculation method" }),
  transitDays: z.number().int("Whole days only").min(1, "Transit time must be at least 1 day").max(30, "At most 30 days").nullable().optional().transform((v) => v ?? null),
  showErrors: z.boolean(),
};
const checkSettings = (v: { method: string; transitDays: number | null }, ctx: z.RefinementCtx) => {
  if (v.method === "Cheapest In Time" && v.transitDays === null) ctx.addIssue({ code: "custom", path: ["transitDays"], message: "Transit time is required for Cheapest In Time" });
};
export const presetSettingsSchema = z.object(SETTINGS_SHAPE).superRefine(checkSettings);

const SERVICES_SHAPE = {
  useAllServices: z.boolean(),
  serviceIds: z.array(z.string().trim().min(1).max(64)).max(2000).default([]),
};
const checkServices = (v: { useAllServices: boolean; serviceIds: readonly string[] }, ctx: z.RefinementCtx) => {
  if (!v.useAllServices && v.serviceIds.length === 0) ctx.addIssue({ code: "custom", path: ["serviceIds"], message: "Select at least one shipping option, or use all available services" });
};
export const presetServicesSchema = z.object(SERVICES_SHAPE).superRefine(checkServices);

export const presetSaveSchema = presetGeneralSchema.extend({ ...SETTINGS_SHAPE, ...SERVICES_SHAPE, version: versionField }).superRefine((v, ctx) => {
  checkSettings(v, ctx);
  checkServices(v, ctx);
});
export type PresetSaveInput = z.input<typeof presetSaveSchema>;
export type PresetSave = z.output<typeof presetSaveSchema>;

export const PRESET_DEFAULTS: PresetSaveInput = {
  name: "", description: "", warehouseId: "", clientId: "", isActive: true, method: "Cheapest", transitDays: null, showErrors: false, useAllServices: true, serviceIds: [],
};
