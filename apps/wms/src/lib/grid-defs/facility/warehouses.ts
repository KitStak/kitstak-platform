/** Warehouses grid + drawer schema (M10). PURE. */
import { z } from "zod";
import { DIMENSION_UNITS, WAREHOUSE_TYPES, WEIGHT_UNITS } from "@/lib/enums";
import { COUNTRIES, subdivisionsFor } from "@/lib/countries";
import { normalizePostal, postalError } from "@/components/shared/address-model";
import { optionalId, optionalText, requiredPattern, requiredText, versionField, type FacilityField } from "./common";

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

/** Starter locations offered when a warehouse is created: <PREFIX>-RECV, -PACK, -SHIP, -RET. */
export const STARTER_LOCATION_SUFFIXES = ["RECV", "PACK", "SHIP", "RET"] as const;

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
  code: requiredPattern("Code", 20, /^[A-Za-z0-9_-]+$/, "Letters, numbers, dash or underscore"),
  name: requiredText("Name", 120),
  prefix: requiredPattern("Prefix", 8, /^[A-Za-z0-9]+$/, "Letters and numbers only"),
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
  /** Create only: add <PREFIX>-RECV / -PACK / -SHIP / -RET and make them the defaults. Ignored on edit. */
  createStarterLocations: z.boolean().optional().default(false),
};

type ShiftFields = { shiftStart: string; shiftStartZone: (typeof DAY_ZONES)[number]; shiftEnd: string; shiftEndZone: (typeof DAY_ZONES)[number] };
const checkShift = (v: ShiftFields, ctx: z.RefinementCtx) => {
  if (to24h(v.shiftStart, v.shiftStartZone) === to24h(v.shiftEnd, v.shiftEndZone)) ctx.addIssue({ code: "custom", path: ["shiftEnd"], message: "End time must differ from start time" });
};
/** Country stored as a name ("United States") or ISO code: returns the ISO code, or null if unknown. */
export function countryCodeOf(country: string | null | undefined): string | null {
  const v = country?.trim().toLowerCase();
  if (!v) return null;
  if (v === "usa" || v === "us" || v === "united states of america") return "US";
  return COUNTRIES.find((c) => c.code.toLowerCase() === v || c.name.toLowerCase() === v)?.code ?? null;
}

/**
 * Canonical state/province code for countries with a fixed list (US, CA), matching code or
 * name case-insensitively; null when it isn't one. Other countries accept free text.
 */
export function normalizeState(country: string | null | undefined, state: string | null | undefined): string | null {
  const list = subdivisionsFor(countryCodeOf(country));
  const v = state?.trim().toLowerCase();
  if (!v) return null;
  if (list.length === 0) return state!.trim();
  return list.find((d) => d.code.toLowerCase() === v || d.name.toLowerCase() === v)?.code ?? null;
}

/** Postal code for any country: US ZIP / CA postal patterns, otherwise 2-10 letters, digits, space or dash. */
export function warehousePostalError(country: string | null | undefined, postal: string): string | null {
  const code = countryCodeOf(country) ?? "";
  const base = postalError(code, postal);
  if (base) return base;
  if (code !== "US" && code !== "CA" && !/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(postal.trim())) return "Use 2-10 letters, digits, spaces or dashes";
  return null;
}

/** Phone in E.164 (+15551234567) or national format: 7-15 digits, optional leading +, spaces, dots, dashes, brackets and an extension. */
export function phoneError(phone: string): string | null {
  const v = phone.trim();
  if (!v) return null;
  const [main = "", ext] = v.split(/\s*(?:ext\.?|x)\s*/i);
  if (!/^\+?[\d\s().-]+$/.test(main)) return "Use digits only, e.g. +1 555 123 4567";
  const digits = main.replace(/\D/g, "").length;
  if (digits < 7 || digits > 15) return "Enter 7 to 15 digits";
  if (ext !== undefined && !/^\d{1,6}$/.test(ext)) return "Extension must be 1-6 digits";
  return null;
}

/**
 * Problems with an address/phone already stored (legacy rows saved before validation existed).
 * Used to flag the grid row and to force a fix on the edit form. Empty array = clean.
 */
