import { apiRoute } from '@/server/http/api';
import { uuidParam } from '@/server/http/params';
import { listStandards } from '@/server/domain';

/** Target pace rows, newest first. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listStandards(ctx, { jobTypeId: uuidParam(searchParams, 'jobType'), vasServiceId: uuidParam(searchParams, 'service'), clientId: uuidParam(searchParams, 'client') }));
