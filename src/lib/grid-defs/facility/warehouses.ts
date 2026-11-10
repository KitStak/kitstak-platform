/** Warehouses grid + drawer schema (M10). PURE. */
import { z } from "zod";
import { DIMENSION_UNITS, WAREHOUSE_TYPES, WEIGHT_UNITS } from "@/lib/enums";
import { optionalId, optionalText, requiredText, versionField, type FacilityField } from "./common";

export const WAREHOUSES_GRID_KEY = "warehouses";

export const WAREHOUSE_FIELDS: readonly FacilityField[] = [
  { field: "code", label: "Warehouse code", type: "text" },
  { field: "name", label: "Name", type: "text" },
  { field: "city", label: "City", type: "text" },
  { field: "state", label: "State", type: "text" },
  { field: "contactName", label: "Contact", type: "text" },
  { field: "type", label: "Type", type: "enum", options: WAREHOUSE_TYPES },
  { field: "isDefault", label: "Default", type: "boolean" },
  { field: "isActive", label: "Active", type: "boolean" },
];

export const WAREHOUSE_SORT_FIELDS = ["code", "name", "address", "contactName", "type", "isDefault", "isActive", "locationCount", "createdAt"] as const;
export const WAREHOUSE_SEARCH_FIELDS = ["code", "name"] as const;

export const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Mexico_City", "Europe/London", "Europe/Berlin", "Asia/Singapore", "Australia/Sydney",
] as const;

const TIME_12 = /^(0?[1-9]|1[0-2]):[0-5]\d$/;
export const DAY_ZONES = ["AM", "PM"] as const;

/** "08:00"+"PM" -> "20:00". */
export function to24h(time: string, zone: (typeof DAY_ZONES)[number]): string {
  const [h = "0", m = "00"] = time.split(":");
  let hour = Number(h) % 12;
  if (zone === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/** "20:00" -> { time: "08:00", zone: "PM" }. */
export function from24h(value: string): { time: string; zone: (typeof DAY_ZONES)[number] } {
  const [h = "0", m = "00"] = value.split(":");
  const hour = Number(h);
  const zone = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { time: `${String(h12).padStart(2, "0")}:${m.padStart(2, "0")}`, zone };
}

const INFO_SHAPE = {
  code: requiredText("Code", 20).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dash or underscore"),
  name: requiredText("Name", 120),
  prefix: requiredText("Prefix", 8).regex(/^[A-Za-z0-9]+$/, "Letters and numbers only"),
  type: z.enum(WAREHOUSE_TYPES),
  addressLine: requiredText("Address line 1", 250),
  addressLine2: optionalText(250),
  postalCode: requiredText("Postal code", 20),
  city: requiredText("City", 100),
  state: requiredText("State", 60),
  country: requiredText("Country", 60),
  contactName: requiredText("Contact name", 120),
  contactPhone: requiredText("Contact phone number", 40),
  email: z.string().trim().max(200).email("Enter a valid email").or(z.literal("")).nullable().optional().transform((v) => v || null),
  shiftStart: z.string().trim().regex(TIME_12, "Use hh:mm, e.g. 08:00"),
  shiftStartZone: z.enum(DAY_ZONES),
  shiftEnd: z.string().trim().regex(TIME_12, "Use hh:mm, e.g. 05:00"),
  shiftEndZone: z.enum(DAY_ZONES),
  timezone: z.enum(TIMEZONES),
};

const SETTINGS_SHAPE = {
  defaultDimensionUnit: z.enum(DIMENSION_UNITS),
  defaultWeightUnit: z.enum(WEIGHT_UNITS),
  useLpDimsForPutaway: z.boolean(),
  defaultReceivingLocationId: optionalId(),
  defaultShipLocationId: optionalId(),
  defaultReturnLocationId: optionalId(),
  mandatoryAdjustmentReason: z.boolean(),
  mandatoryCountReason: z.boolean(),
  mobileAutoLogout: z.boolean(),
  mobileAutoLogoutMinutes: z.number({ error: "Enter the minutes" }).int().min(1, "At least 1 minute").max(720, "At most 720 minutes").nullable().optional(),
};

type ShiftFields = { shiftStart: string; shiftStartZone: (typeof DAY_ZONES)[number]; shiftEnd: string; shiftEndZone: (typeof DAY_ZONES)[number] };
const checkShift = (v: ShiftFields, ctx: z.RefinementCtx) => {
  if (to24h(v.shiftStart, v.shiftStartZone) === to24h(v.shiftEnd, v.shiftEndZone)) ctx.addIssue({ code: "custom", path: ["shiftEnd"], message: "End time must differ from start time" });
};
const checkLogout = (v: { mobileAutoLogout: boolean; mobileAutoLogoutMinutes?: number | null }, ctx: z.RefinementCtx) => {
  if (v.mobileAutoLogout && !v.mobileAutoLogoutMinutes) ctx.addIssue({ code: "custom", path: ["mobileAutoLogoutMinutes"], message: "Enter the inactivity timeout in minutes" });
};

/** Drawer step 1 (Information). */
export const warehouseInfoSchema = z.object(INFO_SHAPE).superRefine(checkShift);
/** Drawer step 2 (Settings). */
export const warehouseSettingsSchema = z.object(SETTINGS_SHAPE).superRefine(checkLogout);

export const warehouseSchema = z.object({ ...INFO_SHAPE, ...SETTINGS_SHAPE, version: versionField }).superRefine((v, ctx) => {
  checkShift(v, ctx);
  checkLogout(v, ctx);
});

export type WarehouseInput = z.input<typeof warehouseSchema>;
export type WarehouseSave = z.output<typeof warehouseSchema>;

export const WAREHOUSE_DEFAULTS: WarehouseInput = {
  code: "", name: "", prefix: "", type: "Internal", addressLine: "", addressLine2: "", postalCode: "", city: "", state: "",
  country: "United States", contactName: "", contactPhone: "", email: "", shiftStart: "08:00", shiftStartZone: "AM",
  shiftEnd: "05:00", shiftEndZone: "PM", timezone: "America/Chicago", defaultDimensionUnit: "Inch", defaultWeightUnit: "Pound",
  useLpDimsForPutaway: false, defaultReceivingLocationId: null, defaultShipLocationId: null, defaultReturnLocationId: null,
  mandatoryAdjustmentReason: true, mandatoryCountReason: false, mobileAutoLogout: true, mobileAutoLogoutMinutes: 30,
};
