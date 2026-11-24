/**
 * The Stripe adapter (docs/billing/CONTRACTS.md section 10.3). The ONLY file in the repo that imports
 * `stripe`, and the only one that knows Stripe object shapes. Everything else works with the
 * normalized `Gateway*` types.
 *
 * Rules kept here:
 *  - Lazy client, SDK default API version (no `apiVersion`), two network retries.
 *  - Prices are found by lookup key only, never by name. The old tier products are never matched.
 *  - Discounts live inside the prices (bundle prices, yearly prices). No coupon is ever applied here,
 *    so the Checkout promo code slot stays free and the total is plain unit amount x quantity.
 *  - Period dates are read from the subscription items when the subscription has none at the top
 *    level (newer API versions moved them). The invoice's subscription id is read the same way.
 *  - One card per plan: reading a subscription makes the customer's default card (set by the Billing
 *    Portal) the subscription's card when they differ. See `adoptCustomerCard`.
 */
import Stripe from 'stripe';
import {
  type BillingInterval,
  type PlanSelection,
  type PriceKey,
  type ProductId,
  allPriceKeys,
  isBundle,
  isProductId,
  normalizeSelection,
  parsePriceKey,
  priceKey,
  quantityFor,
  unitCents,
} from '../catalog';
import { addInterval } from '../dates';
import type { PaymentMethodSummary } from '../plan-state';
import { quote } from '../quote';
import type { BillingConfig } from '../server/config';
import {
  type BillingAddress,
  type BillingGateway,
  type ChangePreview,
  GatewayCardError,
  type GatewayCheckoutSession,
  type GatewayEvent,
  type GatewayInvoice,
  type GatewayInvoiceLine,
  type GatewayItem,
  type GatewaySubscription,
  type GatewaySubscriptionStatus,
  type ProfileInput,
  WebhookSignatureError,
} from './types';

const PRICE_CACHE_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** A Stripe rule: a trial end must be at least 48 hours ahead. */
const MIN_TRIAL_AHEAD_MS = 48 * HOUR_MS;
/** Stripe takes at most 10 lookup keys per list call. */
const LOOKUP_CHUNK = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID_PREFIX = 'kitstak_';
const SUBSCRIPTION_EXPAND = ['default_payment_method', 'customer.invoice_settings.default_payment_method'];

type Loose = Record<string, unknown>;

function loose(value: unknown): Loose {
  return value !== null && typeof value === 'object' ? (value as Loose) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** An id from a field that is either an id string or an expanded object. */
function idOf(value: unknown): string | null {
  return str(value) ?? str(loose(value).id);
}

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function fromUnix(value: unknown): Date | null {
  const seconds = num(value);
  return seconds === null ? null : new Date(seconds * 1000);
}

function orgIdFrom(metadata: unknown): string | null {
  const id = str(loose(metadata).kitstak_org_id);
  return id && UUID_RE.test(id) ? id : null;
}

function toStripeAddress(address: BillingAddress | null): Stripe.AddressParam | undefined {
  if (!address) return undefined;
  return {
    line1: address.line1 ?? '',
    line2: address.line2 ?? '',
    city: address.city ?? '',
    state: address.state ?? '',
    postal_code: address.postalCode ?? '',
    country: address.country ?? '',
  };
}

function mapStatus(status: string): GatewaySubscriptionStatus {
  switch (status) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'unpaid':
    case 'canceled':
    case 'incomplete':
      return status;
    case 'incomplete_expired':
      return 'canceled';
    // Stripe's own "paused" status means collection stopped with nothing paid: treat it as unpaid.
    default:
      return 'unpaid';
  }
}

function cardSummary(method: unknown): PaymentMethodSummary | null {
  const card = loose(loose(method).card);
  const last4 = str(card.last4);
  if (!last4) return null;
  return {
    brand: str(card.brand) ?? 'card',
    last4,
    expMonth: num(card.exp_month) ?? 0,
    expYear: num(card.exp_year) ?? 0,
  };
}

/** The price key of a Stripe price: its lookup key, else the metadata the setup script wrote. */
function priceKeyOf(price: unknown): PriceKey | null {
  const record = loose(price);
  const lookup = str(record.lookup_key);
  if (lookup && parsePriceKey(lookup)) return lookup as PriceKey;
  // A price that was replaced loses its lookup key. Its metadata still says what it is.
  const metadata = loose(record.metadata);
  const product = str(metadata.kitstak_module);
  const interval = str(metadata.kitstak_interval);
  if (product && isProductId(product) && (interval === 'monthly' || interval === 'yearly')) {
    return priceKey(product, interval, metadata.kitstak_bundle === 'true');
  }
  return null;
}

