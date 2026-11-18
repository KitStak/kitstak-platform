import { apiRoute } from '@/server/http/api';
import { uuidParam } from '@/server/http/params';
import { listQuoteScenarios } from '@/server/domain';

/** Saved calculator scenarios, newest first. `?job=` narrows to the what ifs of one job. Needs money rights. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listQuoteScenarios(ctx, { jobId: uuidParam(searchParams, 'job') }));
