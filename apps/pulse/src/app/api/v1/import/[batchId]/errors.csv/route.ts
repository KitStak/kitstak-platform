import { importErrorReport } from '@/server/domain';
import { csvResponse } from '@/server/http/api';
import { fileRoute } from '@/features/reports/server/file-route';

/** `GET /api/v1/import/<batch>/errors.csv`: the rows with problems, plus a `problem` column, ready to fix and upload again. */
export const GET = fileRoute<{ batchId: string }>(async ({ ctx, params }) => {
  const report = await importErrorReport(ctx, params.batchId);
  return csvResponse(report.fileName, report.csv);
});
