/**
 * Small wording helpers shared by the billing screens. PURE. No amount is worked out here: every
 * number comes from `quote()` or from the gateway.
 */
import {
  CATALOG,
  formatMoney,
  isBundle,
  priceTermsLabel,
  toStack,
  unitCents,
  type BillingInterval,
  type PlanSelection,
  type ProductId,
} from '@kitstak/billing/catalog';
import { quote } from '@kitstak/billing/quote';
import type { PaymentMethodSummary, PlanState } from '@kitstak/billing/plan-state';

/** 'per month' or 'per year'. */
export function perPeriod(interval: BillingInterval): string {
  return interval === 'yearly' ? 'per year' : 'per month';
}

/** 'each month' or 'each year'. */
export function eachPeriod(interval: BillingInterval): string {
  return interval === 'yearly' ? 'each year' : 'each month';
}

/** 'Visa ending 4242'. */
export function cardLabel(method: PaymentMethodSummary | null): string {
  if (!method || !method.last4) return 'card';
  const brand = method.brand ? method.brand.charAt(0).toUpperCase() + method.brand.slice(1) : 'Card';
  return `${brand} ending ${method.last4}`;
}

/** '08/28'. */
export function cardExpiry(method: PaymentMethodSummary): string {
  return `${String(method.expMonth).padStart(2, '0')}/${String(method.expYear % 100).padStart(2, '0')}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** '$23.20 per user each month': what one unit of an app costs in this plan. */
export function unitPriceWords(product: ProductId, interval: BillingInterval, bundle: boolean): string {
  return `${formatMoney(unitCents(product, interval, bundle), { trimZeroCents: true })} ${priceTermsLabel(product, interval)}`;
}

/** '$29 per user each month': the public list price of an app. */
export function listPriceWords(product: ProductId): string {
  return unitPriceWords(product, 'monthly', false);
}

/**
 * What adding one app does to the bill, per period, from two quotes. It can be negative: a second
 * app turns on the bundle discount for every app.
 */
export function addAppDeltaCents(selection: PlanSelection, product: ProductId): number {
  const without = toStack(selection.products.filter((id) => id !== product));
  const withIt = toStack([...without, product]);
  return quote({ ...selection, products: withIt }).totalCents - quote({ ...selection, products: without }).totalCents;
}

/** True when adding this app would give the plan the bundle discount it does not have yet. */
export function addingStartsBundle(selection: PlanSelection, product: ProductId): boolean {
  const without = toStack(selection.products.filter((id) => id !== product));
  return !isBundle(without) && isBundle(toStack([...without, product]));
}

/** What one seat fewer would save per period, from two quotes. 0 when seats do not change the price. */
export function oneSeatSavingCents(selection: PlanSelection): number {
  if (selection.seats <= 1) return 0;
  return quote(selection).totalCents - quote({ ...selection, seats: selection.seats - 1 }).totalCents;
}

/** What one warehouse fewer would save per period, from two quotes. */
export function oneWarehouseSavingCents(selection: PlanSelection): number {
  if (selection.warehouses <= 1) return 0;
  return quote(selection).totalCents - quote({ ...selection, warehouses: selection.warehouses - 1 }).totalCents;
}

export function usesSeats(selection: PlanSelection): boolean {
  return selection.products.some((id) => CATALOG.products[id].quantityFrom === 'seats');
}

/** Seats matter for the price or the limit: a per user app, or Pulse with its 5 seats. */
export function showsSeats(selection: PlanSelection): boolean {
  return selection.products.some(
    (id) => CATALOG.products[id].quantityFrom === 'seats' || CATALOG.products[id].includedSeats !== null,
  );
}

export function usesWarehouses(selection: PlanSelection): boolean {
  return selection.products.includes('wms');
}

/** 'Add 1 seat', 'Remove WMS', 'Switch to yearly'. The heading of the confirm panel. */
export function describeChange(before: PlanSelection, after: PlanSelection): string {
  const parts: string[] = [];
  const added = after.products.filter((id) => !before.products.includes(id));
  const removed = before.products.filter((id) => !after.products.includes(id));
  for (const id of added) parts.push(`add ${CATALOG.products[id].shortName}`);
  for (const id of removed) parts.push(`remove ${CATALOG.products[id].shortName}`);
  if (usesSeats(before) && usesSeats(after) && after.seats !== before.seats) {
    const diff = after.seats - before.seats;
    parts.push(diff > 0 ? `add ${plural(diff, 'seat', 'seats')}` : `remove ${plural(-diff, 'seat', 'seats')}`);
  }
  if (usesWarehouses(before) && usesWarehouses(after) && after.warehouses !== before.warehouses) {
    const diff = after.warehouses - before.warehouses;
    parts.push(diff > 0 ? `add ${plural(diff, 'warehouse', 'warehouses')}` : `remove ${plural(-diff, 'warehouse', 'warehouses')}`);
  }
  if (after.interval !== before.interval) parts.push(`switch to ${after.interval}`);
  if (parts.length === 0) return 'No change';
  const sentence = parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function sameSelection(a: PlanSelection, b: PlanSelection): boolean {
  return (
    a.interval === b.interval &&
    a.products.join(',') === b.products.join(',') &&
    (!usesSeats(a) || a.seats === b.seats) &&
    (!usesWarehouses(a) || a.warehouses === b.warehouses)
  );
}

/**
 * The end of a billing period that starts at `date`: whole calendar months in UTC, keeping the day of
 * the month where that month has it. This mirrors `addMonths` in `packages/billing/src/dates.ts`
 * (not an export path), so the dates on screen are the dates the gateway uses.
 */
export function addMonthsUtc(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/**
 * The line under an app that is not in the plan: what adding it does to the bill. Used by billing
 * home and by the launcher tiles, so both say the same thing.
 */
export function addAppPriceNote(state: PlanState, product: ProductId): string {
  const period = perPeriod(state.selection.interval);
  if (state.phase === 'none' && state.trialEligible) return `Free for ${CATALOG.trialDays} days. No card needed.`;
  const delta = addAppDeltaCents(state.selection, product);
  if (delta < 0) return `Adds the bundle discount. You pay ${formatMoney(-delta)} less ${period}.`;
  const lead = state.phase === 'trial' ? 'Free during your trial. Then adds' : 'Adds';
  const bundle = addingStartsBundle(state.selection, product) ? ' with the bundle discount' : '';
  return `${lead} ${formatMoney(delta)} ${period}${bundle}.`;
}
