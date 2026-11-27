/**
 * The reads behind the monthly program report (spec 7.4): the same three domain reads as the
 * program page (Overview, By variant, Days), so the report totals equal the page to the cent, and
 * the audit line for an export.
 */
import 'server-only';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { getProgramDays, getProgramMonth, getProgramVariants, logActivity, type DomainContext } from '@/server/domain';
import { buildProgramReport, type ProgramReportDTO, type ProgramReportVersion } from '../program-report';

/** Builds one version of the report. `version` left out is Internal for money readers, else the units only copy. */
export const loadProgramReport = scoped(async function loadProgramReport(ctx: DomainContext, key: string, month: string | null, version: ProgramReportVersion | null): Promise<ProgramReportDTO> {
  const [overview, variants, days] = await Promise.all([getProgramMonth(ctx, key, month), getProgramVariants(ctx, key, month), getProgramDays(ctx, key, month)]);
  return buildProgramReport({ month: overview, variants, days }, version ?? (overview.moneyHidden ? 'customer' : 'internal'));
});

/** Exports are part of the audit trail, like the Pulse report library. */
export const logProgramReportExport = scoped(async function logProgramReportExport(ctx: DomainContext, report: ProgramReportDTO, format: 'csv' | 'html' | 'pdf'): Promise<void> {
  await logActivity(db, ctx, { verb: 'report.exported', entityType: 'report', meta: { report: 'program-month', program: report.key, month: report.month, version: report.version, format } });
});
