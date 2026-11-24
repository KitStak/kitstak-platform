/**
 * The built in test gateway (docs/billing/CONTRACTS.md section 10.4, SPEC 7.2). It stands in for
 * Stripe outside production when no Stripe key is set, so checkout, card success and decline,
 * invoices, renewals and failed payments can be seen locally. No real money moves.
 *
 * Same path as Stripe: every state change here builds an event, signs it, and hands the raw body and
 * the signature to `processWebhook`, the same function the Stripe route calls. Nothing in this file
 * writes `core.entitlements`, `core.billing_subscriptions` or `core.billing_invoices`, with one
 * marked exception: the time shift test tool moves stored dates.
 *
 * State lives in `core.billing_test_objects`, one JSON document per object.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { billingSubscriptions, billingTestObjects, organization, type BillingTestObjectKind } from '@kitstak/db/schema';
import {
  type BillingInterval,
  CATALOG,
  isBundle,
  isProductId,
  normalizeSelection,
  parsePriceKey,
  type PlanSelection,
  type PriceKey,
  priceKey,
  type ProductId,
  quantityFor,
  unitCents,
} from '../catalog';
import { addInterval } from '../dates';
import { type BillingResult, billingError, billingOk } from '../errors';
import type { PaymentMethodSummary, PlanState } from '../plan-state';
import { type Quote, quote } from '../quote';
import { recordAudit } from '../server/audit';
import type { BillingConfig } from '../server/config';
import { type BillingDb, type BillingRuntime, isUuid } from '../server/db';
import { getPlanState } from '../server/state';
import { clearBillingCaches } from '../server/sync';
import { processWebhook } from '../server/webhook';
import { renderInvoicePdf } from './test-pdf';
import {
  type BillingGateway,
  type ChangePreview,
  GatewayCardError,
  type GatewayCheckoutSession,
  type GatewayEvent,
  type GatewayInvoice,
  type GatewayInvoiceLine,
  type GatewayInvoicePdf,
  type GatewayItem,
  type GatewaySubscription,
  type GatewaySubscriptionStatus,
  type ProfileInput,
  WebhookSignatureError,
} from './types';

export { renderInvoicePdf } from './test-pdf';
export { GatewayCardError, WebhookSignatureError } from './types';

/* ===== test cards ===== */

export type TestCardOutcome = 'success' | 'declined' | 'insufficient_funds' | 'requires_action' | 'fails_on_renewal';

export const TEST_CARDS: readonly {
  readonly number: string;
  readonly label: string;
  readonly outcome: TestCardOutcome;
  /** One plain sentence that says exactly what the test gateway does with this card. */
  readonly detail: string;
}[] = [
  { number: '4242 4242 4242 4242', label: 'Works', outcome: 'success', detail: 'Every charge is paid.' },
  { number: '4000 0000 0000 0002', label: 'Declined', outcome: 'declined', detail: 'The bank says no. The card is not saved.' },
  {
    number: '4000 0000 0000 9995',
    label: 'Not enough money',
    outcome: 'insufficient_funds',
    detail: 'The bank says there is not enough money. The card is not saved.',
  },
  {
    number: '4000 0027 6000 3184',
    label: 'Needs bank approval',
    outcome: 'requires_action',
    detail: 'The bank asks you to approve first. After that every charge is paid.',
  },
  {
    number: '4000 0000 0000 0341',
    label: 'Works now, fails at the next renewal',
    outcome: 'fails_on_renewal',
    detail: 'Saving it works. A first bill and a plan change are paid. Every renewal charge fails.',
  },
];

/**
 * What a charge is for. The "fails at the next renewal" card looks at this and at nothing else: it
 * pays a first bill and a plan change, and it fails every renewal charge (the renewal itself, its
 * retries, and "Pay now" on a renewal bill). So it does not matter whether the card was typed at
 * checkout or saved later on the card page, or what was charged before (review round 2).
 */
type ChargeKind = 'first' | 'change' | 'renewal';

function chargeKindOf(invoice: Pick<InvoiceDoc, 'billingReason' | 'firstBill'>): ChargeKind {
  if (invoice.billingReason === 'subscription_update') return 'change';
  if (invoice.firstBill === true || invoice.billingReason === 'subscription_create') return 'first';
  return 'renewal';
}

/** The one promo code the test gateway knows: 10% off the first charge. */
export const TEST_PROMO_CODE = 'TEST10';
const TEST_PROMO_PERCENT = 10;

/** Days after the invoice date for the second, third and fourth try. After the fourth the plan closes. */
const RETRY_DAYS = [3, 8, 15] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIGNATURE_TOLERANCE_SECONDS = 300;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function findTestCard(cardNumber: string): (typeof TEST_CARDS)[number] | null {
  const digits = digitsOnly(cardNumber);
  return TEST_CARDS.find((card) => digitsOnly(card.number) === digits) ?? null;
}

/* ===== documents ===== */

interface CustomerDoc {
  id: string;
  orgId: string;
  email: string;
  name: string;
  address: ProfileInput['address'];
  taxId: ProfileInput['taxId'];
  defaultPaymentMethodId: string | null;
  invoiceSeq: number;
  /**
   * Credit from plan changes, kept on the customer the way Stripe keeps a customer balance. It
   * comes off the next bills and stays when a plan ends. Older documents kept it on the
   * subscription; `creditOf` counts both and `setCredit` moves it here.
   */
  creditCents?: number;
}

interface PaymentMethodDoc {
  id: string;
  customerId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  outcome: TestCardOutcome;
  /** How many charges above $0 this card has paid. Kept for the record; no rule reads it. */
  chargesSucceeded: number;
}

interface ItemDoc {
  id: string;
  product: ProductId;
  priceKey: PriceKey;
  quantity: number;
  unitCents: number;
}

interface SubscriptionDoc {
  id: string;
  customerId: string;
  orgId: string;
  status: GatewaySubscriptionStatus;
  interval: BillingInterval;
  seats: number;
  warehouses: number;
  items: ItemDoc[];
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  pauseResumesAt: string | null;
  latestInvoiceId: string | null;
  /** Old place for credit. Always 0 on new documents; see `CustomerDoc.creditCents`. */
  creditCents: number;
  /** Set by the "Make the next payment fail" test tool. Used up by the next charge. */
  failNextPayment: boolean;
  promoCode: string | null;
  createdAt: string;
}

interface InvoiceDoc {
  id: string;
  customerId: string;
  subscriptionId: string;
  orgId: string;
  number: string;
  status: GatewayInvoice['status'];
  billingReason: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  lines: GatewayInvoiceLine[];
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string;
  paidAt: string | null;
  /** Every try, by the gateway or by a person pressing "Pay now". */
  attemptCount: number;
  /** Only the gateway's own tries. These follow the retry schedule; "Pay now" does not use one up. */
  autoAttempts: number;
  nextPaymentAttempt: string | null;
  lastErrorCode: string | null;
  paymentMethodLast4: string | null;
  /** How much credit paid this invoice. Older documents only have the credit line. */
  creditAppliedCents?: number;
  /** Money sent back for this invoice (a second subscription that was canceled at once). */
  refundedCents?: number;
  /** True for the first bill of a plan: at checkout, or at the end of the free trial. */
  firstBill?: boolean;
}

interface PendingCard {
  cardNumber: string;
  expMonth: number;
  expYear: number;
  promoCode: string | null;
}

interface CheckoutSessionDoc {
  id: string;
  orgId: string;
  customerId: string;
  selection: PlanSelection;
  trialEnd: string | null;
  successUrl: string;
  cancelUrl: string;
  status: 'open' | 'complete' | 'expired';
  subscriptionId: string | null;
  /** A card waiting for the pretend bank step. Test card numbers only; never a real card. */
  pending: PendingCard | null;
  /** A promo code the person applied on the page, so the summary shows the real first charge. */
  promoCode?: string | null;
  createdAt: string;
}

interface PortalSessionDoc {
  id: string;
  orgId: string;
  customerId: string;
  returnUrl: string;
  status: 'open' | 'complete';
  createdAt: string;
}

interface Ctx {
  readonly db: BillingDb;
  readonly portalUrl: string;
  readonly webhookSecret: string;
  readonly now: () => Date;
}

function newId(prefix: string): string {
  return `${prefix}${randomBytes(12).toString('hex')}`;
}

async function load<T>(db: BillingDb, id: string, kind: BillingTestObjectKind): Promise<T | null> {
  if (typeof id !== 'string' || id.length === 0 || id.length > 80) return null;
  const [row] = await db
    .select({ data: billingTestObjects.data })
    .from(billingTestObjects)
    .where(and(eq(billingTestObjects.id, id), eq(billingTestObjects.kind, kind)));
  return row ? (row.data as unknown as T) : null;
}

async function save(db: BillingDb, kind: BillingTestObjectKind, orgId: string | null, doc: { id: string }): Promise<void> {
  const data = doc as unknown as Record<string, unknown>;
  await db
    .insert(billingTestObjects)
    .values({ id: doc.id, kind, orgId, data })
    .onConflictDoUpdate({ target: billingTestObjects.id, set: { data, updatedAt: new Date() } });
}

async function listKind<T>(db: BillingDb, kind: BillingTestObjectKind, orgId?: string): Promise<T[]> {
  const found = await db
    .select({ data: billingTestObjects.data })
    .from(billingTestObjects)
    .where(orgId ? and(eq(billingTestObjects.kind, kind), eq(billingTestObjects.orgId, orgId)) : eq(billingTestObjects.kind, kind))
    .orderBy(desc(billingTestObjects.createdAt));
  return found.map((row) => row.data as unknown as T);
}

