/** `POST /api/channels/shopify/install { storeName, clientId }` — Shopify Public App: returns the authorize URL and sets the browser nonce. */
import { defineRoute } from '@/server/api/define-route';
import { jsonOk } from '@/server/api/envelope';
import { SHOPIFY_CALLBACK_PATH, SHOPIFY_OAUTH_COOKIE } from '@/server/integrations/shopify-oauth';
import { shopifyInstallSchema, startShopifyInstall } from '@/server/repositories/channels';

export const POST = defineRoute({
  permission: 'integrations.integrations.create_setup',
  body: shopifyInstallSchema,
  transaction: false,
  handler: async ({ db, auth, actor, body, request, requestId }) => {
    const origin = process.env.APP_URL?.replace(/\/+$/, '') || new URL(request.url).origin;
    const { url, nonce } = await startShopifyInstall(db, auth, actor, body, origin);
    const res = jsonOk({ url }, { headers: { 'x-request-id': requestId } });
    res.cookies.set(SHOPIFY_OAUTH_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: SHOPIFY_CALLBACK_PATH,
      maxAge: 600,
    });
    return res;
  },
});
