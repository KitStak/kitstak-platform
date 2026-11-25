/** Free trial emails: welcome, the reminders and the end (docs/billing/SPEC.md sections 8.2 and 10). */
import { billingLink, withOrgParam } from '../../links';
import type { EmailContent } from '../layout';
import {
  TRIAL_DAYS,
  apps,
  asPayload,
  billingFooter,
  cents,
  date,
  day,
  firstWord,
  interval,
  money,
  perPeriod,
  portal,
  stack,
  text,
  wholeNumber,
  orgOf,
} from './shared';

export function welcome(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const products = stack(payload, 'products');
  const endsAt = date(payload, 'trialEndsAt');
  return {
    subject: 'Welcome to KitStak. Your free trial has started.',
    preheader: `${TRIAL_DAYS} days free. No card needed.`,
    heading: `Welcome, ${firstWord(text(payload, 'firstName', 80))}.`,
    blocks: [
      { kind: 'text', text: `Your free trial for ${orgName} has started.` },
      {
        kind: 'facts',
        rows: [
          { label: products.length === 1 ? 'Your app' : 'Your apps', value: apps(products) },
          { label: 'Free until', value: day(endsAt) },
          { label: 'Card', value: 'No card needed' },
        ],
      },
      { kind: 'text', text: 'You have full access until then. Nothing is charged.' },
      { kind: 'note', text: 'You can add more apps to your trial any time in Billing.' },
    ],
    button: { label: 'Open KitStak', url: withOrgParam(`${portalUrl}/`, orgOf(payload)) },
    footer: `You get this email because you started a free trial for ${orgName} on KitStak.`,
  };
}

function endsInWords(daysLeft: number): string {
  return daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`;
}

export function trialEnding(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const products = stack(payload, 'products');
  const endsAt = date(payload, 'trialEndsAt');
  const daysLeft = wholeNumber(payload, 'daysLeft');
  const total = cents(payload, 'totalCents');
  const period = perPeriod(interval(payload, 'interval'));
  return {
    subject: `Your KitStak trial ends ${endsInWords(daysLeft)}`,
    preheader: `Pick a plan by ${day(endsAt)} to keep working.`,
    heading: `Your free trial ends ${endsInWords(daysLeft)}`,
    blocks: [
      { kind: 'text', text: `The free trial for ${orgName} ends on ${day(endsAt)}.` },
      {
        kind: 'facts',
        rows: [
          { label: products.length === 1 ? 'Your app' : 'Your apps', value: apps(products) },
          { label: 'Price after the trial', value: `${money(total)} ${period}` },
          { label: 'Charged today', value: money(0) },
        ],
      },
      { kind: 'text', text: 'Pick a plan to keep working after that day.' },
      { kind: 'note', text: 'Nothing is deleted if you wait. Your apps become view only until you pick a plan.' },
    ],
    button: { label: 'Pick a plan', url: billingLink(portalUrl, { to: 'plan' }, undefined, orgOf(payload)) },
    footer: billingFooter(orgName),
  };
}

export function trialEnded(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const products = stack(payload, 'products');
  const endedAt = date(payload, 'trialEndedAt');
  return {
    subject: 'Your KitStak trial has ended. Your data is safe.',
    preheader: 'Your apps are view only. Pick a plan to keep working.',
    heading: 'Your free trial has ended',
    blocks: [
      { kind: 'text', text: `The free trial of ${apps(products)} for ${orgName} ended on ${day(endedAt)}.` },
      { kind: 'text', text: 'Your apps are view only now. You can still open and read everything.' },
      { kind: 'text', text: 'Nothing is deleted. Pick a plan to keep working.' },
    ],
    button: { label: 'Pick a plan', url: billingLink(portalUrl, { to: 'plan' }, undefined, orgOf(payload)) },
    footer: billingFooter(orgName),
  };
}
