import { withApi } from '@/server/api';
import { dismissDuplicatesSchema } from '@/server/services/crm-contracts';
import { dismissDuplicates } from '@/server/services/crm-duplicates';
import { svc } from '../../../_lib/route-helpers';

/** Mark records as "not duplicates" (or undo that with `undo: true`). */
export const POST = withApi({ permission: 'item:write', body: dismissDuplicatesSchema }, (ctx) =>
  dismissDuplicates(svc(ctx), ctx.body),
);
