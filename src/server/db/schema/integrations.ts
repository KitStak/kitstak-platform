/** Integrations: sales channels (stores) and carriers. */
import { index, integer, primaryKey, doublePrecision, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { CarrierSettingsInput, ChannelSettingsInput } from "../../../lib/domain-types";
import {
  CALL_STATUSES,
  CARRIER_CALL_STEPS,
  CARRIER_ENVIRONMENTS,
  CHANNEL_API_VERSIONS,
  CHANNEL_AUTH_METHODS,
  CHANNEL_CONNECTION_STATUSES,
  CHANNEL_DISTRIBUTIONS,
  CHANNEL_JOB_STATUSES,
  CHANNEL_METHODS,
  CHANNEL_MISSING_ORDER_STATUSES,
  CHANNEL_RUN_STATUSES,
  ACTIVE_PASSIVE,
  DESTINATION_TYPES,
  MARKUP_TYPES,
} from "../../../lib/enums";
import { bool, json, nowIso, pk, stamps } from "../columns";
import { clients, warehouses } from "./org";

export const channelConnections = pgTable("channel_connections", {
  id: pk(),
  provider: text("provider").notNull(), // one of CHANNEL_PROVIDERS
  storeName: text("store_name").notNull(),
  clientId: text("client_id").notNull().references(() => clients.id),
  distribution: text("distribution", { enum: CHANNEL_DISTRIBUTIONS }).notNull().default("Custom App"),
  authMethod: text("auth_method", { enum: CHANNEL_AUTH_METHODS }).notNull().default("Access Token"),
  credentialsEnc: text("credentials_enc"), // AES-256-GCM with INTEGRATION_KEY; never serialized to the client
  apiVersion: text("api_version", { enum: CHANNEL_API_VERSIONS }).notNull().default("GraphQL"),
  status: text("status", { enum: CHANNEL_CONNECTION_STATUSES }).notNull().default("Pending"),
  isActive: bool("is_active").notNull().default(true),
  settings: json<ChannelSettingsInput>("settings").notNull(),
  ...stamps(),
}, (t) => [index("channel_conn_client_idx").on(t.clientId)]);

export const channelLocationMappings = pgTable("channel_location_mappings", {
  id: pk(),
  connectionId: text("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  channelLocationId: text("channel_location_id").notNull(),
  channelLocationName: text("channel_location_name").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
}, (t) => [uniqueIndex("channel_loc_map_idx").on(t.connectionId, t.channelLocationId)]);

export const channelMethods = pgTable("channel_methods", {
  id: pk(),
  connectionId: text("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  method: text("method", { enum: CHANNEL_METHODS }).notNull(),
  status: text("status", { enum: ACTIVE_PASSIVE }).notNull(),
  intervalMinutes: integer("interval_minutes").notNull(),
  jobStatus: text("job_status", { enum: CHANNEL_JOB_STATUSES }).notNull().default("Waiting For Next"),
  nextRunAt: text("next_run_at"),
  lastRunAt: text("last_run_at"),
  lastSuccessAt: text("last_success_at"),
}, (t) => [uniqueIndex("channel_method_idx").on(t.connectionId, t.method)]);

export const channelRuns = pgTable("channel_runs", {
  id: pk(),
  methodId: text("method_id").notNull().references(() => channelMethods.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull(),
  method: text("method").notNull(),
  status: text("status", { enum: CHANNEL_RUN_STATUSES }).notNull(),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
}, (t) => [index("channel_runs_conn_idx").on(t.connectionId, t.startedAt)]);

export const channelRunItems = pgTable("channel_run_items", {
  id: pk(),
  runId: text("run_id").notNull().references(() => channelRuns.id, { onDelete: "cascade" }),
  success: bool("success").notNull(),
  properties: text("properties").notNull(),
  errorMessage: text("error_message"),
  storeOrderNumber: text("store_order_number"),
  sellerSku: text("seller_sku"),
  qty: integer("qty"),
  at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [index("channel_run_items_run_idx").on(t.runId)]);

export const channelMissingOrders = pgTable("channel_missing_orders", {
  id: pk(),
  connectionId: text("connection_id").notNull().references(() => channelConnections.id),
  orderCode: text("order_code").notNull(),
  channelOrderNumber: text("channel_order_number").notNull(),
  orderDate: text("order_date").notNull(),
  lastUpdated: text("last_updated").notNull(),
  lastErrorCode: text("last_error_code").notNull(), // 14-code catalog, src/lib/integration-errors.ts
  payload: text("payload").notNull(),
  status: text("status", { enum: CHANNEL_MISSING_ORDER_STATUSES }).notNull().default("Error"),
}, (t) => [index("channel_missing_conn_idx").on(t.connectionId, t.status)]);

export const carrierConnections = pgTable("carrier_connections", {
  id: pk(),
  provider: text("provider").notNull(), // one of CARRIER_PROVIDERS
  setupName: text("setup_name").notNull(),
  accountPrefix: text("account_prefix").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  environment: text("environment", { enum: CARRIER_ENVIRONMENTS }).notNull().default("Test"),
  credentialsEnc: text("credentials_enc"),
  payorAccountNumber: text("payor_account_number"),
  isActive: bool("is_active").notNull().default(true),
  allClients: bool("all_clients").notNull().default(true),
  allServices: bool("all_services").notNull().default(true),
  allPackages: bool("all_packages").notNull().default(true),
  settings: json<CarrierSettingsInput>("settings").notNull(),
  ...stamps(),
}, (t) => [index("carrier_conn_wh_idx").on(t.warehouseId)]);

export const carrierConnectionClients = pgTable("carrier_connection_clients", {
  connectionId: text("connection_id").notNull().references(() => carrierConnections.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => clients.id),
  markupType: text("markup_type", { enum: MARKUP_TYPES }),
  markupAmount: doublePrecision("markup_amount"),
  hasAccess: bool("has_access").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.connectionId, t.clientId] })]);

export const carrierServices = pgTable("carrier_services", {
  id: pk(),
  connectionId: text("connection_id").notNull().references(() => carrierConnections.id, { onDelete: "cascade" }),
  carrierCode: text("carrier_code").notNull(),
  serviceCode: text("service_code").notNull(),
  name: text("name").notNull(),
  isActive: bool("is_active").notNull().default(true),
  transitDays: integer("transit_days").notNull(),
  isInternational: bool("is_international").notNull().default(false),
}, (t) => [uniqueIndex("carrier_service_idx").on(t.connectionId, t.serviceCode)]);

export const carrierPackages = pgTable("carrier_packages", {
  id: pk(),
  connectionId: text("connection_id").notNull().references(() => carrierConnections.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  isActive: bool("is_active").notNull().default(true),
}, (t) => [uniqueIndex("carrier_package_idx").on(t.connectionId, t.code)]);

export const carrierThirdPartyAccounts = pgTable("carrier_third_party_accounts", {
  id: pk(),
  connectionId: text("connection_id").notNull().references(() => carrierConnections.id, { onDelete: "cascade" }),
  accountNumber: text("account_number").notNull(),
  billingCountry: text("billing_country").notNull(),
  billingZip: text("billing_zip").notNull(),
}, (t) => [index("carrier_3p_conn_idx").on(t.connectionId)]);

export const carrierCallLogs = pgTable("carrier_call_logs", {
  id: pk(),
  step: text("step", { enum: CARRIER_CALL_STEPS }).notNull(),
  connectionId: text("connection_id").notNull(),
  orderId: text("order_id"),
  shipmentId: text("shipment_id"),
  trackingNumber: text("tracking_number"),
  destinationType: text("destination_type", { enum: DESTINATION_TYPES }),
  status: text("status", { enum: CALL_STATUSES }).notNull(),
  httpCode: integer("http_code").notNull(),
  error: text("error"),
  responseMs: integer("response_ms").notNull(),
  serviceName: text("service_name"),
  warehouseId: text("warehouse_id").notNull(),
  clientId: text("client_id"),
  userId: text("user_id"),
  source: text("source"), // BatchPacking | PackingStation | OrderGrid | ShipmentPlan
  labelType: text("label_type"),
  rateShoppingName: text("rate_shopping_name"),
  requestJson: text("request_json").notNull(),
  responseJson: text("response_json").notNull(),
  at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [
  index("carrier_logs_step_idx").on(t.step, t.at),
  index("carrier_logs_order_idx").on(t.orderId),
]);
