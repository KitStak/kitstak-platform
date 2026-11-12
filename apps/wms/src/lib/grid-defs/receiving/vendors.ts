/**
 * Vendors grid + vendor form schema (M05). Pure TS shared by client and server.
 * Display name maps to Logiwa's "nickname", vendor name to "company name".
 */
import { z } from "zod";
import type { ReceivingGridField } from "./purchase-orders";

export const VENDORS_GRID_KEY = "vendors";

/** Any of these opens the vendor list (`GET /api/vendors` and the /receiving/vendors, /organization/vendors routes). */
export const VENDOR_VIEW_PERMISSIONS = ["settings.vendors.view", "inventory.purchase_orders.view", "inventory.purchase_orders.create", "inventory.purchase_orders.edit"] as const;

export const VENDOR_GRID_FIELDS: readonly ReceivingGridField[] = [
  { field: "clientId", label: "Client", type: "enum", dynamicOptions: "clients" },
  { field: "vendorName", label: "Company name", type: "text" },
  { field: "displayName", label: "Company nickname", type: "text" },
  { field: "isActive", label: "Active", type: "boolean" },
];

export const VENDOR_SORT_FIELDS = ["displayName", "vendorName", "clientName", "isActive", "openPoCount", "createdAt"] as const;
export const VENDOR_SEARCH_FIELDS = ["vendorName", "displayName"] as const;

export const VENDOR_DISPLAY_NAME_MAX = 100;
export const VENDOR_NAME_MAX = 255;

const opt = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`).optional().or(z.literal(""));

export const vendorAddressSchema = z.object({
  /** Address name (Logiwa "Address Name", max 50). */
  name: opt(50),
  contactName: opt(100),
  line1: opt(256),
  line2: opt(256),
  postalCode: opt(20),
  city: opt(100),
  phone: opt(40),
  country: z.string().trim().min(1, "Country is required"),
  state: z.string().trim().min(1, "State is required"),
});
export type VendorAddressInput = z.input<typeof vendorAddressSchema>;

export const vendorFormSchema = z
  .object({
    clientId: z.string().trim().min(1, "Client is required"),
    displayName: z.string().trim().min(1, "Vendor display name is required").max(VENDOR_DISPLAY_NAME_MAX, `Use at most ${VENDOR_DISPLAY_NAME_MAX} characters`),
    vendorName: z.string().trim().min(1, "Vendor name is required").max(VENDOR_NAME_MAX, `Use at most ${VENDOR_NAME_MAX} characters`),
    useShipAsBilling: z.boolean(),
    shipping: vendorAddressSchema,
    billing: vendorAddressSchema.optional(),
    version: z.number().int().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.useShipAsBilling) return;
    const parsed = vendorAddressSchema.safeParse(v.billing ?? {});
    if (parsed.success) return;
    for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: ["billing", ...issue.path], message: issue.message });
  });
export type VendorFormInput = z.input<typeof vendorFormSchema>;
export type VendorFormValues = z.output<typeof vendorFormSchema>;

export const EMPTY_VENDOR_ADDRESS: VendorAddressInput = {
  name: "", contactName: "", line1: "", line2: "", postalCode: "", city: "", phone: "", country: "US", state: "AL",
};
