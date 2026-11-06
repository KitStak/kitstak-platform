import { z } from 'zod';
import { withApi } from '@/server/api';
import { deleteFile, readFileForDownload } from '@/server/services/files';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('fileId');

/** Authenticated download; inline only for safe types (`?download=1` forces attachment). */
export const GET = withApi(
  { permission: 'file:read', params, query: z.object({ download: z.enum(['0', '1']).optional() }) },
  async (ctx) => {
    const file = await readFileForDownload(svc(ctx), ctx.params.fileId, ctx.query.download === '1');
    return new Response(Buffer.from(file.body), { status: 200, headers: file.headers });
  },
);

export const DELETE = withApi({ permission: 'file:write', params }, (ctx) =>
  deleteFile(svc(ctx), ctx.params.fileId),
);
