/** Organization: warehouses, clients, addresses, customers, vendors, retailers. */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ClientSettingsInput } from "../../../lib/domain-types";
import {
  ACTIVE_STATUSES,
  ADDRESS_OWNER_TYPES,
  ADDRESS_TYPES,
  ADDRESS_USAGE_TYPES,
  CLIENT_BILLING_PLANS,
  WAREHOUSE_TYPES,
} from "../../../lib/enums";
import { bool, customFields, EMPTY_JSON_OBJECT, json, pk, stamps } from "../columns";

export const warehouses = sqliteTable("warehouses", {
  id: pk(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  addressLine: text("address_line").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  isDefault: bool("is_default").notNull().default(false),
  prefix: text("prefix").notNull().default(""),
  addressLine2: text("address_line2"),
  postalCode: text("postal_code"),
  country: text("country").notNull().default("United States"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  email: text("email"),
  type: text("type", { enum: WAREHOUSE_TYPES }).notNull().default("Internal"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  dayShiftStart: text("day_shift_start").notNull().default("08:00"),
  dayShiftEnd: text("day_shift_end").notNull().default("17:00"),
  defaultDimensionUnit: text("default_dimension_unit").notNull().default("Inch"),
  defaultWeightUnit: text("default_weight_unit").notNull().default("Pound"),
  useLpDimsForPutaway: bool("use_lp_dims_for_putaway").notNull().default(false),
  defaultReceivingLocationId: text("default_receiving_location_id"),
  defaultShipLocationId: text("default_ship_location_id"),
  defaultReturnLocationId: text("default_return_location_id"),
  mandatoryAdjustmentReason: bool("mandatory_adjustment_reason").notNull().default(true),
  mandatoryCountReason: bool("mandatory_count_reason").notNull().default(false),
  mobileAutoLogoutMinutes: integer("mobile_auto_logout_minutes").default(30),
  isActive: bool("is_active").notNull().default(true),
  ...stamps(),
}, (t) => [uniqueIndex("warehouses_code_idx").on(t.code)]);

export const clients = sqliteTable("clients", {
  id: pk(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  phone: text("phone").notNull(),
  billingPlan: text("billing_plan", { enum: CLIENT_BILLING_PLANS }).notNull(),
  status: text("status", { enum: ACTIVE_STATUSES }).notNull(),
  officialName: text("official_name"),
  taxId: text("tax_id"),
  currency: text("currency").notNull().default("USD"),
  settings: json<ClientSettingsInput>("settings").notNull().default(EMPTY_JSON_OBJECT),
  ...customFields(),
  ...stamps(),
}, (t) => [uniqueIndex("clients_code_idx").on(t.code)]);

export const addresses = sqliteTable("addresses", {
  id: pk(),
  ownerType: text("owner_type", { enum: ADDRESS_OWNER_TYPES }).notNull(),
  ownerId: text("owner_id").notNull(),
  name: text("name"),
  usageType: text("usage_type", { enum: ADDRESS_USAGE_TYPES }).notNull().default("Shipping"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  companyName: text("company_name"),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  state: text("state"),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull(),
  phone: text("phone"),
  email: text("email"),
  addressType: text("address_type", { enum: ADDRESS_TYPES }),
  isDefault: bool("is_default").notNull().default(false),
  isActive: bool("is_active").notNull().default(true),
  ...stamps(),
}, (t) => [index("addresses_owner_idx").on(t.ownerType, t.ownerId)]);

export const customers = sqliteTable("customers", {
  id: pk(),
  clientId: text("client_id").notNull().references(() => clients.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  isActive: bool("is_active").notNull().default(true),
  ...stamps(),
}, (t) => [index("customers_client_idx").on(t.clientId)]);

export const vendors = sqliteTable("vendors", {
  id: pk(),
  clientId: text("client_id").notNull().references(() => clients.id),
  displayName: text("display_name").notNull(),
  vendorName: text("vendor_name").notNull(),
  useShipAsBilling: bool("use_ship_as_billing").notNull().default(true),
  isActive: bool("is_active").notNull().default(true),
  ...stamps(),
}, (t) => [uniqueIndex("vendors_client_name_idx").on(t.clientId, t.displayName)]);

export const retailers = sqliteTable("retailers", {
  id: pk(),
  name: text("name").notNull(),
  description: text("description"),
  businessName: text("business_name"),
  logoFileId: text("logo_file_id"),
  isActive: bool("is_active").notNull().default(true),
  createCaseLabels: bool("create_case_labels").notNull().default(false),
  caseLabelPrintQty: integer("case_label_print_qty").notNull().default(1),
  lpLabelPrintQty: integer("lp_label_print_qty").notNull().default(1),
  ...customFields(),
  ...stamps(),
}, (t) => [uniqueIndex("retailers_name_idx").on(t.name)]);
