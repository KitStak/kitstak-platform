import { PRODUCT_IDS } from '@/components/site-links';
import type { ProductId, Stack } from '@/components/site-links';

/**
 * PLACEHOLDER PRICING for every product that is not marked `isConfirmed`. Those numbers are
 * stand-ins so the pages and the setup wizard can show a working estimate; they are not KitStak's
 * real prices. Billing is not connected (Stripe comes last), so nothing here is charged. Change the
 * values in `PRICING` and every page follows.
 */
export const PRICING_IS_PLACEHOLDER = true;

export type { ProductId };
export type Billing = 'monthly' | 'annual';

/** Which number a per unit product is multiplied by. */
export type QuantitySource = 'seats' | 'warehouses';

interface PriceBase {
  readonly name: string;
  /** What one price buys, as it reads after "per": "user", "warehouse", "organization". */
  readonly unit: string;
  readonly unitPlural: string;
  readonly monthlyCents: number;
  /** True once the owner has confirmed this price. A confirmed price is never called preliminary. */
  readonly isConfirmed?: true;
}

/** Charged for each unit: `monthlyCents` times the seats or the warehouses. */
export interface PerUnitPrice extends PriceBase {
  readonly basis: 'per_unit';
  readonly quantityFrom: QuantitySource;
  readonly max: number;
}

/** One flat price for the whole organization. Seats and warehouses never change it. */
export interface FlatOrgPrice extends PriceBase {
  readonly basis: 'flat_per_org';
  /** How many seats the flat price covers. There is no price above this: the visitor talks to us. */
  readonly includedSeats: number;
}

export type ProductPrice = PerUnitPrice | FlatOrgPrice;
export type BillingBasis = ProductPrice['basis'];

interface Discounts {
  /** Off every product when two or more are licensed together. */
  readonly bundleDiscount: number;
  /** Off the monthly price when billed yearly. */
  readonly annualDiscount: number;
}

export const PRICING = {
  crm: {
    basis: 'per_unit',
    quantityFrom: 'seats',
    name: 'KitStak CRM',
    unit: 'user',
    unitPlural: 'users',
    monthlyCents: 2900,
    max: 500,
  },
  wms: {
    basis: 'per_unit',
    quantityFrom: 'warehouses',
    name: 'KitStak WMS',
    unit: 'warehouse',
    unitPlural: 'warehouses',
    monthlyCents: 34900,
    max: 50,
  },
  projects: {
    basis: 'per_unit',
    quantityFrom: 'seats',
    name: 'KitStak Projects',
    unit: 'user',
    unitPlural: 'users',
    monthlyCents: 1200,
    max: 500,
  },
  // Confirmed by the owner: $29 per organization per month, covering up to 5 seats. The owner gave
  // no price above 5 seats, so the site quotes none and points to the contact page.
  pulse: {
    basis: 'flat_per_org',
    name: 'KitStak Pulse',
    unit: 'organization',
    unitPlural: 'organizations',
    monthlyCents: 2900,
    includedSeats: 5,
    isConfirmed: true,
  },
  bundleDiscount: 0.2,
  annualDiscount: 0.15,
} as const satisfies Readonly<Record<ProductId, ProductPrice>> & Discounts;

/** The price entry for any product, as the union of both billing shapes. */
export function priceOf(product: ProductId): ProductPrice {
  return PRICING[product];
}

/** True when the product is charged per user, so the seat count changes its line. */
export function isPerSeat(product: ProductId): boolean {
  const price = priceOf(product);
  return price.basis === 'per_unit' && price.quantityFrom === 'seats';
}

/** "Up to 5 seats" for a flat product, otherwise null. */
export function includedSeatsLabel(product: ProductId): string | null {
  const price = priceOf(product);
  return price.basis === 'flat_per_org' ? `Up to ${price.includedSeats} seats` : null;
}

/** The question a visitor over the seat limit has. Pages link it to the contact route. */
export function moreSeatsPrompt(product: ProductId): string | null {
  const price = priceOf(product);
  return price.basis === 'flat_per_org' ? `Need more than ${price.includedSeats} seats?` : null;
}

/** The link text that follows `moreSeatsPrompt`. */
export const MORE_SEATS_ACTION = 'Talk to us.';

/**
 * The line under a figure while some of the prices shown are stand-ins. Null when every price shown
 * is confirmed. A confirmed price beside stand-ins is named, so nobody reads it as preliminary.
 */
export function preliminaryPriceNote(products: readonly ProductId[]): string | null {
  if (!PRICING_IS_PLACEHOLDER) return null;
  const confirmed = products.filter((id) => priceOf(id).isConfirmed);
  if (confirmed.length === products.length) return null;
  const names = confirmed.map((id) => priceOf(id).name.replace('KitStak ', ''));
  const final = names.length > 0 ? ` The ${names.join(' and ')} price is final.` : '';
  return `Preliminary pricing, shown for planning.${final}`;
}

export interface QuoteInput {
  readonly stack: Stack;
  /** People who sign in. Priced for every per user product (the CRM and Projects share one sign-in). */
  readonly seats: number;
  readonly warehouses: number;
  readonly billing: Billing;
}

export interface QuoteLine {
  readonly product: ProductId;
  readonly name: string;
  readonly basis: BillingBasis;
  /** Units charged. Always 1 for a flat product. */
  readonly quantity: number;
  readonly unitLabel: string;
  readonly unitCents: number;
  readonly subtotalCents: number;
  /** How the subtotal was reached: "5 users × $29", or "Flat price per organization. Up to 5 seats." */
  readonly basisLabel: string;
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

function line(product: ProductId, input: QuoteInput): QuoteLine {
  const price = priceOf(product);
  if (price.basis === 'flat_per_org') {
    return {
      product,
      name: price.name,
      basis: price.basis,
      quantity: 1,
      unitLabel: price.unit,
      unitCents: price.monthlyCents,
      subtotalCents: price.monthlyCents,
      basisLabel: `Flat price per ${price.unit}. Up to ${price.includedSeats} seats.`,
    };
  }
  const quantity = clampQuantity(input[price.quantityFrom], price.max);
  const unitLabel = quantity === 1 ? price.unit : price.unitPlural;
  return {
    product,
    name: price.name,
    basis: price.basis,
    quantity,
    unitLabel,
    unitCents: price.monthlyCents,
    subtotalCents: price.monthlyCents * quantity,
    basisLabel: `${quantity} ${unitLabel} × ${formatUsd(price.monthlyCents)}`,
  };
}

/** True when the stack qualifies for the bundle discount. */
export function isBundle(stack: Stack): boolean {
  return stack.length >= 2;
}

/**
 * Monthly estimate for a stack. The CRM and Projects are priced per user and the WMS per warehouse.
 * Pulse is one flat line per organization. The bundle and yearly discounts apply to every line alike.
 */
export function quote(input: QuoteInput): Quote {
  const lines = PRODUCT_IDS.filter((id) => input.stack.includes(id)).map((id) => line(id, input));

  const listMonthlyCents = lines.reduce((sum, l) => sum + l.subtotalCents, 0);
  const bundleSavingsCents = isBundle(input.stack)
    ? Math.round(listMonthlyCents * PRICING.bundleDiscount)
    : 0;
  const afterBundle = listMonthlyCents - bundleSavingsCents;
  const annualSavingsCents =
    input.billing === 'annual' ? Math.round(afterBundle * PRICING.annualDiscount) : 0;

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
