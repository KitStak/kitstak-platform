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
}).superRefine((v, ctx) => {
  if (v.distribution !== "Custom App") return;
  if (v.authMethod === "Access Token" && !v.accessToken) ctx.addIssue({ code: "custom", path: ["accessToken"], message: "Access token is required" });
  if (v.authMethod === "Client ID & Secret") {
    if (!v.apiClientId) ctx.addIssue({ code: "custom", path: ["apiClientId"], message: "Client ID is required" });
    if (!v.apiClientSecret) ctx.addIssue({ code: "custom", path: ["apiClientSecret"], message: "Client secret is required" });
  }
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
