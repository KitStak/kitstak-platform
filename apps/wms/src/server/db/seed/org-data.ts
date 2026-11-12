/** Static organization data: warehouses, retailers, vendor and client addresses. Pure data. */
import type { CitySeed } from '../seed-data';

export interface WarehouseSeed {
  readonly code: 'MLT1' | 'KS2';
  readonly name: string;
  readonly addressLine: string;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly email: string;
  readonly isDefault: boolean;
}

export const WAREHOUSE_SEEDS: readonly WarehouseSeed[] = [
  {
    code: 'MLT1',
    name: 'MLT1 - Main Fulfillment',
    addressLine: '2200 Commerce Park Dr',
    city: 'Louisville',
    state: 'KY',
    postalCode: '40209',
    contactName: 'Renata Alvarez',
    contactPhone: '(502) 555-0140',
    email: 'mlt1@kitstak.io',
    isDefault: true,
  },
  {
    code: 'KS2',
    name: 'KS2 - Overflow',
    addressLine: '480 Gateway Logistics Blvd',
    city: 'Shepherdsville',
    state: 'KY',
    postalCode: '40165',
    contactName: 'Diego Castillo',
    contactPhone: '(502) 555-0188',
    email: 'ks2@kitstak.io',
    isDefault: false,
  },
];

export interface StreetAddress extends CitySeed {
  readonly line1: string;
}

/** HQ / billing address per client code. */
export const CLIENT_ADDRESSES: Readonly<Record<string, StreetAddress>> = {
  APX: {
    line1: '1400 W Fulton Market',
    city: 'Chicago',
    state: 'IL',
    zip: '60607',
    country: 'United States',
  },
  NVF: {
    line1: '500 Terry A Francois Blvd',
    city: 'San Francisco',
    state: 'CA',
    zip: '94158',
    country: 'United States',
  },
  CPL: {
    line1: '2122 SE Division St',
    city: 'Portland',
    state: 'OR',
    zip: '97202',
    country: 'United States',
  },
  BLB: { line1: '88 Kingston St', city: 'Boston', state: 'MA', zip: '02111', country: 'United States' },
  VLT: { line1: '1201 Westlake Ave N', city: 'Seattle', state: 'WA', zip: '98109', country: 'United States' },
  SMT: { line1: '3100 Brighton Blvd', city: 'Denver', state: 'CO', zip: '80216', country: 'United States' },
  HRB: { line1: '60 Valley St', city: 'Providence', state: 'RI', zip: '02909', country: 'United States' },
  PXP: { line1: '45 W 29th St', city: 'New York', state: 'NY', zip: '10001', country: 'United States' },
};

export const CLIENT_OFFICIAL_NAMES: Readonly<Record<string, string>> = {
  APX: 'Apex Threads Company LLC',
  NVF: 'NovaForge Electronics Inc.',
  CPL: 'Copperline Coffee Roasters LLC',
  BLB: 'Bluebird & Main Apparel Co.',
  VLT: 'Voltbyte Labs Inc.',
  SMT: 'Summit Trail Gear LLC',
  HRB: 'Harbor Roast Collective LLC',
  PXP: 'Pixel and Pine Studio LLC',
};

export const VENDOR_ADDRESSES: readonly StreetAddress[] = [
  { line1: '1820 Industrial Way', city: 'Charlotte', state: 'NC', zip: '28208', country: 'United States' },
  {
    line1: '77 Garment District Ave',
    city: 'Los Angeles',
    state: 'CA',
    zip: '90015',
    country: 'United States',
  },
  { line1: '4400 Harbor Gateway', city: 'Long Beach', state: 'CA', zip: '90810', country: 'United States' },
  { line1: '910 Commerce Pkwy', city: 'Dallas', state: 'TX', zip: '75247', country: 'United States' },
  { line1: '2650 Port Rd', city: 'Seattle', state: 'WA', zip: '98134', country: 'United States' },
  { line1: '15 Roaster Row', city: 'Oakland', state: 'CA', zip: '94607', country: 'United States' },
  { line1: '330 Distribution Dr', city: 'Columbus', state: 'OH', zip: '43228', country: 'United States' },
  { line1: '1200 Logistics Blvd', city: 'Savannah', state: 'GA', zip: '31408', country: 'United States' },
];

/** Extra domestic vendors so every client has 2-4. */
export const EXTRA_VENDORS: Readonly<Record<'apparel' | 'electronics' | 'coffee', readonly string[]>> = {
  apparel: ['Carolina Label & Trim'],
  electronics: ['Midwest Packaging Solutions'],
  coffee: ['Cascade Bag & Box'],
};

export interface RetailerSeed {
  readonly name: string;
  readonly businessName: string;
  readonly description: string;
  readonly createCaseLabels: boolean;
  readonly caseLabelPrintQty: number;
  readonly lpLabelPrintQty: number;
  readonly dc: StreetAddress;
}

export const RETAILER_SEEDS: readonly RetailerSeed[] = [
  {
    name: 'Target',
    businessName: 'Target Corporation',
    description: 'Target stores - UCC-128 case labels required on every carton.',
    createCaseLabels: true,
    caseLabelPrintQty: 2,
    lpLabelPrintQty: 2,
    dc: {
      line1: '7000 Target Pkwy N',
      city: 'Minneapolis',
      state: 'MN',
      zip: '55445',
      country: 'United States',
    },
  },
  {
    name: 'Walmart',
    businessName: 'Walmart Inc.',
    description: 'Walmart DC routing guide; GS1 case labels, pallet labels on all four sides.',
    createCaseLabels: true,
    caseLabelPrintQty: 1,
    lpLabelPrintQty: 4,
    dc: {
      line1: '2101 SE Simple Savings Dr',
      city: 'Bentonville',
      state: 'AR',
      zip: '72712',
      country: 'United States',
    },
  },
  {
    name: "Macy's",
    businessName: "Macy's Merchandising Group",
    description: "Macy's Logistics - case labels for floor-ready apparel.",
    createCaseLabels: true,
    caseLabelPrintQty: 1,
    lpLabelPrintQty: 1,
    dc: { line1: "5300 Macy's Way", city: 'Tulsa', state: 'OK', zip: '74116', country: 'United States' },
  },
  {
    name: 'Staples',
    businessName: 'Staples Inc.',
    description: 'Staples Business Advantage - no case labels; BOL per shipment.',
    createCaseLabels: false,
    caseLabelPrintQty: 1,
    lpLabelPrintQty: 1,
    dc: { line1: '500 Staples Dr', city: 'Framingham', state: 'MA', zip: '01702', country: 'United States' },
  },
];

/** Street suffixes that give realistic US delivery lines. */
export function streetLine(num: number, street: string, suffix: string, unit: string | null): string {
  return `${num} ${street} ${suffix}${unit ? ` ${unit}` : ''}`;
}
