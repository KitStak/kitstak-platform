/**
 * Which mail provider is in use, and one send through Resend (docs/billing/CONTRACTS.md section 13.2).
 *
 *   RESEND_API_KEY   EMAIL_PROVIDER      NODE_ENV          provider
 *   set              resend or unset     any               resend
 *   set              outbox              not production    outbox  (a local choice to keep mail local)
 *   set              outbox              production        resend  (the outbox never runs in production)
 *   not set          any                 not production    outbox
 *   not set          any                 production        none    (mail stays queued, GO-LIVE covers it)
 *
 * `outbox` and `none` mean "do not call Resend". What happens to the mail then is the caller's
 * choice: billing keeps a row in core.billing_emails, WMS writes it to the server log.
 *
 * Resend is called with `fetch`. No mail library is added (CONTRACTS 13.2). Keys are read from env
 * when a send happens and are never logged.
 */
import { createHash } from 'node:crypto';

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

/** True when a send through Resend can be tried: the provider is Resend and a sender is set. */
export function resendReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEmailProvider(env) === 'resend' && clean(env.EMAIL_FROM) !== null;
}

export type SendResult =
  | { readonly ok: true; readonly messageId: string | null }
  | {
      readonly ok: false;
      readonly error: string;
      /**
       * retry: try this email again later. config: the setup is wrong (key, sender domain, rate), so
       * stop and keep the mail for later. fatal: this email can never be sent as it is.
       */
      readonly kind: 'retry' | 'config' | 'fatal';
    };

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>;

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** Optional. Plain text mail (WMS) leaves it out. */
  readonly html?: string;
  /**
   * The same key sent twice goes out once (a retry after a lost answer). Leave it out for mail that
   * is never retried.
   */
  readonly dedupeKey?: string;
  /** Overrides EMAIL_REPLY_TO for this message, for example a company's own address. */
  readonly replyTo?: string;
}

export interface SendOptions {
  /** For tests. Default: process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** For tests. Default: the global fetch. */
  readonly fetch?: FetchLike;
}

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

function classify(status: number): 'config' | 'fatal' | 'retry' {
  // 401 and 403: the key or the sender domain is wrong. 429: too fast. None of these is the
  // email's fault.
  if (status === 401 || status === 403 || status === 429) return 'config';
  // 400 and 422: bad request. 409: the same key was used with other content. Do not retry.
  if (status >= 400 && status < 500) return 'fatal';
  return 'retry';
}

function messageIdOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { id?: unknown };
    return typeof parsed.id === 'string' ? parsed.id : null;
  } catch {
    return null;
  }
}

/** Sends one email through Resend. Never throws: every outcome is in the result. */
export async function sendWithResend(message: MailMessage, options?: SendOptions): Promise<SendResult> {
  const env = options?.env ?? process.env;
  const key = clean(env.RESEND_API_KEY);
  const from = clean(env.EMAIL_FROM);
  const replyTo = clean(message.replyTo) ?? clean(env.EMAIL_REPLY_TO);
  const to = message.to.trim();
  if (!key) return { ok: false, kind: 'config', error: 'RESEND_API_KEY is not set.' };
  if (!from)
    return { ok: false, kind: 'config', error: 'EMAIL_FROM is not set. Resend needs a sender address.' };
  if (to === '') return { ok: false, kind: 'fatal', error: 'No address to send to.' };

  const doFetch: FetchLike = options?.fetch ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await doFetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(message.dedupeKey ? { 'Idempotency-Key': idempotencyKeyFor(message.dedupeKey) } : {}),
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: message.subject,
        ...(message.html ? { html: message.html } : {}),
        text: message.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (response.status >= 200 && response.status < 300) return { ok: true, messageId: messageIdOf(body) };
    return { ok: false, kind: classify(response.status), error: shortError(response.status, body) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'retry', error: `Could not reach Resend. ${reason}`.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}
