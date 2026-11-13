import { apiRoute } from '@/server/http/api';
import { getCycle } from '@/server/domain';

/** One cycle: its tasks and the report (burndown, scope changes). */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => getCycle(ctx, params.id));
