/**
 * Limits for the 6 digit email codes: verify an address, reset a password, sign in (billing review
 * round 5). Two things are protected, and they need different limits.
 *
 * 1. The mailbox, from spam. Sends for one address are SPACED (`enforceSpacedLimit`): a few at
 *    once, then one a minute, then one every 10 minutes, then one every 30 minutes. That is never a
 *    wall for a day. Before this, one budget of 20 sends a day covered every kind of code, and any
 *    stranger could use it up: the owner of an account with no password was then locked out until
 *    the next day, and the screen still said a code was on its way.
 *
 * 2. The code, from guessing. A code has a million values and allows 5 tries. On top of that the
 *    tries for one address are counted. That count is a wall on purpose: without it a patient
 *    guesser gets thousands of tries a day.
 *
 * So that neither limit can be turned against the owner, every count exists twice: one for callers
 * nobody knows ("any"), and one for KNOWN callers: a browser that signed in to this very account
 * before (a signed cookie the Portal sets at sign in) or one that is signed in to it right now. A
 * stranger can fill the first and can never touch the second. The owner on a browser they have
 * used before always gets a code and always gets their tries.
 *
 * What a stranger can still do, said plainly: slow the owner down on a browser the account has
 * never been used on (a wait of at most `CODE_SEND_MAX_WAIT_SECONDS` for a new code, while the
 * newest code is already in the mailbox), and use up the tries for unknown browsers for a day.
 * Both stop at the first sign in from that browser.
 */
import type { BillingDb } from './db';
import { enforceRateLimit, enforceSpacedLimit, waitText } from './rate-limit';

export type CodeKind = 'sign-in' | 'email-verification' | 'forget-password';

/** Seconds since the last send before the next one, by how many went out in this busy period. */
export const CODE_SEND_GAPS: readonly number[] = [0, 0, 60, 60, 60, 600, 600, 600, 600, 600, 600, 600, 1800];
/** A busy period ends after an hour with no send. */
export const CODE_SEND_QUIET_SECONDS = 3600;
/** The longest anyone waits for the next code. */
export const CODE_SEND_MAX_WAIT_SECONDS = Math.max(...CODE_SEND_GAPS);

/** Tries at a code for one address: per 10 minutes and per day, right or wrong. */
export const CODE_TRIES: Record<CodeKind, { readonly short: number; readonly day: number }> = {
  'sign-in': { short: 10, day: 30 },
  'email-verification': { short: 10, day: 30 },
  // 20 codes a day with 5 tries each was the most a day could hold before round 5. Kept.
  'forget-password': { short: 10, day: 100 },
};

export const CODE_SENT_RECENTLY = 'CODE_SENT_RECENTLY';
export const CODE_TRIES_USED_UP = 'CODE_TRIES_USED_UP';

function clean(email: string): string {
  return email.trim().toLowerCase();
}

function who(known: boolean): 'known' | 'any' {
  return known ? 'known' : 'any';
}

/** The key of the send counter. Exported for tests and for the dev reset script. */
export function codeSendKey(input: { email: string; kind: CodeKind; known: boolean }): string {
  return `billing:code-send:${who(input.known)}:${input.kind}:${clean(input.email)}`;
}

/**
 * May a code of this kind be mailed to this address now? Counted whether or not the address has an
 * account, so the answer gives nothing away. When it is refused, the newest code of this kind is at
 * most `retryAfterSeconds` away and an older one is already in the mailbox.
 */
export async function reserveCodeSend(
  db: BillingDb,
  input: { email: string; kind: CodeKind; known: boolean; now?: number },
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  return enforceSpacedLimit(db, {
    key: codeSendKey(input),
    gaps: CODE_SEND_GAPS,
    quietSeconds: CODE_SEND_QUIET_SECONDS,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/** The one sentence for "no new code was sent", with the real wait. The same for every address. */
export function codeSentRecentlyMessage(retryAfterSeconds: number): string {
  return `We sent a code to this address a moment ago. Use that one, or ask for a new one in ${waitText(retryAfterSeconds)}.`;
}

/**
 * Counts one try at a code for this address. `allowed: false` means the try must not reach the
 * code at all. The message says the true wait: 10 minutes for the short count, tomorrow for the day
 * count.
 */
export async function countCodeTry(
  db: BillingDb,
  input: { email: string; kind: CodeKind; known: boolean },
): Promise<{ allowed: boolean; message: string }> {
  const email = clean(input.email);
  const limits = CODE_TRIES[input.kind];
  // The keys of callers nobody knows are the ones from before round 5 for sign in codes.
  const base =
    input.kind === 'sign-in' ? 'billing:code-signin' : input.kind === 'forget-password' ? 'billing:code-reset' : 'billing:code-verify';
  const suffix = input.known ? '-known' : '';
  const short = await enforceRateLimit(db, { key: `${base}${suffix}:${email}`, windowSeconds: 600, max: limits.short });
  const day = await enforceRateLimit(db, { key: `${base}${suffix}-day:${email}`, windowSeconds: 86_400, max: limits.day });
  if (!day) {
    return {
      allowed: false,
      message: input.known
        ? 'Too many codes were tried for this address today. Try again tomorrow.'
        : 'Too many codes were tried for this address today. Use a browser you have signed in with before, or try again tomorrow.',
    };
  }
  if (!short) return { allowed: false, message: 'Too many tries. Wait 10 minutes and try again.' };
  return { allowed: true, message: '' };
}
