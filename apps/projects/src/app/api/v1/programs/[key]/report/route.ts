import { shareReport } from '@/server/domain/programs';
import { fileRoute } from '../../_lib';

/** GET /api/v1/programs/:key/report?run=|week=&charges=0|1&format=pdf|csv (units only unless charges=1 and money:read). */
export const GET = fileRoute<{ key: string }>(async ({ ctx, params, searchParams }) =>
  shareReport(ctx, {
    key: decodeURIComponent(params.key),
    runId: searchParams.get('run'),
    week: searchParams.get('week'),
    includeCharges: searchParams.get('charges') === '1',
    format: searchParams.get('format') === 'pdf' ? 'pdf' : 'csv',
  }),
);