export function storedAddressIssues(v: { readonly country?: string | null; readonly state?: string | null; readonly contactPhone?: string | null }): string[] {
  const issues: string[] = [];
  const code = countryCodeOf(v.country);
  if (!code) issues.push(`Country "${v.country ?? ""}" isn't a recognised country`);
  else if (v.state?.trim() && normalizeState(v.country, v.state) === null) issues.push(`State "${v.state}" isn't valid for ${code}`);
  const phone = v.contactPhone?.trim() ? phoneError(v.contactPhone) : null;
  if (phone) issues.push(`Contact phone "${v.contactPhone}": ${phone}`);
  return issues;
}

const checkAddress = (v: { country: string; state: string; postalCode: string; contactPhone: string }, ctx: z.RefinementCtx) => {
  const code = countryCodeOf(v.country);
  if (!code) ctx.addIssue({ code: "custom", path: ["country"], message: "Choose a country from the list" });
  else if (v.state.trim() && normalizeState(v.country, v.state) === null) {
    ctx.addIssue({ code: "custom", path: ["state"], message: code === "CA" ? "Choose a Canadian province or territory" : "Choose a US state or territory" });
  }
  const postal = v.postalCode.trim() ? warehousePostalError(v.country, v.postalCode) : null;
  if (postal) ctx.addIssue({ code: "custom", path: ["postalCode"], message: postal });
  const phone = phoneError(v.contactPhone);
  if (phone) ctx.addIssue({ code: "custom", path: ["contactPhone"], message: phone });
};

/** Canonical stored address: country name from the ISO list, 2-letter US/CA state, normalised postal code. */
export function normalizeWarehouseAddress<T extends { country: string; state: string; postalCode: string }>(v: T): T {
  const code = countryCodeOf(v.country);
  if (!code) return v;
  const country = COUNTRIES.find((c) => c.code === code)?.name ?? v.country;
  return { ...v, country, state: normalizeState(code, v.state) ?? v.state.trim(), postalCode: normalizePostal(code, v.postalCode) };
}
const checkLogout = (v: { mobileAutoLogout: boolean; mobileAutoLogoutMinutes?: number | null }, ctx: z.RefinementCtx) => {
  if (v.mobileAutoLogout && !v.mobileAutoLogoutMinutes) ctx.addIssue({ code: "custom", path: ["mobileAutoLogoutMinutes"], message: "Enter the inactivity timeout in minutes" });
};

/** Fields owned by the Information step (server field errors route back to it). */
export const WAREHOUSE_INFO_KEYS: ReadonlySet<string> = new Set(Object.keys(INFO_SHAPE));

/** Drawer step 1 (Information). */
export const warehouseInfoSchema = z.object(INFO_SHAPE).superRefine((v, ctx) => { checkShift(v, ctx); checkAddress(v, ctx); });
/** Drawer step 2 (Settings). */
export const warehouseSettingsSchema = z.object(SETTINGS_SHAPE).superRefine(checkLogout);

export const warehouseSchema = z.object({ ...INFO_SHAPE, ...SETTINGS_SHAPE, version: versionField }).superRefine((v, ctx) => {
  checkShift(v, ctx);
  checkLogout(v, ctx);
  checkAddress(v, ctx);
}).transform((v) => normalizeWarehouseAddress(v));

export type WarehouseInput = z.input<typeof warehouseSchema>;
export type WarehouseSave = z.output<typeof warehouseSchema>;

export const WAREHOUSE_DEFAULTS: WarehouseInput = {
  code: "", name: "", prefix: "", type: "Internal", addressLine: "", addressLine2: "", postalCode: "", city: "", state: "",
  country: "United States", contactName: "", contactPhone: "", email: "", shiftStart: "08:00", shiftStartZone: "AM",
  shiftEnd: "05:00", shiftEndZone: "PM", timezone: "America/Chicago", defaultDimensionUnit: "Inch", defaultWeightUnit: "Pound",
  useLpDimsForPutaway: false, defaultReceivingLocationId: null, defaultShipLocationId: null, defaultReturnLocationId: null,
  mandatoryAdjustmentReason: true, mandatoryCountReason: false, mobileAutoLogout: true, mobileAutoLogoutMinutes: 30,
  createStarterLocations: true,
};

/** Confirm copy for Set as default: what the switch changes and what it leaves alone. Pure. */
export function defaultSwitchImpact(currentCode: string | null, nextCode: string): string {
  const from = currentCode ? `${currentCode} stops being the default and ` : "";
  return `Only one warehouse can be the company default. ${from}${nextCode} is marked Default for the whole company. Existing orders, receipts, stock and each user's preferred warehouse don't change. You can undo this from the confirmation message.`;
}
