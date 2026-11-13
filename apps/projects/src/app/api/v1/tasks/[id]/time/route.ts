import { apiRoute } from '@/server/http/api';
import { listTaskTime } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => listTaskTime(ctx, params.id));