function productOfLine(line: unknown): ProductId | null {
  const pricing = loose(loose(line).pricing);
  const productId = str(loose(pricing.price_details).product);
  if (!productId || !productId.startsWith(PRODUCT_ID_PREFIX)) return null;
  const product = productId.slice(PRODUCT_ID_PREFIX.length);
  return isProductId(product) ? product : null;
}

function toInvoiceLine(line: unknown): GatewayInvoiceLine {
  const record = loose(line);
  const parent = loose(record.parent);
  const proration =
    loose(parent.subscription_item_details).proration === true ||
    loose(parent.invoice_item_details).proration === true ||
    record.proration === true;
  const amountCents = num(record.amount) ?? 0;
  const quantity = num(record.quantity) ?? 1;
  const decimal = Number(String(loose(record.pricing).unit_amount_decimal ?? ''));
  const unit = Number.isFinite(decimal) && decimal !== 0 ? Math.round(decimal) : quantity !== 0 ? Math.round(amountCents / quantity) : amountCents;
  return {
    description: str(record.description) ?? 'KitStak',
    product: productOfLine(line),
    quantity,
    unitCents: unit,
    amountCents,
    proration,
  };
}

function sumAmounts(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce((sum: number, entry) => sum + (num(loose(entry).amount) ?? 0), 0);
}

function toInvoice(invoice: unknown): GatewayInvoice {
  const record = loose(invoice);
  const lineList = loose(record.lines).data;
  const lines = Array.isArray(lineList) ? lineList.map(toInvoiceLine) : [];
  const firstPeriod = Array.isArray(lineList) ? loose(loose(lineList.find((line) => !toInvoiceLine(line).proration) ?? lineList[0]).period) : {};
  const transitions = loose(record.status_transitions);
  const subscriptionDetails = loose(loose(record.parent).subscription_details);
  const status = str(record.status);
  const total = num(record.total) ?? 0;
  // `amount_due` is what the card is asked for. When it is below the total, credit paid the rest.
  const chargeAsked = num(record.amount_due);
  const creditAppliedCents = total > 0 && chargeAsked !== null ? Math.min(total, Math.max(0, total - chargeAsked)) : 0;
  return {
    id: str(record.id) ?? '',
    customerId: idOf(record.customer) ?? '',
    subscriptionId: idOf(subscriptionDetails.subscription) ?? idOf(record.subscription),
    number: str(record.number),
    status: status === 'open' || status === 'paid' || status === 'void' || status === 'uncollectible' ? status : 'draft',
    billingReason: str(record.billing_reason),
    subtotalCents: num(record.subtotal) ?? 0,
    discountCents: sumAmounts(record.total_discount_amounts),
    taxCents: Array.isArray(record.total_taxes) ? sumAmounts(record.total_taxes) : (num(record.tax) ?? 0),
    totalCents: num(record.total) ?? 0,
    amountPaidCents: num(record.amount_paid) ?? 0,
    amountDueCents: num(record.amount_remaining) ?? num(record.amount_due) ?? 0,
    lines,
    periodStart: fromUnix(firstPeriod.start) ?? fromUnix(record.period_start),
    periodEnd: fromUnix(firstPeriod.end) ?? fromUnix(record.period_end),
    issuedAt: fromUnix(transitions.finalized_at) ?? fromUnix(record.created) ?? new Date(0),
    paidAt: fromUnix(transitions.paid_at),
    attemptCount: num(record.attempt_count) ?? 0,
    nextPaymentAttempt: fromUnix(record.next_payment_attempt),
    lastErrorCode: null,
    paymentMethodLast4: cardSummary(record.default_payment_method)?.last4 ?? null,
    creditAppliedCents,
    refundedCents: Math.max(0, num(record.post_payment_credit_notes_amount) ?? 0),
  };
}

/** The next bill and the credit that is still waiting as unused time, read from an invoice preview. */
interface UpcomingFacts {
  readonly upcoming: NonNullable<GatewaySubscription['upcoming']>;
  /** Credit from decreases that Stripe holds as pending lines until the next invoice. */
  readonly pendingCreditCents: number;
}

/**
 * Reads Stripe's preview of the next invoice. A decrease made with `create_prorations` does not move
 * the customer balance at once: the unused time waits as negative lines on the next invoice. So the
 * credit a person has is the customer balance plus those waiting lines, and the next charge is the
 * preview's `amount_due`.
 */
