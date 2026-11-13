import { apiRoute, boolParam } from '@/server/http/api';
import { listSpaces } from '@/server/domain';

export const GET = apiRoute(async ({ ctx, searchParams }) => listSpaces(ctx, { includeArchived: boolParam(searchParams.get('archived'), false) }));
