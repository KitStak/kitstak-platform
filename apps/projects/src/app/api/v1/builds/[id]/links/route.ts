import { apiRoute } from '@/server/http/api';
import { resolveTaskParam } from '@/server/http/task-param';
import { listRecordLinksFor } from '@/server/domain/programs';

/** GET /api/v1/builds/:id/links */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => listRecordLinksFor(ctx, { type: 'pm_build', id: await resolveTaskParam(ctx, params.id) }));
