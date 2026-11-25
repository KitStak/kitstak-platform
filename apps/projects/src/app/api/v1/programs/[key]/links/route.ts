import { apiRoute } from '@/server/http/api';
import { listRecordLinksFor, requireProgram } from '@/server/domain/programs';

/** GET /api/v1/programs/:key/links (the Linked panel union). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => {
  const { program } = await requireProgram(ctx, decodeURIComponent(params.key));
  return listRecordLinksFor(ctx, { type: 'pm_program', id: program.id });
});
