'use client';
/**
 * The next step under a seat limit message (docs/billing/SPEC.md section 6.9): a link to the seat
 * stepper in Portal billing, or "Talk to us" when the plan is Pulse alone. The server writes the
 * sentence; this only recognizes it and adds the way forward, so the message is never a dead end.
 */
import { billingLink } from '@kitstak/billing/links';
import { useOptionalOrg } from './org-context';

export type SeatLimitKind = 'seats' | 'pulse' | 'ask';

/** Recognizes the seat sentences written by `checkSeatAvailable` and the CRM seat check. */
export function seatLimitKind(text: string | null | undefined): SeatLimitKind | null {
  if (!text) return null;
  if (/covers up to \d+ seats/i.test(text)) return 'pulse';
  if (/seats? (is|are) in use/i.test(text)) return /\bAsk\b/.test(text) ? 'ask' : 'seats';
  return null;
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://kitstak.com').replace(/\/+$/, '');
const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3300').replace(/\/+$/, '');

export function SeatLimitLink({ text }: { readonly text: string | null | undefined }) {
  const org = useOptionalOrg();
  const kind = seatLimitKind(text);
  // "Ask Maya Chen to add one." already names the next step for people who cannot change the plan.
  if (kind === null || kind === 'ask') return null;
  const href =
    kind === 'pulse' ? `${SITE_URL}/contact` : billingLink(org?.apps?.urls.portal ?? PORTAL_URL, { to: 'seats' }, 'crm');
  return (
    <a
      href={href}
      data-testid="seat-limit-link"
      className="inline-flex min-h-9 w-fit items-center rounded-md text-sm font-semibold text-fg underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {kind === 'pulse' ? 'Talk to us' : 'Add a seat in Billing'}
    </a>
  );
}
