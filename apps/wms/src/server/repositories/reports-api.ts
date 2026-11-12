/**
 * Shared list-route + export-provider factories for the M13 report grids: one permission,
 * the grid grammar and the viewer's scope, identical for the list endpoint and the export.
 */
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import type { ExportPage, ExportProvider } from '@/server/exports/types';
import type { GridQuery } from '@/server/query/grid-query';
import { exportColumnsOf, type ReportDef } from '@/lib/grid-defs/reports/types';
import { reportZoneOffset, type ReportPage, type ReportQuery } from './reports-grid';

export type ReportLister = (
  db: AppDb,
  auth: AuthContext,
  query: ReportQuery,
) => Promise<ReportPage<Record<string, unknown>>>;

export function reportListRoute(def: ReportDef, list: ReportLister) {
  return defineRoute({
    name: `GET ${def.path}`,
    permission: def.permission,
    handler: async ({ db, auth, grid }) => {
      const query = { ...grid(), tzOffsetMinutes: await reportZoneOffset(db, auth.viewScope.warehouseIds) };
      const { rows, total } = await list(db, auth, query);
      return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
    },
  });
}

export function reportExportProvider(def: ReportDef, list: ReportLister): ExportProvider {
  return {
    columns: exportColumnsOf(def).filter((c) => c.key !== 'action'),
    fetchPage: async (ctx, page, pageSize): Promise<ExportPage> => {
      const result = await list(ctx.db, ctx.auth, {
        ...ctx.query,
        page,
        pageSize,
        tzOffsetMinutes: await reportZoneOffset(ctx.db, ctx.auth.viewScope.warehouseIds),
      });
      return { rows: result.rows, total: result.total };
    },
  };
}
