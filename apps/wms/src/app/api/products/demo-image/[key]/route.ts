/**
 * `GET /api/products/demo-image/<kind>-<hex>.svg` — deterministic demo product illustration
 * (seed catalog images, M09). Signed-in users only. The key is parsed against a fixed kind
 * table and a 6-digit hex colour, so the SVG is static markup; it is still served with a
 * sandboxing CSP and nosniff. Unknown keys answer a bare 404 so `<img onError>` falls back to
 * the placeholder.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { parseDemoImageKey, renderDemoImage } from '@/lib/grid-defs/products/demo-images';

export const GET = defineRoute({
  params: z.object({ key: z.string().max(64) }),
  rateLimit: { name: 'product-demo-image', limit: 900, windowMs: 60_000 },
  handler: ({ params }) => {
    const parsed = parseDemoImageKey(params.key);
    if (!parsed)
      return new Response(null, { status: 404, headers: { 'cache-control': 'private, max-age=300' } });
    const svg = renderDemoImage(parsed.kind, parsed.hex);
    return new Response(svg, {
      status: 200,
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'private, max-age=604800, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'content-disposition': 'inline',
      },
    });
  },
});
