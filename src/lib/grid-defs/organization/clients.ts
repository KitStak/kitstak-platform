/**
 * Clients (M11): grid fields, the 4-step Create Client wizard schemas and the ~28 client
 * setting switches (05 §7) with description tooltips. PURE.
 */
import { z } from "zod";
import { ACTIVE_STATUSES, CLIENT_BILLING_PLANS, CURRENCIES } from "@/lib/enums";
import { optionalEmail, optionalText, orgAddressSchema, requiredText, versionField, type OrgField } from "./common";

export const CLIENTS_GRID_KEY = "clients";

export const CLIENT_FIELDS: readonly OrgField[] = [
  { field: "code", label: "Client code", type: "text" },
  { field: "name", label: "Client", type: "text" },
  { field: "officialName", label: "Official name", type: "text" },
  { field: "taxId", label: "Tax ID", type: "text" },
  { field: "status", label: "Status", type: "enum", options: ACTIVE_STATUSES },
  { field: "currency", label: "Currency", type: "enum", options: CURRENCIES },
  { field: "productCount", label: "# Products", type: "number" },
  { field: "openOrders", label: "# Open orders", type: "number" },
  { field: "createdAt", label: "Created date", type: "date" },
];
export const CLIENT_SORT_FIELDS = ["code", "name", "officialName", "taxId", "status", "currency", "productCount", "openOrders", "createdAt"] as const;
export const CLIENT_SEARCH_FIELDS = ["name", "code", "officialName", "taxId"] as const;

/* ---------------- settings switches ---------------- */

export interface SettingSwitch {
  readonly key: string;
  readonly label: string;
  readonly tip: string;
}
export interface SettingGroup {
  readonly key: "notifications" | "fulfillment" | "packing" | "advanced";
  readonly title: string;
  readonly description: string;
  readonly switches: readonly SettingSwitch[];
}

const s = (key: string, label: string, tip: string): SettingSwitch => ({ key, label, tip });

export const CLIENT_SETTING_GROUPS: readonly SettingGroup[] = [
  {
    key: "notifications", title: "Notification email settings", description: "Emails sent to the client's contact.",
    switches: [
      s("receivedPo", "Received PO notification", "Email the client when one of their purchase orders is fully received."),
      s("dailyInventory", "Daily inventory notification", "Send a daily on-hand summary per SKU every morning."),
      s("dailyInventoryByLocation", "Daily inventory by location notification", "Send the daily on-hand summary broken down by location."),
      s("safetyStock", "Safety stock notification", "Email when a SKU's available quantity drops below its safety stock."),
    ],
  },
  {
    key: "fulfillment", title: "Fulfillment settings", description: "How allocation behaves when stock goes missing.",
    switches: [
      s("preventReallocationIfMissing", "Prevent reallocation if missing", "When a picker reports missing stock, don't reallocate the line to another location automatically."),
      s("retainAllocationDuringMissing", "Retain allocation during missing", "Keep the original allocation in place while a missing report is investigated."),
      s("allowDifferentLocationLpn", "Allow different location/LPN", "Let pickers pick the same SKU from a different location or LP than the one suggested."),
    ],
  },
  {
    key: "packing", title: "Packing settings", description: "Packing station rules for this client's orders.",
    switches: [
      s("directPrintPackList", "Direct print pack list", "Print the packing list automatically when packing completes."),
      s("enablePackAll", "Enable pack all", "Show a Pack All button that packs every remaining item in one step."),
      s("disableShippingOptionChange", "Disable shipping option change", "Packers can't change the carrier or service chosen on the order."),
      s("disablePackageChange", "Disable package change", "Packers can't change the suggested shipment package."),
      s("disableBatchOrderPacking", "Disable batch order packing", "Orders must be packed one at a time, not as a batch."),
      s("disableCarrierRate", "Disable carrier rate", "Hide live carrier rates at the packing station."),
      s("disallowMultipleShipmentPackages", "Do not allow multiple shipment packages", "Every order ships in a single package."),
      s("disablePackingWithoutLabel", "Disable packing without label", "A shipping label must be created before packing can complete."),
      s("enableEnterQuantity", "Enable enter quantity", "Let packers type a quantity instead of scanning each unit."),
      s("enablePackageSuggestion", "Enable package suggestion", "Suggest the best-fit shipment package from item dimensions."),
      s("forcePackageTypeValidation", "Force package type validation", "The scanned package must match the suggested package type."),
      s("directPrintAttachedDocuments", "Direct print attached documents", "Print documents attached to the order when packing starts."),
      s("scanOnlyPackTypeBarcodes", "Scan only pack type barcodes", "Accept only pack-type barcodes at packing, not the base product barcode."),
      s("captureLabelImagesForPackingList", "Capture label images for packing list", "Embed shipping label images on the printed packing list."),
      s("autoCompletePackingOnLastScan", "Auto complete packing on last scan", "Complete the package automatically when the last unit is scanned."),
      s("usePreProducedLabelsInMultiBox", "Use pre-produced labels in multi box packing", "Use labels printed in advance for each box of a multi-box order."),
      s("forceCartonizationInstructions", "Force cartonization instructions on packing", "Packers must follow the cartonization plan box by box."),
    ],
  },
  {
    key: "advanced", title: "Advanced settings", description: "Inventory attributes kept from receiving.",
    switches: [
      s("keepReceivingDateOnInventory", "Keep receiving date on inventory", "Store the receiving date on each inventory bucket for FIFO and aging."),
      s("allowUniqueSkuBarcodes", "Allow unique SKU barcodes", "Each SKU must have a barcode no other SKU of this client uses."),
      s("keepPoNumberOnInventory", "Keep PO number on inventory", "Store the PO number on received inventory for traceability."),
      s("receivingPhysicalAttributeVerification", "Activate receiving verification for physical attributes", "Receivers confirm weight and dimensions of new SKUs on first receipt."),
    ],
  },
];

