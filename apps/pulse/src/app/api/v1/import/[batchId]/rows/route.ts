import { z } from 'zod';
import { appendImportRows, editImportRows, listImportRows } from '@/server/domain';
import { apiRoute } from '@/server/http/api';
import { intParam, oneOf } from '@/server/http/params';
import { parseBody } from '@/features/imports/server/body';
import { IMPORT_ACTIONS } from '@/features/imports/types';

type Params = { batchId: string };

/** `GET /api/v1/import/<batch>/rows?action=&offset=&limit=`: the preview rows with every message on its cell. */
export const GET = apiRoute<Params>(async ({ ctx, params, searchParams }) =>
  listImportRows(ctx, params.batchId, { action: oneOf(searchParams, 'action', [...IMPORT_ACTIONS, 'problems', 'all'] as const), offset: intParam(searchParams, 'offset', 0, 1_000_000), limit: intParam(searchParams, 'limit', 50, 500) }),
);

const cell = z.string().max(4000);
const appendSchema = z.object({ rows: z.array(z.object({ n: z.number().int().min(2).max(10_000_000), cells: z.array(cell).max(200) })).max(1000), done: z.boolean().optional() });

/** `POST /api/v1/import/<batch>/rows`: one chunk of raw rows, parsed in the browser, kept as plain strings. `done: true` on the last chunk closes the upload. */
export const POST = apiRoute<Params>(async ({ ctx, params, request }) => {
  const body = await parseBody(request, appendSchema);
  return appendImportRows(ctx, params.batchId, body.rows, { done: body.done });
});

const editSchema = z.object({ edits: z.array(z.object({ rowNumber: z.number().int().min(2), cells: z.array(cell).max(200).optional(), skip: z.boolean().optional() })).min(1).max(500) });

/** `PATCH /api/v1/import/<batch>/rows`: fix cells in place or leave rows out, then check again. */
export const PATCH = apiRoute<Params>(async ({ ctx, params, request }) => editImportRows(ctx, params.batchId, (await parseBody(request, editSchema)).edits));
