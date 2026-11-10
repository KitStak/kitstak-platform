/**
 * Address schema (BUILD_PLAN F4.4): US ZIP / ZIP+4 and Canadian postal validation,
 * state/province required for US and CA, address type, tax type + ID. PURE — the
 * same schema can validate API bodies server-side.
 */
import { z } from "zod";
import { ADDRESS_TYPES, TAX_TYPES } from "@/lib/enums";
import { isCountryCode, subdivisionsFor } from "@/lib/countries";

export const US_ZIP_RE = /^\d{5}(-\d{4})?$/;
export const CA_POSTAL_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

export function postalError(country: string, postal: string): string | null {
  const value = postal.trim();
  if (!value) return "Enter a postal code";
  if (country === "US" && !US_ZIP_RE.test(value)) return "Use a 5-digit ZIP or ZIP+4 (12345-6789)";
  if (country === "CA" && !CA_POSTAL_RE.test(value)) return "Use a Canadian postal code (A1A 1A1)";
  if (value.length > 20) return "At most 20 characters";
  return null;
}

/** Canonical postal form: uppercase, single space for CA. */
export function normalizePostal(country: string, postal: string): string {
  const value = postal.trim().toUpperCase();
  if (country === "CA") {
    const compact = value.replace(/[\s-]/g, "");
    return compact.length === 6 ? `${compact.slice(0, 3)} ${compact.slice(3)}` : value;
  }
  return value;
}

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`);

export const addressSchema = z
  .object({
    name: text(120).min(1, "Enter a name"),
    company: text(120).default(""),
    line1: text(200).min(1, "Enter the street address"),
    line2: text(200).default(""),
    city: text(100).min(1, "Enter a city"),
    state: text(100).default(""),
    postalCode: text(20).default(""),
    country: z.string().refine(isCountryCode, "Choose a country"),
    phone: text(40).default(""),
    email: z.union([z.literal(""), z.email("Enter a valid email")]).default(""),
    addressType: z.enum(ADDRESS_TYPES).default("Residential"),
    taxType: z.enum(TAX_TYPES).nullish(),
    taxId: text(60).default(""),
  })
  .superRefine((a, ctx) => {
    const subdivisions = subdivisionsFor(a.country);
    if (subdivisions.length > 0) {
      if (!a.state) ctx.addIssue({ code: "custom", path: ["state"], message: a.country === "CA" ? "Choose a province" : "Choose a state" });
      else if (!subdivisions.some((s) => s.code === a.state)) ctx.addIssue({ code: "custom", path: ["state"], message: "Choose a valid state / province" });
    }
    const requiresPostal = a.country === "US" || a.country === "CA";
    const err = requiresPostal || a.postalCode ? postalError(a.country, a.postalCode) : null;
    if (err) ctx.addIssue({ code: "custom", path: ["postalCode"], message: err });
    if (a.taxId && !a.taxType) ctx.addIssue({ code: "custom", path: ["taxType"], message: "Choose the tax type for this ID" });
  });

export type AddressInput = z.input<typeof addressSchema>;
export type Address = z.output<typeof addressSchema>;

export const EMPTY_ADDRESS: AddressInput = {
  name: "",
  company: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
  phone: "",
  email: "",
  addressType: "Residential",
  taxType: null,
  taxId: "",
};

/** Multi-line display form (used by AddressCard and print previews). */
export function formatAddressLines(a: Partial<Address>): readonly string[] {
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.company, a.line1, a.line2, cityLine, a.country].filter((l): l is string => Boolean(l && l.trim()));
}
