import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { isSameOriginRequest } from '@/server/auth/origin';
import { resetPassword } from '@/server/auth/password-reset';
import { hitRateLimit, RATE_LIMITS } from '@/server/auth/rate-limit';

const bodySchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(1).max(200),
});

/** POST /api/auth/reset — consumes a reset token; every existing session is revoked. */
export const POST = defineRoute({
  name: 'POST /api/auth/reset',
  auth: 'public',
  csrf: false,
  rateLimit: false,
  transaction: false,
  body: bodySchema,
  handler: async ({ db, request, body, ip }) => {
    if (!isSameOriginRequest(request)) throw new AppError('CSRF', 'Cross-site requests are not allowed');
    const limit = await hitRateLimit(db, RATE_LIMITS.passwordReset, `reset:${ip}`);
    if (!limit.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many attempts. Please try again later.', {
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      });
    }
    await resetPassword(db, { token: body.token, password: body.password, ip });
    return { reset: true };
  },
});
