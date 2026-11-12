/** `GET /api/counts/[id]` (id or code) — plan, lines, entries, jobs. `PATCH` — edit a Pending plan (409 on stale version). `DELETE` — Pending only. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { COUNT_ANY_VIEW, COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import {
  countPlanUpdateSchema,
  deleteCountPlan,
  getCountPlanDetail,
  updateCountPlan,
} from '@/server/repositories/counts-plans';
import { domainCtx, idParamsSchema } from '@/server/repositories/platform-common';

export const GET = defineRoute({
  permission: COUNT_ANY_VIEW,
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getCountPlanDetail(db, auth.scope, params.id),
});

export const PATCH = defineRoute({
  permission: P.edit,
  params: idParamsSchema,
  body: countPlanUpdateSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await updateCountPlan(db, domainCtx(actor, auth), auth, params.id, body),
});

export const DELETE = defineRoute({
  permission: P.delete,
  params: idParamsSchema,
  query: z.object({ version: z.coerce.number().int().min(1).optional() }),
  handler: async ({ db, auth, actor, params, query }) => {
    await deleteCountPlan(db, domainCtx(actor, auth), auth, params.id, query.version);
    return { id: params.id };
  },
});
