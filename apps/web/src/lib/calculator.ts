/**
 * The cart behind the price calculator. Plain functions with no React in them, so the pricing page,
 * the products page and the tests all read the same thing.
 */
import { parseStack, startableStack } from '@/components/site-links';
import { normalizeSelection } from './pricing';
import type { BillingInterval, PlanSelection } from './pricing';

/** Where the visitor pressed "Start my free trial". It rides in the sign-up link as `src`. */
export type CalculatorSource = 'pricing' | 'product';

/** The cart every calculator opens with: the two core apps for a team of five in one warehouse. */
export const CALCULATOR_START: PlanSelection = {
  products: ['crm', 'wms'],
  seats: 5,
  warehouses: 1,
  interval: 'monthly',
};

/**
 * Reads a cart from a link to the calculator (`stack`, `seats`, `warehouses`, `billing`). Every value is
 * cleaned against the catalog limits. A missing or bad value leaves that part of the cart as it is.
 * A product whose app is not open yet is ignored.
 */
export function selectionFromSearch(search: string, base: PlanSelection): PlanSelection {
  const params = new URLSearchParams(search);
  const stack = startableStack(parseStack(params.get('stack')));
  const billing = params.get('billing');
  const interval: BillingInterval =
    billing === 'yearly' || billing === 'annual' ? 'yearly' : billing === 'monthly' ? 'monthly' : base.interval;
  const whole = (name: string, fallback: number) => {
    const raw = params.get(name);
    return raw !== null && /^\d{1,6}$/.test(raw) ? Math.max(Number(raw), 1) : fallback;
  };
  return normalizeSelection({
    products: stack.length > 0 ? stack : base.products,
    seats: whole('seats', base.seats),
    warehouses: whole('warehouses', base.warehouses),
    interval,
  });
}
