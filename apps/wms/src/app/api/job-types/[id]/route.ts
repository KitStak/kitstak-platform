/** `GET|PATCH|DELETE /api/job-types/[id]` — delete is blocked while rules or open jobs use the type. */
import { defineRoute } from '@/server/api/define-route';
import { withM03Actor } from '@/server/repositories/jobs-actor';
import { jobTypeInputSchema } from '@/lib/grid-defs/jobs/forms';
import { domainCtx, idParamsSchema } from '@/server/repositories/platform-common';
import { deleteJobType, getJobTypeDetail, updateJobType } from '@/server/repositories/job-types';

export const GET = defineRoute({
  permission: ['settings.job_types.view', 'automation.wave_rules.view'],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getJobTypeDetail(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: 'settings.job_types.edit',
  params: idParamsSchema,
  body: jobTypeInputSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await withM03Actor(
      db,
      actor,
      auth,
      async () => await updateJobType(db, auth, domainCtx(actor, auth), params.id, body),
    ),
});

export const DELETE = defineRoute({
  permission: 'settings.job_types.delete',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) =>
    await withM03Actor(db, actor, auth, async () => {
      await deleteJobType(db, auth, domainCtx(actor, auth), params.id);
      return { deleted: params.id };
    }),
});
