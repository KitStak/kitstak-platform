import { apiRoute } from '@/server/http/api';
import { search } from '@/server/domain';

export const GET = apiRoute(async ({ ctx, searchParams }) => search(ctx, searchParams.get('q') ?? '', Number(searchParams.get('limit') ?? 8) || 8));
