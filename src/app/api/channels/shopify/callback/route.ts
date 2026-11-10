/**
 * `GET /api/channels/shopify/callback` — Shopify redirects here after the merchant approves the
 * KitStak app. Verifies HMAC + signed state + browser nonce, exchanges the code, creates the
 * Public App connection and returns to the Shopify connection list (errors come back as `?oauthError=`).
 */
import { NextResponse } from "next/server";
import { defineRoute } from "@/server/api/define-route";
import { describeError } from "@/server/domain/errors";
import { SHOPIFY_CALLBACK_PATH, SHOPIFY_OAUTH_COOKIE } from "@/server/integrations/shopify-oauth";
import { finishShopifyInstall } from "@/server/repositories/channels";

export const GET = defineRoute({
  permission: "integrations.integrations.create_setup",
  handler: async ({ db, auth, actor, request, searchParams }) => {
    const origin = process.env.APP_URL?.replace(/\/+$/, "") || new URL(request.url).origin;
    const back = new URL("/integrations/channels/shopify", origin);
    try {
      const detail = await finishShopifyInstall(db, auth, actor, searchParams, request.cookies.get(SHOPIFY_OAUTH_COOKIE)?.value ?? null);
      back.searchParams.set("connected", detail.id);
    } catch (error) {
      back.searchParams.set("oauthError", describeError(error).message.slice(0, 200));
    }
    const res = NextResponse.redirect(back, 303);
    res.cookies.set(SHOPIFY_OAUTH_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: SHOPIFY_CALLBACK_PATH, maxAge: 0 });
    return res;
  },
});
