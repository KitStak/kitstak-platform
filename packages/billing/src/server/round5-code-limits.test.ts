/**
 * Review round 5: the limits for email codes. A stranger must not be able to stop the owner of an
 * address from getting a code for a day, and the tries at a code stay counted.
 *
 * Runs against the local dev Postgres. Skipped when it is not reachable.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { openTestDb } from '../testing/db';
import {
  CODE_SEND_GAPS,
  CODE_SEND_MAX_WAIT_SECONDS,
  CODE_SEND_QUIET_SECONDS,
  CODE_TRIES,
  codeSendKey,
  codeSentRecentlyMessage,
  countCodeTry,
  reserveCodeSend,
} from './code-limits';
import { enforceSpacedLimit, waitText } from './rate-limit';

const { pool, db, available } = await openTestDb();
// One test walks a whole day of requests against the real database.
vi.setConfig({ testTimeout: 120_000 });
const tag = `r5limits-${randomUUID().slice(0, 8)}`;
const address = (name: string): string => `${tag}-${name}@kitstak-test.example`;

afterAll(async () => {
  if (available) await pool.query(`DELETE FROM core.rate_limit WHERE key LIKE $1`, [`%${tag}%`]);
  await pool.end();
});

describe('waitText', () => {
  it('rounds up and never names a wait that is too short', () => {
    expect(waitText(0)).toBe('1 second');
    expect(waitText(1)).toBe('1 second');
    expect(waitText(41)).toBe('41 seconds');
    expect(waitText(60)).toBe('1 minute');
    expect(waitText(61)).toBe('2 minutes');
    expect(waitText(600)).toBe('10 minutes');
    expect(codeSentRecentlyMessage(41)).toBe('We sent a code to this address a moment ago. Use that one, or ask for a new one in 41 seconds.');
  });
});

describe.skipIf(!available)('enforceSpacedLimit', () => {
  it('follows the gaps, names the real wait, and a refused call does not move the wait', async () => {
    const key = `billing:test:${tag}:spaced`;
    const gaps = [0, 0, 60, 600];
    const start = 1_800_000_000_000;
    const at = (seconds: number) => enforceSpacedLimit(db, { key, gaps, quietSeconds: 3600, now: start + seconds * 1000 });

    expect(await at(0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(await at(0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    // The third needs a minute since the second.
    expect(await at(1)).toEqual({ allowed: false, retryAfterSeconds: 59 });
    expect(await at(30)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    // Asking 100 more times changes nothing: the wait does not grow.
    for (let i = 0; i < 100; i += 1) await at(31);
    expect(await at(59)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(await at(60)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    // From the fourth on: 10 minutes, and never more than that.
    expect(await at(61)).toEqual({ allowed: false, retryAfterSeconds: 599 });
    expect(await at(660)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(await at(661)).toEqual({ allowed: false, retryAfterSeconds: 599 });
    expect(await at(1260)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    // An hour with no send, and the address is fast again.
    expect(await at(1260 + 3600 + 1)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(await at(1260 + 3600 + 2)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect((await at(1260 + 3600 + 3)).allowed).toBe(false);
  });

  it('two calls at the same moment can not both take the last free slot', async () => {
    const key = `billing:test:${tag}:race`;
    const now = 1_800_000_000_000;
    const results = await Promise.all(Array.from({ length: 12 }, () => enforceSpacedLimit(db, { key, gaps: [0, 60], quietSeconds: 3600, now })));
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
  });
});

describe.skipIf(!available)('email code limits (review round 5)', () => {
  it('never walls an address for a day: after 30 requests by a stranger the wait is at most the largest gap', async () => {
    const email = address('victim');
    const start = 1_800_000_000_000;
    let sent = 0;
    for (let i = 0; i < 30; i += 1) {
      if ((await reserveCodeSend(db, { email, kind: 'forget-password', known: false, now: start + i * 100 })).allowed) sent += 1;
    }
    // Two at once. Not 20, and no counter for the day exists.
    expect(sent).toBe(2);
    const refused = await reserveCodeSend(db, { email, kind: 'forget-password', known: false, now: start + 3_000 });
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);

    // A stranger who keeps asking for a whole day: the owner still never waits longer than the largest gap.
    let now = start + 3_000;
    let worst = 0;
    let mails = sent;
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      now += 60_000;
      const slot = await reserveCodeSend(db, { email, kind: 'forget-password', known: false, now });
      if (slot.allowed) mails += 1;
      else worst = Math.max(worst, slot.retryAfterSeconds);
    }
    expect(worst).toBeLessThanOrEqual(CODE_SEND_MAX_WAIT_SECONDS);
    expect(CODE_SEND_MAX_WAIT_SECONDS).toBe(1800);
    // The mailbox is still protected: about two an hour once the address is busy, not one a minute.
    expect(mails).toBeLessThan(70);
    const dayKeys = await pool.query(`SELECT key FROM core.rate_limit WHERE key LIKE $1 AND key LIKE '%day%'`, [`%${email}%`]);
    expect(dayKeys.rows).toEqual([]);
  });

  it('a stranger can not use up the sends of a browser the account knows, nor of another kind of code', async () => {
    const email = address('owner');
    const now = 1_800_000_000_000;
    for (let i = 0; i < 30; i += 1) await reserveCodeSend(db, { email, kind: 'sign-in', known: false, now });
    expect((await reserveCodeSend(db, { email, kind: 'sign-in', known: false, now })).allowed).toBe(false);
    // The owner on a known browser: a sign in code at once.
    expect(await reserveCodeSend(db, { email, kind: 'sign-in', known: true, now })).toEqual({ allowed: true, retryAfterSeconds: 0 });
    // And a reset code, for anyone: each kind of code has its own count.
    expect((await reserveCodeSend(db, { email, kind: 'forget-password', known: false, now })).allowed).toBe(true);
    expect(codeSendKey({ email: ` ${email.toUpperCase()} `, kind: 'sign-in', known: true })).toBe(`billing:code-send:known:sign-in:${email}`);
  });

  it('the answer is the same for an address with no account (nothing is looked up)', async () => {
    const now = 1_800_000_000_000;
    const a = address('exists');
    const b = address('does-not-exist');
    const run = async (email: string) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i += 1) out.push((await reserveCodeSend(db, { email, kind: 'sign-in', known: false, now })).allowed);
      return out;
    };
    expect(await run(a)).toEqual(await run(b));
  });

  it('tries at a code stay counted per address, and 31 wrong tries by a stranger leave a known browser its own tries', async () => {
    const email = address('guessed');
    // The short count is the smaller one. It is cleared here to stand in for a stranger who paces the tries.
    const clearShort = () => pool.query(`DELETE FROM core.rate_limit WHERE key = $1`, [`billing:code-signin:${email}`]);
    for (let i = 0; i < CODE_TRIES['sign-in'].day; i += 1) {
      if (i % CODE_TRIES['sign-in'].short === 0) await clearShort();
      expect((await countCodeTry(db, { email, kind: 'sign-in', known: false })).allowed).toBe(true);
    }
    await clearShort();
    const refused = await countCodeTry(db, { email, kind: 'sign-in', known: false });
    expect(refused.allowed).toBe(false);
    expect(refused.message).toBe('Too many codes were tried for this address today. Use a browser you have signed in with before, or try again tomorrow.');
    // The owner on a browser the account knows is not touched by any of it.
    expect(await countCodeTry(db, { email, kind: 'sign-in', known: true })).toEqual({ allowed: true, message: '' });
  });

  it('the short count names a true wait of 10 minutes', async () => {
    const email = address('short');
    for (let i = 0; i < CODE_TRIES['email-verification'].short; i += 1) {
      expect((await countCodeTry(db, { email, kind: 'email-verification', known: false })).allowed).toBe(true);
    }
    expect(await countCodeTry(db, { email, kind: 'email-verification', known: false })).toEqual({
      allowed: false,
      message: 'Too many tries. Wait 10 minutes and try again.',
    });
  });

  it('guessing is not easier than before round 5: the tries a day stay at or under the old ceilings', () => {
    // Before: 30 tries a day at sign in codes, and 20 reset codes a day with 5 tries each.
    expect(CODE_TRIES['sign-in'].day).toBeLessThanOrEqual(30);
    expect(CODE_TRIES['forget-password'].day).toBeLessThanOrEqual(100);
    expect(CODE_TRIES['email-verification'].day).toBeLessThanOrEqual(100);
    expect(CODE_SEND_GAPS[0]).toBe(0);
    expect(CODE_SEND_QUIET_SECONDS).toBeGreaterThanOrEqual(CODE_SEND_MAX_WAIT_SECONDS);
  });
});