export const CLIENT_SETTING_COUNT = CLIENT_SETTING_GROUPS.reduce((n, g) => n + g.switches.length, 0);

export type ClientSettingsForm = Record<SettingGroup["key"], Record<string, boolean>>;

const groupShape = (g: SettingGroup) => z.object(Object.fromEntries(g.switches.map((sw) => [sw.key, z.boolean().default(false)])));
export const clientSettingsFormSchema = z.object({
  notifications: groupShape(CLIENT_SETTING_GROUPS[0]!),
  fulfillment: groupShape(CLIENT_SETTING_GROUPS[1]!),
  packing: groupShape(CLIENT_SETTING_GROUPS[2]!),
  advanced: groupShape(CLIENT_SETTING_GROUPS[3]!),
});

export function emptySettings(): ClientSettingsForm {
  return Object.fromEntries(CLIENT_SETTING_GROUPS.map((g) => [g.key, Object.fromEntries(g.switches.map((sw) => [sw.key, false]))])) as ClientSettingsForm;
}

/** Fills a stored (partial) settings object with every switch. */
export function fullSettings(stored: unknown): ClientSettingsForm {
  const base = emptySettings();
  const src = (stored ?? {}) as Partial<Record<string, Record<string, unknown>>>;
  for (const g of CLIENT_SETTING_GROUPS) for (const sw of g.switches) base[g.key][sw.key] = src[g.key]?.[sw.key] === true;
  return base;
}

export function enabledSwitchCount(settings: ClientSettingsForm): number {
  return CLIENT_SETTING_GROUPS.reduce((n, g) => n + g.switches.filter((sw) => settings[g.key][sw.key]).length, 0);
}

/** Flattened `Packing · Enable pack all` → Yes/No for change-log diffs. */
export function flattenSettings(settings: ClientSettingsForm): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of CLIENT_SETTING_GROUPS) for (const sw of g.switches) out[`setting.${g.key}.${sw.key}`] = settings[g.key][sw.key] === true;
  return out;
}

export function settingLabel(path: string): string | null {
  const [, group, key] = path.split(".");
  const g = CLIENT_SETTING_GROUPS.find((x) => x.key === group);
  const sw = g?.switches.find((x) => x.key === key);
  return g && sw ? `${g.title.replace(/ settings$/, "")} · ${sw.label}` : null;
}

/* ---------------- wizard ---------------- */

export const CLIENT_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

export const clientInfoShape = {
  name: requiredText("Display name", 100),
  code: z.string({ error: "Client code is required" }).trim().toUpperCase().regex(CLIENT_CODE_RE, "2–20 letters, numbers, dash or underscore"),
  officialName: requiredText("Official name", 200),
  status: z.enum(ACTIVE_STATUSES).default("Active"),
  contactName: optionalText(100),
  contactEmail: optionalEmail,
  phone: optionalText(40),
};
export const clientInfoSchema = z.object(clientInfoShape);
export const clientSettingsStepSchema = z.object({ currency: z.enum(CURRENCIES, { error: "Currency is required" }), settings: clientSettingsFormSchema });
export const clientAddressesStepSchema = z.object({ addresses: z.array(orgAddressSchema).max(50) });
export const clientOthersShape = {
  taxId: optionalText(40),
  billingPlan: z.enum(CLIENT_BILLING_PLANS).default("per-order"),
  customFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  note: optionalText(1000),
};
export const clientOthersSchema = z.object(clientOthersShape);

export const clientSchema = z.object({
  ...clientInfoShape,
  currency: z.enum(CURRENCIES, { error: "Currency is required" }),
  settings: clientSettingsFormSchema,
  addresses: z.array(orgAddressSchema).max(50).default([]),
  ...clientOthersShape,
  version: versionField,
});
export type ClientInput = z.input<typeof clientSchema>;
export type ClientSave = z.output<typeof clientSchema>;

/** Settings-tab edit (switches + currency only). */
export const clientSettingsPatchSchema = z.object({ currency: z.enum(CURRENCIES), settings: clientSettingsFormSchema, version: versionField });

export const CLIENT_DEFAULTS: ClientInput = {
  name: "", code: "", officialName: "", status: "Active", contactName: "", contactEmail: "", phone: "",
  currency: "USD", settings: emptySettings(), addresses: [], taxId: "", billingPlan: "per-order", customFields: {}, note: "",
};

/** "Copperline Coffee Co." -> "COPPER" style code suggestion. */
export function suggestClientCode(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 6);
  return words.slice(0, 4).map((w) => w[0]).join("") + (words[0]!.length > 1 ? words[0]!.slice(1, 3) : "");
}
