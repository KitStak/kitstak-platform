import { apiRoute } from '@/server/http/api';
import { intParam, str, uuidParam } from '@/server/http/params';
import { listItems } from '@/server/domain';

export const GET = apiRoute(async ({ ctx, searchParams }) => listItems(ctx, { q: str(searchParams, 'q'), clientId: uuidParam(searchParams, 'client'), limit: intParam(searchParams, 'limit', 500, 2000) }));
