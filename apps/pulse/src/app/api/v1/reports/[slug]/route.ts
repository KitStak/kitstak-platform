import { csvResponse } from '@/server/http/api';
import { flag, oneOf, rangeParams, uuidParam } from '@/server/http/params';
import { buildReport, logActivity } from '@/server/domain';
import { db } from '@/server/db';
import { reportToCsv, reportToHtml } from '@/features/reports/report-format';
import { fileRoute, htmlResponse } from '@/features/reports/server/file-route';
import { JOB_STATUS_VALUES } from '@/lib/constants';

/**
 * One report of the library, three ways:
 *   `/api/v1/reports/job-profit`        JSON (`ReportDTO`) for the page
 *   `/api/v1/reports/job-profit.csv`    the same rows as a CSV file
 *   `/api/v1/reports/job-profit.html`   the same rows as a page to print or paste (`?print=1` opens the print box)
 * Filters: `from,to,site,client,jobType,status`. Reports that show money answer 403 without `money:read`.
 */
export const GET = fileRoute<{ slug: string }>(async ({ ctx, context, params, searchParams }) => {
  const raw = decodeURIComponent(params.slug);
  const format = raw.endsWith('.csv') ? 'csv' : raw.endsWith('.html') ? 'html' : 'json';
  const slug = format === 'json' ? raw : raw.slice(0, raw.lastIndexOf('.'));
  const report = await buildReport(ctx, slug, { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site'), clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), status: oneOf(searchParams, 'status', JOB_STATUS_VALUES) });
  if (format === 'json') return report;
  // Exports are part of the audit trail.
  await logActivity(db, ctx, { verb: 'report.exported', entityType: 'report', meta: { report: slug, format, from: report.from, to: report.to, rows: report.rows.length } });
  if (format === 'csv') return csvResponse(`${context.org.slug}-${slug}-${report.from}-to-${report.to}.csv`, reportToCsv(report));
  return htmlResponse(reportToHtml(report, { orgName: context.org.name, autoPrint: flag(searchParams, 'print') }));
});
