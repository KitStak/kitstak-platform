import type { StackChoice } from '@/components/site-links';

/**
 * PLACEHOLDER PRICING. These numbers are stand-ins so the pages and the setup wizard can show a
 * working estimate; they are not KitStak's real prices. Billing is not connected (Stripe comes
 * last), so nothing here is charged. Change the values in `PRICING` and every page follows.
 */
export const PRICING_IS_PLACEHOLDER = true;

export type ProductId = 'crm' | 'wms';
export type Billing = 'monthly' | 'annual';

interface ProductPrice {
  readonly name: string;
  readonly unit: string;
  readonly unitPlural: string;
  readonly monthlyCents: number;
  readonly max: number;
}

interface PricingTable extends Readonly<Record<ProductId, ProductPrice>> {
  /** Off both products when they are licensed together. */
  readonly bundleDiscount: number;
  /** Off the monthly price when billed yearly. */
  readonly annualDiscount: number;
}

export const PRICING: PricingTable = {
  crm: { name: 'KitStak CRM', unit: 'user', unitPlural: 'users', monthlyCents: 2900, max: 500 },
  wms: { name: 'KitStak WMS', unit: 'warehouse', unitPlural: 'warehouses', monthlyCents: 34900, max: 50 },
  bundleDiscount: 0.2,
  annualDiscount: 0.15,
};

export interface QuoteInput {
  readonly stack: StackChoice;
  readonly seats: number;
  readonly warehouses: number;
  readonly billing: Billing;
}

export interface QuoteLine {
  readonly product: ProductId;
  readonly name: string;
  readonly quantity: number;
  readonly unitLabel: string;
  readonly unitCents: number;
  readonly subtotalCents: number;
}

export interface Quote {
  readonly lines: readonly QuoteLine[];
  readonly listMonthlyCents: number;
  readonly bundleSavingsCents: number;
  readonly annualSavingsCents: number;
  readonly totalSavingsCents: number;
  /** What one month costs after every discount. */
  readonly monthlyCents: number;
}

function clampQuantity(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), max);
}

function line(product: ProductId, rawQuantity: number): QuoteLine {
  const price = PRICING[product];
  const quantity = clampQuantity(rawQuantity, price.max);
  return {
    product,
    name: price.name,
    quantity,
    unitLabel: quantity === 1 ? price.unit : price.unitPlural,
    unitCents: price.monthlyCents,
    subtotalCents: price.monthlyCents * quantity,
  };
}

/** Monthly estimate for a stack. The CRM is priced per user, the WMS per warehouse. */
export function quote(input: QuoteInput): Quote {
  const lines = [
    ...(input.stack !== 'wms' ? [line('crm', input.seats)] : []),
    ...(input.stack !== 'crm' ? [line('wms', input.warehouses)] : []),
  ];

  const listMonthlyCents = lines.reduce((sum, l) => sum + l.subtotalCents, 0);
  const bundleSavingsCents = input.stack === 'both' ? Math.round(listMonthlyCents * PRICING.bundleDiscount) : 0;
  const afterBundle = listMonthlyCents - bundleSavingsCents;
  const annualSavingsCents = input.billing === 'annual' ? Math.round(afterBundle * PRICING.annualDiscount) : 0;

  return {
    lines,
    listMonthlyCents,
    bundleSavingsCents,
    annualSavingsCents,
    totalSavingsCents: bundleSavingsCents + annualSavingsCents,
    monthlyCents: afterBundle - annualSavingsCents,
  };
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function formatUsd(cents: number): string {
  return USD.format(Math.round(cents / 100));
}

export function percentLabel(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
