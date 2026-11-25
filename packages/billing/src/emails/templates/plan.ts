/** Plan emails: started, cancel set, pause set, ended (docs/billing/SPEC.md section 10). */
import { billingLink } from '../../links';
import type { EmailContent } from '../layout';
import {
  apps,
  asPayload,
  billingFooter,
  cents,
  date,
  day,
  dayShort,
  interval,
  money,
  perPeriod,
  portal,
  stack,
  text,
  orgOf,
} from './shared';

export function planStarted(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const products = stack(payload, 'products');
  const total = cents(payload, 'totalCents');
  const dueToday = cents(payload, 'dueTodayCents');
  const firstChargeAt = date(payload, 'firstChargeAt');
  // What the first bill really charges, when it differs from the plan price (a promo code, credit).
  const firstCharge = typeof payload.firstChargeCents === 'number' ? cents(payload, 'firstChargeCents') : total;
  const period = perPeriod(interval(payload, 'interval'));
  const chargeRows =
    dueToday > 0
      ? [{ label: 'Paid today', value: money(dueToday) }]
      : [
          { label: 'Due today', value: money(0) },
          { label: 'First charge', value: `${money(firstCharge)} on ${day(firstChargeAt)}` },
        ];
  return {
    subject: 'Your KitStak plan is set',
    preheader:
      dueToday > 0 ? `You paid ${money(dueToday)} today.` : `Your first charge is on ${day(firstChargeAt)}.`,
    heading: 'Your plan is set',
    blocks: [
      { kind: 'text', text: `Thank you. The plan for ${orgName} is ready.` },
      {
        kind: 'facts',
        rows: [
          { label: products.length === 1 ? 'Your app' : 'Your apps', value: apps(products) },
          { label: 'Price', value: `${money(total)} ${period}` },
          ...chargeRows,
        ],
      },
      { kind: 'note', text: 'You can change or cancel your plan any time in Billing.' },
    ],
    button: { label: 'See my plan', url: billingLink(portalUrl, { to: 'home' }, undefined, orgOf(payload)) },
    footer: billingFooter(orgName),
  };
}

export function cancelScheduled(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const endsAt = date(payload, 'endsAt');
  return {
    subject: `Your KitStak plan will end on ${dayShort(endsAt)}`,
    preheader: 'You keep everything until then. You can undo this with one click.',
    heading: `Your plan will end on ${day(endsAt)}`,
    blocks: [
      { kind: 'text', text: `You canceled the plan for ${orgName}.` },
      { kind: 'text', text: `You keep everything until ${day(endsAt)}. After that your apps are view only.` },
      { kind: 'text', text: 'Nothing is deleted. Changed your mind? You can undo this with one click.' },
    ],
    button: { label: 'Keep my plan', url: billingLink(portalUrl, { to: 'home' }, undefined, orgOf(payload)) },
    footer: billingFooter(orgName),
  };
}

export function paused(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const startsAt = date(payload, 'startsAt');
  const resumesAt = date(payload, 'resumesAt');
  return {
    // The pause is planned, not running yet, so the subject gives the day it starts.
    subject: `Your KitStak plan will pause on ${dayShort(startsAt)}`,
    preheader: `The pause starts on ${day(startsAt)}. Your plan starts again on ${day(resumesAt)}.`,
    heading: 'Your pause is set',
    blocks: [
      { kind: 'text', text: `The plan for ${orgName} will pause. Here are the dates.` },
      {
        kind: 'facts',
        rows: [
          { label: 'Pause starts', value: day(startsAt) },
          { label: 'Plan starts again', value: day(resumesAt) },
        ],
      },
      { kind: 'text', text: 'There are no bills during the pause. Your apps are view only while paused.' },
      { kind: 'note', text: 'Nothing is deleted. You can start again sooner in Billing.' },
    ],
    button: { label: 'See my plan', url: billingLink(portalUrl, { to: 'home' }, undefined, orgOf(payload)) },
    footer: billingFooter(orgName),
  };
}

/** 'after 4 tries', 'after 1 try', or '' when the count is not known. */
function triesWords(attempts: number | null): string {
  if (attempts === null || attempts < 1) return '';
  return ` after ${attempts} ${attempts === 1 ? 'try' : 'tries'}`;
}

export function planEnded(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const endedAt = date(payload, 'endedAt');
  const reason = payload.reason === 'payment_failed' || payload.reason === 'canceled_unpaid' || payload.reason === 'canceled' ? payload.reason : null;
  const amount = typeof payload.amountCents === 'number' && Number.isFinite(payload.amountCents) && payload.amountCents > 0 ? Math.trunc(payload.amountCents) : null;
  const attempts = typeof payload.attempts === 'number' && Number.isFinite(payload.attempts) ? Math.trunc(payload.attempts) : null;
  const button = { label: 'Pick a plan', url: billingLink(portalUrl, { to: 'plan' }, undefined, orgOf(payload)) };
  const footer = billingFooter(orgName);
  const viewOnly = 'Your apps are view only now. You can still open and read everything.';

  if (reason === 'payment_failed') {
    // Nobody canceled. Say why the plan ended, and that nothing more will be tried.
    const why =
      amount !== null
        ? `We could not collect ${money(amount)}${triesWords(attempts)}, so the plan for ${orgName} ended on ${day(endedAt)}.`
        : `We could not collect your payment${triesWords(attempts)}, so the plan for ${orgName} ended on ${day(endedAt)}.`;
    return {
      subject: 'Your KitStak plan has ended. We could not collect your payment.',
      preheader: 'Your data is safe. Pick a plan any time to keep working.',
      heading: 'Your plan has ended',
      blocks: [
        { kind: 'text', text: why },
        { kind: 'text', text: 'We will not try that card again.' },
        { kind: 'text', text: viewOnly },
        { kind: 'text', text: 'Nothing is deleted. Pick a plan any time to keep working. You only pay from the day you start again.' },
      ],
      button,
      footer,
    };
  }
  if (reason === 'canceled_unpaid') {
    return {
      subject: 'Your KitStak plan has ended. Your data is safe.',
      preheader: amount !== null ? `You canceled. We will not charge the ${money(amount)}.` : 'You canceled. Nothing more will be charged.',
      heading: 'Your plan has ended',
      blocks: [
        { kind: 'text', text: `You canceled the plan for ${orgName}. It ended on ${day(endedAt)}.` },
        {
          kind: 'text',
          text: amount !== null ? `A bill of ${money(amount)} was still open. We dropped it. We will not charge it.` : 'The open bill was dropped. We will not charge it.',
        },
        { kind: 'text', text: viewOnly },
        { kind: 'text', text: 'Nothing is deleted. Pick a plan any time to keep working.' },
      ],
      button,
      footer,
    };
  }
  return {
    subject: 'Your KitStak plan has ended. Your data is safe.',
    preheader: 'Your apps are view only. Pick a plan any time to keep working.',
    heading: 'Your plan has ended',
    blocks: [
      {
        kind: 'text',
        text: reason === 'canceled' ? `You canceled the plan for ${orgName}. It ended on ${day(endedAt)}.` : `The plan for ${orgName} ended on ${day(endedAt)}.`,
      },
      { kind: 'text', text: viewOnly },
      { kind: 'text', text: 'Nothing is deleted. Pick a plan any time to keep working.' },
    ],
    button,
    footer,
  };
}
