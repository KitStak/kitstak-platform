import { apiRoute } from '@/server/http/api';
import { resolveTaskParam } from '@/server/http/task-param';
import { buildShortages } from '@/server/domain/programs';

/** GET /api/v1/builds/:id/shortages (WMS read only). */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => buildShortages(ctx, await resolveTaskParam(ctx, params.id)));
