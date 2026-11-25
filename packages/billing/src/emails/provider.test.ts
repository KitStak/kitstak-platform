import { describe, expect, it } from 'vitest';
import { idempotencyKeyFor, resolveEmailProvider, sendWithResend, type FetchLike } from './provider';

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;
const EMAIL = { subject: 'Your KitStak receipt for $29.00', html: '<p>Hi</p>', text: 'Hi' };

function fakeFetch(status: number, body: string) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    return { status, text: async () => body };
  };
  return { fetch, calls };
}

describe('resolveEmailProvider (CONTRACTS 13.2)', () => {
  it.each([
    [{ RESEND_API_KEY: 're_x' }, 'resend'],
    [{ RESEND_API_KEY: 're_x', EMAIL_PROVIDER: 'resend' }, 'resend'],
    [{ RESEND_API_KEY: 're_x', NODE_ENV: 'production' }, 'resend'],
    [{ RESEND_API_KEY: 're_x', EMAIL_PROVIDER: 'outbox', NODE_ENV: 'development' }, 'outbox'],
    // The outbox stores whole emails in the database. It never runs in production.
    [{ RESEND_API_KEY: 're_x', EMAIL_PROVIDER: 'outbox', NODE_ENV: 'production' }, 'resend'],
    [{ NODE_ENV: 'development' }, 'outbox'],
    [{ NODE_ENV: 'test', EMAIL_PROVIDER: 'outbox' }, 'outbox'],
    [{ EMAIL_PROVIDER: 'resend' }, 'outbox'],
    [{ RESEND_API_KEY: '   ' }, 'outbox'],
    [{ NODE_ENV: 'production' }, 'none'],
    [{ NODE_ENV: 'production', EMAIL_PROVIDER: 'outbox' }, 'none'],
    [{ NODE_ENV: 'production', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '' }, 'none'],
  ] as const)('%j gives %s', (values, expected) => {
    expect(resolveEmailProvider(env(values))).toBe(expected);
  });
});

describe('sendWithResend', () => {
  const good = env({ RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'KitStak <billing@mail.example>', EMAIL_REPLY_TO: 'help@mail.example' });

  it('posts to Resend with the key, an idempotency key, and both bodies', async () => {
    const { fetch, calls } = fakeFetch(200, '{"id":"msg_123"}');
    const result = await sendWithResend({ to: 'maya@northwind.example', email: EMAIL, dedupeKey: 'receipt:in_1:maya@northwind.example' }, { env: good, fetch });
    expect(result).toEqual({ ok: true, messageId: 'msg_123' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.headers.Authorization).toBe('Bearer re_test_key');
    expect(calls[0]!.headers['Idempotency-Key']).toBe(idempotencyKeyFor('receipt:in_1:maya@northwind.example'));
    expect(calls[0]!.body).toEqual({
      from: 'KitStak <billing@mail.example>',
      to: ['maya@northwind.example'],
      subject: EMAIL.subject,
      html: EMAIL.html,
      text: EMAIL.text,
      reply_to: 'help@mail.example',
    });
  });

  it('makes an idempotency key that fits Resend (256 characters) for any dedupe key', () => {
    const key = idempotencyKeyFor(`code:verify_email:${'a'.repeat(400)}@example.com:1`);
    expect(key.length).toBeLessThanOrEqual(256);
    expect(key).toBe(idempotencyKeyFor(`code:verify_email:${'a'.repeat(400)}@example.com:1`));
    expect(key).not.toBe(idempotencyKeyFor('other'));
  });

  it('needs a key and a sender, and says which one is missing', async () => {
    const { fetch, calls } = fakeFetch(200, '{}');
    await expect(sendWithResend({ to: 'a@b.example', email: EMAIL, dedupeKey: 'k' }, { env: env({}), fetch })).resolves.toEqual({
      ok: false,
      kind: 'config',
      error: 'RESEND_API_KEY is not set.',
    });
    await expect(
      sendWithResend({ to: 'a@b.example', email: EMAIL, dedupeKey: 'k' }, { env: env({ RESEND_API_KEY: 're_x' }), fetch }),
    ).resolves.toMatchObject({ ok: false, kind: 'config', error: 'EMAIL_FROM is not set. Resend needs a sender address.' });
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
  ] as const)('a %i answer is a %s problem', async (status, kind) => {
    const { fetch } = fakeFetch(status, '{"name":"some_error","message":"Something is off."}');
    const result = await sendWithResend({ to: 'a@b.example', email: EMAIL, dedupeKey: 'k' }, { env: good, fetch });
    expect(result).toEqual({ ok: false, kind, error: `Resend answered ${status}. some_error: Something is off.` });
  });

  it('a network error can be tried again, and the key is never in the error text', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('socket hang up');
    };
    const result = await sendWithResend({ to: 'a@b.example', email: EMAIL, dedupeKey: 'k' }, { env: good, fetch });
    expect(result).toEqual({ ok: false, kind: 'retry', error: 'Could not reach Resend. socket hang up' });
    expect(JSON.stringify(result)).not.toContain('re_test_key');
  });
});
