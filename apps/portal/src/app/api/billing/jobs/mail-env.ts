/**
 * The mail settings from the validated env, in the shape `@kitstak/billing/emails` reads. A blank
 * line in an env file never counts as a key. Used by the tick route and by the dev outbox page.
 */
import 'server-only';
import { env } from '@/server/env';

export function mailEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: env.NODE_ENV,
    EMAIL_PROVIDER: env.EMAIL_PROVIDER,
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_FROM: env.EMAIL_FROM,
    EMAIL_REPLY_TO: env.EMAIL_REPLY_TO,
  } as NodeJS.ProcessEnv;
}
