import { withApi } from '@/server/api';
import { trashQuerySchema } from '@/server/services/admin-contracts';
import { listTrash } from '@/server/services/admin-trash';
import { svc } from '../_lib/route-helpers';

/** Deleted boards, groups and items visible to the caller. */
export const GET = withApi({ permission: 'board:read', query: trashQuerySchema }, (ctx) =>
  listTrash(svc(ctx), ctx.query),
);
