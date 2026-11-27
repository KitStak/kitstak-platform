import { apiRoute } from '@/server/http/api';
import { flag } from '@/server/http/params';
import { listLaborClasses } from '@/server/domain';

export const GET = apiRoute(async ({ ctx, searchParams }) => listLaborClasses(ctx, { includeArchived: flag(searchParams, 'archived') }));
