/**
 * The dev only tool that forwards real Stripe test events to the local Portal
 * (scripts/stripe-events-lib.ts). No network: Stripe and the Portal are small fakes here.
 */
import { describe, expect, it } from 'vitest';
import {
  assertLocalUrl,
  assertTestAccount,
  assertTestKey,
  type FetchLike,
  forwardEvent,
  getEvent,
  listNewEvents,
  signStripePayload,
  type StripeEventBody,
  stripeReader,
} from '../scripts/stripe-events-lib';
import { createStripeGateway } from '../src/gateway/stripe';
import { WebhookSignatureError } from '../src/gateway/types';
import type { BillingConfig } from '../src/server/config';

const SECRET = 'whsec_local_0123456789abcdef';
const CONFIG: BillingConfig = {
  mode: 'stripe_test',
  stripeSecretKey: 'sk_test_not_a_real_key',
  stripeWebhookSecret: SECRET,
  stripePortalConfigurationId: null,
  automaticTax: false,
  testWebhookSecret: 'unused',
};

const event = (id: string, created: number, extra: Record<string, unknown> = {}): StripeEventBody => ({
  id,
  object: 'event',
  type: 'customer.subscription.updated',
  created,
  livemode: false,
  data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1', metadata: {} } },
  ...extra,
});

/** A fake `GET /v1/events`: newest first, with `ending_before`, `starting_after`, `created[gte]` and `limit`. */
function fakeStripe(all: StripeEventBody[], calls: string[] = []): FetchLike {
  const newestFirst = [...all].sort((a, b) => b.created - a.created);
  return async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.stripe.com', '')}`);
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/balance') return { status: 200, text: async () => JSON.stringify({ livemode: false }) };
    if (parsed.pathname.startsWith('/v1/events/')) {
      const found = all.find((entry) => entry.id === parsed.pathname.split('/').pop());
      return found
        ? { status: 200, text: async () => JSON.stringify(found) }
        : { status: 404, text: async () => JSON.stringify({ error: { code: 'resource_missing', message: 'No such event' } }) };
    }
    const limit = Number(parsed.searchParams.get('limit') ?? 10);
    const before = parsed.searchParams.get('ending_before');
    const after = parsed.searchParams.get('starting_after');
    const since = Number(parsed.searchParams.get('created[gte]') ?? 0);
    let list = newestFirst.filter((entry) => entry.created >= since);
    if (before) {
      const index = list.findIndex((entry) => entry.id === before);
      if (index < 0) return { status: 404, text: async () => JSON.stringify({ error: { code: 'resource_missing', message: 'No such event' } }) };
      const newer = list.slice(0, index);
      const page = newer.slice(Math.max(0, newer.length - limit));
      return { status: 200, text: async () => JSON.stringify({ data: page, has_more: newer.length > limit }) };
    }
    if (after) list = list.slice(list.findIndex((entry) => entry.id === after) + 1);
    return { status: 200, text: async () => JSON.stringify({ data: list.slice(0, limit), has_more: list.length > limit }) };
  };
}

describe('stripe-events: the signature', () => {
  it('is one the Portal\'s real webhook check accepts', () => {
    const gateway = createStripeGateway(CONFIG);
    const body = JSON.stringify(event('evt_1', 1_795_000_000));
    const header = signStripePayload(body, SECRET, Math.floor(Date.now() / 1000));
    const verified = gateway.verifyWebhook(body, header);
    expect(verified).toMatchObject({ id: 'evt_1', type: 'customer.subscription.updated', customerId: 'cus_1', subscriptionId: 'sub_1' });
  });

  it('made with another secret, or for another body, is refused', () => {
    const gateway = createStripeGateway(CONFIG);
    const body = JSON.stringify(event('evt_1', 1_795_000_000));
    const now = Math.floor(Date.now() / 1000);
    expect(() => gateway.verifyWebhook(body, signStripePayload(body, 'whsec_other', now))).toThrow(WebhookSignatureError);
    expect(() => gateway.verifyWebhook(`${body} `, signStripePayload(body, SECRET, now))).toThrow(WebhookSignatureError);
    // An old timestamp is refused too (replay protection).
    expect(() => gateway.verifyWebhook(body, signStripePayload(body, SECRET, now - 3600))).toThrow(WebhookSignatureError);
  });
});

