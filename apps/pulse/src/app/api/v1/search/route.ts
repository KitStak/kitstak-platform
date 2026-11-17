import { apiRoute } from '@/server/http/api';
import { intParam, str } from '@/server/http/params';
import { searchAll } from '@/server/domain';

/** Jobs, clients and services that match `?q=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => searchAll(ctx, str(searchParams, 'q') ?? '', intParam(searchParams, 'limit', 8, 25)));
