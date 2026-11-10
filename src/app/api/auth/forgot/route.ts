import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { isSameOriginRequest } from "@/server/auth/csrf";
import { requestPasswordReset } from "@/server/auth/password-reset";
import { hitRateLimit, RATE_LIMITS } from "@/server/auth/rate-limit";

const bodySchema = z.object({ email: z.string().trim().min(3).max(254) });

const GENERIC_FORGOT_MESSAGE = "If an account exists for that email, a reset link has been sent.";

/** POST /api/auth/forgot — always answers the same way (no account enumeration). */
export const POST = defineRoute({
  name: "POST /api/auth/forgot",
  auth: "public",
  csrf: false,
  rateLimit: false,
  transaction: false,
  body: bodySchema,
  handler: async ({ db, request, body, ip }) => {
    if (!isSameOriginRequest(request)) throw new AppError("CSRF", "Cross-site requests are not allowed");
    const limit = hitRateLimit(db, RATE_LIMITS.passwordReset, ip);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many reset requests. Please try again later.", {
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
    await requestPasswordReset(db, { email: body.email, baseUrl: new URL(request.url).origin, ip });
    return { message: GENERIC_FORGOT_MESSAGE };
  },
});