describe('stripe-events: test mode and this machine only', () => {
  it('refuses a live key and anything that is not a Stripe test key', () => {
    expect(assertTestKey('sk_test_abc')).toBe('sk_test_abc');
    expect(assertTestKey(' rk_test_abc ')).toBe('rk_test_abc');
    expect(() => assertTestKey('sk_live_abc')).toThrow(/LIVE/);
    expect(() => assertTestKey('rk_live_abc')).toThrow(/LIVE/);
    expect(() => assertTestKey('pk_test_abc')).toThrow(/not a Stripe test key/);
    expect(() => assertTestKey('')).toThrow(/not set/);
    expect(() => stripeReader('sk_live_abc')).toThrow(/LIVE/);
  });

  it('refuses an account that answers in live mode', async () => {
    const live: FetchLike = async () => ({ status: 200, text: async () => JSON.stringify({ livemode: true }) });
    await expect(assertTestAccount(stripeReader('sk_test_x', live))).rejects.toThrow(/LIVE mode/);
    await expect(assertTestAccount(stripeReader('sk_test_x', fakeStripe([])))).resolves.toBeUndefined();
  });

  it('only forwards to localhost', async () => {
    expect(assertLocalUrl('http://localhost:3300/api/billing/webhooks/stripe').port).toBe('3300');
    expect(() => assertLocalUrl('https://kitstak.app/api/billing/webhooks/stripe')).toThrow(/not this machine/);
    expect(() => assertLocalUrl('http://localhost.evil.example/x')).toThrow(/not this machine/);
    expect(() => assertLocalUrl('nonsense')).toThrow(/Not a URL/);
    const sent: string[] = [];
    const portal: FetchLike = async (url) => {
      sent.push(url);
      return { status: 200, text: async () => '{"ok":true,"result":"processed"}' };
    };
    await expect(forwardEvent(event('evt_1', 1), { url: 'https://example.com/hook', secret: SECRET, fetchImpl: portal })).rejects.toThrow(/not this machine/);
    expect(sent).toEqual([]);
  });

  it('never forwards a live event', async () => {
    const sent: string[] = [];
    const portal: FetchLike = async (url) => {
      sent.push(url);
      return { status: 200, text: async () => '{}' };
    };
    await expect(
      forwardEvent(event('evt_live', 1, { livemode: true }), { url: 'http://localhost:3300/api/billing/webhooks/stripe', secret: SECRET, fetchImpl: portal }),
    ).rejects.toThrow(/LIVE event/);
    expect(sent).toEqual([]);
  });

  it('only ever reads from Stripe', async () => {
    const calls: string[] = [];
    const get = stripeReader('sk_test_x', fakeStripe([event('evt_1', 10)], calls));
    await assertTestAccount(get);
    await listNewEvents(get, { sinceSeconds: 0 });
    await getEvent(get, 'evt_1');
    expect(calls.every((call) => call.startsWith('GET '))).toBe(true);
    await expect(getEvent(get, '../webhook_endpoints')).rejects.toThrow(/Not an event id/);
  });
});

describe('stripe-events: reading new events in order', () => {
  const all = Array.from({ length: 250 }, (_, index) => event(`evt_${String(index + 1).padStart(3, '0')}`, 1000 + index));

  it('with no cursor: everything since the given time, oldest first', async () => {
    const events = await listNewEvents(stripeReader('sk_test_x', fakeStripe(all)), { sinceSeconds: 1200 });
    expect(events).toHaveLength(50);
    expect(events[0]!.id).toBe('evt_201');
    expect(events[49]!.id).toBe('evt_250');
  });

  it('with a cursor: only what came after it, oldest first, across pages', async () => {
    const events = await listNewEvents(stripeReader('sk_test_x', fakeStripe(all)), { afterId: 'evt_010', sinceSeconds: 0 });
    expect(events).toHaveLength(240);
    expect(events.map((entry) => entry.id)).toEqual(all.slice(10).map((entry) => entry.id));
  });

  it('nothing new: an empty list', async () => {
    expect(await listNewEvents(stripeReader('sk_test_x', fakeStripe(all)), { afterId: 'evt_250', sinceSeconds: 0 })).toEqual([]);
  });

  it('a cursor Stripe no longer has falls back to the time window', async () => {
    const events = await listNewEvents(stripeReader('sk_test_x', fakeStripe(all)), { afterId: 'evt_gone', sinceSeconds: 1245 });
    expect(events.map((entry) => entry.id)).toEqual(['evt_246', 'evt_247', 'evt_248', 'evt_249', 'evt_250']);
  });
});

describe('stripe-events: forwarding', () => {
  it('posts the event body as it is, with a signature over those exact bytes', async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const portal: FetchLike = async (url, init) => {
      seen.push({ url, headers: init?.headers ?? {}, body: init?.body ?? '' });
      return { status: 200, text: async () => '{"ok":true,"result":"processed"}' };
    };
    const original = event('evt_9', 1_795_000_000);
    const now = Math.floor(Date.now() / 1000);
    const result = await forwardEvent(original, { url: 'http://localhost:3300/api/billing/webhooks/stripe', secret: SECRET, nowSeconds: now, fetchImpl: portal });
    expect(result).toEqual({ eventId: 'evt_9', type: 'customer.subscription.updated', status: 200, result: 'processed' });
    expect(JSON.parse(seen[0]!.body)).toEqual(original);
    expect(seen[0]!.headers['stripe-signature']).toBe(signStripePayload(seen[0]!.body, SECRET, now));
    // The real check accepts exactly what was posted.
    expect(createStripeGateway(CONFIG).verifyWebhook(seen[0]!.body, seen[0]!.headers['stripe-signature']!).id).toBe('evt_9');
  });

  it('reports what the Portal answered, also when it is not 200', async () => {
    const portal = (status: number, body: string): FetchLike => async () => ({ status, text: async () => body });
    const target = { url: 'http://localhost:3300/api/billing/webhooks/stripe', secret: SECRET };
    expect(await forwardEvent(event('evt_1', 1), { ...target, fetchImpl: portal(200, '{"ok":true,"result":"duplicate"}') })).toMatchObject({ status: 200, result: 'duplicate' });
    expect(await forwardEvent(event('evt_1', 1), { ...target, fetchImpl: portal(500, '{"ok":false,"result":"failed"}') })).toMatchObject({ status: 500, result: 'failed' });
    expect(await forwardEvent(event('evt_1', 1), { ...target, fetchImpl: portal(400, '{"ok":false,"result":"bad_signature"}') })).toMatchObject({ status: 400, result: 'bad_signature' });
    expect(await forwardEvent(event('evt_1', 1), { ...target, fetchImpl: portal(503, '{"ok":false,"message":"Stripe is not set up on this server. Nothing was processed."}') })).toMatchObject({ status: 503 });
  });
});
