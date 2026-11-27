/**
 * Real Stripe sandbox, flow 3: changes to a paid plan. Seats and warehouses up and down with
 * proration, the bundle discount going on and off, and monthly to yearly. After every change the
 * Stripe objects, the plan row, the entitlement rows, the invoices and the emails are checked.
 * Skipped unless STRIPE_SANDBOX=1 (see ./harness.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CATALOG } from '../../src/catalog';
import { getInvoicePdf, listInvoices } from '../../src/server/invoices';
import { buyPlan, changePlan, DAY_MS, failures, itemKeys, type Json, openTestDb, Sandbox, SANDBOX_ENABLED, stripeApi, stripeSubscription } from './harness';

const test = SANDBOX_ENABLED ? await openTestDb() : null;
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

const CRM = CATALOG.products.crm.cents;
const WMS = CATALOG.products.wms.cents;

describe.skipIf(!SANDBOX_ENABLED || !test?.available)('Stripe sandbox: plan changes with proration', () => {
  let box: Sandbox;
  let subscriptionId = '';
  /** Whole days of the 30 day period that are left after the clock moved 10 days. */
  let daysLeft = 0;
  let periodDays = 0;

  const invoiceOf = async (id: string): Promise<Json> => stripeApi('GET', `/v1/invoices/${id}`);
  const customerBalance = async (): Promise<number> => Number((await stripeApi('GET', `/v1/customers/${box.customerId}`)).balance);
  /** Invoice lines that wait for the next renewal. The adapter must never leave any. */
  const waitingLines = async (): Promise<Json[]> => (await stripeApi('GET', '/v1/invoiceitems', { customer: box.customerId, pending: true, limit: 100 })).data as Json[];
  const latestInvoice = async (): Promise<Json> => invoiceOf(String((await stripeSubscription(subscriptionId)).latest_invoice));

  beforeAll(async () => {
    box = await Sandbox.create(test!, '03 plan changes');
    const bought = await buyPlan(box, { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' });
    expect(failures(bought.delivered)).toEqual([]);
    subscriptionId = String(bought.subscription.id);
    box.note('subscriptionId', subscriptionId);
    expect(await box.subscriptionRow()).toMatchObject({ status: 'active', seats: 2, recurring_cents: 2 * CRM.monthly });
    // Ten days into the month, so every change below is for part of a period.
    await box.advanceBy(10 * DAY_MS);
    expect(failures(await box.sync())).toEqual([]);
    const row = await box.subscriptionRow();
    periodDays = Math.round((new Date(row!.current_period_end).getTime() - new Date(row!.current_period_start).getTime()) / DAY_MS);
    daysLeft = periodDays - 10;
  });

  afterAll(async () => {
    await box?.dispose();
    await test?.pool.end();
  });

  it('adding seats charges the days left now, to the cent of the preview', async () => {
    const before = await latestInvoice();
    const { preview, state, delivered } = await changePlan(box, { products: ['crm'], seats: 5, warehouses: 1, interval: 'monthly' });
    expect(failures(delivered)).toEqual([]);
    box.note('eventsAfterSeatIncrease', delivered.map((event) => `${event.type}:${event.outcome.result}`));

    // Three more seats for the whole days left.
    const expected = Math.round((3 * CRM.monthly * daysLeft) / periodDays);
    expect(preview.daysLeft).toBe(daysLeft);
    expect(Math.abs(preview.dueTodayCents - expected)).toBeLessThanOrEqual(1);
    expect(preview.creditCents).toBe(0);

    const subscription = await stripeSubscription(subscriptionId);
    expect(itemKeys(subscription)).toEqual(['kitstak_crm_monthly:5']);
    const invoice = await latestInvoice();
    expect(invoice.id).not.toBe(before.id);
    expect(invoice.status).toBe('paid');
    expect(invoice.billing_reason).toBe('subscription_update');
    // What Stripe charged is what the person was shown.
    expect(invoice.amount_paid).toBe(preview.dueTodayCents);
    box.note('seatIncreaseInvoiceId', invoice.id);

    expect(await box.subscriptionRow()).toMatchObject({ status: 'active', seats: 5, recurring_cents: 5 * CRM.monthly, latest_invoice_id: invoice.id, credit_cents: 0 });
    expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'active', source: 'stripe', seats: 5 }]);
    expect(state.usage.seatLimit).toBe(5);

    const stored = (await box.invoices()).find((entry) => entry.id === invoice.id);
    expect(stored).toMatchObject({ status: 'paid', total_cents: preview.dueTodayCents, amount_paid_cents: preview.dueTodayCents, billing_reason: 'subscription_update' });
    expect((stored!.lines as Json[]).every((line) => line.proration === true)).toBe(true);
    expect((stored!.lines as Json[]).reduce((sum, line) => sum + Number(line.amountCents), 0)).toBe(preview.dueTodayCents);

    const changed = (await box.audit()).filter((entry) => entry.action === 'plan.changed').pop();
    expect(changed!.data).toMatchObject({ dueTodayCents: preview.dueTodayCents, creditCents: 0, invoiceId: invoice.id });
    const receipts = (await box.emails()).filter((email) => email.template === 'receipt');
    expect(receipts.map((email) => email.payload.invoiceId)).toContain(invoice.id);
  });

  it('removing seats makes no charge and becomes credit on the balance at once', async () => {
    const before = await latestInvoice();
    const { preview, delivered } = await changePlan(box, { products: ['crm'], seats: 3, warehouses: 1, interval: 'monthly' });
    expect(failures(delivered)).toEqual([]);

    // Two seats back for the full days left (rounded down, never more than was paid).
    const expected = Math.round((2 * CRM.monthly * preview.daysLeft!) / periodDays);
    expect(preview.dueTodayCents).toBe(0);
    expect(Math.abs(preview.creditCents - expected)).toBeLessThanOrEqual(1);
    expect(preview.daysLeft).toBeLessThanOrEqual(daysLeft);

    const subscription = await stripeSubscription(subscriptionId);
    expect(itemKeys(subscription)).toEqual(['kitstak_crm_monthly:3']);
    // Stripe made an invoice with a total below zero, charged nothing, and put the amount on the
    // customer's credit balance. Nothing is left waiting for the next renewal.
    const invoice = await latestInvoice();
    expect(invoice.id).not.toBe(before.id);
    expect(invoice).toMatchObject({ status: 'paid', total: -preview.creditCents, amount_paid: 0, amount_due: 0, billing_reason: 'subscription_update' });
    expect(await customerBalance()).toBe(-preview.creditCents);
    expect(await waitingLines()).toEqual([]);
    box.note('seatDecreaseCreditInvoiceId', invoice.id);

    const row = await box.subscriptionRow();
    expect(row).toMatchObject({ seats: 3, recurring_cents: 3 * CRM.monthly, credit_cents: preview.creditCents });
    // The next bill is the plan price minus the credit, as Stripe's own preview says.
    expect(row!.next_charge_cents).toBe(3 * CRM.monthly - preview.creditCents);
    expect(row!.next_credit_cents).toBe(preview.creditCents);
    expect(await box.entitlements()).toMatchObject([{ module: 'crm', status: 'active', seats: 3 }]);

    const changed = (await box.audit()).filter((entry) => entry.action === 'plan.changed').pop();
    expect(changed!.data).toMatchObject({ dueTodayCents: 0, creditCents: preview.creditCents, invoiceId: invoice.id, creditBalanceCents: preview.creditCents });
    expect(String(changed!.summary)).toContain('credit was added');
    // A credit is not a payment: no receipt goes out for it.
    const receipts = (await box.emails()).filter((email) => email.template === 'receipt');
    expect(receipts.map((email) => email.payload.invoiceId)).not.toContain(invoice.id);
    box.note('creditAfterSeatDecrease', preview.creditCents);
  });

  it('adding a second app turns the bundle discount on for every app', async () => {
    const { preview, delivered } = await changePlan(box, { products: ['crm', 'wms'], seats: 3, warehouses: 2, interval: 'monthly' });
    expect(failures(delivered)).toEqual([]);

    const subscription = await stripeSubscription(subscriptionId);
    expect(itemKeys(subscription)).toEqual(['kitstak_crm_monthly_bundle:3', 'kitstak_wms_monthly_bundle:2']);
    const amounts = Object.fromEntries((subscription.items.data as Json[]).map((item) => [item.price.lookup_key, item.price.unit_amount]));
    // 20% off both apps, straight from the catalog.
    expect(amounts).toEqual({ kitstak_crm_monthly_bundle: CRM.monthlyBundle, kitstak_wms_monthly_bundle: WMS.monthlyBundle });
    expect(CRM.monthlyBundle).toBe(CRM.monthly * 0.8);

    const recurring = 3 * CRM.monthlyBundle + 2 * WMS.monthlyBundle;
    expect(preview.newRecurringCents).toBe(recurring);
    const invoice = await latestInvoice();
    expect(invoice.status).toBe('paid');
    // The card was charged exactly what the person confirmed, and the credit from the seats that
    // came off paid part of it. (Before the fix the card was charged the credit amount on top.)
    expect(invoice.amount_paid).toBe(preview.dueTodayCents);
    expect(preview.creditAppliedCents).toBe(preview.creditBalanceCents);
    expect(invoice.total - invoice.amount_paid).toBe(preview.creditAppliedCents);
    expect(await customerBalance()).toBe(0);
    expect(await waitingLines()).toEqual([]);
    box.note('bundleOnInvoiceId', invoice.id);
    box.note('bundleOnMoney', { totalCents: invoice.total, creditUsedCents: preview.creditAppliedCents, chargedCents: invoice.amount_paid });

    expect(await box.subscriptionRow()).toMatchObject({ seats: 3, warehouses: 2, recurring_cents: recurring });
    expect(await box.entitlements()).toMatchObject([
      { module: 'crm', status: 'active', source: 'stripe', seats: 3 },
      { module: 'wms', status: 'active', source: 'stripe', seats: null },
    ]);
  });

  it('adding and removing a warehouse prorates the same way', async () => {
    const up = await changePlan(box, { products: ['crm', 'wms'], seats: 3, warehouses: 3, interval: 'monthly' });
    expect(failures(up.delivered)).toEqual([]);
    expect(itemKeys(await stripeSubscription(subscriptionId))).toEqual(['kitstak_crm_monthly_bundle:3', 'kitstak_wms_monthly_bundle:3']);
    const invoice = await latestInvoice();
    expect(invoice.amount_paid).toBe(up.preview.dueTodayCents);
    expect(Math.abs(up.preview.proratedCents - Math.round((WMS.monthlyBundle * up.preview.daysLeft!) / periodDays))).toBeLessThanOrEqual(1);
    expect(await box.subscriptionRow()).toMatchObject({ warehouses: 3 });
    box.note('warehouseIncreaseInvoiceId', invoice.id);

    const down = await changePlan(box, { products: ['crm', 'wms'], seats: 3, warehouses: 1, interval: 'monthly' });
    expect(failures(down.delivered)).toEqual([]);
    expect(down.preview.dueTodayCents).toBe(0);
    expect(Math.abs(down.preview.creditCents - Math.round((2 * WMS.monthlyBundle * down.preview.daysLeft!) / periodDays))).toBeLessThanOrEqual(1);
    expect(itemKeys(await stripeSubscription(subscriptionId))).toEqual(['kitstak_crm_monthly_bundle:3', 'kitstak_wms_monthly_bundle:1']);
    expect(await customerBalance()).toBe(-down.preview.creditCents);
    expect(await waitingLines()).toEqual([]);
    expect(await box.subscriptionRow()).toMatchObject({ warehouses: 1, recurring_cents: 3 * CRM.monthlyBundle + WMS.monthlyBundle, credit_cents: down.preview.creditCents });
  });

  it('removing the second app turns the bundle discount off and makes that app view only', async () => {
    const { delivered } = await changePlan(box, { products: ['crm'], seats: 3, warehouses: 1, interval: 'monthly' });
    expect(failures(delivered)).toEqual([]);
    const subscription = await stripeSubscription(subscriptionId);
    expect(itemKeys(subscription)).toEqual(['kitstak_crm_monthly:3']);
    expect(subscription.items.data[0].price.unit_amount).toBe(CRM.monthly);
    expect(await box.subscriptionRow()).toMatchObject({ recurring_cents: 3 * CRM.monthly });
    expect(await waitingLines()).toEqual([]);
    expect(await box.entitlements()).toMatchObject([
      { module: 'crm', status: 'active', source: 'stripe', seats: 3 },
      { module: 'wms', status: 'canceled', source: 'stripe' },
    ]);
  });

  it('monthly to yearly starts a new year today, takes off the unused month and uses the credit', async () => {
    const before = await box.subscriptionRow();
    const credit = Number(before!.credit_cents);
    expect(credit).toBeGreaterThan(0);
    const { preview, delivered } = await changePlan(box, { products: ['crm'], seats: 3, warehouses: 1, interval: 'yearly' });
    expect(failures(delivered)).toEqual([]);
    box.note('eventsAfterYearly', delivered.map((event) => `${event.type}:${event.outcome.result}`));

    const subscription = await stripeSubscription(subscriptionId);
    expect(itemKeys(subscription)).toEqual(['kitstak_crm_yearly:3']);
    expect(subscription.items.data[0].price.unit_amount).toBe(CRM.yearly);
    // 15% off twelve months.
    expect(CRM.yearly).toBe(Math.round(CRM.monthly * 12 * 0.85));

    // The new year starts today at Stripe too. (Left alone, Stripe keeps the old renewal day and
    // bills "the rest of a year that began 10 days ago".)
    const item = subscription.items.data[0];
    expect(item.current_period_start * 1000).toBe(box.now().getTime());
    expect(Math.round((item.current_period_end - item.current_period_start) / 86400)).toBe(365);
    expect(subscription.billing_cycle_anchor * 1000).toBe(box.now().getTime());

    // A full year, less the unused days of the month, less the credit the customer held.
    const unusedMonth = Math.round((3 * CRM.monthly * daysLeft) / periodDays);
    const invoice = await latestInvoice();
    expect(invoice.status).toBe('paid');
    expect(invoice.total).toBe(3 * CRM.yearly - unusedMonth);
    expect(preview.creditAppliedCents).toBe(credit);
    expect(preview.dueTodayCents).toBe(3 * CRM.yearly - unusedMonth - credit);
    expect(invoice.amount_paid).toBe(preview.dueTodayCents);
    expect(await customerBalance()).toBe(0);
    expect(await waitingLines()).toEqual([]);
    // The sentence under the amount, with Stripe's own numbers in it.
    expect(preview.dueTodayNote).toContain('for the next year');
    expect(preview.dueTodayNote).toContain(`for the ${String(daysLeft)} full days left on your monthly plan`);
    expect(preview.nextChargeAt.getTime()).toBe(item.current_period_end * 1000);
    box.note('yearlyInvoiceId', invoice.id);
    box.note('yearlyMoney', { totalCents: invoice.total, creditUsedCents: preview.creditAppliedCents, chargedCents: invoice.amount_paid, note: preview.dueTodayNote });

    const row = await box.subscriptionRow();
    expect(row).toMatchObject({ interval: 'yearly', seats: 3, recurring_cents: 3 * CRM.yearly, credit_cents: 0 });
    expect(new Date(row!.current_period_start).getTime()).toBe(box.now().getTime());
    expect(new Date(row!.current_period_end).getTime()).toBe(item.current_period_end * 1000);
    expect(row!.next_charge_cents).toBe(3 * CRM.yearly);
    const rows = await box.entitlements();
    expect(new Date(rows[0]!.current_period_end).getTime()).toBe(item.current_period_end * 1000);
  });

  it('every bill is in the invoice list, and each has a PDF link at Stripe', async () => {
    const shown = await listInvoices(box.rt.db, { orgId: box.org.orgId });
    const atStripe = await stripeApi('GET', '/v1/invoices', { customer: box.customerId, limit: 100 });
    const real = (atStripe.data as Json[]).filter((invoice) => invoice.status !== 'draft');
    expect(shown.map((invoice) => invoice.id).sort()).toEqual(real.map((invoice) => String(invoice.id)).sort());
    for (const invoice of real) {
      const row = shown.find((entry) => entry.id === invoice.id)!;
      expect(row).toMatchObject({ number: invoice.number, status: invoice.status, totalCents: invoice.total, amountPaidCents: invoice.amount_paid });
      const pdf = await getInvoicePdf(box.rt, { orgId: box.org.orgId, invoiceId: String(invoice.id) });
      expect(pdf.ok).toBe(true);
      if (pdf.ok) {
        expect(pdf.data.kind).toBe('redirect');
        // Stripe signs a fresh link on every read, so only the stable part is compared.
        if (pdf.data.kind === 'redirect') {
          const url = new URL(pdf.data.url);
          expect(url.host).toBe(new URL(String(invoice.invoice_pdf)).host);
          expect(url.pathname.startsWith(`/invoice/${String(invoice.account ?? '')}`) || url.pathname.includes('/invoice/')).toBe(true);
          expect(url.pathname.endsWith('/pdf')).toBe(true);
        }
      }
    }
    box.note('invoiceNumbers', real.map((invoice) => `${String(invoice.number)} ${String(invoice.billing_reason)} total ${String(invoice.total)} paid ${String(invoice.amount_paid)}`));
    box.note('invoicePdfHost', new URL(String(real[0]!.invoice_pdf)).host);
    // An invoice of another organization is never handed out.
    const other = await getInvoicePdf(box.rt, { orgId: '00000000-0000-4000-8000-000000000000', invoiceId: String(real[0]!.id) });
    expect(other.ok).toBe(false);
  });

  it('Stripe takes a one cent refund on a paid invoice (the safety net under a period change)', async () => {
    // `refundAnyExcess` in the adapter sends back whatever an invoice asked above the confirmed
    // amount. That can only be a cent or two, so the smallest refund must be allowed.
    const invoice = await latestInvoice();
    const note = await stripeApi('POST', '/v1/credit_notes', { invoice: String(invoice.id), amount: 1, refund_amount: 1, reason: 'order_change' });
    expect(note.status).toBe('issued');
    expect(note.total).toBe(1);
    expect((await invoiceOf(String(invoice.id))).post_payment_credit_notes_amount).toBe(1);
    box.note('oneCentCreditNoteId', note.id);
    expect(failures(await box.sync())).toEqual([]);
  });
});
