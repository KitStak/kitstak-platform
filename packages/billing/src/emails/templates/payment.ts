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

export function paymentFailed(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const amount = cents(payload, 'amountDueCents');
  const last4 = optionalText(payload, 'last4', 8);
  const nextRetryAt = optionalDate(payload, 'nextRetryAt');
  const accessChangesAt = date(payload, 'accessChangesAt');
  const blocks: EmailBlock[] = [
    { kind: 'text', text: `We could not charge ${cardWords(last4)} for ${money(amount)}.` },
    {
      kind: 'facts',
      rows: [
        { label: 'Amount due', value: money(amount) },
        { label: 'We try again on', value: nextRetryAt ? day(nextRetryAt) : 'No more tries planned' },
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
    button: { label: 'Update card', url: billingLink(portalUrl, { to: 'fix_payment' }) },
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
  return {
    subject: 'Last day to fix your KitStak payment',
    preheader: `Pay ${money(amount)} by ${day(accessChangesAt)} to keep full access.`,
    heading: 'Last day to fix your payment',
    blocks: [
      { kind: 'text', text: `We still could not collect ${money(amount)} for ${orgName}.` },
      { kind: 'text', text: `Update your card by ${day(accessChangesAt)} to keep full access.` },
      { kind: 'note', text: 'After that your apps are view only. Nothing is deleted.' },
    ],
    button: { label: 'Update card', url: billingLink(portalUrl, { to: 'fix_payment' }) },
    footer: billingFooter(orgName),
  };
}
