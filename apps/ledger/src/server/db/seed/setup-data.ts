/**
 * Seed step 1 data (docs/ledger/SPEC.md 11): the items a kitting and 3PL shop invoices for, the
 * Austin sales tax rate, the WMS operation and program fee mappings, and the roles of the demo
 * people. Pure data; `index.ts` writes it.
 */
import type { LedgerRole } from '@/lib/permissions';

export interface SeedItem {
  readonly code: string;
  readonly name: string;
  readonly unitLabel: string;
  readonly price: string;
  /** Revenue account number in the default chart. */
  readonly account: string;
  readonly taxed?: boolean;
}

export const SEED_ITEMS: readonly SeedItem[] = [
  { code: 'RECV', name: 'Receiving', unitLabel: 'carton', price: '1.2500', account: '4200' },
  { code: 'STOR', name: 'Storage, pallet months', unitLabel: 'pallet month', price: '18.5000', account: '4100' },
  { code: 'PICK', name: 'Pick and pack', unitLabel: 'order', price: '2.1500', account: '4300' },
  { code: 'SHIP', name: 'Shipping and freight', unitLabel: 'shipment', price: '0.0000', account: '4500' },
  { code: 'KIT', name: 'Kit assembly', unitLabel: 'kit', price: '2.7500', account: '4000' },
  { code: 'VAS', name: 'Extra services', unitLabel: 'unit', price: '0.5000', account: '4400' },
  { code: 'LABEL', name: 'Labels', unitLabel: 'label', price: '0.0350', account: '4400', taxed: true },
  { code: 'PROG', name: 'Program fee', unitLabel: 'fee', price: '0.0000', account: '4600' },
];

export const SEED_TAX_RATE = { name: 'Texas: Austin 8.25%', rateMillionths: 82500, agency: 'Texas Comptroller' } as const;

/** WMS operation types and program fee kinds to the item that invoices them (SPEC 5.2). */
export const SEED_MAPPINGS: readonly { readonly source: 'wms_operation' | 'program_fee_kind'; readonly key: string; readonly item: string }[] = [
  { source: 'wms_operation', key: 'Receiving', item: 'RECV' },
  { source: 'wms_operation', key: 'Storage', item: 'STOR' },
  { source: 'wms_operation', key: 'Pick and Pack', item: 'PICK' },
  { source: 'wms_operation', key: 'Shipment', item: 'SHIP' },
  { source: 'wms_operation', key: 'Work Order', item: 'KIT' },
  { source: 'wms_operation', key: 'VAS', item: 'VAS' },
  { source: 'program_fee_kind', key: 'per_unit', item: 'KIT' },
  { source: 'program_fee_kind', key: 'batch', item: 'PROG' },
  { source: 'program_fee_kind', key: 'hourly', item: 'PROG' },
  { source: 'program_fee_kind', key: 'monthly', item: 'PROG' },
  { source: 'program_fee_kind', key: 'minimum', item: 'PROG' },
];

/** Demo roles by org slug and email (SPEC 11). Everyone else resolves to none. */
export const SEED_ROLES: Readonly<Record<string, readonly { readonly email: string; readonly role: LedgerRole }[]>> = {
  kitstak: [
    { email: 'admin@kitstak.io', role: 'owner' },
    { email: 'finance@kitstak.io', role: 'bookkeeper' },
    { email: 'ops.manager@kitstak.io', role: 'approver' },
    { email: 'cs.team@kitstak.io', role: 'viewer' },
    { email: 'j.okafor@kitstak.io', role: 'submitter' },
  ],
};

/** Seed step 2 (SPEC 11): Ledger's invoice settings for the 8 `core.customers` of the kitstak org, by code. */
export interface SeedCustomerProfile {
  readonly code: string;
  readonly billingContact: string;
  readonly billingEmails: readonly string[];
  readonly terms: string;
  readonly taxed?: boolean;
  readonly remindersEnabled?: boolean;
  readonly address: { readonly line1: string; readonly city: string; readonly region: string; readonly postalCode: string; readonly country: string };
}

