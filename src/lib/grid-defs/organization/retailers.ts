/** Retailers (M11, BETA): grid fields and the 3-step wizard schemas. PURE. */
import { z } from "zod";
import { isCountryCode, subdivisionsFor } from "@/lib/countries";
import { optionalEmail, optionalText, requiredText, versionField, type OrgField } from "./common";

export const RETAILERS_GRID_KEY = "retailers";

export const RETAILER_FIELDS: readonly OrgField[] = [
  { field: "name", label: "Name", type: "text" },
  { field: "businessName", label: "Business name", type: "text" },
  { field: "isActive", label: "Status", type: "boolean" },
  { field: "country", label: "Country", type: "text" },
  { field: "createCaseLabels", label: "Case labels", type: "boolean" },
  { field: "orderCount", label: "Orders", type: "number" },
  { field: "createdAt", label: "Created date", type: "date" },
];
export const RETAILER_SORT_FIELDS = ["name", "businessName", "country", "city", "isActive", "orderCount", "createdAt"] as const;
export const RETAILER_SEARCH_FIELDS = ["name", "businessName"] as const;

export const retailerGeneralShape = {
  name: requiredText("Name", 100),
  description: optionalText(250),
  isActive: z.boolean().default(true),
  businessName: optionalText(150),
  logoFileId: z.string().max(64).nullable().optional(),
  line1: optionalText(256),
  line2: optionalText(256),
  postalCode: optionalText(20),
  city: optionalText(100),
  country: z.string({ error: "Country is required" }).refine(isCountryCode, "Country is required"),
  state: optionalText(100),
  email: optionalEmail,
  phone: optionalText(40),
};
const stateCheck = (v: { country: string; state?: string | null }, ctx: z.RefinementCtx) => {
  const subs = subdivisionsFor(v.country);
  if (v.state && subs.length > 0 && !subs.some((s) => s.code === v.state)) ctx.addIssue({ code: "custom", path: ["state"], message: "Choose a valid state" });
};
export const retailerGeneralSchema = z.object(retailerGeneralShape).superRefine(stateCheck);

const qty = (label: string) => z.number({ error: `${label} is required` }).int("Whole number").min(1, "At least 1").max(99, "At most 99");
export const retailerAdvancedShape = {
  createCaseLabels: z.boolean().default(false),
  caseLabelPrintQty: qty("Case label print quantity"),
  lpLabelPrintQty: qty("LP label print quantity"),
  documentFileIds: z.array(z.string().max(64)).max(20).default([]),
};
export const retailerAdvancedSchema = z.object(retailerAdvancedShape);
export const retailerOtherSchema = z.object({ customFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}) });

export const retailerSchema = z.object({ ...retailerGeneralShape, ...retailerAdvancedShape, customFields: retailerOtherSchema.shape.customFields, version: versionField }).superRefine(stateCheck);
export type RetailerInput = z.input<typeof retailerSchema>;
export type RetailerSave = z.output<typeof retailerSchema>;

export const RETAILER_DEFAULTS: RetailerInput = {
  name: "", description: "", isActive: true, businessName: "", logoFileId: null, line1: "", line2: "", postalCode: "", city: "", country: "US", state: "",
  email: "", phone: "", createCaseLabels: false, caseLabelPrintQty: 1, lpLabelPrintQty: 1, documentFileIds: [], customFields: {},
};
