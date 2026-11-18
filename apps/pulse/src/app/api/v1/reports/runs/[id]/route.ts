import { csvResponse } from '@/server/http/api';
import { getReportRunFile } from '@/server/domain';
import { fileRoute, htmlResponse } from '@/features/reports/server/file-route';

/** One build's file: `?format=csv` (default) or `?format=html` (a page to print or paste). A build with money needs `money:read`. */
export const GET = fileRoute<{ id: string }>(async ({ ctx, params, searchParams }) => {
  const format = searchParams.get('format') === 'html' ? 'html' : 'csv';
  const file = await getReportRunFile(ctx, params.id, format);
  return format === 'csv' ? csvResponse(file.fileName, file.body) : htmlResponse(file.body);
});
