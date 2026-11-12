/** `GET /api/auth/sso/metadata` — SAML 2.0 service-provider metadata (entity ID, ACS URL) for the identity provider. */
import { defineRoute } from '@/server/api/define-route';
import { samlMetadataXml } from '@/server/repositories/apps-sso';

export const GET = defineRoute({
  auth: 'public',
  handler: ({ request }) =>
    new Response(samlMetadataXml(new URL(request.url).origin), {
      headers: {
        'Content-Type': 'application/samlmetadata+xml; charset=utf-8',
        'Content-Disposition': 'inline; filename="kitstak-sp-metadata.xml"',
      },
    }),
});