const iso = (date: Date): string => date.toISOString();
const dateOrNull = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

/** Rounds half away from zero, like money on a credit and a charge of the same size. */
function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/* ===== credit and bill math ===== */

const CREDIT_LINE = 'Credit from plan changes';

/** The customer's credit. Counts the old place (the subscription) and the new one, once each. */
function creditOf(customer: CustomerDoc | null, sub: Pick<SubscriptionDoc, 'creditCents'> | null): number {
  return Math.max(0, (customer?.creditCents ?? 0) + (sub?.creditCents ?? 0));
}

/** Stores the balance on the customer and clears the old place. The caller saves both documents. */
function setCredit(customer: CustomerDoc, sub: SubscriptionDoc | null, cents: number): void {
  customer.creditCents = Math.max(0, Math.round(cents));
  if (sub) sub.creditCents = 0;
}

function promoLabel(code: string): string {
  return `Promo code ${code} (${TEST_PROMO_PERCENT}% off)`;
}

interface BillMath {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly discountLabel: string | null;
  readonly creditUsedCents: number;
  /** What the card is charged. */
  readonly totalCents: number;
}

/**
 * One bill: the lines, then the promo code, then credit. Invoices, the "next charge" on billing home
 * and the summary on the test checkout page all come from this one function, so they cannot differ.
 */
function billMath(subtotalCents: number, promoCode: string | null, creditCents: number): BillMath {
  let discountCents = 0;
  let discountLabel: string | null = null;
  if (promoCode === TEST_PROMO_CODE && subtotalCents > 0) {
    discountCents = Math.round((subtotalCents * TEST_PROMO_PERCENT) / 100);
    discountLabel = promoLabel(TEST_PROMO_CODE);
  }
  const afterDiscount = subtotalCents - discountCents;
  const creditUsedCents = creditCents > 0 && afterDiscount > 0 ? Math.min(creditCents, afterDiscount) : 0;
  return { subtotalCents, discountCents, discountLabel, creditUsedCents, totalCents: afterDiscount - creditUsedCents };
}

