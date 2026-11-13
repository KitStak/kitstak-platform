import { CONTACT } from '../site-links';

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
    note: 'A guided tour of the WMS, the CRM or both, using an operation like yours.',
    prompt: 'Which product do you want to see, and what does your operation look like?',
    action: 'Request a walkthrough',
    subject: 'Walkthrough request',
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
