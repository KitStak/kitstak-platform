/**
 * `GET /api/products/image?u=<image url>` — same-origin proxy for product / listing images
 * (merchant CDN URLs are blocked by the app CSP). Signed-in users only; SSRF-hardened and
 * cached in `products-image.ts`. Failures answer a bare status so `<img onError>` falls back
 * to the product initials. M09.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { ImageProxyError, getProductImage } from '@/server/repositories/products-image';

export const GET = defineRoute({
  query: z.object({ u: z.string().trim().min(1).max(2000) }),
  rateLimit: { name: 'product-image', limit: 900, windowMs: 60_000 },
  handler: async ({ query }) => {
    try {
      const img = await getProductImage(query.u);
      return new Response(new Uint8Array(img.bytes), {
        status: 200,
        headers: {
          'content-type': img.contentType,
          'content-length': String(img.bytes.length),
          'cache-control': 'private, max-age=86400',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
          'content-disposition': 'inline',
        },
      });
    } catch (error) {
      const status = error instanceof ImageProxyError ? error.status : 502;
      return new Response(null, {
        status,
        headers: {
          'cache-control': 'private, max-age=300',
          'x-image-error': error instanceof Error ? error.message.slice(0, 120) : 'error',
        },
      });
    }
  },
});