/* ===== signing ===== */

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` */
export function signTestPayload(rawBody: string, secret: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function verifyTestSignature(rawBody: string, header: string | null, secret: string, now: Date): void {
  if (!header) throw new WebhookSignatureError('Missing signature');
  const parts = new Map<string, string>();
  for (const piece of header.split(',')) {
    const at = piece.indexOf('=');
    if (at > 0) parts.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim());
  }
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1') ?? '';
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) throw new WebhookSignatureError('Malformed signature');
  if (Math.abs(Math.floor(now.getTime() / 1000) - t) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new WebhookSignatureError('Signature is too old');
  }
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new WebhookSignatureError('Signature does not match');
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseEvent(rawBody: string): GatewayEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new WebhookSignatureError('Body is not JSON');
  }
  const event = (parsed ?? {}) as { id?: unknown; type?: unknown; created?: unknown; data?: { object?: Record<string, unknown> } };
  const id = text(event.id);
  const type = text(event.type);
  if (!id || !type) throw new WebhookSignatureError('Body is not an event');
  const object = event.data?.object ?? {};
  const kind = text(object.object);
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  const orgId = text(metadata.kitstak_org_id) ?? text(object.client_reference_id);
  return {
    id,
    type,
    createdAt: new Date((typeof event.created === 'number' ? event.created : 0) * 1000),
    orgId: isUuid(orgId) ? orgId : null,
    customerId: kind === 'customer' ? text(object.id) : text(object.customer),
    subscriptionId: kind === 'subscription' ? text(object.id) : text(object.subscription),
    invoiceId: kind === 'invoice' ? text(object.id) : null,
    checkoutSessionId: kind === 'checkout.session' ? text(object.id) : null,
    payload: parsed as Record<string, unknown>,
  };
}

/* ===== mapping ===== */

function itemsFor(selection: PlanSelection): ItemDoc[] {
  const bundle = isBundle(selection.products);
  return selection.products.map((product) => ({
    id: newId('si_test_'),
    product,
    priceKey: priceKey(product, selection.interval, bundle),
    quantity: quantityFor(product, selection),
    unitCents: unitCents(product, selection.interval, bundle),
  }));
}

function recurringOf(items: readonly ItemDoc[]): number {
  return items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0);
}

function lineLabel(item: ItemDoc): string {
  const pricing = CATALOG.products[item.product];
  if (pricing.quantityFrom === 'flat') return `${pricing.name} (whole team)`;
  return `${pricing.name} (${item.quantity} ${item.quantity === 1 ? pricing.unit : pricing.unitPlural})`;
}

function toGatewayItem(item: ItemDoc): GatewayItem {
  return {
    id: item.id,
    priceKey: item.priceKey,
    priceId: `price_test_${item.priceKey}`,
    product: item.product,
    quantity: item.quantity,
    unitCents: item.unitCents,
  };
}

async function cardOf(db: BillingDb, customerId: string): Promise<PaymentMethodDoc | null> {
  const customer = await load<CustomerDoc>(db, customerId, 'customer');
  if (!customer?.defaultPaymentMethodId) return null;
  return load<PaymentMethodDoc>(db, customer.defaultPaymentMethodId, 'payment_method');
}

function cardSummary(card: PaymentMethodDoc | null): PaymentMethodSummary | null {
  return card ? { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear } : null;
}

/** What the next bill of a subscription will charge, or null when no bill is coming. */
function upcomingOf(doc: SubscriptionDoc, creditCents: number): GatewaySubscription['upcoming'] {
  const billable = doc.status === 'trialing' || doc.status === 'active' || doc.status === 'past_due';
  if (!billable || doc.cancelAtPeriodEnd || doc.pauseResumesAt) return null;
  const bill = billMath(recurringOf(doc.items), doc.promoCode, creditCents);
  return {
    amountDueCents: bill.totalCents,
    discountCents: bill.discountCents,
    discountLabel: bill.discountLabel,
    creditAppliedCents: bill.creditUsedCents,
  };
}

async function toGatewaySubscription(db: BillingDb, doc: SubscriptionDoc): Promise<GatewaySubscription> {
  const customer = await load<CustomerDoc>(db, doc.customerId, 'customer');
  const creditBalanceCents = creditOf(customer, doc);
  return {
    id: doc.id,
    customerId: doc.customerId,
    orgId: doc.orgId,
    status: doc.status,
    interval: doc.interval,
    items: doc.items.filter((item) => isProductId(item.product) && parsePriceKey(item.priceKey) !== null).map(toGatewayItem),
    currentPeriodStart: new Date(doc.currentPeriodStart),
    currentPeriodEnd: new Date(doc.currentPeriodEnd),
    trialEnd: dateOrNull(doc.trialEnd),
    cancelAtPeriodEnd: doc.cancelAtPeriodEnd,
    cancelAt: dateOrNull(doc.cancelAt),
    canceledAt: dateOrNull(doc.canceledAt),
    endedAt: dateOrNull(doc.endedAt),
    pauseResumesAt: dateOrNull(doc.pauseResumesAt),
    paymentMethod: cardSummary(await cardOf(db, doc.customerId)),
    latestInvoiceId: doc.latestInvoiceId,
    creditBalanceCents,
    upcoming: upcomingOf(doc, creditBalanceCents),
  };
}

function toGatewayInvoice(doc: InvoiceDoc): GatewayInvoice {
  return {
    id: doc.id,
    customerId: doc.customerId,
    subscriptionId: doc.subscriptionId,
    number: doc.number,
    status: doc.status,
    billingReason: doc.billingReason,
    subtotalCents: doc.subtotalCents,
    discountCents: doc.discountCents,
    taxCents: doc.taxCents,
    totalCents: doc.totalCents,
    amountPaidCents: doc.amountPaidCents,
    amountDueCents: doc.amountDueCents,
    lines: doc.lines,
    periodStart: dateOrNull(doc.periodStart),
    periodEnd: dateOrNull(doc.periodEnd),
    issuedAt: new Date(doc.issuedAt),
    paidAt: dateOrNull(doc.paidAt),
    attemptCount: doc.attemptCount,
    nextPaymentAttempt: dateOrNull(doc.nextPaymentAttempt),
    lastErrorCode: doc.lastErrorCode,
    paymentMethodLast4: doc.paymentMethodLast4,
    creditAppliedCents:
      doc.creditAppliedCents ??
      doc.lines.filter((line) => line.description === CREDIT_LINE).reduce((sum, line) => sum - line.amountCents, 0),
    refundedCents: doc.refundedCents ?? 0,
  };
}

/* ===== events ===== */

/** A runtime built from what the gateway itself knows, so its events run through `processWebhook`. */
function runtimeFor(ctx: Ctx, gateway: BillingGateway): BillingRuntime {
  const config: BillingConfig = {
    mode: 'test_gateway',
    stripeSecretKey: null,
    stripeWebhookSecret: null,
    stripePortalConfigurationId: null,
    automaticTax: false,
    testWebhookSecret: ctx.webhookSecret,
  };
  return { db: ctx.db, config, mode: 'test_gateway', gateway, portalUrl: ctx.portalUrl, now: ctx.now };
}

function buildEvent(type: string, object: Record<string, unknown>, at: Date): string {
  return JSON.stringify({
    id: newId('evt_test_'),
    object: 'event',
    type,
    created: Math.floor(at.getTime() / 1000),
    livemode: false,
    data: { object },
  });
}

function subscriptionObject(doc: SubscriptionDoc): Record<string, unknown> {
  return {
    id: doc.id,
    object: 'subscription',
    customer: doc.customerId,
    status: doc.status,
    metadata: { kitstak_org_id: doc.orgId },
  };
}

function invoiceObject(doc: InvoiceDoc): Record<string, unknown> {
  return {
    id: doc.id,
    object: 'invoice',
    customer: doc.customerId,
    subscription: doc.subscriptionId,
    status: doc.status,
    total: doc.totalCents,
    metadata: { kitstak_org_id: doc.orgId },
  };
}

/** Builds, signs and delivers one event through the same door Stripe uses. */
async function deliver(ctx: Ctx, gateway: BillingGateway, type: string, object: Record<string, unknown>): Promise<void> {
  const at = ctx.now();
  const rawBody = buildEvent(type, object, at);
  const signature = signTestPayload(rawBody, ctx.webhookSecret, at);
  await processWebhook(runtimeFor(ctx, gateway), { rawBody, signature });
}

/* ===== charging ===== */

type ChargeResult = { ok: true; last4: string } | { ok: false; code: string };

/** Tries the card on file. Mutates `sub.failNextPayment`; the caller saves the subscription. */
async function attemptCharge(ctx: Ctx, sub: SubscriptionDoc, amountCents: number, kind: ChargeKind): Promise<ChargeResult> {
  const card = await cardOf(ctx.db, sub.customerId);
  if (!card) return { ok: false, code: 'no_payment_method' };
  if (amountCents <= 0) return { ok: true, last4: card.last4 };
  if (sub.failNextPayment) {
    sub.failNextPayment = false;
    return { ok: false, code: 'card_declined' };
  }
  if (card.outcome === 'declined') return { ok: false, code: 'card_declined' };
  if (card.outcome === 'insufficient_funds') return { ok: false, code: 'insufficient_funds' };
  if (card.outcome === 'fails_on_renewal' && kind === 'renewal') return { ok: false, code: 'card_declined' };
  card.chargesSucceeded += 1;
  await save(ctx.db, 'payment_method', sub.orgId, card);
  return { ok: true, last4: card.last4 };
}

/** Builds an invoice document (not saved). Applies the promo code and any credit as their own lines. */
async function draftInvoice(
  ctx: Ctx,
  sub: SubscriptionDoc,
  input: {
    reason: string;
    lines: GatewayInvoiceLine[];
    periodStart: Date | null;
    periodEnd: Date | null;
    issuedAt: Date;
    usePromo: boolean;
    useCredit: boolean;
  },
): Promise<{ invoice: InvoiceDoc; customer: CustomerDoc; creditUsed: number; promoUsed: boolean }> {
  const customer = await load<CustomerDoc>(ctx.db, sub.customerId, 'customer');
  if (!customer) throw new Error('Test customer is missing.');
  const lines = [...input.lines];
  const subtotal = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const bill = billMath(subtotal, input.usePromo ? sub.promoCode : null, input.useCredit ? creditOf(customer, sub) : 0);
  const discount = bill.discountCents;
  const promoUsed = discount > 0;
  if (bill.discountLabel) {
    lines.push({
      description: bill.discountLabel,
      product: null,
      quantity: 1,
      unitCents: -discount,
      amountCents: -discount,
      proration: false,
    });
  }
  const creditUsed = bill.creditUsedCents;
  if (creditUsed > 0) {
    lines.push({
      description: CREDIT_LINE,
      product: null,
      quantity: 1,
      unitCents: -creditUsed,
      amountCents: -creditUsed,
      proration: false,
    });
  }

  const total = subtotal - discount - creditUsed;
  customer.invoiceSeq += 1;
  const invoice: InvoiceDoc = {
    id: newId('in_test_'),
    customerId: sub.customerId,
    subscriptionId: sub.id,
    orgId: sub.orgId,
    number: `TEST-${String(customer.invoiceSeq).padStart(4, '0')}`,
    status: 'open',
    billingReason: input.reason,
    subtotalCents: subtotal - creditUsed,
    discountCents: discount,
    taxCents: 0,
    totalCents: total,
    amountPaidCents: 0,
    amountDueCents: total,
    lines,
    periodStart: input.periodStart ? iso(input.periodStart) : null,
    periodEnd: input.periodEnd ? iso(input.periodEnd) : null,
    issuedAt: iso(input.issuedAt),
    paidAt: null,
    attemptCount: 0,
    autoAttempts: 0,
    nextPaymentAttempt: null,
    lastErrorCode: null,
    paymentMethodLast4: null,
    creditAppliedCents: creditUsed,
    refundedCents: 0,
  };
  return { invoice, customer, creditUsed, promoUsed };
}

function periodLines(items: readonly ItemDoc[]): GatewayInvoiceLine[] {
  return items.map((item) => ({
    description: lineLabel(item),
    product: item.product,
    quantity: item.quantity,
    unitCents: item.unitCents,
    amountCents: item.unitCents * item.quantity,
    proration: false,
  }));
}

function markPaid(invoice: InvoiceDoc, last4: string, at: Date): void {
  invoice.status = 'paid';
  invoice.amountPaidCents = invoice.totalCents;
  invoice.amountDueCents = 0;
  invoice.paidAt = iso(at);
  invoice.nextPaymentAttempt = null;
  invoice.lastErrorCode = null;
  invoice.paymentMethodLast4 = last4;
}

/* ===== plan changes ===== */

interface ChangeMath {
  readonly newItems: ItemDoc[];
  readonly lines: GatewayInvoiceLine[];
  readonly netCents: number;
  readonly creditApplied: number;
  readonly preview: ChangePreview;
  readonly intervalChanged: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function daysLeftWords(from: Date, to: Date): string {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  return `the ${plural(days, 'day', 'days')} left in this period`;
}

/**
 * The proration rule, the same one Stripe uses: `round(unit x quantity change x seconds left /
 * seconds in period)`. An increase is due now. A decrease becomes credit on the next bill.
 */
function changeMath(
  sub: SubscriptionDoc,
  creditCents: number,
  selection: PlanSelection,
  prorationDate: Date,
  now: Date,
): ChangeMath {
  const normalized = normalizeSelection(selection);
  const fresh = itemsFor(normalized);
  // Keep the item id of an app that stays in the plan.
  const newItems = fresh.map((item) => {
    const existing = sub.items.find((old) => old.product === item.product);
    return existing ? { ...item, id: existing.id } : item;
  });
  const intervalChanged = normalized.interval !== sub.interval;
  const newRecurring = recurringOf(newItems);
  const oldRecurring = recurringOf(sub.items);
  const periodStart = new Date(sub.currentPeriodStart);
  const periodEnd = new Date(sub.currentPeriodEnd);
  const lines: GatewayInvoiceLine[] = [];
  let nextChargeAt = periodEnd;

  if (sub.status === 'trialing') {
    // Still inside the free trial: nothing has been paid, so nothing is prorated.
    nextChargeAt = sub.trialEnd ? new Date(sub.trialEnd) : periodEnd;
  } else {
    const total = Math.max(1, periodEnd.getTime() - periodStart.getTime());
    const left = Math.min(total, Math.max(0, periodEnd.getTime() - prorationDate.getTime()));
    const fraction = left / total;
    const leftWords = daysLeftWords(prorationDate, periodEnd);
    // For a credit the server hands in a date a whole number of full days before the period end
    // (`proration.ts`), so this is the count of full days that come back.
    const fullDays = Math.max(0, Math.round((periodEnd.getTime() - prorationDate.getTime()) / DAY_MS));
    const unusedWords = `unused time, ${plural(fullDays, 'full day', 'full days')} left`;
    const prorated = (cents: number) => roundCents(cents * fraction);
    const push = (description: string, product: ProductId, quantity: number, unit: number, amountCents: number) => {
      if (amountCents !== 0) lines.push({ description, product, quantity, unitCents: unit, amountCents, proration: true });
    };

    if (intervalChanged) {
      // A new billing period starts today. The unused part of the old one comes back as credit.
      for (const old of sub.items) {
        push(`${lineLabel(old)}: ${unusedWords}`, old.product, old.quantity, old.unitCents, -prorated(old.unitCents * old.quantity));
      }
      for (const item of newItems) {
        lines.push({
          description: `${lineLabel(item)} for the next ${normalized.interval === 'yearly' ? 'year' : 'month'}`,
          product: item.product,
          quantity: item.quantity,
          unitCents: item.unitCents,
          amountCents: item.unitCents * item.quantity,
          proration: false,
        });
      }
      // The new period starts at the moment of the change. The proration date only sets how much
      // unused time comes back.
      nextChargeAt = addInterval(now, normalized.interval);
    } else {
      const products = new Set<ProductId>([...sub.items.map((item) => item.product), ...newItems.map((item) => item.product)]);
      for (const product of products) {
        const old = sub.items.find((item) => item.product === product);
        const next = newItems.find((item) => item.product === product);
        const pricing = CATALOG.products[product];
        if (old && next && old.unitCents === next.unitCents) {
          const diff = next.quantity - old.quantity;
          if (diff !== 0) {
            const what = plural(Math.abs(diff), pricing.unit, pricing.unitPlural);
            push(
              diff > 0 ? `${pricing.name}: ${what} more for ${leftWords}` : `${pricing.name}: ${what} fewer, ${unusedWords}`,
              product,
              Math.abs(diff),
              next.unitCents,
              prorated(next.unitCents * diff),
            );
          }
        } else {
          if (old) push(`${lineLabel(old)}: ${unusedWords}`, product, old.quantity, old.unitCents, -prorated(old.unitCents * old.quantity));
          if (next) push(`${lineLabel(next)} for ${leftWords}`, product, next.quantity, next.unitCents, prorated(next.unitCents * next.quantity));
        }
      }
    }
  }

  const netCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const creditApplied = netCents > 0 ? Math.min(creditCents, netCents) : 0;
  const shown = [...lines];
  if (creditApplied > 0) {
    shown.push({
      description: CREDIT_LINE,
      product: null,
      quantity: 1,
      unitCents: -creditApplied,
      amountCents: -creditApplied,
      proration: false,
    });
  }
  return {
    newItems,
    lines,
    netCents,
    creditApplied,
    intervalChanged,
    preview: {
      dueTodayCents: netCents > 0 ? netCents - creditApplied : 0,
      creditCents: netCents < 0 ? -netCents : 0,
      newRecurringCents: newRecurring,
      recurringDeltaCents: newRecurring - oldRecurring,
      nextChargeAt,
      prorationDate,
      lines: shown,
      taxCents: 0,
      proratedCents: netCents > 0 ? netCents : 0,
      creditAppliedCents: creditApplied,
    },
  };
}

/* ===== the gateway ===== */

export function createTestGateway(input: {
  db: BillingDb;
  portalUrl: string;
  webhookSecret: string;
  now?: () => Date;
}): BillingGateway {
  const ctx: Ctx = {
    db: input.db,
    portalUrl: input.portalUrl.replace(/\/+$/, ''),
    webhookSecret: input.webhookSecret,
    now: input.now ?? (() => new Date()),
  };
  const { db } = ctx;

  async function requireSubscription(id: string): Promise<SubscriptionDoc> {
    const doc = await load<SubscriptionDoc>(db, id, 'subscription');
    if (!doc) throw new Error('Test subscription not found.');
    return doc;
  }

  const gateway: BillingGateway = {
    kind: 'test',

    async ensureCustomer({ orgId, existingCustomerId, profile }) {
      if (existingCustomerId) {
        const existing = await load<CustomerDoc>(db, existingCustomerId, 'customer');
        if (existing && existing.orgId === orgId) {
          await gateway.updateCustomer(existing.id, profile);
          return { customerId: existing.id };
        }
      }
      const customer: CustomerDoc = {
        id: newId('cus_test_'),
        orgId,
        email: profile.email,
        name: profile.name,
        address: profile.address,
        taxId: profile.taxId,
        defaultPaymentMethodId: null,
        invoiceSeq: 0,
      };
      await save(db, 'customer', orgId, customer);
      return { customerId: customer.id };
    },

    async updateCustomer(customerId, profile) {
      const customer = await load<CustomerDoc>(db, customerId, 'customer');
      if (!customer) return;
      // An empty email or name means "leave it as it is".
      if (profile.email) customer.email = profile.email;
      if (profile.name) customer.name = profile.name;
      customer.address = profile.address;
      customer.taxId = profile.taxId;
      await save(db, 'customer', customer.orgId, customer);
    },

    async createCheckoutSession({ orgId, customerId, selection, trialEnd, successUrl, cancelUrl }) {
      const session: CheckoutSessionDoc = {
        id: newId('cs_test_'),
        orgId,
        customerId,
        selection: normalizeSelection(selection),
        trialEnd: trialEnd ? iso(trialEnd) : null,
        successUrl,
        cancelUrl,
        status: 'open',
        subscriptionId: null,
        pending: null,
        createdAt: iso(ctx.now()),
      };
      await save(db, 'checkout_session', orgId, session);
      return { id: session.id, url: `${ctx.portalUrl}/test-gateway/checkout/${session.id}` };
    },

    async getCheckoutSession(id): Promise<GatewayCheckoutSession | null> {
      const session = await load<CheckoutSessionDoc>(db, id, 'checkout_session');
      if (!session) return null;
      return {
        id: session.id,
        orgId: session.orgId,
        status: session.status,
        customerId: session.customerId,
        subscriptionId: session.subscriptionId,
        url: session.status === 'open' ? `${ctx.portalUrl}/test-gateway/checkout/${session.id}` : null,
      };
    },

    async expireOpenCheckoutSessions(customerId) {
      const customer = await load<CustomerDoc>(db, customerId, 'customer');
      if (!customer) return 0;
      // Every open pay page of the customer's organization, whichever customer it was made for
      // (review round 2). An organization has one plan, so it never needs two open pay pages.
      const open = (await listKind<CheckoutSessionDoc>(db, 'checkout_session', customer.orgId)).filter(
        (session) => session.status === 'open',
      );
      for (const session of open) {
        session.status = 'expired';
        session.pending = null;
        await save(db, 'checkout_session', session.orgId, session);
      }
      return open.length;
    },

    async cancelAndRefund(subscriptionId) {
      const sub = await requireSubscription(subscriptionId);
      const now = ctx.now();
      let refundedCents = 0;
      const invoice = sub.latestInvoiceId ? await load<InvoiceDoc>(db, sub.latestInvoiceId, 'invoice') : null;
      if (invoice && invoice.status === 'paid') {
        refundedCents = Math.max(0, invoice.amountPaidCents - (invoice.refundedCents ?? 0));
        invoice.refundedCents = (invoice.refundedCents ?? 0) + refundedCents;
        await save(db, 'invoice', sub.orgId, invoice);
      } else if (invoice && invoice.status === 'open') {
        invoice.status = 'void';
        invoice.amountDueCents = 0;
        invoice.nextPaymentAttempt = null;
        await save(db, 'invoice', sub.orgId, invoice);
      }
      if (sub.status !== 'canceled') {
        sub.status = 'canceled';
        sub.canceledAt = iso(now);
        sub.endedAt = iso(now);
        await save(db, 'subscription', sub.orgId, sub);
      }
      return { refundedCents };
    },

    async createPaymentUpdateSession({ customerId, returnUrl }) {
      const customer = await load<CustomerDoc>(db, customerId, 'customer');
      if (!customer) throw new Error('Test customer not found.');
      const session: PortalSessionDoc = {
        id: newId('bps_test_'),
        orgId: customer.orgId,
        customerId,
        returnUrl,
        status: 'open',
        createdAt: iso(ctx.now()),
      };
      await save(db, 'portal_session', customer.orgId, session);
      return { url: `${ctx.portalUrl}/test-gateway/card/${session.id}` };
    },

    async getSubscription(id) {
      const doc = await load<SubscriptionDoc>(db, id, 'subscription');
      return doc ? toGatewaySubscription(db, doc) : null;
    },

    async findSubscriptionForCustomer(customerId) {
      const customer = await load<CustomerDoc>(db, customerId, 'customer');
      if (!customer) return null;
      const all = (await listKind<SubscriptionDoc>(db, 'subscription', customer.orgId)).filter((doc) => doc.customerId === customerId);
      const doc = all.find((entry) => entry.status !== 'canceled') ?? all[0];
      return doc ? toGatewaySubscription(db, doc) : null;
    },

    async previewChange({ subscriptionId, selection, prorationDate }) {
      const sub = await requireSubscription(subscriptionId);
      const customer = await load<CustomerDoc>(db, sub.customerId, 'customer');
      return changeMath(sub, creditOf(customer, sub), selection, prorationDate, ctx.now()).preview;
    },

    async applyChange({ subscriptionId, selection, prorationDate }) {
      const normalized = normalizeSelection(selection);
      const { orgId } = await requireSubscription(subscriptionId);
      // One step (review round 2): the documents are read, changed and saved under the lock of the
      // organization and in one transaction. Two calls at the same moment run one after the other,
      // and the second one meets the plan the first one left: it charges nothing twice.
      type Changed = { ok: true; sub: SubscriptionDoc; paidInvoice: InvoiceDoc | null } | { ok: false; code: string };
      const changed = await db.transaction(async (tx): Promise<Changed> => {
        const locked: Ctx = { ...ctx, db: tx as unknown as BillingDb };
        await lockOrg(locked.db, orgId);
        const sub = await load<SubscriptionDoc>(locked.db, subscriptionId, 'subscription');
        if (!sub) throw new Error('Test subscription not found.');
        const now = locked.now();
        let customer = await load<CustomerDoc>(locked.db, sub.customerId, 'customer');
        if (!customer) throw new Error('Test customer is missing.');
        const credit = creditOf(customer, sub);
        const math = changeMath(sub, credit, normalized, prorationDate, now);
        let paidInvoice: InvoiceDoc | null = null;

        if (math.preview.dueTodayCents > 0) {
          const drafted = await draftInvoice(locked, sub, {
            reason: 'subscription_update',
            lines: math.lines,
            periodStart: now,
            periodEnd: math.intervalChanged ? addInterval(now, normalized.interval) : new Date(sub.currentPeriodEnd),
            issuedAt: now,
            usePromo: false,
            useCredit: true,
          });
          const charge = await attemptCharge(locked, sub, drafted.invoice.totalCents, 'change');
          if (!charge.ok) {
            // A declined card changes nothing. Only the used up "fail next" flag is kept.
            await save(locked.db, 'subscription', sub.orgId, sub);
            return { ok: false, code: charge.code };
          }
          markPaid(drafted.invoice, charge.last4, now);
          customer = drafted.customer;
          setCredit(customer, sub, credit - drafted.creditUsed);
          sub.latestInvoiceId = drafted.invoice.id;
          await save(locked.db, 'invoice', sub.orgId, drafted.invoice);
          paidInvoice = drafted.invoice;
        } else if (math.netCents > 0) {
          // Fully covered by credit from an earlier decrease.
          setCredit(customer, sub, credit - math.creditApplied);
        } else {
          setCredit(customer, sub, credit - math.netCents);
        }
        await save(locked.db, 'customer', sub.orgId, customer);

        sub.items = math.newItems;
        sub.seats = normalized.seats;
        sub.warehouses = normalized.warehouses;
        if (math.intervalChanged) {
          sub.interval = normalized.interval;
          if (sub.status !== 'trialing') {
            sub.currentPeriodStart = iso(now);
            sub.currentPeriodEnd = iso(addInterval(now, normalized.interval));
          }
        }
        if (sub.cancelAtPeriodEnd) sub.cancelAt = sub.currentPeriodEnd;
        await save(locked.db, 'subscription', sub.orgId, sub);
        return { ok: true, sub, paidInvoice };
      });
      if (!changed.ok) throw new GatewayCardError('The test card was declined.', changed.code);

      // Events go out after the commit, through the same door Stripe uses.
      if (changed.paidInvoice) await deliver(ctx, gateway, 'invoice.paid', invoiceObject(changed.paidInvoice));
      await deliver(ctx, gateway, 'customer.subscription.updated', subscriptionObject(changed.sub));
      return toGatewaySubscription(db, changed.sub);
    },

    async setCancelAtPeriodEnd(subscriptionId, cancel) {
      const sub = await requireSubscription(subscriptionId);
      sub.cancelAtPeriodEnd = cancel;
      sub.cancelAt = cancel ? (sub.status === 'trialing' && sub.trialEnd ? sub.trialEnd : sub.currentPeriodEnd) : null;
      await save(db, 'subscription', sub.orgId, sub);
      await deliver(ctx, gateway, 'customer.subscription.updated', subscriptionObject(sub));
      return toGatewaySubscription(db, sub);
    },

    async pause(subscriptionId, resumesAt) {
      const sub = await requireSubscription(subscriptionId);
      sub.pauseResumesAt = iso(resumesAt);
      await save(db, 'subscription', sub.orgId, sub);
      await deliver(ctx, gateway, 'customer.subscription.paused', subscriptionObject(sub));
      return toGatewaySubscription(db, sub);
    },

    async resume(subscriptionId, options) {
      const sub = await requireSubscription(subscriptionId);
      sub.pauseResumesAt = null;
      let invoice: InvoiceDoc | null = null;
      let failed = false;
      if (options?.billNow && sub.status === 'active') {
        // The paid time ran out during the pause. A new period starts today and is billed today.
        const start = ctx.now();
        const billed = await billPeriod(ctx, sub, start, 'subscription_cycle');
        invoice = billed.invoice;
        failed = !billed.paid;
      }
      await save(db, 'subscription', sub.orgId, sub);
      if (invoice) await deliver(ctx, gateway, failed ? 'invoice.payment_failed' : 'invoice.paid', invoiceObject(invoice));
      await deliver(ctx, gateway, 'customer.subscription.resumed', subscriptionObject(sub));
      return toGatewaySubscription(db, sub);
    },

    async payLatestInvoice(subscriptionId) {
      const sub = await requireSubscription(subscriptionId);
      const invoice = sub.latestInvoiceId ? await load<InvoiceDoc>(db, sub.latestInvoiceId, 'invoice') : null;
      if (!invoice) throw new Error('There is no invoice to pay.');
      if (invoice.status !== 'open') return toGatewayInvoice(invoice);

      const charge = await attemptCharge(ctx, sub, invoice.totalCents, chargeKindOf(invoice));
      invoice.attemptCount += 1;
      if (!charge.ok) {
        invoice.lastErrorCode = charge.code;
        await save(db, 'invoice', sub.orgId, invoice);
        await save(db, 'subscription', sub.orgId, sub);
        await deliver(ctx, gateway, 'invoice.payment_failed', invoiceObject(invoice));
        throw new GatewayCardError('The test card was declined.', charge.code);
      }
      markPaid(invoice, charge.last4, ctx.now());
      if (sub.status === 'past_due' || sub.status === 'unpaid') sub.status = 'active';
      await save(db, 'invoice', sub.orgId, invoice);
      await save(db, 'subscription', sub.orgId, sub);
      await deliver(ctx, gateway, 'invoice.paid', invoiceObject(invoice));
      await deliver(ctx, gateway, 'customer.subscription.updated', subscriptionObject(sub));
      return toGatewayInvoice(invoice);
    },

    async getInvoice(id) {
      const doc = await load<InvoiceDoc>(db, id, 'invoice');
      return doc ? toGatewayInvoice(doc) : null;
    },

    async listInvoices(customerId, limit) {
      const customer = await load<CustomerDoc>(db, customerId, 'customer');
      if (!customer) return [];
      const all = (await listKind<InvoiceDoc>(db, 'invoice', customer.orgId)).filter((doc) => doc.customerId === customerId);
      return all
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
        .slice(0, Math.max(1, limit))
        .map(toGatewayInvoice);
    },

    async getInvoicePdf(id): Promise<GatewayInvoicePdf> {
      const doc = await load<InvoiceDoc>(db, id, 'invoice');
      if (!doc) throw new Error('Test invoice not found.');
      const customer = await load<CustomerDoc>(db, doc.customerId, 'customer');
      const billTo: string[] = [];
      if (customer?.email) billTo.push(customer.email);
      const address = customer?.address;
      if (address) {
        const street = [address.line1, address.line2].filter(Boolean).join(', ');
        const city = [address.city, address.state, address.postalCode].filter(Boolean).join(', ');
        if (street) billTo.push(street);
        if (city) billTo.push(city);
        if (address.country) billTo.push(address.country);
      }
      if (customer?.taxId) billTo.push(`Tax ID: ${customer.taxId.value}`);
      return {
        kind: 'bytes',
        bytes: renderInvoicePdf({ invoice: toGatewayInvoice(doc), orgName: customer?.name ?? 'KitStak customer', billTo }),
        filename: `KitStak-${doc.number}.pdf`,
      };
    },

    verifyWebhook(rawBody, signatureHeader) {
      verifyTestSignature(rawBody, signatureHeader, ctx.webhookSecret, ctx.now());
      return parseEvent(rawBody);
    },
  };

  return gateway;
}

/**
 * Starts a new period at `start` and bills it. Mutates `sub` (period, status, latest invoice, credit,
 * promo); the caller saves the subscription. The invoice and the customer are saved here.
 */
async function billPeriod(
  ctx: Ctx,
  sub: SubscriptionDoc,
  start: Date,
  reason: string,
): Promise<{ invoice: InvoiceDoc; paid: boolean }> {
  const end = addInterval(start, sub.interval);
  // The first bill of a plan: at checkout, or the first charge when the free trial ends.
  const firstBill = reason === 'subscription_create' || sub.trialEnd !== null;
  const drafted = await draftInvoice(ctx, sub, {
    reason,
    lines: periodLines(sub.items),
    periodStart: start,
    periodEnd: end,
    issuedAt: start,
    usePromo: true,
    useCredit: true,
  });
  const { invoice } = drafted;
  invoice.firstBill = firstBill;
  sub.currentPeriodStart = iso(start);
  sub.currentPeriodEnd = iso(end);
  sub.trialEnd = null;
  sub.latestInvoiceId = invoice.id;
  setCredit(drafted.customer, sub, creditOf(drafted.customer, sub) - drafted.creditUsed);
  if (drafted.promoUsed) sub.promoCode = null;
  if (sub.cancelAtPeriodEnd) sub.cancelAt = sub.currentPeriodEnd;

  const charge = await attemptCharge(ctx, sub, invoice.totalCents, firstBill ? 'first' : 'renewal');
  invoice.attemptCount = 1;
  invoice.autoAttempts = 1;
  if (charge.ok) {
    markPaid(invoice, charge.last4, start.getTime() > ctx.now().getTime() ? ctx.now() : start);
    sub.status = 'active';
  } else {
    invoice.lastErrorCode = charge.code;
    invoice.nextPaymentAttempt = iso(new Date(start.getTime() + RETRY_DAYS[0] * DAY_MS));
    sub.status = 'past_due';
  }
  await save(ctx.db, 'customer', sub.orgId, drafted.customer);
  await save(ctx.db, 'invoice', sub.orgId, invoice);
  return { invoice, paid: charge.ok };
}

/* ===== hosted pages ===== */

export interface TestCheckoutView {
  readonly sessionId: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly status: 'open' | 'complete' | 'expired';
  readonly quote: Quote;
  readonly dueTodayCents: number;
  readonly firstChargeAt: Date;
  readonly trialEnd: Date | null;
  readonly cancelUrl: string;
  /** True while a card waits for the pretend bank step. */
  readonly needsBankApproval: boolean;
  /** The promo code applied on this page, with its own line for the summary. null when none. */
  readonly promo: { readonly code: string; readonly label: string; readonly discountCents: number } | null;
  /** Credit on the account that comes off the first charge. */
  readonly creditAppliedCents: number;
  /** What the card is charged at the first charge: the price, minus the promo code, minus credit. */
  readonly firstChargeCents: number;
}

export interface TestCardUpdateView {
  readonly sessionId: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly current: PaymentMethodSummary | null;
  readonly returnUrl: string;
}

async function orgNameOf(db: BillingDb, orgId: string): Promise<string> {
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));
  return org?.name ?? 'your organization';
}

const LIVE_TEST_STATUSES: readonly GatewaySubscriptionStatus[] = ['trialing', 'active', 'past_due', 'unpaid'];

/** One writer per organization until the transaction ends. */
async function lockOrg(db: BillingDb, orgId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kitstak-billing-org:${orgId}`}, 0))`);
}

function ctxOf(rt: BillingRuntime): Ctx {
  return { db: rt.db, portalUrl: rt.portalUrl, webhookSecret: rt.config.testWebhookSecret, now: rt.now };
}

function isTestRuntime(rt: BillingRuntime): rt is BillingRuntime & { gateway: BillingGateway } {
  return rt.mode === 'test_gateway' && rt.gateway !== null && rt.gateway.kind === 'test';
}

export async function getTestCheckout(db: BillingDb, sessionId: string, now: Date = new Date()): Promise<TestCheckoutView | null> {
  const session = await load<CheckoutSessionDoc>(db, sessionId, 'checkout_session');
  if (!session) return null;
  const priced = quote(session.selection);
  const trialEnd = dateOrNull(session.trialEnd);
  const inTrial = trialEnd !== null && trialEnd.getTime() > now.getTime();
  const customer = await load<CustomerDoc>(db, session.customerId, 'customer');
  const promoCode = session.pending?.promoCode ?? session.promoCode ?? null;
  // The same function the first invoice is made with, so this is the amount that will be charged.
  const bill = billMath(priced.totalCents, promoCode, creditOf(customer, null));
  return {
    sessionId: session.id,
    orgId: session.orgId,
    orgName: await orgNameOf(db, session.orgId),
    status: session.status,
    quote: priced,
    dueTodayCents: inTrial ? 0 : bill.totalCents,
    firstChargeAt: inTrial && trialEnd ? trialEnd : now,
    trialEnd: inTrial ? trialEnd : null,
    cancelUrl: session.cancelUrl,
    needsBankApproval: session.pending !== null,
    promo:
      promoCode && bill.discountLabel
        ? { code: promoCode, label: bill.discountLabel, discountCents: bill.discountCents }
        : null,
    creditAppliedCents: bill.creditUsedCents,
    firstChargeCents: bill.totalCents,
  };
}

/**
 * The promo code box on the test checkout page. A code that works is saved on the session, so the
 * summary shows the promo line and the real first charge before the person pays. An empty code
 * takes the promo off again.
 */
export async function applyTestPromo(
  rt: BillingRuntime,
  input: { sessionId: string; promoCode: string },
): Promise<BillingResult<{ promo: TestCheckoutView['promo']; firstChargeCents: number }>> {
  if (!isTestRuntime(rt)) return billingError('billing_unavailable');
  const session = await load<CheckoutSessionDoc>(rt.db, input.sessionId, 'checkout_session');
  if (!session) return billingError('not_found');
  if (session.status !== 'open') {
    return billingError('not_found', 'This checkout page has closed. Go back to Billing and start again.');
  }
  const code = input.promoCode.trim().toUpperCase();
  if (code !== '' && code !== TEST_PROMO_CODE) {
    return billingError('invalid_input', `That promo code is not valid. In test mode, try ${TEST_PROMO_CODE}.`);
  }
  session.promoCode = code === '' ? null : code;
  await save(rt.db, 'checkout_session', session.orgId, session);
  const view = await getTestCheckout(rt.db, session.id, rt.now());
  if (!view) return billingError('not_found');
  return billingOk({ promo: view.promo, firstChargeCents: view.firstChargeCents });
}

function cardExpired(expMonth: number, expYear: number, now: Date): boolean {
  const year = expYear < 100 ? 2000 + expYear : expYear;
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12 || !Number.isInteger(year)) return true;
  // A card is good through the last day of its month.
  return Date.UTC(year, expMonth, 1) <= now.getTime();
}

async function attachCard(
  ctx: Ctx,
  customer: CustomerDoc,
  card: { cardNumber: string; expMonth: number; expYear: number; outcome: TestCardOutcome },
): Promise<PaymentMethodDoc> {
  const method: PaymentMethodDoc = {
    id: newId('pm_test_'),
    customerId: customer.id,
    brand: 'visa',
    last4: digitsOnly(card.cardNumber).slice(-4),
    expMonth: card.expMonth,
    expYear: card.expYear < 100 ? 2000 + card.expYear : card.expYear,
    outcome: card.outcome,
    chargesSucceeded: 0,
  };
  await save(ctx.db, 'payment_method', customer.orgId, method);
  customer.defaultPaymentMethodId = method.id;
  await save(ctx.db, 'customer', customer.orgId, customer);
  return method;
}

/**
 * The pay button on the test checkout page. A declined card leaves everything as it was. A card that
 * needs bank approval comes back with `requires_action`; call again with `approve3ds` true or false.
 */
export async function completeTestCheckout(
  rt: BillingRuntime,
  input: {
    sessionId: string;
    cardNumber: string;
    expMonth: number;
    expYear: number;
    cvc: string;
    name: string;
    postalCode: string;
    promoCode?: string;
    approve3ds?: boolean;
  },
): Promise<BillingResult<{ status: 'complete' | 'requires_action'; redirectUrl: string }>> {
  if (!isTestRuntime(rt)) return billingError('billing_unavailable');
  const ctx = ctxOf(rt);
  const session = await load<CheckoutSessionDoc>(ctx.db, input.sessionId, 'checkout_session');
  if (!session) return billingError('not_found');
  const successUrl = session.successUrl.replace('{CHECKOUT_SESSION_ID}', session.id);
  if (session.status === 'complete') return billingOk({ status: 'complete', redirectUrl: successUrl });
  if (session.status !== 'open') return billingError('not_found', 'This checkout page has closed. Go back to Billing and start again.');

  // The bank step answers for the card that was entered before it.
  const answeringBank = input.approve3ds !== undefined && session.pending !== null;
  const entered = answeringBank && session.pending
    ? session.pending
    : {
        cardNumber: input.cardNumber,
        expMonth: input.expMonth,
        expYear: input.expYear,
        // The box on the form wins; with nothing typed, the code applied on the page counts.
        promoCode: input.promoCode?.trim() ? input.promoCode.trim().toUpperCase() : (session.promoCode ?? null),
      };

  const known = findTestCard(entered.cardNumber);
  if (!known) return billingError('card_declined', 'Use one of the test cards on this page. Real cards do not work in test mode.');
  if (!answeringBank) {
    if (cardExpired(entered.expMonth, entered.expYear, ctx.now())) {
      return billingError('card_declined', 'That expiry date is in the past. Check it and try again.');
    }
    if (!/^\d{3,4}$/.test(input.cvc.trim())) {
      return billingError('card_declined', 'Enter the 3 digit security code from the back of the card.');
    }
    if (entered.promoCode && entered.promoCode !== TEST_PROMO_CODE) {
      return billingError('invalid_input', `That promo code is not valid. In test mode, try ${TEST_PROMO_CODE}.`);
    }
  }
  if (known.outcome === 'declined') return billingError('card_declined');
  if (known.outcome === 'insufficient_funds') {
    return billingError('card_declined', 'That card does not have enough money. Try another card.');
  }
  if (known.outcome === 'requires_action') {
    if (input.approve3ds === undefined) {
      session.pending = entered;
      await save(ctx.db, 'checkout_session', session.orgId, session);
      return billingOk({
        status: 'requires_action',
        redirectUrl: `${ctx.portalUrl}/test-gateway/checkout/${session.id}?step=bank`,
      });
    }
    if (!input.approve3ds) {
      session.pending = null;
      await save(ctx.db, 'checkout_session', session.orgId, session);
      return billingError('card_declined', 'Your bank did not approve the payment. Try again or use another card.');
    }
  }

  // Everything from here to the saved subscription happens under one lock per organization and in one
  // transaction. Two pay pages pressed at the same moment cannot both make a subscription, and a
  // declined first payment leaves nothing behind: no card, no invoice, no used up credit.
  type Created =
    | { ok: true; sub: SubscriptionDoc; customer: CustomerDoc; firstInvoice: InvoiceDoc | null }
    | { ok: false; error: ReturnType<typeof billingError> };
  const DECLINED = Symbol('declined');
  let created: Created;
  try {
    created = await ctx.db.transaction(async (tx): Promise<Created> => {
      const locked: Ctx = { ...ctx, db: tx as unknown as BillingDb };
      await lockOrg(locked.db, session.orgId);
      const fresh = await load<CheckoutSessionDoc>(locked.db, session.id, 'checkout_session');
      if (!fresh || fresh.status !== 'open') {
        return { ok: false, error: billingError('not_found', 'This checkout page has closed. Go back to Billing and start again.') };
      }
      const live = (await listKind<SubscriptionDoc>(locked.db, 'subscription', session.orgId)).find((doc) =>
        LIVE_TEST_STATUSES.includes(doc.status),
      );
      if (live) {
        // The organization already has a plan (another pay page finished first). Close this page.
        fresh.status = 'expired';
        fresh.pending = null;
        await save(locked.db, 'checkout_session', fresh.orgId, fresh);
        return { ok: false, error: billingError('already_subscribed', 'You already have a plan. Nothing was charged here.') };
      }

      const customer = await load<CustomerDoc>(locked.db, session.customerId, 'customer');
      if (!customer) return { ok: false, error: billingError('not_found') };
      await attachCard(locked, customer, { ...entered, outcome: known.outcome });

      const now = locked.now();
      const trialEnd = dateOrNull(session.trialEnd);
      const trialing = trialEnd !== null && trialEnd.getTime() > now.getTime();
      const sub: SubscriptionDoc = {
        id: newId('sub_test_'),
        customerId: customer.id,
        orgId: session.orgId,
        status: trialing ? 'trialing' : 'incomplete',
        interval: session.selection.interval,
        seats: session.selection.seats,
        warehouses: session.selection.warehouses,
        items: itemsFor(session.selection),
        currentPeriodStart: iso(now),
        currentPeriodEnd: iso(trialing && trialEnd ? trialEnd : addInterval(now, session.selection.interval)),
        trialEnd: trialing && trialEnd ? iso(trialEnd) : null,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        canceledAt: null,
        endedAt: null,
        pauseResumesAt: null,
        latestInvoiceId: null,
        creditCents: 0,
        failNextPayment: false,
        promoCode: entered.promoCode,
        createdAt: iso(now),
      };

      let firstInvoice: InvoiceDoc | null = null;
      if (!trialing) {
        const billed = await billPeriod(locked, sub, now, 'subscription_create');
        // Roll everything back: the page stays open and can be tried again with another card.
        if (!billed.paid) throw DECLINED;
        firstInvoice = billed.invoice;
      }
      await save(locked.db, 'subscription', session.orgId, sub);

      fresh.status = 'complete';
      fresh.subscriptionId = sub.id;
      fresh.pending = null;
      await save(locked.db, 'checkout_session', fresh.orgId, fresh);
      return { ok: true, sub, customer, firstInvoice };
    });
  } catch (error) {
    if (error === DECLINED) return billingError('card_declined');
    throw error;
  }
  if (!created.ok) return created.error;
  const { sub, customer, firstInvoice } = created;

  await deliver(ctx, rt.gateway, 'checkout.session.completed', {
    id: session.id,
    object: 'checkout.session',
    customer: customer.id,
    subscription: sub.id,
    client_reference_id: session.orgId,
    status: 'complete',
    metadata: { kitstak_org_id: session.orgId },
  });
  await deliver(ctx, rt.gateway, 'customer.subscription.created', subscriptionObject(sub));
  if (firstInvoice) await deliver(ctx, rt.gateway, 'invoice.paid', invoiceObject(firstInvoice));

  return billingOk({ status: 'complete', redirectUrl: successUrl });
}

/** The back link on the test checkout page. No charge was made and the cart is kept. */
export async function cancelTestCheckout(rt: BillingRuntime, sessionId: string): Promise<{ redirectUrl: string }> {
  const fallback = `${rt.portalUrl}/billing/checkout/canceled`;
  if (!isTestRuntime(rt)) return { redirectUrl: fallback };
  const session = await load<CheckoutSessionDoc>(rt.db, sessionId, 'checkout_session');
  if (!session) return { redirectUrl: fallback };
  if (session.pending) {
    session.pending = null;
    await save(rt.db, 'checkout_session', session.orgId, session);
  }
  return { redirectUrl: session.cancelUrl };
}

export async function getTestCardUpdate(db: BillingDb, sessionId: string): Promise<TestCardUpdateView | null> {
  const session = await load<PortalSessionDoc>(db, sessionId, 'portal_session');
  if (!session) return null;
  return {
    sessionId: session.id,
    orgId: session.orgId,
    orgName: await orgNameOf(db, session.orgId),
    current: cardSummary(await cardOf(db, session.customerId)),
    returnUrl: session.returnUrl,
  };
}

/** Saves a new test card as the card on file. A card the bank would decline is not saved. */
export async function completeTestCardUpdate(
  rt: BillingRuntime,
  input: { sessionId: string; cardNumber: string; expMonth: number; expYear: number; cvc: string },
): Promise<BillingResult<{ redirectUrl: string }>> {
  if (!isTestRuntime(rt)) return billingError('billing_unavailable');
  const ctx = ctxOf(rt);
  const session = await load<PortalSessionDoc>(ctx.db, input.sessionId, 'portal_session');
  if (!session) return billingError('not_found');
  const known = findTestCard(input.cardNumber);
  if (!known) return billingError('card_declined', 'Use one of the test cards on this page. Real cards do not work in test mode.');
  if (cardExpired(input.expMonth, input.expYear, ctx.now())) {
    return billingError('card_declined', 'That expiry date is in the past. Check it and try again.');
  }
  if (!/^\d{3,4}$/.test(input.cvc.trim())) {
    return billingError('card_declined', 'Enter the 3 digit security code from the back of the card.');
  }
  if (known.outcome === 'declined') return billingError('card_declined');
  if (known.outcome === 'insufficient_funds') {
    return billingError('card_declined', 'That card does not have enough money. Try another card.');
  }
  const customer = await load<CustomerDoc>(ctx.db, session.customerId, 'customer');
  if (!customer) return billingError('not_found');
  const method = await attachCard(ctx, customer, { ...input, outcome: known.outcome });
  session.status = 'complete';
  await save(ctx.db, 'portal_session', session.orgId, session);
  await deliver(ctx, rt.gateway, 'payment_method.attached', {
    id: method.id,
    object: 'payment_method',
    customer: customer.id,
    metadata: { kitstak_org_id: customer.orgId },
  });
  return billingOk({ redirectUrl: session.returnUrl });
}

/* ===== test tools ===== */

type DueAction = 'cancel' | 'resume' | 'retry' | 'boundary';

function nextDue(sub: SubscriptionDoc, invoice: InvoiceDoc | null, now: Date): { action: DueAction; at: Date } | null {
  const candidates: { action: DueAction; at: Date }[] = [];
  const active = sub.status === 'active' || sub.status === 'trialing';
  if (active && sub.cancelAtPeriodEnd) candidates.push({ action: 'cancel', at: new Date(sub.currentPeriodEnd) });
  if (active && sub.pauseResumesAt) candidates.push({ action: 'resume', at: new Date(sub.pauseResumesAt) });
  if (active && !sub.cancelAtPeriodEnd) {
    candidates.push({ action: 'boundary', at: new Date(sub.status === 'trialing' && sub.trialEnd ? sub.trialEnd : sub.currentPeriodEnd) });
  }
  if (sub.status === 'past_due' && invoice && invoice.status === 'open' && invoice.nextPaymentAttempt) {
    candidates.push({ action: 'retry', at: new Date(invoice.nextPaymentAttempt) });
  }
  const order: Record<DueAction, number> = { cancel: 0, resume: 1, retry: 2, boundary: 3 };
  const due = candidates
    .filter((entry) => entry.at.getTime() <= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime() || order[a.action] - order[b.action]);
  return due[0] ?? null;
}

/**
 * Runs everything that is due for the test subscriptions: first charges at trial end, renewals,
 * retries of failed payments, pauses that end, and plans that reach their last day. This is the
 * work Stripe does by itself over time.
 */
export async function testRunDue(rt: BillingRuntime, input?: { orgId?: string }): Promise<{ renewed: number; failed: number }> {
  const counts = { renewed: 0, failed: 0 };
  if (!isTestRuntime(rt)) return counts;
  const ctx = ctxOf(rt);
  const gateway = rt.gateway;
  const subs = (await listKind<SubscriptionDoc>(ctx.db, 'subscription', input?.orgId)).filter(
    (doc) => doc.status !== 'canceled' && doc.status !== 'incomplete',
  );

  for (const listed of subs) {
    for (let step = 0; step < 80; step += 1) {
      const sub = await load<SubscriptionDoc>(ctx.db, listed.id, 'subscription');
      if (!sub || sub.status === 'canceled') break;
      const invoice = sub.latestInvoiceId ? await load<InvoiceDoc>(ctx.db, sub.latestInvoiceId, 'invoice') : null;
      const due = nextDue(sub, invoice, ctx.now());
      if (!due) break;

      if (due.action === 'cancel') {
        sub.status = 'canceled';
        sub.canceledAt = sub.canceledAt ?? iso(due.at);
        sub.endedAt = iso(due.at);
        await save(ctx.db, 'subscription', sub.orgId, sub);
        await deliver(ctx, gateway, 'customer.subscription.deleted', subscriptionObject(sub));
        break;
      }

      if (due.action === 'resume') {
        sub.pauseResumesAt = null;
        await save(ctx.db, 'subscription', sub.orgId, sub);
        await deliver(ctx, gateway, 'customer.subscription.resumed', subscriptionObject(sub));
        continue;
      }

      if (due.action === 'retry' && invoice) {
        const charge = await attemptCharge(ctx, sub, invoice.totalCents, chargeKindOf(invoice));
        invoice.attemptCount += 1;
        invoice.autoAttempts = (invoice.autoAttempts ?? invoice.attemptCount - 1) + 1;
        if (charge.ok) {
          markPaid(invoice, charge.last4, due.at);
          sub.status = 'active';
          await save(ctx.db, 'invoice', sub.orgId, invoice);
          await save(ctx.db, 'subscription', sub.orgId, sub);
          await deliver(ctx, gateway, 'invoice.paid', invoiceObject(invoice));
          await deliver(ctx, gateway, 'customer.subscription.updated', subscriptionObject(sub));
          counts.renewed += 1;
          continue;
        }
        counts.failed += 1;
        invoice.lastErrorCode = charge.code;
        const nextRetryDay = RETRY_DAYS[invoice.autoAttempts - 1];
        if (nextRetryDay === undefined) {
          // The last try failed. The gateway gives up and closes the plan.
          invoice.status = 'uncollectible';
          invoice.nextPaymentAttempt = null;
          sub.status = 'canceled';
          sub.canceledAt = iso(due.at);
          sub.endedAt = iso(due.at);
          await save(ctx.db, 'invoice', sub.orgId, invoice);
          await save(ctx.db, 'subscription', sub.orgId, sub);
          await deliver(ctx, gateway, 'invoice.payment_failed', invoiceObject(invoice));
          await deliver(ctx, gateway, 'customer.subscription.deleted', subscriptionObject(sub));
          break;
        }
        invoice.nextPaymentAttempt = iso(new Date(new Date(invoice.issuedAt).getTime() + nextRetryDay * DAY_MS));
        await save(ctx.db, 'invoice', sub.orgId, invoice);
        await save(ctx.db, 'subscription', sub.orgId, sub);
        await deliver(ctx, gateway, 'invoice.payment_failed', invoiceObject(invoice));
        continue;
      }

      // A period boundary: the end of the trial or of a paid period.
      if (sub.pauseResumesAt && new Date(sub.pauseResumesAt).getTime() > due.at.getTime()) {
        // Paused: the period rolls on and no invoice is made.
        sub.currentPeriodStart = iso(due.at);
        sub.currentPeriodEnd = iso(addInterval(due.at, sub.interval));
        await save(ctx.db, 'subscription', sub.orgId, sub);
        await deliver(ctx, gateway, 'customer.subscription.updated', subscriptionObject(sub));
        continue;
      }
      const billed = await billPeriod(ctx, sub, due.at, 'subscription_cycle');
      await save(ctx.db, 'subscription', sub.orgId, sub);
      if (billed.paid) {
        counts.renewed += 1;
        await deliver(ctx, gateway, 'invoice.paid', invoiceObject(billed.invoice));
      } else {
        counts.failed += 1;
        await deliver(ctx, gateway, 'invoice.payment_failed', invoiceObject(billed.invoice));
      }
      await deliver(ctx, gateway, 'customer.subscription.updated', subscriptionObject(sub));
    }
  }
  return counts;
}

const SHIFT_KEYS = new Set([
  'currentPeriodStart',
  'currentPeriodEnd',
  'trialEnd',
  'cancelAt',
  'canceledAt',
  'endedAt',
  'pauseResumesAt',
  'createdAt',
  'issuedAt',
  'paidAt',
  'periodStart',
  'periodEnd',
  'nextPaymentAttempt',
]);

function shiftDoc(doc: Record<string, unknown>, ms: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };
  for (const [key, value] of Object.entries(doc)) {
    if (SHIFT_KEYS.has(key) && typeof value === 'string') {
      const at = new Date(value).getTime();
      if (Number.isFinite(at)) out[key] = new Date(at - ms).toISOString();
    }
  }
  return out;
}

/**
 * Test tool: moves the org's stored dates back by `days` (trial dates, entitlement period ends, the
 * test subscription periods, late payment dates and the activity history), then runs what is due.
 * This is how a test reaches "trial ended" or "renewal day" without waiting. It is the one place the
 * test gateway touches dates in our own tables, and it only exists in test gateway mode.
 */
export async function testShiftTime(rt: BillingRuntime, input: { orgId: string; days: number }): Promise<BillingResult<PlanState>> {
  if (!isTestRuntime(rt)) return billingError('billing_unavailable');
  const days = Math.round(input.days);
  if (!isUuid(input.orgId) || !Number.isFinite(days) || days < 1 || days > 800) {
    return billingError('invalid_input', 'Pick a number of days from 1 to 800.');
  }
  const { db } = rt;
  const orgId = input.orgId;
  const span = sql`(${days} * interval '1 day')`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE "core"."billing_accounts"
         SET "trial_started_at" = "trial_started_at" - ${span}, "trial_ends_at" = "trial_ends_at" - ${span}
       WHERE "org_id" = ${orgId}`);
    await tx.execute(sql`
      UPDATE "core"."billing_trial_uses" SET "started_at" = "started_at" - ${span} WHERE "org_id" = ${orgId}`);
    await tx.execute(sql`
      UPDATE "core"."entitlements" SET "current_period_end" = "current_period_end" - ${span}
       WHERE "org_id" = ${orgId} AND "current_period_end" IS NOT NULL AND "source" <> 'manual'`);
    await tx.execute(sql`
      UPDATE "core"."billing_subscriptions"
         SET "current_period_start" = "current_period_start" - ${span},
             "current_period_end" = "current_period_end" - ${span},
             "trial_end" = "trial_end" - ${span},
             "cancel_at" = "cancel_at" - ${span},
             "canceled_at" = "canceled_at" - ${span},
             "ended_at" = "ended_at" - ${span},
             "pause_starts_at" = "pause_starts_at" - ${span},
             "pause_resumes_at" = "pause_resumes_at" - ${span},
             "past_due_since" = "past_due_since" - ${span},
             "next_payment_attempt" = "next_payment_attempt" - ${span},
             "gateway_synced_at" = "gateway_synced_at" - ${span}
       WHERE "org_id" = ${orgId}`);
    await tx.execute(sql`
      UPDATE "core"."billing_invoices"
         SET "issued_at" = "issued_at" - ${span}, "paid_at" = "paid_at" - ${span},
             "period_start" = "period_start" - ${span}, "period_end" = "period_end" - ${span},
             "next_payment_attempt" = "next_payment_attempt" - ${span}
       WHERE "org_id" = ${orgId}`);
    await tx.execute(sql`
      UPDATE "core"."billing_audit_log" SET "created_at" = "created_at" - ${span} WHERE "org_id" = ${orgId}`);
    await tx.execute(sql`
      UPDATE "core"."billing_cancel_feedback" SET "created_at" = "created_at" - ${span} WHERE "org_id" = ${orgId}`);
    await tx.execute(sql`
      UPDATE "core"."billing_emails"
         SET "created_at" = "created_at" - ${span}, "sent_at" = "sent_at" - ${span}, "send_after" = "send_after" - ${span}
       WHERE "org_id" = ${orgId}`);

    const docs = await tx
      .select({ id: billingTestObjects.id, data: billingTestObjects.data })
      .from(billingTestObjects)
      .where(eq(billingTestObjects.orgId, orgId));
    for (const doc of docs) {
      await tx
        .update(billingTestObjects)
        .set({ data: shiftDoc(doc.data, days * DAY_MS) })
        .where(eq(billingTestObjects.id, doc.id));
    }
  });

  clearBillingCaches(orgId);
  await testRunDue(rt, { orgId });
  await recordAudit(db, {
    orgId,
    actor: { userId: null, label: 'Test tools' },
    action: 'test.tool',
    summary: `Test tool: skipped ahead ${days} ${days === 1 ? 'day' : 'days'}. No real money moved.`,
    data: { days },
  });
  clearBillingCaches(orgId);
  return billingOk(await getPlanState(rt, orgId));
}

