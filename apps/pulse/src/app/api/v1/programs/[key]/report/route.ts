import { NextResponse } from 'next/server';
import { csvResponse } from '@/server/http/api';
import { flag, oneOf, str } from '@/server/http/params';
import { fileRoute, htmlResponse } from '@/features/reports/server/file-route';
import { PROGRAM_REPORT_VERSIONS, programReportFileName } from '@/features/programs/program-report';
import { loadProgramReport, logProgramReportExport } from '@/features/programs/server/program-report-data';
import { programReportToCsv, programReportToHtml } from '@/features/programs/program-report-format';
import { programReportToPdf } from '@/features/programs/program-report-pdf';

const FORMATS = ['json', 'csv', 'html', 'pdf'] as const;

/**
 * The monthly program report (docs/programs/PULSE_PROGRAMS_SPEC.md 7.4), four ways:
 *   `/api/v1/programs/GLOVE/report?month=2026-11&version=internal`              JSON (`ProgramReportDTO`)
 *   `...&format=csv`   the same numbers as a CSV file
 *   `...&format=html`  a page to print (`&print=1` opens the print box)
 *   `...&format=pdf`   a PDF file
 * `version` is `internal` (default for people who see money) or `customer` (never any cost,
 * labor, profit or margin). It reads the same three reads as the program page, so the totals
 * equal the page to the cent. Money stays hidden for a reader without money rights.
 */
export const GET = fileRoute<{ key: string }>(async ({ ctx, context, params, searchParams }) => {
  const key = decodeURIComponent(params.key);
  const month = str(searchParams, 'month');
  const format = oneOf(searchParams, 'format', FORMATS) ?? 'json';
  const report = await loadProgramReport(ctx, key, month, oneOf(searchParams, 'version', PROGRAM_REPORT_VERSIONS));
  if (format === 'json') return report;
  await logProgramReportExport(ctx, report, format);
  if (format === 'csv') return csvResponse(programReportFileName(report, 'csv'), programReportToCsv(report, { orgName: context.org.name }));
  if (format === 'html') return htmlResponse(programReportToHtml(report, { orgName: context.org.name, autoPrint: flag(searchParams, 'print') }));
  const pdf = programReportToPdf(report, { orgName: context.org.name });
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${flag(searchParams, 'inline') ? 'inline' : 'attachment'}; filename="${programReportFileName(report, 'pdf')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
