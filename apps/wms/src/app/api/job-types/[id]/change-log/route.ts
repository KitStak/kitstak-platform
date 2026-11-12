/** `GET /api/job-types/[id]/change-log?page&ps`. */
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { idParamsSchema, pagingSchema } from '@/server/repositories/platform-common';
import { JOB_TYPE_ENTITY, loadJobType } from '@/server/repositories/job-types';
import { listEntityChangeLog } from '@/server/repositories/wave-rules';

export const GET = defineRoute({
  permission: 'settings.job_types.change_log',
  params: idParamsSchema,
  query: pagingSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadJobType(db, auth, params.id);
    const { rows, total } = await listEntityChangeLog(db, JOB_TYPE_ENTITY, params.id, query.page, query.ps);
    return listResult(rows, { total, page: query.page, pageSize: query.ps });
  },
});
