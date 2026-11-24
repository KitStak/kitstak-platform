/**
 * Payment emails: the receipt, a failed payment, a bank approval request and the last day reminder
 * (docs/billing/SPEC.md sections 8.3 and 10).
 */
import { billingLink } from '../../links';
import type { EmailBlock, EmailContent } from '../layout';
import {
  EmailPayloadError,
  asPayload,
  billingFooter,
  cardWords,
  cents,
  date,
  day,
  money,
  optionalDate,
  optionalText,
  portal,
  text,
} from './shared';

function receiptLines(value: unknown): { label: string; amount: string }[] {
  if (!Array.isArray(value)) throw new EmailPayloadError('The receipt has no lines.');
  const out: { label: string; amount: string }[] = [];
  for (const entry of value.slice(0, 40)) {
    if (entry === null || typeof entry !== 'object') continue;
    const line = entry as { description?: unknown; amountCents?: unknown };
    if (typeof line.description !== 'string' || typeof line.amountCents !== 'number') continue;
    const label = line.description.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (label === '' || !Number.isFinite(line.amountCents)) continue;
    out.push({ label, amount: money(Math.trunc(line.amountCents)) });
  }
  return out;
}

export function receipt(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const invoiceId = text(payload, 'invoiceId', 120);
  const paid = cents(payload, 'amountPaidCents');
  const tax = cents(payload, 'taxCents');
  const paidAt = date(payload, 'paidAt');
  const last4 = optionalText(payload, 'last4', 8);
  const invoiceNumber = optionalText(payload, 'invoiceNumber', 60);
  const nextChargeAt = optionalDate(payload, 'nextChargeAt');

  const rows = receiptLines(payload.lines);
  if (tax > 0) rows.push({ label: 'Sales tax', amount: money(tax) });

  const facts: { label: string; value: string }[] = [{ label: 'Paid on', value: day(paidAt) }];
  if (last4 && /^\d{4}$/.test(last4)) facts.push({ label: 'Card', value: `Ending ${last4}` });
  if (invoiceNumber) facts.push({ label: 'Invoice', value: invoiceNumber });
  if (nextChargeAt) facts.push({ label: 'Next charge', value: day(nextChargeAt) });

  const blocks: EmailBlock[] = [
    { kind: 'text', text: `Thank you. We received your payment for ${orgName}.` },
    { kind: 'lines', rows, total: { label: 'Total paid', amount: money(paid) } },
    { kind: 'facts', rows: facts },
    { kind: 'note', text: 'You can save the invoice as a PDF from the link below.' },
  ];
  return {
    subject: `Your KitStak receipt for ${money(paid)}`,
    preheader: `Paid on ${day(paidAt)}. Thank you.`,
    heading: `Receipt for ${money(paid)}`,
    blocks,
    button: { label: 'View invoice', url: `${portalUrl}/billing/invoices/${encodeURIComponent(invoiceId)}` },
    footer: billingFooter(orgName),
  };
}

/**
 * The moment an email speaks from: the `asOf` of its payload, else now. A date is only called "by
 * then" or "until then" when it is still ahead of this moment.
 */
function writtenAt(payload: Readonly<Record<string, unknown>>): Date {
  return optionalDate(payload, 'asOf') ?? new Date();
}

