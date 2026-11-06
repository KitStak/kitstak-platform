import { withApi } from '@/server/api';
import { trashEntriesSchema } from '@/server/services/admin-contracts';
import { purgeFromTrash } from '@/server/services/admin-trash';
import { svc } from '../../_lib/route-helpers';

/** Permanent delete (board owners and org admins only; checked per entry). */
export const POST = withApi(
  {
    permission: 'board:delete',
    rateLimit: 'heavy',
    body: trashEntriesSchema,
    audit: {
      action: 'trash.purged',
      metadata: (ctx) => ({ entries: (ctx.data as { done: unknown[] }).done }),
    },
  },
  (ctx) => purgeFromTrash(svc(ctx), ctx.body),
);
