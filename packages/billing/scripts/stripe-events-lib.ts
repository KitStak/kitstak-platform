/**
 * Local Stripe event forwarding (docs/billing/DEV.md, "Real Stripe test mode"). DEV ONLY.
 *
 * Stripe cannot reach a Portal that runs on a laptop or in a cloud dev container. So the events are
 * fetched from Stripe (`GET /v1/events`) and posted to the Portal's real webhook route, signed the
 * way Stripe signs them, with a signing secret that only exists on this machine. The Portal then runs
 * the same handler it runs in production, on real event bodies.
 *
 * Rules kept here:
 *  - Test mode only. A live key is refused before any request, and an event with `livemode: true`
 *    is never forwarded.
 *  - Read only at Stripe. Nothing here creates, changes or disables a webhook endpoint or any other
 *    Stripe object.
 *  - Events are only ever posted to this machine (localhost).
 *  - No Stripe SDK import: plain `fetch`, so the tool has no dependency and works behind a proxy
 *    when Node runs with NODE_USE_ENV_PROXY=1.
 */
import { createHmac } from 'node:crypto';

export interface StripeEventBody {
  readonly id: string;
  readonly type: string;
  readonly created: number;
  readonly livemode: boolean;
  readonly [key: string]: unknown;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

const STRIPE_API = 'https://api.stripe.com';
const PAGE = 100;
/** Stop after this many pages in one read, so a wrong cursor can never loop for ever. */
const MAX_PAGES = 50;

export class StripeEventsError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'StripeEventsError';
    this.status = status;
    this.code = code;
  }
}

/** Throws unless the key is a Stripe TEST key. A live key never gets as far as a request. */
export function assertTestKey(key: string | undefined | null): string {
  const trimmed = (key ?? '').trim();
  if (trimmed === '') throw new Error('STRIPE_SECRET_KEY is not set.');
  if (/^(sk|rk)_live_/.test(trimmed)) throw new Error('Refused: this is a LIVE Stripe key. This tool is for test mode only.');
  if (!/^(sk|rk)_test_/.test(trimmed)) throw new Error('Refused: STRIPE_SECRET_KEY is not a Stripe test key.');
  return trimmed;
}

/** Throws unless the URL points at this machine. Signed events never leave it. */
export function assertLocalUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }
  const host = parsed.hostname;
  if (parsed.protocol !== 'http:' || (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]')) {
    throw new Error(`Refused: ${parsed.origin} is not this machine. Events are only forwarded to http://localhost.`);
  }
  return parsed;
}

/**
 * The `Stripe-Signature` header for a body, made the way Stripe makes it: an HMAC SHA-256 of
 * `<timestamp>.<body>` with the endpoint's signing secret.
 */
export function signStripePayload(payload: string, secret: string, timestampSeconds: number): string {
  const signature = createHmac('sha256', secret).update(`${timestampSeconds}.${payload}`, 'utf8').digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}

/** Oldest first. Events made in the same second keep the order Stripe listed them in. */
export function oldestFirst(newestFirst: readonly StripeEventBody[]): StripeEventBody[] {
  return [...newestFirst].reverse();
}

function query(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key).replace(/%5B/g, '[').replace(/%5D/g, ']')}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** A small read only Stripe client: `GET` and nothing else. */
export function stripeReader(key: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  const secret = assertTestKey(key);
  return async function get<T = Record<string, unknown>>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const response = await fetchImpl(`${STRIPE_API}${path}${query(params)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new StripeEventsError(`Stripe answered ${response.status} with no JSON.`, response.status, null);
    }
    const error = (body as { error?: { message?: string; code?: string } }).error;
    if (response.status >= 400 || error) {
      throw new StripeEventsError(error?.message ?? `Stripe answered ${response.status}.`, response.status, error?.code ?? null);
    }
    return body as T;
  };
}

export type StripeGet = ReturnType<typeof stripeReader>;

interface EventPage {
  readonly data: StripeEventBody[];
  readonly has_more: boolean;
}

/** Throws when the key answers in live mode. Call once before anything is forwarded. */
export async function assertTestAccount(get: StripeGet): Promise<void> {
  const balance = await get<{ livemode?: boolean }>('/v1/balance');
  if (balance.livemode !== false) throw new Error('Refused: this Stripe key answers in LIVE mode.');
}

/**
 * Every event made after the event `afterId`, oldest first. When there is no cursor yet (or Stripe no
 * longer has that event: it keeps 30 days), every event made at or after `sinceSeconds`.
 */
export async function listNewEvents(
  get: StripeGet,
  cursor: { afterId?: string | null; sinceSeconds: number },
): Promise<StripeEventBody[]> {
  if (cursor.afterId) {
    try {
      const out: StripeEventBody[] = [];
      let before = cursor.afterId;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        // The list is newest first. `ending_before` gives the page just newer than the cursor.
        const answer = await get<EventPage>('/v1/events', { limit: PAGE, ending_before: before });
        if (answer.data.length === 0) break;
        out.push(...oldestFirst(answer.data));
        before = answer.data[0]!.id;
        if (!answer.has_more) break;
      }
      return out;
    } catch (error) {
      if (!(error instanceof StripeEventsError) || error.code !== 'resource_missing') throw error;
      // Stripe no longer has the cursor event. Fall back to the time window below.
    }
  }
  const newest: StripeEventBody[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await get<EventPage>('/v1/events', {
      limit: PAGE,
      'created[gte]': Math.floor(cursor.sinceSeconds),
      ...(after ? { starting_after: after } : {}),
    });
    newest.push(...answer.data);
    if (!answer.has_more || answer.data.length === 0) break;
    after = answer.data[answer.data.length - 1]!.id;
  }
  return oldestFirst(newest);
}

export async function getEvent(get: StripeGet, id: string): Promise<StripeEventBody> {
  if (!/^evt_[A-Za-z0-9_]+$/.test(id)) throw new Error(`Not an event id: ${id}`);
  return get<StripeEventBody>(`/v1/events/${id}`);
}

export interface ForwardResult {
  readonly eventId: string;
  readonly type: string;
  readonly status: number;
  /** `processed`, `duplicate`, `ignored`, `failed` or `bad_signature`, as the Portal answered. */
  readonly result: string;
}

/**
 * Posts one event to the Portal webhook route with a valid signature. The body is the event exactly
 * as Stripe gave it (one JSON text), and the signature covers those exact bytes.
 */
export async function forwardEvent(
  event: StripeEventBody,
  input: { url: string; secret: string; nowSeconds?: number; fetchImpl?: FetchLike },
): Promise<ForwardResult> {
  assertLocalUrl(input.url);
  if (event.livemode !== false) throw new Error(`Refused: event ${event.id} is a LIVE event.`);
  if (!input.secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  const payload = JSON.stringify(event);
  const timestamp = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const response = await (input.fetchImpl ?? (fetch as unknown as FetchLike))(input.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(payload, input.secret, timestamp) },
    body: payload,
  });
  const text = await response.text();
  let result = '';
  try {
    result = String((JSON.parse(text) as { result?: unknown; message?: unknown }).result ?? (JSON.parse(text) as { message?: unknown }).message ?? '');
  } catch {
    result = text.slice(0, 120);
  }
  return { eventId: event.id, type: event.type, status: response.status, result };
}
