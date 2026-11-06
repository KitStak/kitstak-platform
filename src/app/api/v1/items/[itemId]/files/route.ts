import { withApi } from '@/server/api';
import { env } from '@/server/env';
import { BadRequestError, PayloadTooLargeError } from '@/server/http/errors';
import { listItemFiles, uploadFile } from '@/server/services/files';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('itemId');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMN_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const MULTIPART_OVERHEAD = 64 * 1024;

export const GET = withApi({ permission: 'file:read', params }, (ctx) =>
  listItemFiles(svc(ctx), ctx.params.itemId),
);

/** multipart/form-data: `file` (required), `updateId`, `columnKey` (optional). */
export const POST = withApi({ permission: 'file:write', params }, async (ctx) => {
  const contentType = ctx.request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data'))
    throw new BadRequestError('Expected multipart/form-data');
  const declared = Number(ctx.request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > env.MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD)
    throw new PayloadTooLargeError(env.MAX_UPLOAD_BYTES);
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    throw new BadRequestError('The upload could not be read');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new BadRequestError('Attach a file in the "file" field');
  const updateId = form.get('updateId');
  const columnKey = form.get('columnKey');
  if (updateId !== null && (typeof updateId !== 'string' || !UUID.test(updateId)))
    throw new BadRequestError('Invalid updateId');
  if (columnKey !== null && (typeof columnKey !== 'string' || !COLUMN_KEY.test(columnKey)))
    throw new BadRequestError('Invalid columnKey');
  return created(
    await uploadFile(svc(ctx), {
      itemId: ctx.params.itemId,
      updateId: typeof updateId === 'string' ? updateId : null,
      columnKey: typeof columnKey === 'string' ? columnKey : null,
      file,
    }),
  );
});
