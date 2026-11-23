/**
 * Billing error codes and their plain UI sentences (docs/billing/CONTRACTS.md section 4.4, SPEC 12.6).
 * PURE. Server functions return `BillingResult<T>` and never throw for a case a person can fix.
 */
export type BillingErrorCode =
  | 'not_signed_in'
  | 'no_org'
  | 'forbidden'
  | 'email_unverified'
  | 'billing_unavailable'
  | 'invalid_selection'
  /** Added during build (CONTRACTS section 24): a form value that is not a plan selection is wrong. */
  | 'invalid_input'
  | 'below_usage'
  | 'trial_used'
  | 'already_subscribed'
  | 'no_subscription'
  | 'card_declined'
  | 'payment_failed'
  | 'price_changed'
  | 'rate_limited'
  | 'seat_limit'
  | 'warehouse_limit'
  | 'yearly_no_pause'
  | 'gateway_error'
  | 'not_found';

export interface BillingError {
  readonly code: BillingErrorCode;
  readonly message: string;
}

export type BillingResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: BillingError };

/** Plain UI sentence per code. SPEC section 12.6 lists the exact copy. */
export const BILLING_ERROR_COPY: Readonly<Record<BillingErrorCode, string>> = {
  not_signed_in: 'Please sign in again.',
  no_org: 'Create your organization first.',
  forbidden: 'Only an owner or a billing manager can do this.',
  email_unverified: 'Verify your email first. It takes one minute.',
  billing_unavailable: 'Billing is not available right now. Nothing was charged. Please try again later.',
  invalid_selection: 'Pick at least one app.',
  invalid_input: 'Check what you entered and try again.',
  below_usage: 'You use more than that today. Pick a bigger number, or remove people or warehouses first.',
  trial_used: 'You already used your free trial. You can still pick a plan.',
  already_subscribed: 'You already have a plan. You can change it on the plan page.',
  no_subscription: 'You do not have a paid plan yet.',
  card_declined: 'That card was declined. Try another card or call your bank.',
  payment_failed: 'The payment did not go through. Nothing changed. Try again or use another card.',
  price_changed: 'The amount changed while you were looking. Check the new amount and confirm again.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  seat_limit: 'All your seats are in use. Add a seat first.',
  warehouse_limit: 'Your plan covers the warehouses you have now. Add one to your plan first.',
  yearly_no_pause: 'Yearly plans cannot be paused. You are paid up until your renewal date.',
  gateway_error: 'Something went wrong on our side. Nothing was charged. Please try again.',
  not_found: 'We could not find that.',
};

/** An error result. With no message, the plain sentence for the code is used. */
export function billingError(code: BillingErrorCode, message?: string): { ok: false; error: BillingError } {
  return { ok: false, error: { code, message: message ?? BILLING_ERROR_COPY[code] } };
}

/** A success result. */
export function billingOk<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}
