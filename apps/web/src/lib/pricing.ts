/**
 * Prices on the marketing site. Nothing here holds a price. Every number comes from the one shared
 * catalog in `@kitstak/billing`, the same one portal sign-up, billing and the payment gateway read
 * (docs/billing/CONTRACTS.md section 4). To change a price, change `packages/billing/src/catalog.ts`.
 *
 * This file re-exports the catalog and the quote, and adds a few phrases the site builds from them.
 */
import {
  CATALOG,
  PLANNED_PRODUCTS,
  formatMoney,
  isPlannedProductId,
  percentLabel,
  plannedPriceTermsLabel,
  priceTermsLabel,
} from '@kitstak/billing/catalog';
import type {
  BillingInterval,
  PlannedProductId,
  PlannedProductPricing,
  ProductId,
  ProductPricing,
} from '@kitstak/billing/catalog';

export {
  BILLING_INTERVALS,
  BILLING_POLICY,
  CATALOG,
  MAX_SEATS,
  MAX_WAREHOUSES,
  PRICING_IS_PLACEHOLDER,
  formatMoney,
  isBundle,
  normalizeSelection,
  percentLabel,
  priceTermsLabel,
  productListLabel,
  unitCents,
} from '@kitstak/billing/catalog';
export { PLANNED_PRODUCTS, PLANNED_PRODUCT_IDS, isPlannedProductId } from '@kitstak/billing/catalog';
export type {
  BillingInterval,
  PlanSelection,
  PlannedProductId,
  PlannedProductPricing,
  ProductId,
  ProductPricing,
  Stack,
} from '@kitstak/billing/catalog';
export { quote, quoteSummaryLines } from '@kitstak/billing/quote';
export type { Quote, QuoteLine } from '@kitstak/billing/quote';

/** "20%": off every app when a plan has two or more. */
export const BUNDLE_OFF = percentLabel(CATALOG.bundlePercentOff);
/** "15%": off when paying yearly. */
export const YEARLY_OFF = percentLabel(CATALOG.yearlyPercentOff);
/** 14: days in the free trial. */
export const TRIAL_DAYS = CATALOG.trialDays;
/** The line that sits under every start button. */
export const TRIAL_LINE = `${TRIAL_DAYS} days free. No card needed.`;

/** Any app with a page on the site: one you can buy, or Crew and Ledger, which you cannot buy yet. */
export type PricedProductId = ProductId | PlannedProductId;

/** The catalog entry for a product. */
export function priceOf(product: ProductId): ProductPricing;
export function priceOf(product: PlannedProductId): PlannedProductPricing;
export function priceOf(product: PricedProductId): ProductPricing | PlannedProductPricing;
export function priceOf(product: PricedProductId): ProductPricing | PlannedProductPricing {
  return isPlannedProductId(product) ? PLANNED_PRODUCTS[product] : CATALOG.products[product];
}

/** True when the product is charged per user, so the seat count changes its line. */
export function isPerSeat(product: ProductId): boolean {
  return priceOf(product).quantityFrom === 'seats';
}

/** The public monthly list price for one unit: "$29", "$349". */
export function listPrice(product: PricedProductId): string {
  return formatMoney(priceOf(product).cents.monthly, { trimZeroCents: true });
}

/**
 * The price a card shows for one unit, as a monthly figure. Paying yearly it is the yearly price
 * spread over 12 months ("$24.65"), which the catalog guarantees is a whole number of cents.
 */
export function unitPerMonth(product: PricedProductId, interval: BillingInterval): string {
  const cents = priceOf(product).cents;
  return formatMoney(interval === 'yearly' ? cents.yearly / 12 : cents.monthly, { trimZeroCents: true });
}

/** What the gateway charges for one unit for a whole year: "$295.80". */
export function unitPerYear(product: PricedProductId): string {
  return formatMoney(priceOf(product).cents.yearly, { trimZeroCents: true });
}

/** "per user each month", "per warehouse each month", "each month for your whole team". */
export function monthlyTerms(product: PricedProductId): string {
  return isPlannedProductId(product) ? plannedPriceTermsLabel(product, 'monthly') : priceTermsLabel(product, 'monthly');
}

/** The price in words: "$29 per user each month", "$29 each month for your whole team". */
export function priceInWords(product: PricedProductId): string {
  return `${listPrice(product)} ${monthlyTerms(product)}`;
}

/** "Up to 5 seats" for a flat product, otherwise null. */
export function includedSeatsLabel(product: PricedProductId): string | null {
  const seats = priceOf(product).includedSeats;
  return seats === null ? null : `Up to ${seats} seats`;
}

/** The question a visitor over the seat limit has. Pages link it to the contact route. */
export function moreSeatsPrompt(product: PricedProductId): string | null {
  const seats = priceOf(product).includedSeats;
  return seats === null ? null : `Need more than ${seats} seats?`;
}

/** "per person each year", "each year for your whole team": the terms for a yearly price. */
export function yearlyTerms(product: PricedProductId): string {
  return isPlannedProductId(product) ? plannedPriceTermsLabel(product, 'yearly') : priceTermsLabel(product, 'yearly');
}

/** The small print beside every planned price, so nobody reads it as something they can buy today. */
export const PLANNED_PRICE_NOTE = 'Planned price. You cannot buy it yet.';

/** The link text that follows the over the limit note, after "For a bigger team,". */
export const OVER_SEATS_ACTION = 'talk to us';

/** The link text that follows `moreSeatsPrompt`. */
export const MORE_SEATS_ACTION = 'Talk to us.';

/**
 * The worked example for a change in the middle of a period: one more CRM seat, half way through a
 * month. You pay half a month now and the full seat price each month after.
 */
export function midMonthSeatExample(): { readonly today: string; readonly eachMonth: string } {
  const seat = priceOf('crm').cents.monthly;
  return {
    today: formatMoney(seat / 2),
    eachMonth: formatMoney(seat, { trimZeroCents: true }),
  };
}