export function paymentFailed(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const amount = cents(payload, 'amountDueCents');
  const last4 = optionalText(payload, 'last4', 8);
  const nextRetryAt = optionalDate(payload, 'nextRetryAt');
  const accessChangesAt = date(payload, 'accessChangesAt');
  const asOf = writtenAt(payload);
  // A retry date that has passed is not a plan. Say "no more tries" only when there really is none.
  const retryAhead = nextRetryAt !== null && nextRetryAt.getTime() > asOf.getTime() ? nextRetryAt : null;
  const button = { label: 'Update card', url: billingLink(portalUrl, { to: 'fix_payment' }) };

  if (accessChangesAt.getTime() <= asOf.getTime()) {
    // The grace days are over: this try failed after the apps became view only. Nothing here asks
    // the customer to act "by" a day that has passed, or promises access they no longer have.
    const facts = [
      { label: 'Amount due', value: money(amount) },
      { label: 'Apps view only since', value: day(accessChangesAt) },
    ];
    if (retryAhead) facts.push({ label: 'We try again on', value: day(retryAhead) });
    const blocks: EmailBlock[] = [
      { kind: 'text', text: `We tried ${cardWords(last4)} again for ${money(amount)}. It did not go through.` },
      { kind: 'text', text: `Your apps are view only now. Pay ${money(amount)} to turn them back on.` },
      { kind: 'facts', rows: facts },
      {
        kind: 'note',
        text: retryAhead
          ? 'Nothing is deleted. You do not have to wait for the next try. Update your card and your apps open again right away.'
          : 'Nothing is deleted. Update your card and your apps open again right away.',
      },
    ];
    return {
      subject: 'Your KitStak apps are view only. Your payment is still late.',
      preheader: `Pay ${money(amount)} to turn your apps back on.`,
      heading: 'Your payment is still late',
      blocks,
      button,
      footer: billingFooter(orgName),
    };
  }

  const blocks: EmailBlock[] = [
    { kind: 'text', text: `We could not charge ${cardWords(last4)} for ${money(amount)}.` },
    {
      kind: 'facts',
      rows: [
        { label: 'Amount due', value: money(amount) },
        { label: 'We try again on', value: retryAhead ? day(retryAhead) : 'No more tries planned' },
        { label: 'Full access until', value: day(accessChangesAt) },
      ],
    },
    { kind: 'text', text: `Update your card by ${day(accessChangesAt)} to keep full access.` },
    { kind: 'note', text: 'Nothing is deleted. After that date your apps are view only until you pay.' },
  ];
  return {
    subject: 'We could not charge your card for KitStak',
    preheader: `Update your card by ${day(accessChangesAt)} to keep full access.`,
    heading: 'Your payment did not go through',
    blocks,
    button,
    footer: billingFooter(orgName),
  };
}

export function paymentActionRequired(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const amount = cents(payload, 'amountDueCents');
  const last4 = optionalText(payload, 'last4', 8);
  return {
    subject: 'Your bank needs you to approve a KitStak payment',
    preheader: `Approve the payment of ${money(amount)} to keep your plan running.`,
    heading: 'Your bank needs your OK',
    blocks: [
      { kind: 'text', text: `Your bank wants you to approve a payment of ${money(amount)} for ${orgName}.` },
      { kind: 'text', text: `We tried ${cardWords(last4)}. Nothing was charged yet.` },
      { kind: 'text', text: 'Open Billing and choose Pay now. Your bank will ask you to confirm.' },
    ],
    button: { label: 'Approve payment', url: billingLink(portalUrl, { to: 'fix_payment' }) },
    footer: billingFooter(orgName),
  };
}

export function graceEnding(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const amount = cents(payload, 'amountDueCents');
  const accessChangesAt = date(payload, 'accessChangesAt');
  const button = { label: 'Update card', url: billingLink(portalUrl, { to: 'fix_payment' }) };
  if (accessChangesAt.getTime() <= writtenAt(payload).getTime()) {
    // Sent late (a job that did not run on the day): the last day has passed, so say what is true now.
    return {
      subject: 'Your KitStak apps are view only. Your payment is still late.',
      preheader: `Pay ${money(amount)} to turn your apps back on.`,
      heading: 'Your payment is still late',
      blocks: [
        { kind: 'text', text: `We still could not collect ${money(amount)} for ${orgName}.` },
        { kind: 'text', text: `Your apps are view only now. Pay ${money(amount)} to turn them back on.` },
        { kind: 'note', text: 'Nothing is deleted. Update your card and your apps open again right away.' },
      ],
      button,
      footer: billingFooter(orgName),
    };
  }
  return {
    subject: 'Last day to fix your KitStak payment',
    preheader: `Pay ${money(amount)} by ${day(accessChangesAt)} to keep full access.`,
    heading: 'Last day to fix your payment',
    blocks: [
      { kind: 'text', text: `We still could not collect ${money(amount)} for ${orgName}.` },
      { kind: 'text', text: `Update your card by ${day(accessChangesAt)} to keep full access.` },
      { kind: 'note', text: 'After that your apps are view only. Nothing is deleted.' },
    ],
    button,
    footer: billingFooter(orgName),
  };
}
