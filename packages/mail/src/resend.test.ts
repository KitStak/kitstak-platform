import { describe, expect, it } from 'vitest';
import {
  idempotencyKeyFor,
  resendReady,
  resolveEmailProvider,
  sendWithResend,
  type FetchLike,
} from './resend';

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;
const READY = env({ RESEND_API_KEY: 're_test_123', EMAIL_FROM: 'KitStak <onboarding@resend.dev>' });
const MESSAGE = { to: 'ana@example.com', subject: 'Reset your password', text: 'Open this link.' };

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function fakeResend(status: number, body: string) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    return { status, text: async () => body };
  };
  return { fetch, calls };
}

describe('resolveEmailProvider', () => {
  it.each([
    [{ RESEND_API_KEY: 're_x' }, 'resend'],
    [{ RESEND_API_KEY: 're_x', EMAIL_PROVIDER: 'RESEND' }, 'resend'],
    [{ RESEND_API_KEY: 're_x', EMAIL_PROVIDER: 'outbox' }, 'outbox'],
    [{ RESEND_API_KEY: 're_x', EMAIL_PROVIDER: 'outbox', NODE_ENV: 'production' }, 'resend'],
    [{ RESEND_API_KEY: '   ' }, 'outbox'],
    [{}, 'outbox'],
    [{ NODE_ENV: 'production' }, 'none'],
  ] as const)('%o gives %s', (values, expected) => {
    expect(resolveEmailProvider(env(values))).toBe(expected);
  });
});

describe('resendReady', () => {
  it('needs both the key and a sender', () => {
    expect(resendReady(READY)).toBe(true);
    expect(resendReady(env({ RESEND_API_KEY: 're_x' }))).toBe(false);
    expect(resendReady(env({ EMAIL_FROM: 'a@b.c' }))).toBe(false);
  });

  it('is false when the outbox is chosen locally', () => {
    expect(resendReady(env({ ...READY, EMAIL_PROVIDER: 'outbox' }))).toBe(false);
  });
});

describe('sendWithResend', () => {
  it('posts the message to Resend with the key and returns the message id', async () => {
    const { fetch, calls } = fakeResend(200, '{"id":"msg_1"}');
    const result = await sendWithResend(MESSAGE, { env: READY, fetch });

    expect(result).toEqual({ ok: true, messageId: 'msg_1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.Authorization).toBe('Bearer re_test_123');
    expect(calls[0]!.body).toEqual({
      from: 'KitStak <onboarding@resend.dev>',
      to: ['ana@example.com'],
      subject: 'Reset your password',
      text: 'Open this link.',
    });
  });

  it('sends html, an idempotency key and a reply-to when given', async () => {
    const { fetch, calls } = fakeResend(200, '{"id":"msg_2"}');
    await sendWithResend(
      { ...MESSAGE, html: '<p>Open</p>', dedupeKey: 'reset:1', replyTo: 'ops@acme.test' },
      { env: env({ ...READY, EMAIL_REPLY_TO: 'help@kitstak.test' }), fetch },
    );

    expect(calls[0]!.headers['Idempotency-Key']).toBe(idempotencyKeyFor('reset:1'));
    expect(calls[0]!.body.html).toBe('<p>Open</p>');
    expect(calls[0]!.body.reply_to).toBe('ops@acme.test');
  });

  it('falls back to EMAIL_REPLY_TO and sends no idempotency key without a dedupe key', async () => {
    const { fetch, calls } = fakeResend(200, '{}');
    const result = await sendWithResend(MESSAGE, {
      env: env({ ...READY, EMAIL_REPLY_TO: 'help@kitstak.test' }),
      fetch,
    });

    expect(result).toEqual({ ok: true, messageId: null });
    expect(calls[0]!.headers['Idempotency-Key']).toBeUndefined();
    expect(calls[0]!.body.reply_to).toBe('help@kitstak.test');
  });

  it('does not call Resend without a key or a sender', async () => {
    const { fetch, calls } = fakeResend(200, '{}');
    expect(await sendWithResend(MESSAGE, { env: env({ EMAIL_FROM: 'a@b.c' }), fetch })).toMatchObject({
      ok: false,
      kind: 'config',
    });
    expect(await sendWithResend(MESSAGE, { env: env({ RESEND_API_KEY: 're_x' }), fetch })).toMatchObject({
      ok: false,
      kind: 'config',
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses an empty address without calling Resend', async () => {
    const { fetch, calls } = fakeResend(200, '{}');
    expect(await sendWithResend({ ...MESSAGE, to: '  ' }, { env: READY, fetch })).toMatchObject({
      ok: false,
      kind: 'fatal',
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, 'config'],
    [403, 'config'],
    [429, 'config'],
    [400, 'fatal'],
    [409, 'fatal'],
    [422, 'fatal'],
    [500, 'retry'],
    [503, 'retry'],
  ] as const)('classifies status %i as %s', async (status, kind) => {
    const { fetch } = fakeResend(
      status,
      '{"name":"validation_error","message":"The domain is not verified"}',
    );
    const result = await sendWithResend(MESSAGE, { env: READY, fetch });

    expect(result).toEqual({
      ok: false,
      kind,
      error: `Resend answered ${status}. validation_error: The domain is not verified`,
    });
  });

  it('reports a network failure as retry and never leaks the key', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('socket hang up');
    };
    const result = await sendWithResend(MESSAGE, { env: READY, fetch });

    expect(result).toEqual({ ok: false, kind: 'retry', error: 'Could not reach Resend. socket hang up' });
    expect(JSON.stringify(result)).not.toContain('re_test_123');
  });
});

describe('idempotencyKeyFor', () => {
  it('is stable and inside the 256 character limit', () => {
    const long = 'x'.repeat(1000);
    expect(idempotencyKeyFor(long)).toBe(idempotencyKeyFor(long));
    expect(idempotencyKeyFor(long).length).toBeLessThanOrEqual(256);
    expect(idempotencyKeyFor('a')).not.toBe(idempotencyKeyFor('b'));
  });
});
