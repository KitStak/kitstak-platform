/** POST → board export as a CSV or XLSX download. Every export is audited. */
import { withApi } from '@/server/api';
import { exportSchema } from '@/server/services/import-export-contracts';
import { exportBoard } from '@/server/services/import-export-export';
import { svc } from '../_lib/route-helpers';

export const runtime = 'nodejs';

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const POST = withApi(
  { permission: 'data:export', planRead: true, rateLimit: 'heavy', body: exportSchema, maxBodyBytes: 512 * 1024 },
  async (ctx) => {
    const file = await exportBoard(svc(ctx), ctx.body);
    await ctx.audit({
      action: 'data.exported',
      targetType: 'board',
      targetId: ctx.body.boardId,
      metadata: {
        format: ctx.body.format,
        rows: file.rowCount,
        includeSubitems: ctx.body.includeSubitems,
        scope: ctx.body.itemIds?.length ? 'selection' : ctx.body.groupId ? 'group' : 'board',
      },
    });
    return new Response(file.body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': contentDisposition(file.fileName),
        'Cache-Control': 'no-store',
        'X-Export-Rows': String(file.rowCount),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
);
