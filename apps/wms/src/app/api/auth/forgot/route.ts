import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { isSameOriginRequest } from '@/server/auth/origin';
import { requestPasswordReset } from '@/server/auth/password-reset';
import { hitRateLimit, RATE_LIMITS } from '@/server/auth/rate-limit';

const bodySchema = z.object({ email: z.string().trim().min(3).max(254) });

const GENERIC_FORGOT_MESSAGE = 'If an account exists for that email, a reset link has been sent.';

/** POST /api/auth/forgot — always answers the same way (no account enumeration). */
export const POST = defineRoute({
  name: 'POST /api/auth/forgot',
  auth: 'public',
  csrf: false,
  rateLimit: false,
  transaction: false,
  body: bodySchema,
  handler: async ({ db, request, body, ip, rateIp }) => {
    if (!isSameOriginRequest(request)) throw new AppError('CSRF', 'Cross-site requests are not allowed');
    // Auth review H2: the limiter keys on the spoof-resistant rateIp (rotating
    // x-forwarded-for no longer opens a fresh bucket), plus a per-target-email bucket
    // so one mailbox cannot be reset-mail-bombed from many addresses either.
    const limit = await hitRateLimit(db, RATE_LIMITS.passwordReset, rateIp);
    const emailLimit = await hitRateLimit(
      db,
      RATE_LIMITS.passwordResetEmail,
      body.email.trim().toLowerCase(),
    );
    if (!limit.allowed || !emailLimit.allowed) {
      const retryAfter = Math.max(limit.retryAfterSeconds, emailLimit.retryAfterSeconds);
      throw new AppError('RATE_LIMITED', 'Too many reset requests. Please try again later.', {
        headers: { 'Retry-After': String(retryAfter) },
      });
    }
    await requestPasswordReset(db, { email: body.email, baseUrl: new URL(request.url).origin, ip });
    return { message: GENERIC_FORGOT_MESSAGE };
  },
});
