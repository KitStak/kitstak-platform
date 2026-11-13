import { apiRoute } from '@/server/http/api';
import { getRunningTimer } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => getRunningTimer(ctx));
