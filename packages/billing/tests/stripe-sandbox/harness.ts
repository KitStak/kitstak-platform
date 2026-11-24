/**
 * Support for the real Stripe sandbox suite (docs/billing/STRIPE-SANDBOX-RUN.md). OPT IN: every
 * file here is skipped unless STRIPE_SANDBOX=1 and a Stripe TEST key are in the environment. Run it
 * with `deploy/dev/stripe-sandbox-test.sh`.
 *
 * What is real: the Stripe API (test mode), the Stripe gateway adapter, the server functions, the
 * webhook handler and the local dev Postgres. What is replaced, and why:
 *
 *  - Stripe cannot deliver webhooks to this machine. The events are read from `GET /v1/events` and
 *    handed to `processWebhook` with a valid signature made from a signing secret that only exists
 *    here. That is the same door the Portal route uses, on the real event bodies.
 *  - The hosted pay page (checkout.stripe.com) cannot be opened from a test. The app still makes the
 *    real Checkout Session. The step a person does on the page (type a card, press Pay) is done
 *    through the API: a subscription with the same customer, prices, quantities, trial end and
 *    metadata the session holds, paid with a Stripe test card.
 *  - Time moves with Stripe test clocks. The runtime's clock is the test clock's time.
 *
 * Safety: a live key is refused before any request, and the suite stops if the account answers in
 * live mode. Nothing here creates, changes or disables a webhook endpoint.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestKey, listNewEvents, signStripePayload, type StripeEventBody, stripeReader } from '../../scripts/stripe-events-lib';
import type { PlanSelection } from '../../src/catalog';
import { createStripeGateway } from '../../src/gateway/stripe';
import type { BillingActor, BillingRuntime } from '../../src/server/db';
import { createBillingRuntime } from '../../src/server/runtime';
import { processWebhook, type WebhookOutcome } from '../../src/server/webhook';
import { createTestOrg, openTestDb, removeTestOrg, type TestDb, type TestOrg, TEST_PORTAL_URL } from '../../src/testing/db';

const KEY = (process.env.STRIPE_SECRET_KEY ?? '').trim();
/** True only when the suite was asked for and a TEST key is present. */
export const SANDBOX_ENABLED = process.env.STRIPE_SANDBOX === '1' && /^(sk|rk)_test_/.test(KEY);

const STRIPE_API = 'https://api.stripe.com';
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = process.env.STRIPE_SANDBOX_EVIDENCE_DIR ?? resolve(HERE, '../../../../deploy/dev/.run/stripe-sandbox');
/**
 * Some Stripe keys need a person to approve `DELETE /v1/subscriptions/:id` in the Stripe dashboard
 * before it runs (Stripe answers "This action requires human approval"). With such a key, set
 * STRIPE_SANDBOX_CANCEL_NEEDS_APPROVAL=1: the two flows that end a subscription at once then check
 * that the refusal changes nothing, instead of checking the cancel itself.
 */
export const CANCEL_NEEDS_APPROVAL = process.env.STRIPE_SANDBOX_CANCEL_NEEDS_APPROVAL === '1';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

export class StripeApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly declineCode: string | null;
  readonly body: Record<string, unknown>;
  constructor(message: string, status: number, error: Record<string, unknown>) {
    super(message);
    this.name = 'StripeApiError';
    this.status = status;
    this.code = typeof error.code === 'string' ? error.code : null;
    this.declineCode = typeof error.decline_code === 'string' ? error.decline_code : null;
    this.body = error;
  }
}

type Params = { [key: string]: Value };
type Value = string | number | boolean | null | undefined | Params | Value[];

