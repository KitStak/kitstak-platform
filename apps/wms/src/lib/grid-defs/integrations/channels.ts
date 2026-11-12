/** Channel connections: Connect Store + Edit Store Connection schemas (M12, spec 06 §7a). PURE. */
import { z } from "zod";
import { channelSettingsSchema } from "@/lib/domain-types";
import { CHANNEL_API_VERSIONS, CHANNEL_AUTH_METHODS, CHANNEL_METHODS } from "@/lib/enums";
import { requiredId, versionField, type IntegrationField } from "./common";

export const CHANNEL_CONNECTIONS_GRID_KEY = "channel-connections";

export const CHANNEL_CONNECTION_FIELDS: readonly IntegrationField[] = [
  { field: "storeName", label: "Store name", type: "text" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "status", label: "Status", type: "enum", options: ["Pending", "Completed", "Error"] },
  { field: "isActive", label: "Connection active", type: "boolean" },
  { field: "distribution", label: "App type", type: "enum", options: ["Custom App", "Public App", "API"] },
];
export const CHANNEL_CONNECTION_SORT_FIELDS = ["storeName", "clientName", "status", "isActive", "createdAt", "lastOrderAt"] as const;

export const STORE_NAME_MAX = 60;

type AuthMethod = (typeof CHANNEL_AUTH_METHODS)[number];

/** Extra credentials stored encrypted with the token / client pair (Amazon, BigCommerce, Etsy, TikTok Shop). */
export const EXTRA_CREDENTIAL_KEYS = ["refreshToken", "sellerId", "marketplaceId", "storeHash", "shopId", "apiKey", "userAccessToken", "shopCipher"] as const;
export type ExtraCredentialKey = (typeof EXTRA_CREDENTIAL_KEYS)[number];

/** Extra credential a channel needs besides the token / client pair. */
export interface ExtraCredentialField {
  readonly key: ExtraCredentialKey;
  readonly label: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly hint?: string;
  readonly placeholder?: string;
}

/** How the Connect Store drawer asks for one channel's credentials (labels follow each API's own names). */
export interface ChannelCredentialProfile {
  readonly authMethods: readonly AuthMethod[];
  readonly storeLabel: string;
  readonly storePlaceholder: string;
  readonly storeHint: string;
  readonly tokenLabel: string;
  readonly clientIdLabel: string;
  readonly clientSecretLabel: string;
  readonly extra: readonly ExtraCredentialField[];
  /** REST / GraphQL choice (Shopify only). */
  readonly apiVersionChoice: boolean;
  readonly help: string;
}

const PROFILE_DEFAULT: ChannelCredentialProfile = {
  authMethods: ["Access Token", "Client ID & Secret"], storeLabel: "Store name", storePlaceholder: "Store name", storeHint: "",
  tokenLabel: "Access token", clientIdLabel: "Client ID", clientSecretLabel: "Client secret", extra: [], apiVersionChoice: false, help: "",
};

