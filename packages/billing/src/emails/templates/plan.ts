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
} from './shared';

export function planStarted(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const products = stack(payload, 'products');
  const total = cents(payload, 'totalCents');
  const dueToday = cents(payload, 'dueTodayCents');
  const firstChargeAt = date(payload, 'firstChargeAt');
  const period = perPeriod(interval(payload, 'interval'));
  const chargeRows =
    dueToday > 0
      ? [{ label: 'Paid today', value: money(dueToday) }]
      : [
          { label: 'Due today', value: money(0) },
          { label: 'First charge', value: `${money(total)} on ${day(firstChargeAt)}` },
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
    button: { label: 'See my plan', url: billingLink(portalUrl, { to: 'home' }) },
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
    button: { label: 'Keep my plan', url: billingLink(portalUrl, { to: 'home' }) },
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
    subject: 'Your KitStak plan is paused',
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
    button: { label: 'See my plan', url: billingLink(portalUrl, { to: 'home' }) },
    footer: billingFooter(orgName),
  };
}

export function planEnded(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const portalUrl = portal(payload);
  const endedAt = date(payload, 'endedAt');
  return {
    subject: 'Your KitStak plan has ended. Your data is safe.',
    preheader: 'Your apps are view only. Pick a plan any time to keep working.',
    heading: 'Your plan has ended',
    blocks: [
      { kind: 'text', text: `The plan for ${orgName} ended on ${day(endedAt)}.` },
      { kind: 'text', text: 'Your apps are view only now. You can still open and read everything.' },
      { kind: 'text', text: 'Nothing is deleted. Pick a plan any time to keep working.' },
    ],
    button: { label: 'Pick a plan', url: billingLink(portalUrl, { to: 'plan' }) },
    footer: billingFooter(orgName),
  };
}
