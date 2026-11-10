/** Catalog definitions layered on the base product pool: kits, packaging, tracking, packs. Pure data. */
import type { ProductSeed } from "../seed-data";

export const EXTRA_PRODUCTS: readonly ProductSeed[] = [
  { clientCode: "APX", sku: "APX-KIT-TEE3", name: "Apex Classic Tee 3-Pack Bundle (Black / White / Navy, M)", category: "Apparel", price: 62, weightOz: 19.5, lengthIn: 11, widthIn: 9, heightIn: 3, isKit: true, isFragile: false },
  { clientCode: "NVF", sku: "NOVA-KIT-ROAD", name: "NovaForge Road Warrior Kit (65W Charger + 2m Cable + 10K PowerCell)", category: "Electronics", price: 99, weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 3, isKit: true, isFragile: true },
  { clientCode: "APX", sku: "APX-PKG-POLY-1013", name: "Apex Branded Poly Mailer 10x13", category: "Packaging", price: 0.38, weightOz: 0.6, lengthIn: 13, widthIn: 10, heightIn: 0.1, isKit: false, isFragile: false },
  { clientCode: "NVF", sku: "NOVA-PKG-ASB-0608", name: "Anti-Static Bubble Bag 6x8", category: "Packaging", price: 0.22, weightOz: 0.3, lengthIn: 8, widthIn: 6, heightIn: 0.2, isKit: false, isFragile: false },
  { clientCode: "CPL", sku: "CPL-PKG-SLEEVE", name: "Copperline Gift Sleeve - Kraft", category: "Packaging", price: 0.65, weightOz: 1.2, lengthIn: 9, widthIn: 9, heightIn: 0.2, isKit: false, isFragile: false },
  { clientCode: "VLT", sku: "VLT-PKG-BOX-12106", name: "Voltbyte Shipper Box 12x10x6", category: "Packaging", price: 1.1, weightOz: 7, lengthIn: 12, widthIn: 10, heightIn: 6, isKit: false, isFragile: false },
];

export interface KitDef {
  readonly sku: string;
  readonly kitType: "Kit to Stock" | "Kit to Order";
  readonly components: readonly (readonly [string, number])[];
}

export const KIT_DEFS: readonly KitDef[] = [
  { sku: "VLT-KIT-DESK", kitType: "Kit to Stock", components: [["VLT-MSE-WRLS", 1], ["VLT-KBD-MECH", 1], ["VLT-STAND-LPT", 1]] },
  { sku: "CPL-KIT-SAMPLER", kitType: "Kit to Stock", components: [["CPL-BAG-ESP-12", 1], ["CPL-BAG-MED-12", 1], ["CPL-BAG-DRK-12", 1], ["CPL-BAG-DEC-12", 1]] },
  { sku: "HRB-KIT-GIFT", kitType: "Kit to Stock", components: [["HRB-BAG-HSE-12", 1], ["HRB-BAG-SNG-12", 1], ["HRB-FLTR-100", 1]] },
  { sku: "PXP-KIT-TRAVEL", kitType: "Kit to Order", components: [["PXP-CASE-IP16", 1], ["PXP-CHG-MAG", 1], ["PXP-GRIP-POP", 1]] },
  { sku: "APX-KIT-TEE3", kitType: "Kit to Order", components: [["APX-TEE-BLK-M", 1], ["APX-TEE-WHT-M", 1], ["APX-TEE-NVY-M", 1]] },
  { sku: "NOVA-KIT-ROAD", kitType: "Kit to Order", components: [["NOVA-CHG-65W", 1], ["NOVA-CBL-USBC-2M", 1], ["NOVA-PWB-10K", 1]] },
];

/** Serial-tracked SKUs (serials captured at receiving and packing). */
export const SERIAL_SKUS: ReadonlySet<string> = new Set(["VLT-EBD-PRO", "NOVA-HUB-7P", "NOVA-PWB-20K"]);

/** Lot + expiry tracked SKUs (roasted coffee, 270-day shelf life). */
export const LOT_SKUS: ReadonlySet<string> = new Set([
  "CPL-BAG-ESP-12", "CPL-BAG-MED-12", "CPL-BAG-DRK-12", "CPL-BAG-DEC-12", "CPL-BAG-ESP-32", "CPL-PODS-24", "HRB-BAG-HSE-12", "HRB-BAG-SNG-12",
]);

