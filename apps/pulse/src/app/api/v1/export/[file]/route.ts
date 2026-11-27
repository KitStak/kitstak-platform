import { db } from '@/server/db';
import { exportEverything, exportStream, listActivity, logActivity, type ExportFilters } from '@/server/domain';
import { notFound } from '@/server/errors';
import { csvResponse } from '@/server/http/api';
import { dateParam, flag, oneOf, str, uuidParam } from '@/server/http/params';
import { zipResponse } from '@/features/export/server/zip-response';
import { fileRoute } from '@/features/reports/server/file-route';
import { AUDIT_CSV_HEADERS, auditCsvRow } from '@/features/settings/audit-format';
import { JOB_STATUS_VALUES } from '@/lib/constants';
import { toCsv } from '@/lib/csv/write';
import { exportFileName } from '@/lib/csv/write';
import { isStreamId } from '@/lib/streams';

export const maxDuration = 300;

/** The most audit rows one CSV holds. */
const AUDIT_CAP = 20_000;

/**
 * CSV out:
 *   `/api/v1/export/production.csv?from&to&client&jobType&site&status`   one stream, in the columns of its template
 *   `/api/v1/export/job_plans.csv?layout=lines`                          quotes and budgets line by line
 *   `/api/v1/export/everything.zip?from&to`                              every stream that has rows, in one zip
 *   `/api/v1/export/audit.csv?actor&entityType&verb&q&from&to`           the audit log
 * `money=0` leaves the money columns out. Permission and money are checked on the server.
 */
export const GET = fileRoute<{ file: string }>(async ({ ctx, params, searchParams }) => {
  const file = decodeURIComponent(params.file);
  const filters: ExportFilters = {
    from: dateParam(searchParams, 'from'),
    to: dateParam(searchParams, 'to'),
    clientId: uuidParam(searchParams, 'client'),
    jobTypeId: uuidParam(searchParams, 'jobType'),
    siteId: uuidParam(searchParams, 'site'),
    status: oneOf(searchParams, 'status', JOB_STATUS_VALUES),
    layout: oneOf(searchParams, 'layout', ['totals', 'lines'] as const) ?? undefined,
    hideMoney: searchParams.get('money') === '0' || flag(searchParams, 'noMoney'),
  };
  if (file === 'everything.zip') {
    const files = await exportEverything(ctx, filters);
    const note = [
      'KitStak Pulse export',
      `Workspace: ${ctx.orgSlug}`,
      `Made: ${new Date().toISOString()}`,
      filters.from || filters.to ? `Dates: ${filters.from ?? 'the start'} to ${filters.to ?? 'today'}` : 'Dates: everything',
      '',
      'Each file has the same columns as its import template, so you can fix a file and import it back.',
      ...files.map((entry) => `${entry.fileName}: ${entry.rowCount} rows${entry.cut ? ' (cut at 200,000 rows)' : ''}`),
      files.length === 0 ? 'There were no rows to export.' : '',
    ].join('\r\n');
    return zipResponse(exportFileName('everything', ctx.orgSlug, filters.from, filters.to).replace(/\.csv$/, '.zip'), [{ name: 'READ ME.txt', content: note }, ...files.map((entry) => ({ name: entry.fileName, content: entry.csv }))]);
  }
  if (file === 'audit.csv') {
    const rows: string[][] = [];
    let cursor: string | null = null;
    do {
      const page = await listActivity(ctx, {
        actorId: uuidParam(searchParams, 'actor'),
        entityType: str(searchParams, 'entityType'),
        verbPrefix: str(searchParams, 'verb'),
        q: str(searchParams, 'q'),
        from: filters.from,
        to: filters.to,
        cursor,
        limit: 200,
      });
      for (const item of page.items) rows.push(auditCsvRow(item));
      cursor = page.nextCursor;
    } while (cursor && rows.length < AUDIT_CAP);
    await logActivity(db, ctx, { verb: 'export.run', entityType: 'export', meta: { stream: 'audit_log', rows: rows.length, from: filters.from ?? null, to: filters.to ?? null } });
    return csvResponse(exportFileName('audit-log', ctx.orgSlug, filters.from, filters.to), toCsv([...AUDIT_CSV_HEADERS], rows));
  }
  const match = /^([a-z_]+)\.csv$/.exec(file);
  if (!match || !isStreamId(match[1])) throw notFound('That file');
  const out = await exportStream(ctx, match[1], filters);
  return csvResponse(out.fileName, out.csv);
});
