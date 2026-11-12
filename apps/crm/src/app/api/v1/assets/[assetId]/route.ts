import { z } from 'zod';
import { withApi } from '@/server/api';
import { ASSET_ID_RE, readImageAsset } from '@/server/services/admin-assets';

/** Serve an uploaded image to signed-in users (ids are unguessable v4 uuids). */
export const GET = withApi({ org: 'none', params: z.object({ assetId: z.string().regex(ASSET_ID_RE) }) }, async (ctx) => {
  const asset = await readImageAsset(ctx.params.assetId);
  return new Response(Buffer.from(asset.body), {
    status: 200,
    headers: {
      'Content-Type': asset.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
});