/** Retired at the end of the replay (Inactive status). */
export const RETIRED_SKUS: ReadonlySet<string> = new Set(["PXP-CASE-IP15", "PXP-SCR-IP15", "NOVA-CBL-LTG-2M"]);

/** SKUs kept deliberately short so allocation shortages occur naturally. */
export const SCARCE_SKUS: ReadonlySet<string> = new Set(["SMT-JKT-OLV-M", "VLT-SPK-XL", "HRB-GRND-BRL"]);

export interface ProductTaxonomy {
  readonly type: string;
  readonly group: string;
}

export function taxonomyFor(category: string, sku: string): ProductTaxonomy {
  if (sku.includes("-PKG-")) return { type: "Packaging", group: category === "Coffee" ? "Year-Round Roasts" : "Core Line" };
  if (sku.includes("-KIT-")) return { type: category === "Coffee" ? "Gift Sets" : "Bundles", group: category === "Coffee" ? "Limited Release" : category === "Apparel" ? "Seasonal" : "Premium" };
  if (category === "Apparel") {
    const type = sku.includes("JKT") || sku.includes("HOOD") ? "Outerwear" : sku.includes("TEE") ? "Tops" : "Accessories";
    return { type, group: sku.includes("JKT") ? "Seasonal" : "Core Line" };
  }
  if (category === "Electronics") {
    const type = sku.includes("CBL") ? "Cables" : sku.includes("CHG") || sku.includes("PWB") ? "Chargers & Power"
      : sku.includes("EBD") || sku.includes("SPK") ? "Audio" : "Desk Accessories";
    return { type, group: sku.includes("PRO") || sku.includes("XL") || sku.includes("MECH") ? "Premium" : "Core Line" };
  }
  const type = sku.includes("PODS") || sku.includes("INST") ? "Single Serve" : sku.includes("BAG") ? "Whole Bean" : "Merchandise";
  return { type, group: sku.includes("SNG") || sku.includes("DEC") ? "Limited Release" : "Year-Round Roasts" };
}

/** Case quantity for SKUs that also ship in master cases (≈40% of the catalog). */
export function caseQtyFor(category: string, sku: string): number | null {
  if (sku.includes("-KIT-") || sku.includes("-PKG-")) return null;
  if (category === "Apparel") return sku.includes("TEE") || sku.includes("SOCK") ? 24 : null;
  if (category === "Electronics") return sku.includes("CBL") ? 50 : sku.includes("CHG") ? 20 : null;
  return sku.includes("-12") || sku.includes("PODS") ? 12 : null;
}

export const CUSTOMS_BY_CATEGORY: Readonly<Record<string, { hsCode: string; originCountry: string }>> = {
  Apparel: { hsCode: "6109.10", originCountry: "Vietnam" },
  Electronics: { hsCode: "8544.42", originCountry: "China" },
  Coffee: { hsCode: "0901.21", originCountry: "Colombia" },
  Packaging: { hsCode: "3923.21", originCountry: "United States" },
};

/** UPC-A check digit for an 11-digit body. */
export function upcCheckDigit(body11: string): number {
  const digits = body11.split("").map(Number);
  const odd = digits.filter((_, i) => i % 2 === 0).reduce((s, d) => s + d, 0);
  const even = digits.filter((_, i) => i % 2 === 1).reduce((s, d) => s + d, 0);
  return (10 - ((odd * 3 + even) % 10)) % 10;
}

/** GTIN check digit (GS1 mod 10) for any body length. */
export function gtinCheckDigit(body: string): number {
  const digits = body.split("").map(Number).reverse();
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

export function upcFor(index: number): string {
  const body = `8410${String(index * 37 + 1000).padStart(7, "0")}`;
  return `${body}${upcCheckDigit(body)}`;
}

export function caseGtinFor(upc: string): string {
  const body = `10${upc.slice(0, 11)}`;
  return `${body}${gtinCheckDigit(body)}`;
}