export const CHANNEL_CREDENTIAL_PROFILES: Readonly<Record<string, ChannelCredentialProfile>> = {
  shopify: { ...PROFILE_DEFAULT, storeLabel: "Your Shopify store name", storePlaceholder: "bluebird-main", storeHint: "e.g. bluebird-main (we connect to bluebird-main.myshopify.com)", apiVersionChoice: true,
    help: "Create a custom app in Shopify admin → Settings → Apps and sales channels → Develop apps, grant orders, products, inventory, locations and fulfillments scopes, then paste its Admin API access token." },
  shipstation: { ...PROFILE_DEFAULT, authMethods: ["Client ID & Secret"], storeLabel: "ShipStation account name", storePlaceholder: "Main account", storeHint: "A name for this ShipStation account.",
    clientIdLabel: "API key", clientSecretLabel: "API secret", help: "In ShipStation go to Settings → Account → API Settings and generate an API key and secret." },
  woocommerce: { ...PROFILE_DEFAULT, authMethods: ["Client ID & Secret"], storeLabel: "Store URL", storePlaceholder: "shop.example.com", storeHint: "The WordPress site address; HTTPS is required.",
    clientIdLabel: "Consumer key", clientSecretLabel: "Consumer secret", help: "In WordPress go to WooCommerce → Settings → Advanced → REST API, add a key with Read/Write permission, and paste the consumer key and secret." },
  ebay: { ...PROFILE_DEFAULT, authMethods: ["Access Token"], storeLabel: "eBay seller username", storePlaceholder: "bluebird_main", storeHint: "Shown as the Store on downloaded orders.",
    tokenLabel: "User access token (OAuth)", help: "Generate a user token in the eBay Developer Program with the sell.fulfillment and sell.inventory scopes for this seller." },
  walmart: { ...PROFILE_DEFAULT, authMethods: ["Client ID & Secret"], storeLabel: "Walmart seller name", storePlaceholder: "Bluebird & Main", storeHint: "Shown as the Store on downloaded orders.",
    help: "In Walmart Seller Center go to Settings → API Key Management and copy the Client ID and Client Secret for the Marketplace API." },
  amazon: { ...PROFILE_DEFAULT, authMethods: ["Client ID & Secret"], storeLabel: "Amazon store name", storePlaceholder: "Bluebird & Main US", storeHint: "Shown as the Store on downloaded orders.",
    clientIdLabel: "LWA client ID", clientSecretLabel: "LWA client secret",
    extra: [
      { key: "refreshToken", label: "Refresh token", required: true, secret: true, hint: "From authorising the SP-API app for this seller (starts with Atzr|)." },
      { key: "sellerId", label: "Seller ID (Merchant token)", required: true, secret: false, placeholder: "A1B2C3D4E5F6G7", hint: "Seller Central → Settings → Account Info → Merchant Token." },
      { key: "marketplaceId", label: "Marketplace ID", required: false, secret: false, placeholder: "ATVPDKIKX0DER", hint: "Leave blank for Amazon.com (US)." },
    ],
    help: "Register an SP-API app (Orders, Listings and Shipping roles, plus the restricted shipping-address role), authorise it for the seller, and paste the LWA credentials and refresh token." },
  bigcommerce: { ...PROFILE_DEFAULT, authMethods: ["Access Token"], storeLabel: "BigCommerce store name", storePlaceholder: "Bluebird & Main", storeHint: "Shown as the Store on downloaded orders.",
    tokenLabel: "API account access token",
    extra: [{ key: "storeHash", label: "Store hash", required: true, secret: false, placeholder: "abc123xyz", hint: "The part after /stores/ in the API path (https://api.bigcommerce.com/stores/{hash}/v3/)." }],
    help: "In BigCommerce go to Settings → Store-level API accounts → Create API account, grant Orders (modify), Products (modify), Information & settings (read-only) and Store inventory (modify), then paste the access token and the store hash from the API path." },
  magento: { ...PROFILE_DEFAULT, authMethods: ["Access Token"], storeLabel: "Store URL", storePlaceholder: "shop.example.com", storeHint: "The Magento base URL; HTTPS is required.",
    tokenLabel: "Integration access token",
    help: "In Magento admin go to System → Extensions → Integrations → Add New Integration, allow Sales, Catalog and Stores resources, activate it, and paste the Access Token. Make sure 'Allow OAuth Access Tokens to be used as standalone Bearer tokens' is Yes under Stores → Configuration → Services → OAuth." },
  etsy: { ...PROFILE_DEFAULT, authMethods: ["Access Token"], storeLabel: "Etsy shop name", storePlaceholder: "BluebirdAndMain", storeHint: "Shown as the Store on downloaded orders.",
    tokenLabel: "OAuth access token",
    extra: [
      { key: "apiKey", label: "App keystring (API key)", required: true, secret: true, hint: "From your app on etsy.com/developers/your-apps." },
      { key: "shopId", label: "Shop ID", required: true, secret: false, placeholder: "12345678", hint: "The numeric shop ID (GET /v3/application/users/me returns it)." },
      { key: "refreshToken", label: "Refresh token", required: false, secret: true, hint: "Recommended: access tokens last one hour; KitStak renews them with the refresh token." },
    ],
    help: "Create an app at etsy.com/developers, authorise it for the shop with the transactions_r, transactions_w, listings_r and listings_w scopes (OAuth 2.0 with PKCE), then paste the keystring, the access and refresh tokens and the shop ID." },
  tiktok: { ...PROFILE_DEFAULT, authMethods: ["Client ID & Secret"], storeLabel: "TikTok shop name", storePlaceholder: "Bluebird & Main", storeHint: "Shown as the Store on downloaded orders.",
    clientIdLabel: "App key", clientSecretLabel: "App secret",
    extra: [
      { key: "userAccessToken", label: "Seller access token", required: true, secret: true, hint: "From authorising your app for the shop (Partner Center → App → Authorization)." },
      { key: "refreshToken", label: "Refresh token", required: false, secret: true, hint: "Recommended: access tokens expire after about 7 days; KitStak renews them with the refresh token." },
      { key: "shopCipher", label: "Shop cipher", required: false, secret: false, hint: "Leave blank to use the first shop the token is authorised for." },
    ],
    help: "In TikTok Shop Partner Center create a custom app with the Order, Product, Logistics and Fulfillment scopes, authorise it for your shop, and paste the app key, app secret and the seller's access and refresh tokens." },
};

export function channelCredentialProfile(provider: string): ChannelCredentialProfile {
  return CHANNEL_CREDENTIAL_PROFILES[provider] ?? PROFILE_DEFAULT;
}

