/** Company Settings schemas: information, account defaults, security policy (M14). PURE. */
import { z } from "zod";
import { CURRENCIES, DIMENSION_UNITS, WEIGHT_UNITS } from "@/lib/enums";
import { requiredText, versionField } from "./common";

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIMES = ["image/png", "image/jpeg"] as const;

export const companyInfoSchema = z.object({
  displayName: requiredText("Company display name", 60),
  fullName: requiredText("Company full name", 160),
  version: versionField,
});

export const COMPANY_DATE_FORMATS = [
  { value: "M/D/YYYY h:mm:ss A", label: "M/D/YYYY (default)" },
  { value: "MM/DD/YYYY h:mm:ss A", label: "MM/dd/yyyy" },
  { value: "DD/MM/YYYY h:mm:ss A", label: "dd/MM/yyyy" },
  { value: "YYYY/MM/DD h:mm:ss A", label: "yyyy/MM/dd" },
] as const;

export const companyDefaultsSchema = z.object({
  currency: z.enum(CURRENCIES, { error: "Choose a currency" }),
  weightUnit: z.enum(WEIGHT_UNITS, { error: "Choose a weight unit" }),
  dimensionUnit: z.enum(DIMENSION_UNITS, { error: "Choose a dimension unit" }),
  dateFormat: z.string().trim().min(1, "Choose a date format").max(40),
  version: versionField,
});

export const companySecuritySchema = z.object({
  minLength: z.number({ error: "Enter a length" }).int("Whole number").min(8, "At least 8 characters").max(64, "At most 64 characters"),
  requireUpper: z.boolean(),
  requireNumber: z.boolean(),
  requireSymbol: z.boolean(),
  expires: z.boolean(),
  maxAgeDays: z.number({ error: "Enter a number of days" }).int("Whole number").min(1, "At least 1 day").max(3650, "At most 3650 days"),
  lockoutThreshold: z.number({ error: "Enter a number" }).int("Whole number").min(3, "At least 3 attempts").max(50, "At most 50 attempts"),
  lockoutMinutes: z.number({ error: "Enter minutes" }).int("Whole number").min(1, "At least 1 minute").max(1440, "At most 24 hours"),
  version: versionField,
});

export type CompanyInfoValues = z.input<typeof companyInfoSchema>;
export type CompanyDefaultsValues = z.input<typeof companyDefaultsSchema>;
export type CompanySecurityValues = z.input<typeof companySecuritySchema>;

/** Plain-language summary of a password policy ("12+ characters with upper, number and symbol"). */
export function policySummary(p: { minLength: number; requireUpper: boolean; requireNumber: boolean; requireSymbol: boolean }): string {
  const parts = [p.requireUpper ? "upper and lower case" : null, p.requireNumber ? "a number" : null, p.requireSymbol ? "a symbol" : null].filter(Boolean);
  return `${p.minLength}+ characters${parts.length ? ` with ${parts.join(", ")}` : ""}`;
}