export function upcomingFromPreview(preview: unknown): UpcomingFacts {
  const record = loose(preview);
  const invoice = toInvoice(preview);
  const total = num(record.total) ?? 0;
  const amountDue = Math.max(0, num(record.amount_due) ?? total);
  const prorationNet = invoice.lines.filter((line) => line.proration).reduce((sum, line) => sum + line.amountCents, 0);
  const pendingCreditCents = Math.max(0, -prorationNet);
  // The bill without the waiting credit lines: the plan price, minus a promo code, plus tax.
  const regular = total + pendingCreditCents;
  return {
    upcoming: {
      amountDueCents: amountDue,
      discountCents: invoice.discountCents,
      discountLabel: invoice.discountCents > 0 ? 'Promo code' : null,
      creditAppliedCents: Math.min(Math.max(0, regular), Math.max(0, regular - amountDue)),
    },
    pendingCreditCents,
  };
}

function toSubscription(subscription: unknown, facts: UpcomingFacts | null = null): GatewaySubscription {
  const record = loose(subscription);
  const itemList = loose(record.items).data;
  const rawItems: unknown[] = Array.isArray(itemList) ? itemList : [];
  const items: GatewayItem[] = [];
  let interval: BillingInterval = 'monthly';
  let periodStart: number | null = num(record.current_period_start);
  let periodEnd: number | null = num(record.current_period_end);
  const topLevelPeriod = periodStart !== null && periodEnd !== null;

  for (const raw of rawItems) {
    const item = loose(raw);
    const price = loose(item.price);
    if (loose(price.recurring).interval === 'year') interval = 'yearly';
    if (!topLevelPeriod) {
      const start = num(item.current_period_start);
      const end = num(item.current_period_end);
      if (start !== null) periodStart = periodStart === null ? start : Math.min(periodStart, start);
      if (end !== null) periodEnd = periodEnd === null ? end : Math.max(periodEnd, end);
    }
    const key = priceKeyOf(price);
    const parsed = key ? parsePriceKey(key) : null;
    if (!key || !parsed) continue;
    items.push({
      id: str(item.id) ?? '',
      priceKey: key,
      priceId: str(price.id) ?? '',
      product: parsed.product,
      quantity: num(item.quantity) ?? 1,
      unitCents: num(price.unit_amount) ?? unitCents(parsed.product, parsed.interval, parsed.bundle),
    });
  }

  const customer = loose(record.customer);
  const customerDefault = loose(customer.invoice_settings).default_payment_method;
  // The card that will be charged: the subscription's own, else the customer's default.
  const paymentMethod = cardSummary(record.default_payment_method) ?? cardSummary(customerDefault);

  const pause = record.pause_collection ? loose(record.pause_collection) : null;
  // A pause with no end date (set by hand in the dashboard) still counts as paused.
  const pauseResumesAt = pause ? (fromUnix(pause.resumes_at) ?? new Date(Date.UTC(9999, 11, 31))) : null;

  const created = fromUnix(record.created) ?? new Date(0);
  return {
    id: str(record.id) ?? '',
    customerId: idOf(record.customer) ?? '',
    orgId: orgIdFrom(record.metadata),
    status: mapStatus(str(record.status) ?? ''),
    interval,
    items,
    currentPeriodStart: fromUnix(periodStart) ?? created,
    currentPeriodEnd: fromUnix(periodEnd) ?? created,
    trialEnd: fromUnix(record.trial_end),
    cancelAtPeriodEnd: record.cancel_at_period_end === true,
    cancelAt: fromUnix(record.cancel_at),
    canceledAt: fromUnix(record.canceled_at),
    endedAt: fromUnix(record.ended_at),
    pauseResumesAt,
    paymentMethod,
    latestInvoiceId: idOf(record.latest_invoice),
    // A negative Stripe customer balance is credit. Unused time that waits for the next invoice counts too.
    creditBalanceCents: Math.max(0, -(num(customer.balance) ?? 0)) + (facts?.pendingCreditCents ?? 0),
    upcoming: facts?.upcoming ?? null,
  };
}

function isMissing(error: unknown): boolean {
  const record = loose(error);
  return record.code === 'resource_missing' || record.statusCode === 404;
}

function asCardError(error: unknown): GatewayCardError | null {
  const record = loose(error);
  if (record.type === 'StripeCardError' || record.code === 'card_declined' || str(record.decline_code)) {
    return new GatewayCardError('The card was declined.', str(record.decline_code) ?? str(record.code));
  }
  return null;
}

function discountSentence(selection: PlanSelection): string {
  const bundle = isBundle(selection.products);
  const yearly = selection.interval === 'yearly';
  const base = 'Cancel any time in Billing. Your data stays yours.';
  if (bundle && yearly) return `These prices already include your yearly and bundle discounts. ${base}`;
  if (bundle) return `These prices already include your bundle discount. ${base}`;
  if (yearly) return `These prices already include your yearly discount. ${base}`;
  return base;
}

