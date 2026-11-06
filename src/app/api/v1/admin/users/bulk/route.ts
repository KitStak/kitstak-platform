import { withApi } from '@/server/api';
import { bulkUsersSchema } from '@/server/services/admin-contracts';
import { bulkUpdateUsers } from '@/server/services/admin-users';
import { svc } from '../../../_lib/route-helpers';

const ACTION_AUDIT: Readonly<Record<string, string>> = {
  set_role: 'member.role_changed',
  deactivate: 'member.deactivated',
  reactivate: 'member.reactivated',
};

/** Bulk role change / deactivate / reactivate. Each successful member gets its own audit row. */
export const POST = withApi({ permission: 'member:update', body: bulkUsersSchema }, async (ctx) => {
  const result = await bulkUpdateUsers(svc(ctx), ctx.body);
  const bulk = ctx.body.memberIds.length > 1;
  await Promise.all(
    result.updated.map((memberId) =>
      ctx.audit({
        action: ACTION_AUDIT[ctx.body.action] ?? 'member.updated',
        targetType: 'member',
        targetId: memberId,
        metadata: ctx.body.role ? { role: ctx.body.role, bulk } : { bulk },
      }),
    ),
  );
  return result;
});