export const connectStoreSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  distribution: z.enum(["Custom App", "API", "Public App"]),
  storeName: z.string({ error: "Store name is required" }).trim().min(1, "Store name is required").max(STORE_NAME_MAX, `At most ${STORE_NAME_MAX} characters`),
  clientId: requiredId("Client"),
  authMethod: z.enum(CHANNEL_AUTH_METHODS).default("Access Token"),
  apiVersion: z.enum(CHANNEL_API_VERSIONS).default("GraphQL"),
  accessToken: z.string().trim().max(500).optional(),
  apiClientId: z.string().trim().max(200).optional(),
  apiClientSecret: z.string().trim().max(500).optional(),
  refreshToken: z.string().trim().max(1000).optional(),
  sellerId: z.string().trim().max(40).regex(/^[A-Z0-9]*$/i, "Letters and digits only").optional(),
  marketplaceId: z.string().trim().max(20).regex(/^[A-Z0-9]*$/i, "Letters and digits only").optional(),
  storeHash: z.string().trim().max(40).regex(/^[A-Z0-9]*$/i, "Letters and digits only").optional(),
  shopId: z.string().trim().max(20).regex(/^d*$/, "Digits only").optional(),
  apiKey: z.string().trim().max(200).optional(),
  userAccessToken: z.string().trim().max(1000).optional(),
  shopCipher: z.string().trim().max(200).optional(),
}).superRefine((v, ctx) => {
  if (v.distribution !== "Custom App") return;
  const profile = channelCredentialProfile(v.provider);
  if (!profile.authMethods.includes(v.authMethod)) {
    ctx.addIssue({ code: "custom", path: ["authMethod"], message: `Use ${profile.authMethods.join(" or ")} for this channel` });
    return;
  }
  if (v.authMethod === "Access Token" && !v.accessToken) ctx.addIssue({ code: "custom", path: ["accessToken"], message: `${profile.tokenLabel} is required` });
  if (v.authMethod === "Client ID & Secret") {
    if (!v.apiClientId) ctx.addIssue({ code: "custom", path: ["apiClientId"], message: `${profile.clientIdLabel} is required` });
    if (!v.apiClientSecret) ctx.addIssue({ code: "custom", path: ["apiClientSecret"], message: `${profile.clientSecretLabel} is required` });
  }
  for (const x of profile.extra) if (x.required && !v[x.key]) ctx.addIssue({ code: "custom", path: [x.key], message: `${x.label} is required` });
});
export type ConnectStoreInput = z.input<typeof connectStoreSchema>;

export const mappingSchema = z.object({
  channelLocationId: z.string().trim().min(1, "Choose a store location").max(100),
  channelLocationName: z.string().trim().min(1).max(200),
  warehouseId: requiredId("Warehouse"),
});

export const intervalsSchema = z.partialRecord(z.enum(CHANNEL_METHODS), z.number().int().min(5, "At least every 5 minutes").max(10_080, "At most once a week"));

export const editStoreSchema = z.object({
  storeName: z.string().trim().min(1, "Store name is required").max(STORE_NAME_MAX),
  isActive: z.boolean(),
  apiVersion: z.enum(CHANNEL_API_VERSIONS),
  /** Optional credential rotation; blank keeps the stored secret. */
  authMethod: z.enum(CHANNEL_AUTH_METHODS).optional(),
  accessToken: z.string().trim().max(500).optional(),
  apiClientId: z.string().trim().max(200).optional(),
  apiClientSecret: z.string().trim().max(500).optional(),
  mappings: z.array(mappingSchema).max(100),
  settings: channelSettingsSchema,
  intervals: intervalsSchema.default({}),
  version: versionField,
}).superRefine((v, ctx) => {
  const seen = new Set<string>();
  v.mappings.forEach((m, i) => {
    if (seen.has(m.channelLocationId)) ctx.addIssue({ code: "custom", path: ["mappings", i, "channelLocationId"], message: "Each store location can map to one warehouse" });
    seen.add(m.channelLocationId);
  });
  const anyMethod = v.settings.orders.download || v.settings.inventory.sync || v.settings.shipments.sendShipmentInfo;
  if (anyMethod && v.mappings.length === 0) ctx.addIssue({ code: "custom", path: ["mappings"], message: "Link at least one store location to a warehouse before turning on orders, inventory or shipments" });
  if (v.settings.orders.download && v.settings.paymentStatuses.length === 0) ctx.addIssue({ code: "custom", path: ["settings", "paymentStatuses"], message: "Choose at least one payment status to download" });
});
export type EditStoreInput = z.input<typeof editStoreSchema>;
export type EditStoreSave = z.output<typeof editStoreSchema>;

export const PAYMENT_STATUSES = ["paid", "partially_paid", "authorized", "pending", "partially_refunded"] as const;
export const SHIPMENT_ORDER_TYPES = ["D2C Order", "B2B Order"] as const;
export const PRODUCT_UOMS = ["Unit", "Each", "Case", "Pack"] as const;

/** Which channel method each configuration toggle drives. */
export function methodActiveFlags(settings: z.output<typeof channelSettingsSchema>): Readonly<Record<(typeof CHANNEL_METHODS)[number], boolean>> {
  return {
    "Download Orders": settings.orders.download,
    "Download Products": settings.products.download,
    "Sync Inventory": settings.inventory.sync,
    "Send Shipment Info": settings.shipments.sendShipmentInfo,
  };
}
