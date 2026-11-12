/**
 * Role data restrictions (M14 Manage Restrictions): deep redaction of API payloads and export
 * rows. `redactFor` (foundation, `auth/permissions.ts`) is shallow and opt-in per serializer;
 * this walks any JSON-shaped value (objects, arrays, nested lines / packages / shipments) and
 * nulls every field a restriction covers, so one call at the response boundary
 * (`define-route` → `toResponse`) and one in the export runner hide carrier cost, carrier
 * account data and rate-shopping data everywhere (requests REQ-R4-1 / REQ-R4-2).
 *
 * Pure and allocation-light: values without a restricted key are returned as-is (same
 * reference), so unrestricted users and payloads pay nothing.
 */
import type { Restriction } from '@/server/auth/permissions';

/**
 * Field names hidden per restriction, matched case-insensitively against object keys. Covers
 * the foundation `RESTRICTED_FIELDS` plus the column names used by orders, shipping, packing,
 * returns and billing (e.g. `totalShippingCost`, `returnShippingCost`, `shippingAccountNumber`).
 */
export const DEEP_RESTRICTED_FIELDS: Readonly<Record<Restriction, readonly string[]>> = {
  carrier_cost: [
    'shippingCost',
    'totalShippingCost',
    'returnShippingCost',
    'carrierCost',
    'carrierFee',
    'rate',
    'rateAmount',
    'totalCharge',
    'labelCost',
    'insuranceCost',
    'shippingCharge',
    'shippingCharges',
    'freightCost',
    'postage',
    'postageCost',
    'surcharge',
    'surcharges',
    'baseRate',
    'netCharge',
    'listRate',
    'negotiatedRate',
    'fuelSurcharge',
    'carrierCharge',
  ],
  carrier_account_data: [
    'accountNumber',
    'carrierAccountNumber',
    'shippingAccountNumber',
    'taxDutiesAccountNumber',
    'billingAccount',
    'billingAccountNumber',
    'billingZip',
    'billingPostalCode',
    'meterNumber',
    'thirdPartyAccount',
    'thirdPartyAccountNumber',
    'carrierAccountId',
    'apiKey',
    'apiSecret',
  ],
  rate_shopping_data: [
    'rateShoppingResult',
    'rateShoppingResults',
    'rateQuotes',
    'rateShopRuleId',
    'rateShoppingPresetId',
    'rateShoppingPresetName',
    'selectedRate',
    'rateShoppingLog',
    'rateShopQuotes',
  ],
};

/** Lower-cased key set for the given restrictions (empty when none apply). */
export function restrictedKeySet(
  restrictions: readonly Restriction[],
  fields: Readonly<Record<Restriction, readonly string[]>> = DEEP_RESTRICTED_FIELDS,
): ReadonlySet<string> {
  return new Set(restrictions.flatMap((r) => fields[r] ?? []).map((k) => k.toLowerCase()));
}

const MAX_DEPTH = 12;

function walk(value: unknown, hidden: ReadonlySet<string>, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = walk(item, hidden, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  // Only plain records are walked (Dates, Buffers, Responses pass through untouched).
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return value;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (hidden.has(key.toLowerCase())) {
      out[key] = null;
      if (v !== null) changed = true;
      continue;
    }
    const next = walk(v, hidden, depth + 1);
    if (next !== v) changed = true;
    out[key] = next;
  }
  return changed ? out : value;
}

/**
 * Returns `value` with every restricted field (at any depth) set to null. Never mutates the
 * input; returns the same reference when nothing is restricted.
 */
export function deepRedactFor<T>(
  subject: { readonly restrictions: readonly Restriction[] } | null | undefined,
  value: T,
): T {
  if (!subject || subject.restrictions.length === 0) return value;
  const hidden = restrictedKeySet(subject.restrictions);
  if (hidden.size === 0) return value;
  return walk(value, hidden, 0) as T;
}

/** Export columns a restricted subject must not receive (drop them from the sheet entirely). */
export function restrictedExportColumns<C extends { readonly key: string }>(
  subject: { readonly restrictions: readonly Restriction[] } | null | undefined,
  columns: readonly C[],
): readonly C[] {
  if (!subject || subject.restrictions.length === 0) return columns;
  const hidden = restrictedKeySet(subject.restrictions);
  return columns.filter((c) => !hidden.has(c.key.toLowerCase()));
}
