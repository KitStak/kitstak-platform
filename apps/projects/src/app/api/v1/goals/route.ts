import { apiRoute } from '@/server/http/api';
import { listGoals } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => listGoals(ctx));
