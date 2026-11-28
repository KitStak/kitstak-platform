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
