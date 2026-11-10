/**
 * Return Process settings (M14 Data Setup › Return Process). PURE.
 * Eight account-wide Return Parameters (Logiwa parity) that M04 return receiving enforces.
 * Stored on `company_settings.defaults.returnRules`; RMA codes use the `rma` code sequence.
 */
import { z } from "zod";

export const RETURN_RULE_KEYS = [
  "expiryDateMatch",
  "productionDateMatch",
  "lotNumberMatch",
  "serialNumberMatch",
  "packTypeMatch",
  "preventUnspecifiedSku",
  "preventExceedingShippedQty",
  "allowAlternateWarehouse",
] as const;

export type ReturnRuleKey = (typeof RETURN_RULE_KEYS)[number];
export type ReturnRules = Readonly<Record<ReturnRuleKey, boolean>>;

export interface ReturnRuleDef {
  readonly key: ReturnRuleKey;
  readonly label: string;
  readonly description: string;
  readonly group: "match" | "limits";
}

export const RETURN_RULE_DEFS: readonly ReturnRuleDef[] = [
  { key: "expiryDateMatch", group: "match", label: "Expiry date match", description: "Accept a return only with an expiry date that was shipped on the order." },
  { key: "productionDateMatch", group: "match", label: "Production date match", description: "Accept a return only with a production date that was shipped on the order." },
  { key: "lotNumberMatch", group: "match", label: "Lot / batch number match", description: "Accept a return only with a lot or batch number that was shipped on the order." },
  { key: "serialNumberMatch", group: "match", label: "Serial number match", description: "Accept a return only for serial numbers that were shipped on the order." },
  { key: "packTypeMatch", group: "match", label: "Pack type match", description: "Accept a return only in the pack type it was shipped in." },
  { key: "preventUnspecifiedSku", group: "limits", label: "Prevent unspecified SKU returns", description: "Return only SKUs that were shipped on the order." },
  { key: "preventExceedingShippedQty", group: "limits", label: "Prevent exceeding shipped quantity", description: "Block returning more units of a SKU than were shipped." },
  { key: "allowAlternateWarehouse", group: "limits", label: "Enable returns to alternate warehouses", description: "Allow returns into a warehouse different from the one the order shipped from." },
];

/** Logiwa ships every parameter switched on. */
export const DEFAULT_RETURN_RULES: ReturnRules = Object.fromEntries(RETURN_RULE_KEYS.map((k) => [k, true])) as ReturnRules;

export const returnRulesShape = Object.fromEntries(RETURN_RULE_KEYS.map((k) => [k, z.boolean()])) as Record<ReturnRuleKey, z.ZodBoolean>;

export const returnRulesSchema = z.object({ ...returnRulesShape, version: z.number().int().min(0).optional() });
export type ReturnRulesInput = z.output<typeof returnRulesSchema>;

/** Stored JSON → full rule set (unknown keys dropped, missing keys take the default). */
export function normalizeReturnRules(raw: unknown): ReturnRules {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(RETURN_RULE_KEYS.map((k) => [k, typeof obj[k] === "boolean" ? obj[k] : DEFAULT_RETURN_RULES[k]])) as ReturnRules;
}

/** Change-log friendly view: "Expiry date match: On". */
export function returnRulesView(rules: ReturnRules): Record<string, string> {
  return Object.fromEntries(RETURN_RULE_DEFS.map((d) => [d.label, rules[d.key] ? "On" : "Off"]));
}

export function countOn(rules: ReturnRules): number {
  return RETURN_RULE_KEYS.filter((k) => rules[k]).length;
}

/* ---------------- enforcement helper for M04 return receiving ---------------- */

export interface ShippedLine {
  readonly productId: string;
  readonly qty: number;
  readonly lot?: string | null;
  readonly expiryDate?: string | null;
  readonly productionDate?: string | null;
  readonly packTypeId?: string | null;
  readonly serials?: readonly string[];
}

export interface ReturnedLine {
  readonly productId: string;
  readonly qty: number;
  readonly lot?: string | null;
  readonly expiryDate?: string | null;
  readonly productionDate?: string | null;
  readonly packTypeId?: string | null;
  readonly serials?: readonly string[];
  /** Qty already returned against this SKU on earlier receipts. */
  readonly alreadyReturned?: number;
}

export interface ReturnViolation {
  readonly rule: ReturnRuleKey;
  readonly message: string;
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Checks one returned line against what shipped and the active rules.
 * `warehouseMismatch` = the receiving warehouse differs from the shipping warehouse.
 * Returns every violation (empty = accepted). Pure, so M04 and tests share it.
 */
export function checkReturnLine(rules: ReturnRules, shipped: readonly ShippedLine[], line: ReturnedLine, opts: { readonly warehouseMismatch?: boolean } = {}): ReturnViolation[] {
  const out: ReturnViolation[] = [];
  if (opts.warehouseMismatch && !rules.allowAlternateWarehouse) out.push({ rule: "allowAlternateWarehouse", message: "Returns must be received in the warehouse the order shipped from" });
  const forSku = shipped.filter((s) => s.productId === line.productId);
  if (forSku.length === 0) {
    if (rules.preventUnspecifiedSku) out.push({ rule: "preventUnspecifiedSku", message: "This SKU was not shipped on the order" });
    return out;
  }
  const shippedQty = forSku.reduce((sum, s) => sum + s.qty, 0);
  if (rules.preventExceedingShippedQty && (line.alreadyReturned ?? 0) + line.qty > shippedQty) {
    out.push({ rule: "preventExceedingShippedQty", message: `Only ${Math.max(shippedQty - (line.alreadyReturned ?? 0), 0)} more can be returned (shipped ${shippedQty})` });
  }
  const attr = (rule: ReturnRuleKey, key: "lot" | "expiryDate" | "productionDate" | "packTypeId", label: string) => {
    if (!rules[rule] || !line[key]) return;
    if (!forSku.some((s) => same(s[key], line[key]))) out.push({ rule, message: `${label} ${line[key]} was not shipped on the order` });
  };
  attr("lotNumberMatch", "lot", "Lot");
  attr("expiryDateMatch", "expiryDate", "Expiry date");
  attr("productionDateMatch", "productionDate", "Production date");
  attr("packTypeMatch", "packTypeId", "Pack type");
  if (rules.serialNumberMatch && line.serials?.length) {
    const shippedSerials = new Set(forSku.flatMap((s) => s.serials ?? []).map((x) => x.trim().toLowerCase()));
    const unknown = line.serials.filter((x) => !shippedSerials.has(x.trim().toLowerCase()));
    if (unknown.length) out.push({ rule: "serialNumberMatch", message: `Serial ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? ` +${unknown.length - 3}` : ""} was not shipped on the order` });
  }
  return out;
}
