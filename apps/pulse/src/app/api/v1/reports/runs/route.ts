import { apiRoute } from '@/server/http/api';
import { intParam } from '@/server/http/params';
import { listReportRuns } from '@/server/domain';

/** Past report builds, newest first (`ReportRunDTO[]`). Kept 90 days. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listReportRuns(ctx, { limit: intParam(searchParams, 'limit', 50, 200) }));
