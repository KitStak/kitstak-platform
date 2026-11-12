/**
 * Forgot/reset rate limiting is keyed on the spoof-resistant `rateIp` (auth review
 * 2026-11-11, H2): rotating `X-Forwarded-For` must NOT open a fresh bucket (without
 * TRUST_PROXY every untrusted client shares the "direct" bucket), and the forgot route
 * additionally buckets per TARGET email so one mailbox cannot be mail-bombed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AppDb } from '@/server/api/db';
import { seededDb, type SeededDb } from './fixtures';

let current: SeededDb;
vi.mock('@/server/api/db', () => ({ getAppDb: async (): Promise<AppDb> => current.db }));

const { POST: forgotPost } = await import('@/app/api/auth/forgot/route');
const { POST: resetPost } = await import('@/app/api/auth/reset/route');

const BASE = 'http://localhost:3000';
let spoofCounter = 0;

/** Same-origin request whose X-Forwarded-For rotates on every call (the H2 attack). */
function spoofedRequest(path: string, body: unknown): NextRequest {
  spoofCounter += 1;
  return new NextRequest(`${BASE}${path}`, {
    method: 'POST',
    headers: new Headers({
      host: 'localhost:3000',
      origin: BASE,
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.${Math.floor(spoofCounter / 250)}.${(spoofCounter % 250) + 1}`,
    }),
    body: JSON.stringify(body),
  });
}

describe('forgot/reset rate limiting (spoof-resistant rateIp)', () => {
  beforeEach(() => {
    // Without a trusted proxy, rateIp must collapse every client to "direct".
    delete process.env.TRUST_PROXY;
  });
  afterEach(async () => {
    await current.close();
  });

  it('forgot: rotating X-Forwarded-For does not reset the bucket (429 after the limit)', async () => {
    current = await seededDb();
    // Unknown emails: no mail is sent, but every request must count against the SHARED
    // direct bucket (limit 5/15min) despite a fresh spoofed address each time.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await forgotPost(spoofedRequest('/api/auth/forgot', { email: `ghost${i}@example.com` }));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it('forgot: the per-target-email bucket limits mail to one mailbox independently', async () => {
    current = await seededDb();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await forgotPost(spoofedRequest('/api/auth/forgot', { email: 'victim@example.com' }));
      statuses.push(res.status);
    }
    // Email bucket (3/15min) trips before the IP bucket (5/15min) does.
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('reset: token attempts share the direct bucket despite spoofed addresses', async () => {
    current = await seededDb();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await resetPost(
        spoofedRequest('/api/auth/reset', {
          token: `not-a-real-token-${String(i).padStart(2, '0')}-abcdef`,
          password: 'Brand!new2026pass',
        }),
      );
      statuses.push(res.status);
    }
    // Invalid tokens answer 400 while within the limit; the 6th is throttled.
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
  });
});
