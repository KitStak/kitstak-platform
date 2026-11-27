/** Account emails: the two 6 digit codes and the invite (docs/billing/SPEC.md section 10). */
import type { EmailContent } from '../layout';
import { CATALOG, isProductId } from '../../catalog';
import { billingLink } from '../../links';
import { EmailPayloadError, asPayload, date, day, optionalText, orgOf, portal, text, wholeNumber } from './shared';

const CODE_RE = /^\d{4,8}$/;

function code(payload: Readonly<Record<string, unknown>>): string {
  const value = text(payload, 'code', 12);
  // A code that was wiped after sending can never be sent again.
  if (!CODE_RE.test(value)) throw new EmailPayloadError('The code is missing. It was already sent or wiped.');
  return value;
}

function minutesWords(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function verifyEmail(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const otp = code(payload);
  const minutes = wholeNumber(payload, 'minutes');
  // The same email carries a sign in code ("Email me a code instead"). Only the two sentences that
  // say what the code is for, and why the email came, change.
  const signIn = payload.purpose === 'sign_in';
  return {
    subject: `Your KitStak code: ${otp}`,
    preheader: `It works for ${minutesWords(minutes)}.`,
    heading: 'Your code',
    blocks: [
      { kind: 'text', text: signIn ? 'Enter this code to sign in to KitStak.' : 'Enter this code to verify your email.' },
      { kind: 'code', code: otp },
      { kind: 'text', text: `It works for ${minutesWords(minutes)}.` },
      {
        kind: 'note',
        text: signIn ? 'If you did not ask for this, ignore this email. Nobody can sign in without the code.' : 'If you did not ask for this, ignore this email.',
      },
    ],
    button: null,
    footer: signIn
      ? 'You get this email because someone asked to sign in to KitStak with this address.'
      : 'You get this email because someone used this address to sign up for KitStak.',
  };
}

export function resetPassword(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const otp = code(payload);
  const minutes = wholeNumber(payload, 'minutes');
  return {
    subject: 'Reset your KitStak password',
    preheader: `Your code works for ${minutesWords(minutes)}.`,
    heading: 'Reset your password',
    blocks: [
      { kind: 'text', text: 'Enter this code to set a new password.' },
      { kind: 'code', code: otp },
      { kind: 'text', text: `It works for ${minutesWords(minutes)}.` },
      { kind: 'note', text: 'If you did not ask for this, ignore this email. Your password stays the same.' },
    ],
    button: null,
    footer: 'You get this email because someone asked to reset the password for this address.',
  };
}

export function invitation(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const inviterName = text(payload, 'inviterName', 120);
  const expiresAt = date(payload, 'expiresAt');
  portal(payload);
  return {
    subject: `${inviterName} invited you to ${orgName} on KitStak`,
    preheader: `Accept by ${day(expiresAt)} to join the team.`,
    heading: `Join ${orgName} on KitStak`,
    blocks: [
      { kind: 'text', text: `${inviterName} invited you to work with ${orgName} on KitStak.` },
      { kind: 'text', text: `This invite works until ${day(expiresAt)}.` },
      { kind: 'note', text: 'If you were not expecting this, you can ignore this email.' },
    ],
    button: { label: 'Accept invite', url: text(payload, 'acceptUrl', 500) },
    footer: `You get this email because ${inviterName} invited this address to KitStak.`,
  };
}

/** "Ana Reyes asked for Projects": sent to the people who can change the plan, at most once a day per app. */
export function appRequest(raw: unknown): EmailContent {
  const payload = asPayload(raw);
  const orgName = text(payload, 'orgName', 120);
  const askerName = text(payload, 'askerName', 120);
  const product = text(payload, 'product', 40);
  if (!isProductId(product)) throw new EmailPayloadError('The email payload names no app.');
  const name = CATALOG.products[product].shortName;
  const portalUrl = portal(payload);
  const priceLine = optionalText(payload, 'priceLine', 200);
  return {
    subject: `${askerName} asked for ${name}`,
    preheader: `Add ${name} to the plan for ${orgName} in two clicks.`,
    heading: `${askerName} asked for ${name}`,
    blocks: [
      { kind: 'text', text: `${askerName} would like to use ${name} at ${orgName}. It is not in your plan yet.` },
      ...(priceLine ? [{ kind: 'text' as const, text: priceLine }] : []),
      { kind: 'note', text: 'You see the price before anything is added. Nothing changes until you confirm.' },
    ],
    button: { label: `Add ${name}`, url: billingLink(portalUrl, { to: 'add', product }, undefined, orgOf(payload)) },
    footer: `You get this email because you manage billing for ${orgName} on KitStak.`,
  };
}
