import { apiRoute } from '@/server/http/api';
import { listGoalCheckIns } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => listGoalCheckIns(ctx, params.id));
