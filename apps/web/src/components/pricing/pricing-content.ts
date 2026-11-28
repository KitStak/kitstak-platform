/**
 * The words on the pricing page. Every price, percent and number of days is read from the shared
 * catalog (`@/lib/pricing`), so this page can never disagree with sign-up or with an invoice.
 * Copy rules: plain words, short sentences, 20 words at most.
 */
import type { FaqItem } from '@/components/product/cta';
import { COMING_SOON_APPS, announcedName, comingSoonNames } from '@/components/site-links';
import {
  BILLING_POLICY,
  BUNDLE_OFF,
  CATALOG,
  TRIAL_DAYS,
  YEARLY_OFF,
  includedSeatsLabel,
  midMonthSeatExample,
  priceInWords,
  priceOf,
} from '@/lib/pricing';

export const HERO = {
  kicker: 'Pricing',
  titleTop: 'Simple prices.',
  titleBottom: 'Pay only for the apps you use.',
  lead: `Try every app free for ${TRIAL_DAYS} days. No card needed. Cancel any time.`,
} as const;

export const CARDS_NOTE = `Use two or more apps and save ${BUNDLE_OFF} on every one.`;

/** Above the Crew and Ledger cards. */
export const PLANNED_LEAD = `${comingSoonNames()} ${COMING_SOON_APPS.length === 1 ? 'has a price' : 'have prices'} but no app yet. Not in the calculator. When an app opens, it counts toward the bundle.`;

export const CALCULATOR = {
  title: 'Price your plan.',
  lead: 'Switch apps on and set your size. This is the total you see at sign-up and on your invoice, to the cent.',
} as const;

export interface BillingRule {
  readonly title: string;
  readonly lines: readonly string[];
}

const seat = midMonthSeatExample();
const pauseMonths = CATALOG.pauseMonths;

/** "How billing works", in four short parts (docs/billing/SPEC.md section 2, rules P4, P9, P11, P12, P14). */
export const BILLING_RULES: readonly BillingRule[] = [
  {
    title: 'Your trial is free',
    lines: [
      `You get ${TRIAL_DAYS} days with full access to the apps you pick.`,
      'No card needed. Nothing is charged unless you pick a plan.',
    ],
  },
  {
    title: 'Changes start right away',
    lines: [
      'Add or remove seats, warehouses or apps any time. You pay only for the days left.',
      `Add 1 CRM seat halfway through the month and you pay ${seat.today} today, then ${seat.eachMonth} more each month.`,
      'Remove something and the unused part becomes credit on your next bill.',
      'A day that has started counts as used. So you pay for today when you add, and credit is for the full days left.',
    ],
  },
  {
    title: 'Cancel any time',
    lines: [
      'It takes two clicks in Billing. You keep access until the end of the time you paid for.',
      `Need a break? Monthly plans can pause for ${pauseMonths[0]} to ${pauseMonths[pauseMonths.length - 1]} months.`,
    ],
  },
  {
    title: 'Your data stays yours',
    lines: [
      'Nothing is deleted when a trial ends, a plan pauses or a plan ends.',
      'Your apps become view only. You can still open, read and export everything.',
    ],
  },
];

const pulseSeats = priceOf('pulse').includedSeats;

export const PRICING_FAQ: readonly FaqItem[] = [
  {
    question: 'What happens when my trial ends?',
    answer: 'Your apps become view only. Nothing is deleted. Pick a plan to keep working.',
  },
  {
    question: 'Do I need a card to start?',
    answer: `No. The ${TRIAL_DAYS} day trial needs no card. Add one only when you pick a plan.`,
  },
  {
    question: 'Can I change seats later?',
    answer: 'Yes. Any time. You pay only for the days left.',
  },
  {
    question: 'Can I cancel?',
    answer: 'Yes. Two clicks in Billing. You keep access until the end of the period.',
  },
  {
    question: 'Do I need a demo to buy the WMS?',
    answer: 'No. Start the trial and add warehouses yourself.',
  },
  {
    question: 'What is a seat?',
    answer: 'A seat is one person on your team who can sign in. Guests are free.',
  },
  {
    question: 'How does the bundle discount work?',
    answer: `With two or more apps you save ${BUNDLE_OFF} on every app. It starts the moment you add the second app. It stops if you go back to one.`,
  },
  {
    question: 'What do I save by paying yearly?',
    answer: `You save ${YEARLY_OFF}. It works together with the bundle discount.`,
  },
  {
    question: 'How many people can use Pulse?',
    answer: `${includedSeatsLabel('pulse')}. That is ${pulseSeats} people for one flat price. For a bigger team, talk to us.`,
  },
  ...COMING_SOON_APPS.map((id) => ({
    question: `When can I buy ${announcedName(id)}?`,
    answer: `Not yet. It is planned at ${priceInWords(id)}${includedSeatsLabel(id) ? `, ${includedSeatsLabel(id)?.toLowerCase()}` : ''}. Ask to be told when it opens.`,
  })),
  {
    question: 'Is sales tax included?',
    answer: 'No. If sales tax applies to you, it is added at checkout and shown as its own line.',
  },
  {
    question: 'Can I get a refund?',
    answer: BILLING_POLICY.refund,
  },
  {
    question: 'How do I pay?',
    answer: `By card, on a secure checkout page. ${BILLING_POLICY.payments}`,
  },
];
