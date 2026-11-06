import { withApi } from '@/server/api';
import { trashEntriesSchema } from '@/server/services/admin-contracts';
import { restoreFromTrash } from '@/server/services/admin-trash';
import { svc } from '../../_lib/route-helpers';

export const POST = withApi(
  {
    permission: 'item:write',
    body: trashEntriesSchema,
    audit: {
      action: 'trash.restored',
      metadata: (ctx) => ({ entries: (ctx.data as { done: unknown[] }).done }),
    },
  },
  (ctx) => restoreFromTrash(svc(ctx), ctx.body),
);
