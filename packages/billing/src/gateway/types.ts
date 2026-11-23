/**
 * The gateway seam (docs/billing/CONTRACTS.md section 10.1). Stripe and the built in test gateway
 * both implement `BillingGateway`, and everything above this file works with the normalized
 * `Gateway*` shapes only. No other file may know a gateway's own object shapes.
 */
import type { BillingInterval, PlanSelection, PriceKey, ProductId } from '../catalog';
import type { PaymentMethodSummary } from '../plan-state';

export type GatewayKind = 'stripe' | 'test';
export type GatewaySubscriptionStatus = 'incomplete' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled';

export interface BillingAddress {
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  /** ISO 2 letter country code. */
  readonly country?: string;
}

export interface GatewayItem {
  readonly id: string;
  readonly priceKey: PriceKey;
  readonly priceId: string;
  readonly product: ProductId;
  readonly quantity: number;
  readonly unitCents: number;
}

export interface GatewaySubscription {
  readonly id: string;
  readonly customerId: string;
  readonly orgId: string | null;
  readonly status: GatewaySubscriptionStatus;
  readonly interval: BillingInterval;
  readonly items: readonly GatewayItem[];
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly trialEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelAt: Date | null;
  readonly canceledAt: Date | null;
  readonly endedAt: Date | null;
  /** Set while collection is paused. */
  readonly pauseResumesAt: Date | null;
  readonly paymentMethod: PaymentMethodSummary | null;
  readonly latestInvoiceId: string | null;
}

export interface GatewayInvoiceLine {
  readonly description: string;
  readonly product: ProductId | null;
  readonly quantity: number;
  readonly unitCents: number;
  readonly amountCents: number;
  readonly proration: boolean;
}

export interface GatewayInvoice {
  readonly id: string;
  readonly customerId: string;
  readonly subscriptionId: string | null;
  readonly number: string | null;
  readonly status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  readonly billingReason: string | null;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly amountPaidCents: number;
  readonly amountDueCents: number;
  readonly lines: readonly GatewayInvoiceLine[];
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly issuedAt: Date;
  readonly paidAt: Date | null;
  readonly attemptCount: number;
  readonly nextPaymentAttempt: Date | null;
  readonly lastErrorCode: string | null;
  readonly paymentMethodLast4: string | null;
}

export interface GatewayCheckoutSession {
  readonly id: string;
  readonly orgId: string | null;
  readonly status: 'open' | 'complete' | 'expired';
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly url: string | null;
}

export interface GatewayEvent {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
  readonly orgId: string | null;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly invoiceId: string | null;
  readonly checkoutSessionId: string | null;
  /** Raw event, stored in core.billing_events.payload. */
  readonly payload: Record<string, unknown>;
}

export interface ChangePreview {
  /** Charged now, 0 when the change is a decrease. */
  readonly dueTodayCents: number;
  /** Credit that lands on the next bill, 0 on an increase. */
  readonly creditCents: number;
  /** Each period after the change, before tax. */
  readonly newRecurringCents: number;
  /** Signed. */
  readonly recurringDeltaCents: number;
  readonly nextChargeAt: Date;
  /** Pass back unchanged to applyPlanChange. */
  readonly prorationDate: Date;
  readonly lines: readonly GatewayInvoiceLine[];
  readonly taxCents: number;
}

export interface ProfileInput {
  readonly email: string;
  readonly name: string;
  readonly address: BillingAddress | null;
  readonly taxId: { type: string; value: string } | null;
}

export type GatewayInvoicePdf =
  | { kind: 'redirect'; url: string }
  | { kind: 'bytes'; bytes: Uint8Array; filename: string };

export interface BillingGateway {
  readonly kind: GatewayKind;
  ensureCustomer(input: {
    orgId: string;
    existingCustomerId: string | null;
    profile: ProfileInput;
  }): Promise<{ customerId: string }>;
  updateCustomer(customerId: string, profile: ProfileInput): Promise<void>;
  createCheckoutSession(input: {
    orgId: string;
    customerId: string;
    selection: PlanSelection;
    trialEnd: Date | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }>;
  getCheckoutSession(id: string): Promise<GatewayCheckoutSession | null>;
  createPaymentUpdateSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  getSubscription(id: string): Promise<GatewaySubscription | null>;
  findSubscriptionForCustomer(customerId: string): Promise<GatewaySubscription | null>;
  previewChange(input: {
    subscriptionId: string;
    selection: PlanSelection;
    prorationDate: Date;
  }): Promise<ChangePreview>;
  applyChange(input: {
    subscriptionId: string;
    selection: PlanSelection;
    prorationDate: Date;
  }): Promise<GatewaySubscription>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<GatewaySubscription>;
  pause(subscriptionId: string, resumesAt: Date): Promise<GatewaySubscription>;
  /**
   * Ends a pause. `billNow` (added during build, CONTRACTS section 24) is for a pause that already
   * began: the paid time is used up, so billing starts again today with a new period.
   */
  resume(subscriptionId: string, options?: { billNow?: boolean }): Promise<GatewaySubscription>;
  payLatestInvoice(subscriptionId: string): Promise<GatewayInvoice>;
  getInvoice(id: string): Promise<GatewayInvoice | null>;
  listInvoices(customerId: string, limit: number): Promise<readonly GatewayInvoice[]>;
  getInvoicePdf(id: string): Promise<GatewayInvoicePdf>;
  /** Throws WebhookSignatureError on a bad or missing signature. Never returns an unverified event. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): GatewayEvent;
}

export class WebhookSignatureError extends Error {
  /**
   * True for this error by name, also when it was made by another copy of this module. A dev hot
   * reload keeps the cached gateway, so its errors come from the older copy of the class.
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'WebhookSignatureError';
  }
  constructor(message = 'Webhook signature check failed') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export class GatewayCardError extends Error {
  readonly declineCode: string | null;
  /** True for this error by name, also across copies of this module (see WebhookSignatureError). */
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'GatewayCardError';
  }
  constructor(message = 'The card was declined', declineCode: string | null = null) {
    super(message);
    this.name = 'GatewayCardError';
    this.declineCode = declineCode;
  }
}