function encode(params: Params, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const key = prefix ? `${prefix}[${name}]` : name;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (entry !== null && typeof entry === 'object') parts.push(...encode(entry as Params, `${key}[${String(index)}]`));
        else if (entry !== undefined && entry !== null) parts.push(`${encodeURIComponent(`${key}[${String(index)}]`)}=${encodeURIComponent(String(entry))}`);
      });
    } else if (typeof value === 'object') {
      parts.push(...encode(value, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One raw call to the Stripe API. Used for the steps the app does not do itself (test cards, clocks). */
export async function stripeApi(method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {}): Promise<Json> {
  const key = assertTestKey(KEY);
  const body = encode(params).join('&');
  const url = `${STRIPE_API}${path}${method === 'GET' && body ? `?${body}` : ''}`;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${key}`, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        ...(method === 'POST' ? { body } : {}),
      });
      const json = (await response.json()) as Json;
      if (response.status >= 400 || json.error) {
        const error = (json.error ?? {}) as Record<string, unknown>;
        // A lock on the customer or the clock: Stripe asks to try again.
        if ((response.status === 429 || error.code === 'lock_timeout') && attempt < 2) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw new StripeApiError(typeof error.message === 'string' ? error.message : `Stripe answered ${String(response.status)}`, response.status, error);
      }
      return json;
    } catch (error) {
      if (error instanceof StripeApiError) throw error;
      last = error;
      await sleep(1000);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

let accountChecked = false;
/** Stops the suite unless the key answers in test mode (and for the expected account, when one is named). */
export async function assertSandboxAccount(): Promise<string> {
  const balance = await stripeApi('GET', '/v1/balance');
  if (balance.livemode !== false) throw new Error('Refused: this Stripe key answers in LIVE mode. The sandbox suite never runs there.');
  const account = await stripeApi('GET', '/v1/account');
  const expected = (process.env.STRIPE_SANDBOX_ACCOUNT ?? '').trim();
  if (expected && account.id !== expected) {
    throw new Error(`Refused: the key belongs to ${String(account.id)}, not to the sandbox account ${expected}.`);
  }
  accountChecked = true;
  return String(account.id);
}

export interface Delivered {
  readonly id: string;
  readonly type: string;
  readonly outcome: WebhookOutcome;
}

/**
 * One organization, one Stripe customer on its own test clock, and a runtime whose gateway is the
 * real Stripe adapter. A test file makes one or more of these and removes them when it is done.
 */
export class Sandbox {
  readonly org: TestOrg;
  readonly rt: BillingRuntime;
  readonly actor: BillingActor;
  readonly webhookSecret: string;
  customerId = '';
  clockId = '';
  /** Every Stripe object id this sandbox made, for the run report. */
  readonly evidence: Record<string, unknown> = {};
  private clockTime: Date;
  private readonly startedAt: number;
  private readonly seen = new Set<string>();
  private readonly test: TestDb;
  /** The Stripe side of a past event read, kept so the next read starts after it. */
  private lastEventId: string | null = null;

  private constructor(test: TestDb, org: TestOrg, label: string) {
    this.test = test;
    this.org = org;
    this.actor = { userId: org.owner.id, label: org.owner.name };
    this.webhookSecret = `whsec_sandbox_${randomBytes(24).toString('hex')}`;
    this.clockTime = new Date(Math.floor(Date.now() / 1000) * 1000);
    this.startedAt = Math.floor(Date.now() / 1000) - 5;
    const now = (): Date => new Date(this.clockTime.getTime());
    this.rt = createBillingRuntime({
      db: test.db,
      env: {
        NODE_ENV: 'test',
        BETTER_AUTH_SECRET: 'sandbox-only-secret-sandbox-only-secret-sandbox',
        STRIPE_SECRET_KEY: KEY,
        STRIPE_WEBHOOK_SECRET: this.webhookSecret,
        STRIPE_PORTAL_CONFIGURATION_ID: process.env.STRIPE_PORTAL_CONFIGURATION_ID,
      } as NodeJS.ProcessEnv,
      portalUrl: TEST_PORTAL_URL,
      now,
      // The adapter gets the same clock, so "is this trial end 48 hours ahead" is asked in clock time.
      stripe: (config) => createStripeGateway(config, { now }),
    });
    this.evidence.label = label;
    this.evidence.orgId = org.orgId;
  }

  /** A new organization with an owner. `extraRoles` adds more people (each one uses a seat). */
  static async create(test: TestDb, label: string, extraRoles: readonly string[] = []): Promise<Sandbox> {
    if (!accountChecked) await assertSandboxAccount();
    const org = await createTestOrg(test.pool, extraRoles);
    return new Sandbox(test, org, label);
  }

  now(): Date {
    return new Date(this.clockTime.getTime());
  }

  get pool() {
    return this.test.pool;
  }

  /**
   * Makes the Stripe customer on a new test clock and stores it the way checkout stores it. The app's
   * own `ensureCustomer` then finds it (same organization in the metadata) and keeps it.
   */
  async createCustomerOnClock(): Promise<string> {
    const clock = await stripeApi('POST', '/v1/test_helpers/test_clocks', {
      frozen_time: Math.floor(this.clockTime.getTime() / 1000),
      name: `kitstak sandbox ${String(this.evidence.label)}`.slice(0, 100),
    });
    this.clockId = String(clock.id);
    this.clockTime = new Date(Number(clock.frozen_time) * 1000);
    const customer = await stripeApi('POST', '/v1/customers', {
      name: this.org.name,
      email: this.org.owner.email,
      test_clock: this.clockId,
      address: { line1: '1 Test Street', city: 'Chicago', state: 'IL', postal_code: '60601', country: 'US' },
      metadata: { kitstak_org_id: this.org.orgId, kitstak_sandbox: '1' },
    });
    this.customerId = String(customer.id);
    await this.test.pool.query(
      `insert into core.stripe_customers (org_id, stripe_customer_id) values ($1, $2)
         on conflict (org_id) do update set stripe_customer_id = excluded.stripe_customer_id`,
      [this.org.orgId, this.customerId],
    );
    await this.test.pool.query(
      `insert into core.billing_accounts (org_id, gateway) values ($1, 'stripe')
         on conflict (org_id) do update set gateway = 'stripe'`,
      [this.org.orgId],
    );
    this.evidence.customerId = this.customerId;
    this.evidence.testClockId = this.clockId;
    return this.customerId;
  }

  /** Attaches a Stripe test card to the customer and returns the new payment method id. */
  async attachCard(testCard: string): Promise<string> {
    const method = await stripeApi('POST', `/v1/payment_methods/${testCard}/attach`, { customer: this.customerId });
    return String(method.id);
  }

  /**
   * The step a person does on the hosted pay page, through the API: a subscription on the session's
   * customer with the session's prices, quantities and metadata. `card` is a Stripe test card id.
   * With `payment_behavior: default_incomplete` the first invoice waits for `payFirstInvoice`.
   */
  async subscribeLikeCheckout(input: { sessionId: string; trialEnd: Date | null; card?: string; incomplete?: boolean }): Promise<Json> {
    const lines = await stripeApi('GET', `/v1/checkout/sessions/${input.sessionId}/line_items`, { limit: 20 });
    const items = (lines.data as Json[]).map((line) => ({ price: String(line.price.id), quantity: Number(line.quantity) }));
    const session = await stripeApi('GET', `/v1/checkout/sessions/${input.sessionId}`);
    const method = input.card ? await this.attachCard(input.card) : null;
    const subscription = await stripeApi('POST', '/v1/subscriptions', {
      customer: this.customerId,
      items,
      metadata: { kitstak_org_id: String(session.metadata.kitstak_org_id) },
      ...(input.trialEnd ? { trial_end: Math.floor(input.trialEnd.getTime() / 1000) } : {}),
      ...(method ? { default_payment_method: method } : {}),
      // Checkout saves the card on the subscription. So does this.
      payment_settings: { save_default_payment_method: 'on_subscription' },
      ...(input.incomplete ? { payment_behavior: 'default_incomplete' } : {}),
    });
    return subscription;
  }

  /** The payment intent of an invoice (newer API versions list it under the invoice's payments). */
  async paymentIntentOf(invoiceId: string): Promise<string> {
    const payments = await stripeApi('GET', '/v1/invoice_payments', { invoice: invoiceId, limit: 5 });
    const first = (payments.data as Json[])[0];
    const intent = first?.payment?.payment_intent;
    if (typeof intent !== 'string') throw new Error(`Invoice ${invoiceId} has no payment intent.`);
    return intent;
  }

  /** Moves the test clock and waits until Stripe has finished everything that was due. */
  async advanceTo(target: Date): Promise<void> {
    const seconds = Math.floor(target.getTime() / 1000);
    await stripeApi('POST', `/v1/test_helpers/test_clocks/${this.clockId}/advance`, { frozen_time: seconds });
    for (let waited = 0; waited < 180; waited += 1) {
      await sleep(2000);
      const clock = await stripeApi('GET', `/v1/test_helpers/test_clocks/${this.clockId}`);
      if (clock.status === 'ready') {
        this.clockTime = new Date(Number(clock.frozen_time) * 1000);
        return;
      }
      if (clock.status === 'internal_failure') throw new Error('Stripe could not advance the test clock.');
    }
    throw new Error('The test clock did not finish advancing in 6 minutes.');
  }

  advanceBy(ms: number): Promise<void> {
    return this.advanceTo(new Date(this.clockTime.getTime() + ms));
  }

  /** New Stripe events about this customer, oldest first. Events already returned are left out. */
  async pullEvents(): Promise<StripeEventBody[]> {
    const get = stripeReader(KEY);
    const mine: StripeEventBody[] = [];
    // Stripe writes events a moment after the call that caused them returns. Read until two reads
    // in a row bring nothing new, so a slow event is not left for the next step of a test.
    let quiet = 0;
    for (let round = 0; round < 12 && quiet < 2; round += 1) {
      await sleep(round === 0 ? 2500 : 1500);
      const all = await listNewEvents(get, { afterId: this.lastEventId, sinceSeconds: this.startedAt });
      if (all.length > 0) this.lastEventId = all[all.length - 1]!.id;
      let found = 0;
      for (const event of all) {
        if (this.seen.has(event.id)) continue;
        const object = ((event.data as Json | undefined)?.object ?? {}) as Json;
        const customer = typeof object.customer === 'string' ? object.customer : (object.customer as Json | null)?.id;
        if (object.id !== this.customerId && customer !== this.customerId) continue;
        this.seen.add(event.id);
        mine.push(event);
        found += 1;
      }
      quiet = found === 0 ? quiet + 1 : 0;
    }
    return mine;
  }

  /** Hands one event to the webhook handler, signed the way Stripe signs it. */
  async deliverOne(event: StripeEventBody): Promise<Delivered> {
    const rawBody = JSON.stringify(event);
    const signature = signStripePayload(rawBody, this.webhookSecret, Math.floor(Date.now() / 1000));
    const outcome = await processWebhook(this.rt, { rawBody, signature });
    return { id: event.id, type: event.type, outcome };
  }

  async deliver(events: readonly StripeEventBody[]): Promise<Delivered[]> {
    const out: Delivered[] = [];
    for (const event of events) out.push(await this.deliverOne(event));
    return out;
  }

  /** Reads every new event of this customer and delivers them in the order Stripe made them. */
  async sync(): Promise<Delivered[]> {
    return this.deliver(await this.pullEvents());
  }

  /**
   * Like `sync`, and keeps reading until an event of the given type has been delivered. Stripe makes
   * some events (a failed payment of an invoice, for one) a while after the others of the same step.
   */
  async syncUntil(type: string, timeoutMs = 90_000): Promise<Delivered[]> {
    const out: Delivered[] = [];
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      out.push(...(await this.sync()));
      if (out.some((event) => event.type === type)) return out;
      if (Date.now() > deadline) throw new Error(`Stripe made no ${type} event for ${this.customerId} in ${String(timeoutMs / 1000)} seconds.`);
    }
  }

  async rows<T = Json>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return (await this.test.pool.query(sql, params as unknown[])).rows as T[];
  }

  subscriptionRow(): Promise<Json | undefined> {
    return this.rows(`select * from core.billing_subscriptions where org_id = $1`, [this.org.orgId]).then((rows) => rows[0]);
  }

  entitlements(): Promise<Json[]> {
    return this.rows(
      `select module, status, source, seats, stripe_subscription_id, stripe_price_id, current_period_end
         from core.entitlements where org_id = $1 order by module`,
      [this.org.orgId],
    );
  }

  invoices(): Promise<Json[]> {
    return this.rows(`select * from core.billing_invoices where org_id = $1 order by issued_at, id`, [this.org.orgId]);
  }

  emails(): Promise<Json[]> {
    return this.rows(`select template, to_email, dedupe_key, payload from core.billing_emails where org_id = $1 order by created_at, id`, [this.org.orgId]);
  }

  async emailTemplates(): Promise<string[]> {
    return (await this.emails()).map((email) => String(email.template));
  }

  audit(): Promise<Json[]> {
    return this.rows(`select action, summary, data, event_id from core.billing_audit_log where org_id = $1 order by created_at, id`, [this.org.orgId]);
  }

  async auditActions(): Promise<string[]> {
    return (await this.audit()).map((row) => String(row.action));
  }

  ledger(): Promise<Json[]> {
    return this.rows(`select id, type, status, attempts, error from core.billing_events where org_id = $1 order by received_at, id`, [this.org.orgId]);
  }

  note(key: string, value: unknown): void {
    this.evidence[key] = value;
  }

  /** Removes the local rows. Stripe objects stay unless STRIPE_SANDBOX_CLEANUP=1 (then the clock and its customer go). */
  async dispose(): Promise<void> {
    try {
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      const file = resolve(EVIDENCE_DIR, `${String(this.evidence.label).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`);
      writeFileSync(file, `${JSON.stringify(this.evidence, null, 2)}\n`);
    } catch {
      // The evidence file is a convenience. A read only folder must not fail the suite.
    }
    await removeTestOrg(this.test.pool, this.org);
    if (process.env.STRIPE_SANDBOX_CLEANUP === '1' && this.clockId) {
      await stripeApi('DELETE', `/v1/test_helpers/test_clocks/${this.clockId}`).catch(() => undefined);
    }
  }
}

/** Opens the checkout through the app and returns the real session. Throws with the app's message when it fails. */
export async function openCheckout(box: Sandbox, selection: PlanSelection) {
  const { createCheckout } = await import('../../src/server/checkout');
  const result = await createCheckout(box.rt, {
    orgId: box.org.orgId,
    orgName: box.org.name,
    selection,
    actor: box.actor,
    actorEmail: box.org.owner.email,
  });
  if (!result.ok) throw new Error(`createCheckout failed: ${result.error.code} ${result.error.message}`);
  return result.data;
}

/** The whole first purchase: the app's checkout session, then the pay step through the API, then the events. */
export async function buyPlan(
  box: Sandbox,
  selection: PlanSelection,
  options: { card?: string } = {},
): Promise<{ sessionId: string; subscription: Json; delivered: Delivered[] }> {
  if (!box.customerId) await box.createCustomerOnClock();
  const checkout = await openCheckout(box, selection);
  const subscription = await box.subscribeLikeCheckout({
    sessionId: checkout.sessionId,
    trialEnd: checkout.dueTodayCents === 0 ? checkout.firstChargeAt : null,
    card: options.card ?? 'pm_card_visa',
  });
  // The pay page is not used, so the session is closed. Stripe sends `checkout.session.expired`.
  await stripeApi('POST', `/v1/checkout/sessions/${checkout.sessionId}/expire`).catch(() => undefined);
  const delivered = await box.sync();
  return { sessionId: checkout.sessionId, subscription, delivered };
}

export { openTestDb };
export type { Json };

/** A plan change the way the confirm panel does it: preview, confirm with the preview's basis and amount, then the events. */
export async function changePlan(box: Sandbox, selection: PlanSelection) {
  const { applyPlanChange, previewPlanChange } = await import('../../src/server/changes');
  const preview = await previewPlanChange(box.rt, { orgId: box.org.orgId, selection });
  if (!preview.ok) throw new Error(`previewPlanChange failed: ${preview.error.code} ${preview.error.message}`);
  const applied = await applyPlanChange(box.rt, {
    orgId: box.org.orgId,
    selection,
    basis: preview.data.basis,
    expectedDueTodayCents: preview.data.dueTodayCents,
    actor: box.actor,
  });
  if (!applied.ok) throw new Error(`applyPlanChange failed: ${applied.error.code} ${applied.error.message}`);
  const delivered = await box.sync();
  return { preview: preview.data, state: applied.data, delivered };
}

/** The events that did not answer 200. Empty when every event was handled. */
export function failures(delivered: readonly Delivered[]): Delivered[] {
  return delivered.filter((event) => event.outcome.status !== 200);
}

/** The Stripe subscription with its items, as Stripe has it now. */
export async function stripeSubscription(id: string): Promise<Json> {
  return stripeApi('GET', `/v1/subscriptions/${id}`);
}

/** `kitstak_crm_monthly:5`, one per item, sorted. */
export function itemKeys(subscription: Json): string[] {
  return (subscription.items.data as Json[]).map((item) => `${String(item.price.lookup_key)}:${String(item.quantity)}`).sort();
}
