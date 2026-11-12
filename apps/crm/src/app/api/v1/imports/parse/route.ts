/** POST multipart/form-data `file` → parsed sheets (server-validated type & size). */
import { withApi } from '@/server/api';
import { BadRequestError } from '@/server/http/errors';
import { IMPORT_MAX_FILE_BYTES, parseImportFile } from '@/server/services/import-export-parse';

export const runtime = 'nodejs';

const MULTIPART_OVERHEAD = 64 * 1024;

export const POST = withApi({ permission: 'data:import', rateLimit: 'mutation', rateLimitCost: 5 }, async (ctx) => {
  const contentType = ctx.request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data'))
    throw new BadRequestError('Expected multipart/form-data');
  const declared = Number(ctx.request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > IMPORT_MAX_FILE_BYTES + MULTIPART_OVERHEAD)
    throw new BadRequestError('This file is larger than 10 MB. Split it into smaller files and import them one at a time.');
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    throw new BadRequestError('The upload could not be read');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new BadRequestError('Attach a file in the "file" field');
  const name = (file.name || 'import.csv').slice(0, 255);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseImportFile(name, bytes);
});
