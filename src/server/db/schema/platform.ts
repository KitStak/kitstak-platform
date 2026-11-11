/**
 * Platform: lookups, code sequences, change log, tags, custom fields, files,
 * attachments, notes, background tasks, imports, printouts, screen configs.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  ATTACHMENT_DOCUMENT_TYPES,
  BG_TASK_KINDS,
  BG_TASK_STATUSES,
  CHANGE_TYPES,
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_SLOTS,
  IMPORT_STATUSES,
  LOOKUP_TYPES,
  PRINT_MODES,
  PRINT_RECORDS_PER_PAGE,
  PRINTER_TYPES,
  TAG_SCOPES,
} from "../../../lib/enums";
import { bool, json, nowIso, pk, stamps } from "../columns";
import { users } from "./identity";
import { clients, warehouses } from "./org";

export const lookupValues = pgTable("lookup_values", {
  id: pk(),
  type: text("type", { enum: LOOKUP_TYPES }).notNull(),
  name: text("name").notNull(),
  code: text("code"),
  clientId: text("client_id").references(() => clients.id),
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  isActive: bool("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  // vas_type {calculationType}; mobile_cart_type {levels,columns}; merge rule {criteria}
  meta: json<Record<string, unknown>>("meta"),
  ...stamps(),
}, (t) => [
  index("lookup_type_idx").on(t.type),
  // NULL-safe scope keys: SQLite treats NULLs as distinct, so global (NULL-scoped)
  // values would otherwise escape uniqueness. CASE (not coalesce) because
  // drizzle-kit splits index expressions on commas.
  uniqueIndex("lookup_unique_idx").on(
    t.type,
    t.name,
    sql`(CASE WHEN ${t.clientId} IS NULL THEN '' ELSE ${t.clientId} END)`,
    sql`(CASE WHEN ${t.warehouseId} IS NULL THEN '' ELSE ${t.warehouseId} END)`,
  ),
]);

export const codeSequences = pgTable("code_sequences", {
  key: text("key").notNull(),
  warehouseId: text("warehouse_id").notNull().default("*"),
  prefix: text("prefix").notNull(),
  nextValue: integer("next_value").notNull().default(1),
  padding: integer("padding").notNull().default(6),
  autoGenerate: bool("auto_generate").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.key, t.warehouseId] })]);

export const changeLog = pgTable("change_log", {
  id: pk(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  entityCode: text("entity_code"),
  parentEntityType: text("parent_entity_type"), // line-level entries
  parentEntityId: text("parent_entity_id"),
  type: text("type", { enum: CHANGE_TYPES }).notNull(),
  field: text("field"),
  fieldLabel: text("field_label"),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  message: text("message").notNull(),
  userId: text("user_id"),
  source: text("source").notNull(), // email | "Integration" | "Scheduler"
  at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [
  index("change_log_entity_idx").on(t.entityType, t.entityId),
  index("change_log_at_idx").on(t.at),
  index("change_log_parent_idx").on(t.parentEntityType, t.parentEntityId),
]);

export const tags = pgTable("tags", {
  id: pk(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  scope: text("scope", { enum: TAG_SCOPES }).notNull().default("any"),
  ...stamps(),
}, (t) => [uniqueIndex("tags_name_scope_idx").on(t.name, t.scope)]);

export const entityTags = pgTable("entity_tags", {
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.tagId, t.entityType, t.entityId] }),
  index("entity_tags_entity_idx").on(t.entityType, t.entityId),
]);

export const customFieldDefs = pgTable("custom_field_defs", {
  id: pk(),
  entityType: text("entity_type", { enum: CUSTOM_FIELD_ENTITIES }).notNull(),
  slot: text("slot", { enum: CUSTOM_FIELD_SLOTS }).notNull(),
  name: text("name").notNull(),
  options: json<string[]>("options"),
  isActive: bool("is_active").notNull().default(true),
  ...stamps(),
}, (t) => [uniqueIndex("cfd_slot_idx").on(t.entityType, t.slot)]);

export const files = pgTable("files", {
  id: pk(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(), // .data/files/<id>
  ownerEntityType: text("owner_entity_type"),
  ownerEntityId: text("owner_entity_id"),
  uploadedBy: text("uploaded_by"),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
  expiresAt: text("expires_at"),
}, (t) => [index("files_owner_idx").on(t.ownerEntityType, t.ownerEntityId)]);

export const attachments = pgTable("attachments", {
  id: pk(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  documentType: text("document_type", { enum: ATTACHMENT_DOCUMENT_TYPES }).notNull(),
  fileId: text("file_id").notNull().references(() => files.id),
  uploadedBy: text("uploaded_by"),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
}, (t) => [index("attachments_entity_idx").on(t.entityType, t.entityId)]);

export const entityNotes = pgTable("entity_notes", {
  id: pk(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  body: text("body").notNull(),
  userId: text("user_id").references(() => users.id),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
}, (t) => [index("entity_notes_entity_idx").on(t.entityType, t.entityId)]);

export const backgroundTasks = pgTable("background_tasks", {
  id: pk(),
  kind: text("kind", { enum: BG_TASK_KINDS }).notNull(),
  title: text("title").notNull(),
  gridKey: text("grid_key"),
  query: text("query"),
  status: text("status", { enum: BG_TASK_STATUSES }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  rowCount: integer("row_count"),
  errorMessage: text("error_message"),
  fileId: text("file_id").references(() => files.id),
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
  finishedAt: text("finished_at"),
}, (t) => [index("bg_tasks_user_idx").on(t.userId, t.createdAt)]);

export const importBatches = pgTable("import_batches", {
  id: pk(),
  importKey: text("import_key").notNull(),
  status: text("status", { enum: IMPORT_STATUSES }).notNull(),
  masterRowCount: integer("master_row_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  fileId: text("file_id").notNull().references(() => files.id),
  errorFileId: text("error_file_id"),
  uploadedBy: text("uploaded_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
  finishedAt: text("finished_at"),
}, (t) => [index("import_batches_key_idx").on(t.importKey, t.createdAt)]);

export const importRows = pgTable("import_rows", {
  id: pk(),
  batchId: text("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  success: bool("success").notNull(),
  data: text("data").notNull(),
  message: text("message"),
  entityId: text("entity_id"),
}, (t) => [index("import_rows_batch_idx").on(t.batchId)]);

export const printoutTemplates = pgTable("printout_templates", {
  id: pk(),
  typeKey: text("type_key").notNull(), // F6 print type catalog (25 types)
  name: text("name").notNull(),
  description: text("description").notNull(),
  recordsPerPage: text("records_per_page", { enum: PRINT_RECORDS_PER_PAGE }).notNull(),
  printMode: text("print_mode", { enum: PRINT_MODES }).notNull(),
  printerType: text("printer_type", { enum: PRINTER_TYPES }).notNull(),
  baseTemplate: text("base_template").notNull(), // renderer key in src/server/print/templates
  layout: json<Record<string, unknown>>("layout"),
  options: json<Record<string, unknown>>("options"),
  allClients: bool("all_clients").notNull().default(true),
  isActive: bool("is_active").notNull().default(true),
  isDefault: bool("is_default").notNull().default(false),
  ...stamps(),
}, (t) => [index("printout_type_idx").on(t.typeKey)]);

export const printoutTemplateClients = pgTable("printout_template_clients", {
  templateId: text("template_id").notNull().references(() => printoutTemplates.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => clients.id),
  hasAccess: bool("has_access").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.templateId, t.clientId] })]);

export interface ScreenConfigConditions {
  when: "Operation Starting";
  join: "And" | "Or";
  clientIds?: string[];
  poTypes?: string[];
  vendorIds?: string[];
}

export interface ScreenConfigSteps {
  steps: { key: string; enabled: boolean; required: boolean }[];
}

export const screenConfigs = pgTable("screen_configs", {
  id: pk(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  name: text("name").notNull(),
  operationType: text("operation_type", { enum: ["Receiving"] }).notNull().default("Receiving"),
  screenName: text("screen_name").notNull(),
  isActive: bool("is_active").notNull().default(true),
  conditions: json<ScreenConfigConditions>("conditions"),
  config: json<ScreenConfigSteps>("config"),
  ...stamps(),
}, (t) => [index("screen_configs_wh_idx").on(t.warehouseId)]);
