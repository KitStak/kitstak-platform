import { apiCsvRoute } from '@/server/http/api';
import { importErrorReport } from '@/server/domain/setup-import';

/** `GET /api/v1/import/[batchId]/errors.csv`: the rows with problems, with the problem in words (SPEC 7). */
export const GET = apiCsvRoute<{ batchId: string }>(({ ctx, params }) => importErrorReport(ctx, params.batchId), { rights: ['import:run'] });
