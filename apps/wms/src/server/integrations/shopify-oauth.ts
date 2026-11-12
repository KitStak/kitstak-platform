/**
 * Shopify Public App install (OAuth 2.0 authorization code grant), M12.
 *
 *   POST /api/channels/shopify/install  → signed state + nonce cookie → authorize URL
 *   GET  /api/channels/shopify/callback → verify HMAC, state, nonce and shop → exchange code →
 *                                         create the "Public App" connection → back to the list
 *
 * Enabled when SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are set (the Partner Dashboard app's
 * API key and secret). The redirect URL is `${APP_URL or request origin}/api/channels/shopify/callback`
 * and must be listed under the app's Allowed redirection URLs.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ChannelApiError, fetchJson, rec, strOrNull } from './channel-adapter';

export const SHOPIFY_OAUTH_COOKIE = 'ks_shopify_oauth';
export const SHOPIFY_CALLBACK_PATH = '/api/channels/shopify/callback';
const STATE_TTL_MS = 10 * 60_000;

/** Orders, products, inventory, locations and fulfillment orders: what the four channel methods use. */
export const SHOPIFY_PUBLIC_APP_SCOPES = [
  'read_orders',
  'write_orders',
  'read_products',
  'read_inventory',
  'write_inventory',
  'read_locations',
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
  'read_assigned_fulfillment_orders',
  'write_assigned_fulfillment_orders',
  'read_fulfillments',
  'write_fulfillments',
] as const;

export interface ShopifyAppConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: string;
}

export function shopifyPublicAppConfig(env: NodeJS.ProcessEnv = process.env): ShopifyAppConfig | null {
  const clientId = env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    scopes: env.SHOPIFY_SCOPES?.trim() || SHOPIFY_PUBLIC_APP_SCOPES.join(','),
  };
}

/** "bluebird-main", "bluebird-main.myshopify.com", "https://bluebird-main.myshopify.com/admin" → "bluebird-main.myshopify.com". */
export function normalizeShopDomain(input: string): string | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const handle = s.endsWith('.myshopify.com') ? s.slice(0, -'.myshopify.com'.length) : s;
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(handle) ? `${handle}.myshopify.com` : null;
}

export interface OAuthState {
  readonly userId: string;
  readonly clientId: string;
  readonly shop: string;
  readonly nonce: string;
  readonly exp: number;
}

const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function newNonce(): string {
  return randomBytes(18).toString('base64url');
}

export function signState(state: OAuthState, secret: string): string {
  const data = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${data}.${sign(data, secret)}`;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Null when the signature, expiry or shape is wrong. */
export function verifyState(token: string, secret: string, now = Date.now()): OAuthState | null {
  const [data, mac] = token.split('.');
  if (!data || !mac || !safeEqual(mac, sign(data, secret))) return null;
  try {
    const s = rec(JSON.parse(Buffer.from(data, 'base64url').toString('utf8')));
    const state: OAuthState = {
      userId: String(s.userId ?? ''),
      clientId: String(s.clientId ?? ''),
      shop: String(s.shop ?? ''),
      nonce: String(s.nonce ?? ''),
      exp: Number(s.exp),
    };
    if (!state.userId || !state.clientId || !state.shop || !state.nonce || !(state.exp > now)) return null;
    return state;
  } catch {
    return null;
  }
}

export const stateExpiry = (now = Date.now()) => now + STATE_TTL_MS;

/** Shopify's callback HMAC: hex HMAC-SHA256 of the sorted query without `hmac` / `signature`. */
export function verifyShopifyHmac(params: URLSearchParams, secret: string): boolean {
  const given = params.get('hmac');
  if (!given) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return safeEqual(createHmac('sha256', secret).update(message).digest('hex'), given.toLowerCase());
}

export function authorizeUrl(
  cfg: ShopifyAppConfig,
  shop: string,
  state: string,
  redirectUri: string,
): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    scope: cfg.scopes,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${q.toString()}`;
}

export async function exchangeShopifyCode(
  cfg: ShopifyAppConfig,
  shop: string,
  code: string,
): Promise<{ accessToken: string; scope: string }> {
  const body = rec(
    await fetchJson(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code }),
    }),
  );
  const accessToken = strOrNull(body.access_token);
  if (!accessToken) throw new ChannelApiError('Shopify did not return an access token', 502);
  return { accessToken, scope: String(body.scope ?? '') };
}
