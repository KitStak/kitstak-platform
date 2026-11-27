import { priceOf } from '@/lib/pricing';
import { CONTACT, NOTIFY_LABEL, isAppLive, isPlannedProductId, isProductId } from '../site-links';
import type { SiteProductId } from '../site-links';

export const TOPICS = [
  {
    id: 'founder',
    label: 'Talk to the founder',
    note: 'Twenty minutes on a call about your operation and whether KitStak fits it.',
    prompt: 'What should the founder know before the call? Include a few times that work.',
    action: 'Request a call',
    subject: 'Talk to the founder',
  },
  {
    id: 'demo',
    label: 'Book a walkthrough',
    note: 'A guided tour of the WMS, the CRM, Projects, Pulse or the whole stack, using an operation like yours.',
    prompt: 'Which product do you want to see, and what does your operation look like?',
    action: 'Request a walkthrough',
    subject: 'Walkthrough request',
  },
  {
    id: 'projects',
    label: 'KitStak Projects',
    note: 'Add Projects to an organization you already run, or ask how it fits the way your team plans work.',
    prompt: 'Which organization is it for, and how does your team plan and track projects today?',
    action: 'Ask about Projects',
    subject: 'KitStak Projects',
  },
  {
    id: 'pulse',
    label: 'KitStak Pulse',
    // Nobody can add Pulse to an account until its app is open.
    note: isAppLive('pulse')
      ? 'Add Pulse to an organization you already run, or ask how it fits the way you track job profit today.'
      : 'Pulse is coming soon. Ask how it fits the way you track job profit today, or book a walkthrough.',
    prompt: 'What kind of jobs do you run, and how do you work out what each one made today?',
    action: 'Ask about Pulse',
    subject: 'KitStak Pulse',
  },
  {
    id: 'notify',
    label: NOTIFY_LABEL,
    note: 'KitStak Crew and KitStak Ledger are coming soon. We will email you once when you can start.',
    prompt: 'Which app are you waiting for, and what do you use for it today?',
    action: 'Ask to be told',
    subject: "Tell me when it's ready",
  },
  {
    id: 'sales',
    label: 'Pricing and bundles',
    note: 'Questions about price, the bundle, larger teams or more warehouses.',
    prompt: 'How many people and warehouses are you planning for?',
    action: 'Ask about pricing',
    subject: 'Pricing question',
  },
  {
    id: 'billing',
    label: 'Billing help',
    note: 'A charge, an invoice, a refund question or your card.',
    prompt: 'What happened? Add your company name and the invoice number if you have one.',
    action: 'Send message',
    subject: 'Billing help',
  },
  {
    id: 'other',
    label: 'Something else',
    note: 'Anything at all.',
    prompt: 'How can we help?',
    action: 'Send message',
    subject: 'Message from kitstak.com',
  },
] as const;

export type TopicId = (typeof TOPICS)[number]['id'];

export interface ContactDraft {
  readonly topic: TopicId;
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly message: string;
}

export function parseTopic(value: string | null | undefined): TopicId {
  return TOPICS.find((topic) => topic.id === value)?.id ?? 'other';
}

/** Reads `?product=` from a walkthrough link. Null for anything that is not a product. */
export function parseProduct(value: string | null | undefined): SiteProductId | null {
  return value && (isProductId(value) || isPlannedProductId(value)) ? value : null;
}

/**
 * The first line of the message when a visitor books a walkthrough from one product page, so they
 * do not have to say which product they mean. Empty for every other way into the form.
 */
export function starterMessage(topic: TopicId, product: SiteProductId | null): string {
  if (product === null) return '';
  if (topic === 'notify') return `Please tell me when ${priceOf(product).name} is ready.`;
  if (topic !== 'demo') return '';
  return `I would like a walkthrough of ${priceOf(product).name}.`;
}

/** `mailto:` link that opens the visitor's own email app with the message filled in. */
export function buildMailto(draft: ContactDraft): string {
  const topic = TOPICS.find((t) => t.id === draft.topic) ?? TOPICS[TOPICS.length - 1]!;
  const company = draft.company.trim();
  const subject = company ? `${topic.subject}: ${company}` : topic.subject;
  const signature = [draft.name.trim(), company, draft.email.trim()].filter((line) => line !== '');

  // Some mail apps drop or cut very long mailto links, so shorten the message until the link fits.
  let message = draft.message.trim().replace(/\r?\n/g, '\r\n');
  let href = encodeMailto(subject, message, signature);
  while (href.length > MAX_MAILTO_LENGTH && message.length > 0) {
    message = message.slice(0, Math.floor(message.length * 0.85)).trimEnd();
    href = encodeMailto(subject, `${message}…`, signature);
  }
  return href;
}

/** Longest link the common mail handlers accept reliably. */
export const MAX_MAILTO_LENGTH = 1800;

function encodeMailto(subject: string, message: string, signature: readonly string[]): string {
  // Mail apps expect CRLF line breaks in a mailto body.
  const body = [...(message === '' ? [] : [message, '']), ...signature].join('\r\n');
  const params = new URLSearchParams({ subject, body });
  // URLSearchParams encodes spaces as "+", which mail apps show literally.
  return `mailto:${CONTACT.email}?${params.toString().replace(/\+/g, '%20')}`;
}
