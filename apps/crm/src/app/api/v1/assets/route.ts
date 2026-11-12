import { withApi } from '@/server/api';
import { BadRequestError, PayloadTooLargeError } from '@/server/http/errors';
import { ASSET_MAX_BYTES, saveImageAsset } from '@/server/services/admin-assets';
import { created } from '../_lib/route-helpers';

const MULTIPART_OVERHEAD = 16 * 1024;

/** Upload a profile photo or organization logo (multipart `file`, image only, 2 MB). */
export const POST = withApi({ org: 'none' }, async (ctx) => {
  const contentType = ctx.request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) throw new BadRequestError('Expected multipart/form-data');
  const declared = Number(ctx.request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > ASSET_MAX_BYTES + MULTIPART_OVERHEAD) {
    throw new PayloadTooLargeError(ASSET_MAX_BYTES);
  }
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    throw new BadRequestError('The upload could not be read');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new BadRequestError('Attach an image in the "file" field');
  return created(await saveImageAsset(file));
});
