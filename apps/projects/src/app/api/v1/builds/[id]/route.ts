import { apiRoute } from '@/server/http/api';
import { resolveTaskParam } from '@/server/http/task-param';
import { getBuild } from '@/server/domain/programs';

/** GET /api/v1/builds/:id (uuid or GLOVE-212). */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => getBuild(ctx, await resolveTaskParam(ctx, params.id)));
