/**
 * Printout type catalog — the 25 Logiwa printout types (references/logiwa-spec/
 * 08-settings-shell.md §Printouts & Labels). `typeKey` is stored on
 * `printout_templates.type_key`; `baseTemplate` is the renderer key under `templates/`.
 * PURE (client-safe).
 */

export const PRINT_CATEGORIES = ['lists', 'labels', 'billings', 'others'] as const;
export type PrintCategory = (typeof PRINT_CATEGORIES)[number];

export const PRINT_FORMATS = ['pdf', 'zpl'] as const;
export type PrintFormat = (typeof PRINT_FORMATS)[number];

export interface PrintTypeDef {
  readonly key: string;
  readonly name: string;
  readonly category: PrintCategory;
  readonly printerType: 'Label Printer' | 'Laser Printer';
  /** Formats the renderer supports; first = default. */
  readonly formats: readonly PrintFormat[];
  /** Renderer key in `templates/` (null = not implemented yet → "Not configured"). */
  readonly renderer: string | null;
  readonly beta?: boolean;
}

const list = (key: string, name: string, renderer: string | null): PrintTypeDef => ({
  key,
  name,
  category: 'lists',
  printerType: 'Laser Printer',
  formats: ['pdf'],
  renderer,
});
const label = (key: string, name: string, renderer: string | null, beta = false): PrintTypeDef => ({
  key,
  name,
  category: 'labels',
  printerType: 'Label Printer',
  formats: renderer ? ['pdf', 'zpl'] : ['pdf'],
  renderer,
  ...(beta ? { beta } : {}),
});
const billing = (key: string, name: string, renderer: string | null = null): PrintTypeDef => ({
  key,
  name,
  category: 'billings',
  printerType: 'Laser Printer',
  formats: ['pdf'],
  renderer,
});

export const PRINT_TYPES: readonly PrintTypeDef[] = Object.freeze([
  list('packing-list', 'Packing List', 'packing-slip'),
  list('packing-slip', 'Packing Slip', 'packing-slip'),
  list('picking-list', 'Picking List', 'pick-list'),
  list('consolidated-picking-list', 'Consolidated Picking List', 'pick-list'),
  list('purchase-order-list', 'Purchase Order List', 'purchase-order'),
  list('manifest-bol', 'Manifest/BOL', 'manifest-bol'),
  list('work-order-picking-list', 'Work Order Picking List', 'pick-list'),
  list('work-order-consolidated-picking-list', 'Work Order Consolidated Picking List', 'pick-list'),
  list('resolution-job', 'Resolution Job', null),
  label('lp-label', 'LP Label', 'barcode-label'),
  label('location-label', 'Location Label', 'barcode-label'),
  label('product-label', 'Product Label', 'barcode-label'),
  label('mobile-cart-label', 'Mobile Cart', 'barcode-label'),
  label('job-picking-list-label', 'Job Picking List', null),
  label('pick-short-label', 'Pick Short Label', null),
  label('pack-short-label', 'Pack Short Label', null),
  label('retailer-case-label', 'Retailer Label For Case', 'barcode-label', true),
  label('retailer-parent-lp-label', 'Retailer Label For Parent LP', 'barcode-label', true),
  label('shipping-label', 'Shipping Label', 'shipping-label'),
  billing('contract', 'Contract'),
  billing('billing-report', 'Billing Report'),
  billing('so-billing-charges', 'SO Billing Charges'),
  billing('po-billing-charges', 'PO Billing Charges', 'po-billing-charges'),
  {
    key: 'custom-eod',
    name: 'Custom EOD',
    category: 'others',
    printerType: 'Laser Printer',
    formats: ['pdf'],
    renderer: null,
  },
  {
    key: 'job-content',
    name: 'Job Content',
    category: 'others',
    printerType: 'Laser Printer',
    formats: ['pdf'],
    renderer: null,
  },
]);

export const PRINT_TYPE_KEYS: readonly string[] = Object.freeze(PRINT_TYPES.map((t) => t.key));

const BY_KEY: ReadonlyMap<string, PrintTypeDef> = new Map(PRINT_TYPES.map((t) => [t.key, t]));

export function getPrintType(key: string): PrintTypeDef | undefined {
  return BY_KEY.get(key);
}

export function isPrintImplemented(key: string): boolean {
  return Boolean(BY_KEY.get(key)?.renderer);
}