export const SEED_CUSTOMER_PROFILES: Readonly<Record<string, readonly SeedCustomerProfile[]>> = {
  kitstak: [
    { code: 'APX', billingContact: 'Dana Whitfield', billingEmails: ['ap@apexthreads.example'], terms: 'Net 15', address: { line1: '410 W Erie St', city: 'Chicago', region: 'IL', postalCode: '60654', country: 'US' } },
    { code: 'NVF', billingContact: 'Marcus Oyelaran', billingEmails: ['ap@novaforge.example', 'marcus@novaforge.example'], terms: 'Net 30', address: { line1: '88 Townsend St', city: 'San Francisco', region: 'CA', postalCode: '94107', country: 'US' } },
    { code: 'CPL', billingContact: 'Elena Vasquez', billingEmails: ['ap@copperlinecoffee.example'], terms: 'Net 30', address: { line1: '1200 SE Morrison St', city: 'Portland', region: 'OR', postalCode: '97214', country: 'US' } },
    { code: 'BLB', billingContact: 'Priya Raghavan', billingEmails: ['ap@bluebirdandmain.example'], terms: 'Net 30', address: { line1: '27 Main St', city: 'Boston', region: 'MA', postalCode: '02129', country: 'US' } },
    { code: 'VLT', billingContact: 'Tom Keller', billingEmails: ['ap@voltbyte.example'], terms: 'Net 45', address: { line1: '1501 4th Ave', city: 'Seattle', region: 'WA', postalCode: '98101', country: 'US' } },
    { code: 'SMT', billingContact: 'Jess Monroe', billingEmails: ['ap@summittrailgear.example'], terms: 'Net 30', address: { line1: '3100 Blake St', city: 'Denver', region: 'CO', postalCode: '80205', country: 'US' } },
    { code: 'HRB', billingContact: 'Owen Caldwell', billingEmails: ['ap@harborroast.example'], terms: 'Net 30', taxed: true, address: { line1: '9 Wickenden St', city: 'Providence', region: 'RI', postalCode: '02903', country: 'US' } },
    { code: 'PXP', billingContact: 'Sofia Lindqvist', billingEmails: ['ap@pixelandpine.example'], terms: 'Due on receipt', remindersEnabled: false, address: { line1: '55 Water St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US' } },
  ],
};

/** Seed step 2: the made up vendors of SPEC 11, with the account their bills go to by default. */
export interface SeedVendor {
  readonly name: string;
  readonly kinds: readonly ('supplier' | 'carrier' | 'temp_agency' | 'landlord' | 'utility' | 'service')[];
  readonly email: string;
  readonly phone: string;
  readonly account: string;
  readonly terms: string;
  readonly tracks1099?: boolean;
  readonly w9OnFile?: boolean;
}

export const SEED_VENDORS: readonly SeedVendor[] = [
  { name: 'Ridgeway Packaging', kinds: ['supplier'], email: 'ar@ridgewaypackaging.example', phone: '(512) 555-0110', account: '5200', terms: 'Net 30' },
  { name: 'Northstar Staffing', kinds: ['temp_agency'], email: 'billing@northstarstaffing.example', phone: '(512) 555-0122', account: '5100', terms: 'Net 15', tracks1099: true, w9OnFile: true },
  { name: 'Bluewater Freight', kinds: ['carrier'], email: 'ar@bluewaterfreight.example', phone: '(512) 555-0134', account: '5300', terms: 'Net 30', tracks1099: true, w9OnFile: true },
  { name: 'Maple Industrial Properties', kinds: ['landlord'], email: 'rent@mapleindustrial.example', phone: '(512) 555-0146', account: '6000', terms: '1st of next month', tracks1099: true },
  { name: 'City Power and Light', kinds: ['utility'], email: 'accounts@citypower.example', phone: '(512) 555-0158', account: '6100', terms: 'Net 15' },
  { name: 'Clearline Waste', kinds: ['service'], email: 'billing@clearlinewaste.example', phone: '(512) 555-0170', account: '6950', terms: 'Net 30' },
];