async function liveTestSubscription(rt: BillingRuntime, orgId: string): Promise<SubscriptionDoc | null> {
  const [row] = await rt.db
    .select({ id: billingSubscriptions.gatewaySubscriptionId, gateway: billingSubscriptions.gateway })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.orgId, orgId));
  if (!row || row.gateway !== 'test') return null;
  const doc = await load<SubscriptionDoc>(rt.db, row.id, 'subscription');
  return doc && doc.orgId === orgId && doc.status !== 'canceled' ? doc : null;
}

/** Test tool: the next charge for this org fails once, as if the bank said no. */
export async function testFailNextPayment(rt: BillingRuntime, input: { orgId: string }): Promise<BillingResult<null>> {
  if (!isTestRuntime(rt)) return billingError('billing_unavailable');
  const sub = await liveTestSubscription(rt, input.orgId);
  if (!sub) return billingError('no_subscription');
  sub.failNextPayment = true;
  await save(rt.db, 'subscription', sub.orgId, sub);
  await recordAudit(rt.db, {
    orgId: input.orgId,
    actor: { userId: null, label: 'Test tools' },
    action: 'test.tool',
    summary: 'Test tool: the next payment will fail. No real money moves.',
  });
  return billingOk(null);
}

/**
 * Test tool: builds and signs an event for the org's current test objects, and returns the raw body
 * and the signature without sending it. Used by the webhook replay tests.
 */
export async function testSendEvent(rt: BillingRuntime, input: { type: string; orgId: string }): Promise<{ rawBody: string; signature: string }> {
  const at = rt.now();
  let object: Record<string, unknown> = { id: newId('obj_test_'), object: 'unknown', metadata: { kitstak_org_id: input.orgId } };
  const sub = rt.mode === 'test_gateway' ? await liveTestSubscription(rt, input.orgId) : null;
  if (sub && input.type.startsWith('invoice.') && sub.latestInvoiceId) {
    const invoice = await load<InvoiceDoc>(rt.db, sub.latestInvoiceId, 'invoice');
    if (invoice) object = invoiceObject(invoice);
  } else if (sub) {
    object = subscriptionObject(sub);
  }
  const rawBody = buildEvent(input.type, object, at);
  return { rawBody, signature: signTestPayload(rawBody, rt.config.testWebhookSecret, at) };
}
