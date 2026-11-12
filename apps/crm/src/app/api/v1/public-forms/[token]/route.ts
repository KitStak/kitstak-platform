import { z } from 'zod';
import { withApi } from '@/server/api';
import { publicSubmissionSchema } from '@/server/services/board-views-form-model';
import { getPublicForm, isAutomatedSubmission, submitPublicForm } from '@/server/services/board-views-forms';

// Loose shape here so a malformed token is a 404 (resolveToken), not a 422 that leaks the format.
const params = z.object({ token: z.string().max(200) });

/** Public (no session) form definition. */
export const GET = withApi({ auth: 'none', org: 'none', rateLimit: 'search', params }, (ctx) =>
  getPublicForm(ctx.params.token),
);

/**
 * Public submission → creates an item on the form's board. Anti-abuse: per-IP `auth` rate
 * limit (10 burst, ~10/min), honeypot + server-signed render stamp time trap (missing, forged,
 * too fast or stale stamps get a fake success), 32 KB body cap.
 */
export const POST = withApi(
  { auth: 'none', org: 'none', rateLimit: 'auth', params, body: publicSubmissionSchema, maxBodyBytes: 32_768 },
  async (ctx) => {
    if (isAutomatedSubmission(ctx.params.token, ctx.body)) {
      // Still 404 for unknown tokens so the fake success can't be used to probe tokens.
      await getPublicForm(ctx.params.token);
      return { accepted: true as const };
    }
    return submitPublicForm(ctx.params.token, ctx.body);
  },
);