export function createStripeGateway(config: BillingConfig, deps?: { client?: Stripe; now?: () => Date }): BillingGateway {
  const now = deps?.now ?? (() => new Date());
  let client: Stripe | null = deps?.client ?? null;

  function stripe(): Stripe {
    if (client) return client;
    if (!config.stripeSecretKey) throw new Error('STRIPE_SECRET_KEY is not set.');
    client = new Stripe(config.stripeSecretKey, {
      maxNetworkRetries: 2,
      appInfo: { name: 'KitStak Portal' },
    });
    return client;
  }

  let prices: { at: number; byKey: Map<string, string> } | null = null;

  async function priceIds(): Promise<Map<string, string>> {
    if (prices && now().getTime() - prices.at < PRICE_CACHE_MS) return prices.byKey;
    const keys = allPriceKeys();
    const byKey = new Map<string, string>();
    for (let index = 0; index < keys.length; index += LOOKUP_CHUNK) {
      const page = await stripe().prices.list({
        lookup_keys: keys.slice(index, index + LOOKUP_CHUNK),
        active: true,
        limit: 100,
      });
      for (const price of page.data) {
        if (price.lookup_key) byKey.set(price.lookup_key, price.id);
      }
    }
    prices = { at: now().getTime(), byKey };
    return byKey;
  }

  async function priceIdFor(key: PriceKey): Promise<string> {
    let id = (await priceIds()).get(key);
    if (!id) {
      // The price may have been made since the cache was filled. Look once more.
      prices = null;
      id = (await priceIds()).get(key);
    }
    if (!id) {
      process.stderr.write(`[kitstak-billing] Stripe has no active price with lookup key ${key}. Run stripe:setup check.\n`);
      throw new Error(`Missing Stripe price: ${key}`);
    }
    return id;
  }

  async function retrieveSubscription(id: string): Promise<Stripe.Subscription | null> {
    try {
      return await stripe().subscriptions.retrieve(id, { expand: SUBSCRIPTION_EXPAND });
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /**
   * Keeps one card per plan. Checkout saves the card on the subscription. The Billing Portal's
   * "update payment method" flow saves the new card as the customer's default, and Stripe charges the
   * subscription's own card first. So when the two differ, the customer's default (the newer choice)
   * becomes the subscription's card. Without this, a renewal would still charge the old card.
   */
  async function adoptCustomerCard(subscription: Stripe.Subscription): Promise<Stripe.Subscription> {
    const record = loose(subscription);
    const status = str(record.status);
    if (status === 'canceled' || status === 'incomplete_expired') return subscription;
    const customerDefault = idOf(loose(loose(record.customer).invoice_settings).default_payment_method);
    if (!customerDefault || customerDefault === idOf(record.default_payment_method)) return subscription;
    try {
      return await stripe().subscriptions.update(subscription.id, {
        default_payment_method: customerDefault,
        expand: SUBSCRIPTION_EXPAND,
      });
    } catch {
      // The read still answers with what Stripe has. The next sync tries again.
      process.stderr.write(`[kitstak-billing] could not set the new card on subscription ${subscription.id}\n`);
      return subscription;
    }
  }

  /**
   * Asks Stripe what the next invoice will charge. null when no invoice is coming (the plan ended, is
   * set to end, or is paused) or when Stripe cannot say; screens then fall back to the plan price.
   */
  async function upcomingFor(subscription: Stripe.Subscription): Promise<UpcomingFacts | null> {
    const record = loose(subscription);
    const status = str(record.status);
    const billable = status === 'trialing' || status === 'active' || status === 'past_due';
    if (!billable || record.cancel_at_period_end === true || record.cancel_at || record.pause_collection) return null;
    const customerId = idOf(record.customer);
    if (!customerId) return null;
    try {
      const preview = await stripe().invoices.createPreview({ customer: customerId, subscription: subscription.id });
      // No amount, no answer. A missing number must never be shown as "$0.00".
      if (num(loose(preview).amount_due) === null && num(loose(preview).total) === null) return null;
      return upcomingFromPreview(preview);
    } catch (error) {
      process.stderr.write(
        `[kitstak-billing] could not preview the next invoice of ${subscription.id}: ${str(loose(error).code) ?? 'error'}\n`,
      );
      return null;
    }
  }

  /** The normalized subscription with its credit and its next bill. */
  async function full(subscription: Stripe.Subscription): Promise<GatewaySubscription> {
    return toSubscription(subscription, await upcomingFor(subscription));
  }

  /** The full item list for an update: swaps, quantity changes, new items and removed items. */
  async function itemParams(
    subscription: Stripe.Subscription,
    selection: PlanSelection,
  ): Promise<{ id?: string; price?: string; quantity?: number; deleted?: boolean }[]> {
    const bundle = isBundle(selection.products);
    const existing = new Map<ProductId, string>();
    const unknownItems: string[] = [];
    for (const item of subscription.items.data) {
      const key = priceKeyOf(item.price);
      const parsed = key ? parsePriceKey(key) : null;
      if (parsed) existing.set(parsed.product, item.id);
      else unknownItems.push(item.id);
    }
    const out: { id?: string; price?: string; quantity?: number; deleted?: boolean }[] = [];
    for (const product of selection.products) {
      const price = await priceIdFor(priceKey(product, selection.interval, bundle));
      const quantity = quantityFor(product, selection);
      const id = existing.get(product);
      out.push(id ? { id, price, quantity } : { price, quantity });
    }
    for (const [product, id] of existing) {
      if (!selection.products.includes(product)) out.push({ id, deleted: true });
    }
    // Items we do not know were not put there by KitStak. Leave them alone.
    void unknownItems;
    return out;
  }

  /**
   * The server prorates a credit from a date up to one day ahead (full days left only, see
   * `proration.ts`). If Stripe refuses a proration date in the future, the adapter uses a date in the
   * past that keeps the two rules that matter: it is the same for a preview and for the change that
   * follows it, and it never hands back more than a charge at the same moment would have billed. That
   * date is the start of the current hour, but never before the whole day date a charge would use.
   */
  let futureProrationRefused = false;

  function pastDateFor(date: Date): Date {
    const at = now().getTime();
    if (date.getTime() <= at) return date;
    const hour = Math.floor(at / HOUR_MS) * HOUR_MS;
    return new Date(Math.max(hour, date.getTime() - 24 * HOUR_MS));
  }

  function isProrationDateError(error: unknown): boolean {
    const record = loose(error);
    const param = str(record.param) ?? '';
    return param.includes('proration_date') || /proration[ _]date/i.test(str(record.message) ?? '');
  }

  async function withProrationDate<T>(date: Date, run: (used: Date) => Promise<T>): Promise<T> {
    const future = date.getTime() > now().getTime();
    if (!future) return run(date);
    if (futureProrationRefused) return run(pastDateFor(date));
    try {
      return await run(date);
    } catch (error) {
      if (!isProrationDateError(error)) throw error;
      futureProrationRefused = true;
      process.stderr.write('[kitstak-billing] Stripe refused a proration date in the future. Credits now count from the start of the hour.\n');
      return run(pastDateFor(date));
    }
  }

  async function preview(subscription: Stripe.Subscription, selection: PlanSelection, askedDate: Date): Promise<ChangePreview> {
    const current = toSubscription(subscription);
    const items = await itemParams(subscription, selection);
    let prorationDate = askedDate;
    const upcoming = await withProrationDate(askedDate, (used) => {
      prorationDate = used;
      return stripe().invoices.createPreview({
        customer: current.customerId,
        subscription: subscription.id,
        subscription_details: {
          items,
          proration_date: unix(used),
          proration_behavior: 'always_invoice',
        },
      });
    });
    const invoice = toInvoice(upcoming);
    const total = invoice.totalCents;
    const dueToday = total > 0 ? Math.max(0, num(loose(upcoming).amount_due) ?? total) : 0;
    const oldRecurring = current.items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0);
    const newRecurring = quote(selection).totalCents;
    const intervalChanged = selection.interval !== current.interval;
    const trialing = current.status === 'trialing' && current.trialEnd !== null;
    return {
      dueTodayCents: dueToday,
      creditCents: total < 0 ? -total : 0,
      newRecurringCents: newRecurring,
      recurringDeltaCents: newRecurring - oldRecurring,
      nextChargeAt: trialing && current.trialEnd
        ? current.trialEnd
        : intervalChanged
          ? // A new period starts at the moment of the change, whatever date the unused time is counted from.
            addInterval(now(), selection.interval)
          : current.currentPeriodEnd,
      prorationDate,
      lines: invoice.lines,
      taxCents: invoice.taxCents,
      proratedCents: total > 0 ? total : 0,
      creditAppliedCents: total > 0 ? total - dueToday : 0,
    };
  }

  const gateway: BillingGateway = {
    kind: 'stripe',

    async ensureCustomer({ orgId, existingCustomerId, profile }) {
      if (existingCustomerId) {
        try {
          const existing = await stripe().customers.retrieve(existingCustomerId);
          if (!loose(existing).deleted && orgIdFrom(loose(existing).metadata) === orgId) {
            await gateway.updateCustomer(existingCustomerId, profile);
            return { customerId: existingCustomerId };
          }
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
      const address = toStripeAddress(profile.address);
      const created = await stripe().customers.create({
        name: profile.name,
        email: profile.email,
        ...(address ? { address } : {}),
        metadata: { kitstak_org_id: orgId },
      });
      if (profile.taxId) {
        try {
          await stripe().customers.createTaxId(created.id, {
            type: profile.taxId.type as Stripe.CustomerCreateTaxIdParams['type'],
            value: profile.taxId.value,
          });
        } catch {
          // A tax ID Stripe cannot read must not block checkout. The pay page collects it again.
        }
      }
      return { customerId: created.id };
    },

    async updateCustomer(customerId, profile) {
      const address = toStripeAddress(profile.address);
      await stripe().customers.update(customerId, {
        // An empty email or name means "leave it as it is".
        ...(profile.name ? { name: profile.name } : {}),
        ...(profile.email ? { email: profile.email } : {}),
        ...(address ? { address } : {}),
      });
      const existing = await stripe().customers.listTaxIds(customerId, { limit: 20 });
      const wanted = profile.taxId;
      const same = wanted
        ? existing.data.some((taxId) => taxId.type === wanted.type && taxId.value === wanted.value)
        : existing.data.length === 0;
      if (same) return;
      if (wanted) {
        // Create first: if Stripe refuses the new one, the old one is still there.
        await stripe().customers.createTaxId(customerId, {
          type: wanted.type as Stripe.CustomerCreateTaxIdParams['type'],
          value: wanted.value,
        });
      }
      for (const taxId of existing.data) await stripe().customers.deleteTaxId(customerId, taxId.id);
    },

    async createCheckoutSession({ orgId, customerId, selection: rawSelection, trialEnd, successUrl, cancelUrl }) {
      const selection = normalizeSelection(rawSelection);
      const bundle = isBundle(selection.products);
      const lineItems: { price: string; quantity: number }[] = [];
      for (const product of selection.products) {
        lineItems.push({
          price: await priceIdFor(priceKey(product, selection.interval, bundle)),
          quantity: quantityFor(product, selection),
        });
      }
      const passTrial = trialEnd !== null && trialEnd.getTime() - now().getTime() >= MIN_TRIAL_AHEAD_MS;
      const session = await stripe().checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: orgId,
        line_items: lineItems,
        subscription_data: {
          ...(passTrial && trialEnd ? { trial_end: unix(trialEnd) } : {}),
          metadata: { kitstak_org_id: orgId },
        },
        allow_promotion_codes: true,
        payment_method_collection: 'always',
        billing_address_collection: 'auto',
        automatic_tax: { enabled: config.automaticTax },
        tax_id_collection: { enabled: true },
        customer_update: { name: 'auto', address: 'auto' },
        custom_text: { submit: { message: discountSentence(selection) } },
        metadata: { kitstak_org_id: orgId },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) throw new Error('Stripe returned a checkout session with no URL.');
      return { id: session.id, url: session.url };
    },

    async getCheckoutSession(id): Promise<GatewayCheckoutSession | null> {
      try {
        const session = await stripe().checkout.sessions.retrieve(id);
        const record = loose(session);
        const reference = str(record.client_reference_id);
        const status = str(record.status);
        return {
          id: session.id,
          orgId: orgIdFrom(record.metadata) ?? (reference && UUID_RE.test(reference) ? reference : null),
          status: status === 'complete' || status === 'expired' ? status : 'open',
          customerId: idOf(record.customer),
          subscriptionId: idOf(record.subscription),
          url: str(record.url),
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async expireOpenCheckoutSessions(customerId) {
      const open = await stripe().checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 });
      let closed = 0;
      for (const session of open.data) {
        try {
          await stripe().checkout.sessions.expire(session.id);
          closed += 1;
        } catch {
          // It was paid or it closed a moment ago. The second subscription guard in sync handles a paid one.
        }
      }
      return closed;
    },

    async cancelAndRefund(subscriptionId) {
      const subscription = await retrieveSubscription(subscriptionId);
      if (!subscription) return { refundedCents: 0 };
      const record = loose(subscription);
      const invoiceId = idOf(record.latest_invoice);
      const status = str(record.status);
      if (status !== 'canceled' && status !== 'incomplete_expired') {
        // No final invoice and no proration: the whole payment goes back below.
        await stripe().subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
      }
      if (!invoiceId) return { refundedCents: 0 };
      const invoice = loose(await stripe().invoices.retrieve(invoiceId));
      if (invoice.status === 'open') {
        await stripe().invoices.voidInvoice(invoiceId);
        return { refundedCents: 0 };
      }
      const paid = (num(invoice.amount_paid) ?? 0) - (num(invoice.post_payment_credit_notes_amount) ?? 0);
      if (invoice.status !== 'paid' || paid <= 0) return { refundedCents: 0 };
      // A credit note with a refund sends the money back to the card and shows on the invoice.
      await stripe().creditNotes.create({ invoice: invoiceId, amount: paid, refund_amount: paid, reason: 'duplicate' });
      return { refundedCents: paid };
    },

    async cancelNow(subscriptionId) {
      const subscription = await retrieveSubscription(subscriptionId);
      if (!subscription) throw new Error('Stripe subscription not found.');
      const status = str(loose(subscription).status);
      if (status !== 'canceled' && status !== 'incomplete_expired') {
        // No final invoice and no proration. Stripe stops collecting the open invoices of a canceled
        // subscription by itself; voiding them below makes that final and shows it on the invoice.
        await stripe().subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
      }
      // Every open invoice of this subscription is dropped, not only the latest one, so no older
      // bill can be collected after the customer was told "we will not charge it".
      let voidedCents = 0;
      const open = await stripe().invoices.list({ subscription: subscriptionId, status: 'open', limit: 20 });
      for (const invoice of open.data) {
        if (!invoice.id) continue;
        voidedCents += Math.max(0, num(loose(invoice).amount_remaining) ?? num(loose(invoice).amount_due) ?? 0);
        await stripe().invoices.voidInvoice(invoice.id);
      }
      const ended = await retrieveSubscription(subscriptionId);
      if (!ended) throw new Error('Stripe subscription not found.');
      return { subscription: await full(ended), voidedCents };
    },

    async createPaymentUpdateSession({ customerId, returnUrl }) {
      const session = await stripe().billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
        ...(config.stripePortalConfigurationId ? { configuration: config.stripePortalConfigurationId } : {}),
        flow_data: {
          type: 'payment_method_update',
          after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
        },
      });
      return { url: session.url };
    },

    async getSubscription(id) {
      const subscription = await retrieveSubscription(id);
      return subscription ? full(await adoptCustomerCard(subscription)) : null;
    },

    async findSubscriptionForCustomer(customerId) {
      const page = await stripe().subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20,
        expand: ['data.default_payment_method'],
      });
      // Only subscriptions KitStak made carry the org id. Anything else on the customer is not ours.
      const ours = page.data.map((entry) => toSubscription(entry)).filter((subscription) => subscription.orgId !== null);
      return ours.find((subscription) => subscription.status !== 'canceled') ?? ours[0] ?? null;
    },

    async previewChange({ subscriptionId, selection, prorationDate }) {
      const subscription = await retrieveSubscription(subscriptionId);
      if (!subscription) throw new Error('Stripe subscription not found.');
      return preview(subscription, normalizeSelection(selection), prorationDate);
    },

    async applyChange({ subscriptionId, selection: rawSelection, prorationDate }) {
      const selection = normalizeSelection(rawSelection);
      const subscription = await retrieveSubscription(subscriptionId);
      if (!subscription) throw new Error('Stripe subscription not found.');
      const before = toSubscription(subscription);
      const planned = await preview(subscription, selection, prorationDate);
      const items = await itemParams(subscription, selection);
      // A change of billing period always makes an invoice now, so it must be paid or not happen.
      const invoiceNow = planned.dueTodayCents > 0 || selection.interval !== before.interval;
      let updated: Stripe.Subscription;
      try {
        updated = await stripe().subscriptions.update(subscriptionId, {
          items,
          // The date the preview above really used, so the invoice equals the preview to the cent.
          proration_date: unix(planned.prorationDate),
          proration_behavior: invoiceNow ? 'always_invoice' : 'create_prorations',
          // With this, a declined card changes nothing: the update waits and is then dropped.
          ...(invoiceNow ? { payment_behavior: 'pending_if_incomplete' as const } : {}),
          expand: SUBSCRIPTION_EXPAND,
        });
      } catch (error) {
        const cardError = asCardError(error);
        if (cardError) throw cardError;
        throw error;
      }
      if (loose(updated).pending_update) {
        // The payment did not go through. Void the invoice so the waiting update is dropped now.
        const invoiceId = idOf(loose(updated).latest_invoice);
        if (invoiceId) {
          try {
            await stripe().invoices.voidInvoice(invoiceId);
          } catch {
            // Stripe drops the waiting update by itself within a day.
          }
        }
        throw new GatewayCardError('The card was declined.', null);
      }
      return full(updated);
    },

    async setCancelAtPeriodEnd(subscriptionId, cancel) {
      const updated = await stripe().subscriptions.update(subscriptionId, {
        cancel_at_period_end: cancel,
        expand: SUBSCRIPTION_EXPAND,
      });
      return full(updated);
    },

    async pause(subscriptionId, resumesAt) {
      const updated = await stripe().subscriptions.update(subscriptionId, {
        pause_collection: { behavior: 'void', resumes_at: unix(resumesAt) },
        expand: SUBSCRIPTION_EXPAND,
      });
      return full(updated);
    },

    async resume(subscriptionId, options) {
      const updated = await stripe().subscriptions.update(subscriptionId, {
        pause_collection: '',
        // The paid time ran out during the pause: start a new period today and bill it today.
        ...(options?.billNow ? { billing_cycle_anchor: { type: 'now' as const }, proration_behavior: 'none' as const } : {}),
        expand: SUBSCRIPTION_EXPAND,
      });
      return full(updated);
    },

    async payLatestInvoice(subscriptionId) {
      const subscription = await retrieveSubscription(subscriptionId);
      if (!subscription) throw new Error('Stripe subscription not found.');
      const invoiceId = idOf(loose(subscription).latest_invoice);
      if (!invoiceId) throw new Error('There is no invoice to pay.');
      const invoice = await stripe().invoices.retrieve(invoiceId);
      if (invoice.status !== 'open') return toInvoice(invoice);

      // A card saved through the Billing Portal becomes the customer's default. Pay with that one,
      // and make it the subscription's card so renewals use it too.
      const customerDefault = idOf(loose(loose(loose(subscription).customer).invoice_settings).default_payment_method);
      const subscriptionDefault = idOf(loose(subscription).default_payment_method);
      try {
        const paid = await stripe().invoices.pay(invoiceId, customerDefault ? { payment_method: customerDefault } : {});
        if (customerDefault && customerDefault !== subscriptionDefault) {
          await stripe().subscriptions.update(subscriptionId, { default_payment_method: customerDefault });
        }
        return toInvoice(paid);
      } catch (error) {
        const cardError = asCardError(error);
        if (cardError) throw cardError;
        throw error;
      }
    },

    async getInvoice(id) {
      try {
        return toInvoice(await stripe().invoices.retrieve(id));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async listInvoices(customerId, limit) {
      const page = await stripe().invoices.list({ customer: customerId, limit: Math.min(Math.max(1, limit), 100) });
      return page.data.map(toInvoice);
    },

    async getInvoicePdf(id) {
      const invoice = await stripe().invoices.retrieve(id);
      const url = str(loose(invoice).invoice_pdf);
      if (!url) throw new Error('Stripe has no PDF for this invoice yet.');
      return { kind: 'redirect', url };
    },

    verifyWebhook(rawBody, signatureHeader): GatewayEvent {
      if (!config.stripeWebhookSecret) throw new WebhookSignatureError('STRIPE_WEBHOOK_SECRET is not set');
      if (!signatureHeader) throw new WebhookSignatureError('Missing signature');
      let event: Stripe.Event;
      try {
        event = stripe().webhooks.constructEvent(rawBody, signatureHeader, config.stripeWebhookSecret);
      } catch {
        throw new WebhookSignatureError('Signature does not match');
      }
      const object = loose(loose(loose(event).data).object);
      const kind = str(object.object);
      const subscriptionDetails = loose(loose(object.parent).subscription_details);
      const reference = str(object.client_reference_id);
      const orgId =
        orgIdFrom(object.metadata) ??
        orgIdFrom(subscriptionDetails.metadata) ??
        (kind === 'checkout.session' && reference && UUID_RE.test(reference) ? reference : null);
      return {
        id: event.id,
        type: event.type,
        createdAt: fromUnix(loose(event).created) ?? now(),
        orgId,
        customerId: kind === 'customer' ? str(object.id) : idOf(object.customer),
        subscriptionId:
          kind === 'subscription' ? str(object.id) : (idOf(subscriptionDetails.subscription) ?? idOf(object.subscription)),
        invoiceId: kind === 'invoice' ? str(object.id) : null,
        checkoutSessionId: kind === 'checkout.session' ? str(object.id) : null,
        payload: event as unknown as Record<string, unknown>,
      };
    },
  };

  return gateway;
}
