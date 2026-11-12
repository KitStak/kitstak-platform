/**
 * `POST /api/account/password` — Change Password. Same-origin check (defineRoute), a
 * strict per-user rate limit (5 tries / 15 min), policy check, then session rotation:
 * every OTHER Better Auth session ends; this browser's session stays alive.
 */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { accountPasswordSchema } from '@/lib/grid-defs/admin/account';
import { changeOwnPassword } from '@/server/repositories/users-account';
import { withWriteTx } from '@/server/db/sql';

const PASSWORD_CHANGE_LIMIT = { name: 'account-password', limit: 5, windowMs: 15 * 60_000 } as const;

export const POST = defineRoute({
  permission: 'settings.change_password.view',
  body: accountPasswordSchema,
  rateLimit: PASSWORD_CHANGE_LIMIT,
  transaction: false,
  handler: async ({ db, auth, actor, body, audit }) => {
    try {
      await withWriteTx(
        db,
        async (tx) => await changeOwnPassword(tx, auth, actor, body.currentPassword, body.newPassword),
      );
    } catch (error: unknown) {
      // A rejected change is a failure row of its own action, never "Password changed · Success".
      const reason =
        error instanceof AppError
          ? error.fieldErrors?.currentPassword
            ? 'wrong_current_password'
            : error.code.toLowerCase()
          : 'error';
      await audit({
        action: 'auth.password_change_rejected',
        entity: 'user',
        entityId: auth.user.id,
        outcome: 'failure',
        detail: { reason },
      });
      throw error;
    }
    await audit({
      action: 'auth.password_change',
      entity: 'user',
      entityId: auth.user.id,
      detail: { otherSessionsEnded: true },
    });
    return { changed: true };
  },
});
