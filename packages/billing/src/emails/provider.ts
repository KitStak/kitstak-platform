/**
 * Which mail provider is in use, and the Resend sender (docs/billing/CONTRACTS.md section 13.2).
 * The transport lives in `@kitstak/mail` so other platform mail (WMS resets, invites) shares it.
 * See `resolveEmailProvider` there for the provider table.
 */
import { sendWithResend as send, type FetchLike, type SendResult } from '@kitstak/mail';
import type { RenderedEmail } from './layout';

export {
  idempotencyKeyFor,
  resolveEmailProvider,
  type EmailProvider,
  type FetchLike,
  type SendResult,
} from '@kitstak/mail';

export async function sendWithResend(
  input: { to: string; email: RenderedEmail; dedupeKey: string },
  options?: { env?: NodeJS.ProcessEnv; fetch?: FetchLike },
): Promise<SendResult> {
  return send(
    {
      to: input.to,
      subject: input.email.subject,
      html: input.email.html,
      text: input.email.text,
      dedupeKey: input.dedupeKey,
    },
    options,
  );
}
