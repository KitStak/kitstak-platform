/**
 * What a vendor is to the shop (`core.vendors.kinds`, docs/ledger/SPEC.md 5.1). Kept in step with
 * the `vendors_kinds_check` constraint of `@kitstak/db`. Pure, safe in client components.
 */
export const VENDOR_KINDS = ['supplier', 'carrier', 'temp_agency', 'landlord', 'utility', 'service', 'other'] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

export const VENDOR_KIND_LABELS: Readonly<Record<VendorKind, string>> = {
  supplier: 'Supplier',
  carrier: 'Carrier',
  temp_agency: 'Temp agency',
  landlord: 'Landlord',
  utility: 'Utility',
  service: 'Service',
  other: 'Other',
};

export function isVendorKind(value: unknown): value is VendorKind {
  return typeof value === 'string' && (VENDOR_KINDS as readonly string[]).includes(value);
}
