import { apiRoute } from '@/server/http/api';
import { flag } from '@/server/http/params';
import { listJobTypes } from '@/server/domain';

export const GET = apiRoute(async ({ ctx, searchParams }) => listJobTypes(ctx, { includeArchived: flag(searchParams, 'archived') }));
