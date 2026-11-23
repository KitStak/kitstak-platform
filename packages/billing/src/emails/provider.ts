/**
 * Which mail provider is in use, and the Resend sender (docs/billing/CONTRACTS.md section 13.2).
 *
 *   RESEND_API_KEY   EMAIL_PROVIDER      NODE_ENV          provider
 *   set              resend or unset     any               resend
 *   set              outbox              not production    outbox  (a local choice to keep mail local)
 *   set              outbox              production        resend  (the outbox never runs in production)
 *   not set          any                 not production    outbox
 *   not set          any                 production        none    (mail stays queued, GO-LIVE covers it)
 *
 * Resend is called with `fetch`. No mail library is added. Keys are read from env when a send
 * happens and are never logged.
 */
import { createHash } from 'node:crypto';
import type { RenderedEmail } from './layout';

export type EmailProvider = 'resend' | 'outbox' | 'none';

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function resolveEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const production = env.NODE_ENV === 'production';
  const key = clean(env.RESEND_API_KEY);
  const wanted = clean(env.EMAIL_PROVIDER)?.toLowerCase() ?? null;
  if (!key) return production ? 'none' : 'outbox';
  if (wanted === 'outbox' && !production) return 'outbox';
  return 'resend';
}

export type SendResult =
  | { readonly ok: true; readonly messageId: string | null }
  | {
      readonly ok: false;
      readonly error: string;
      /**
       * retry: try this email again later. config: the setup is wrong (key, sender domain, rate), so
       * stop this run and keep every email queued. fatal: this email can never be sent as it is.
       */
      readonly kind: 'retry' | 'config' | 'fatal';
    };

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>;

const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 15_000;

/** Resend keys are at most 256 characters. A hash keeps any dedupe key inside that, and stable. */
export function idempotencyKeyFor(dedupeKey: string): string {
  return `kitstak-email/${createHash('sha256').update(dedupeKey).digest('hex')}`;
}

function shortError(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as { message?: unknown; name?: unknown };
    if (typeof parsed.message === 'string') detail = parsed.message;
    if (typeof parsed.name === 'string') detail = `${parsed.name}: ${detail}`;
  } catch {
    // Not JSON. Use the text as it is.
  }
  return `Resend answered ${status}. ${detail}`.slice(0, 400);
}

export async function sendWithResend(
  input: { to: string; email: RenderedEmail; dedupeKey: string },
  options?: { env?: NodeJS.ProcessEnv; fetch?: FetchLike },
): Promise<SendResult> {
  const env = options?.env ?? process.env;
  const key = clean(env.RESEND_API_KEY);
  const from = clean(env.EMAIL_FROM);
  const replyTo = clean(env.EMAIL_REPLY_TO);
  if (!key) return { ok: false, kind: 'config', error: 'RESEND_API_KEY is not set.' };
  if (!from) return { ok: false, kind: 'config', error: 'EMAIL_FROM is not set. Resend needs a sender address.' };

  const doFetch: FetchLike = options?.fetch ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await doFetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        // The same email sent twice (a retry after a lost answer) goes out once.
        'Idempotency-Key': idempotencyKeyFor(input.dedupeKey),
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (response.status >= 200 && response.status < 300) {
      let messageId: string | null = null;
      try {
        const parsed = JSON.parse(body) as { id?: unknown };
        if (typeof parsed.id === 'string') messageId = parsed.id;
      } catch {
        messageId = null;
      }
      return { ok: true, messageId };
    }
    const error = shortError(response.status, body);
    // 401 and 403: the key or the sender domain is wrong. 429: too fast. None of these is the
    // email's fault, so nothing is marked failed.
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return { ok: false, kind: 'config', error };
    }
    // 400 and 422: bad request. 409: the same key was used with other content. Do not retry.
    if (response.status >= 400 && response.status < 500) return { ok: false, kind: 'fatal', error };
    return { ok: false, kind: 'retry', error };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'retry', error: `Could not reach Resend. ${reason}`.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}
