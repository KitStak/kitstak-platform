/**
 * Field-level change log (BUILD_PLAN 0.4 #3): every create/update/delete on a business
 * entity writes `change_log` rows as `old --> new` with human-readable labels.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { DomainCtx, Tx } from "./types";

/** Display names per entity type (used in messages, e.g. "Shipment Order SO000123 is created."). */
export const ENTITY_LABELS: Readonly<Record<string, string>> = {
  shipment_order: "Shipment Order",
  order_line: "Order Line",
  purchase_order: "Purchase Order",
  product: "Product",
  location: "Location",
  job: "Job",
  task: "Task",
  return_order: "Return Order",
  shipment: "Shipment",
  end_of_day_manifest: "End Of Day",
  work_order: "Work Order",
  count_plan: "Count Plan",
  client: "Client",
  purchase_order_line: "Purchase Order Line",
  vendor: "Vendor",
  license_plate: "License Plate",
};

/** Field labels shared by every entity; per-entity overrides win. */
const COMMON_LABELS: Readonly<Record<string, string>> = {
  code: "Code", status: "Status", warehouseId: "Warehouse", clientId: "Client", priority: "Priority",
  note: "Note", customerName: "Customer Name", customerEmail: "Customer Email", customerPhone: "Customer Phone",
  shipAddress: "Address", shipAddress2: "Address 2", shipCity: "City", shipState: "State", shipZip: "Zip Code",
  shipCountry: "Country", carrier: "Carrier", shippingService: "Shipping Service", trackingNumber: "Tracking Number",
  quantity: "Quantity", pickedQuantity: "Picked Qty", packedQuantity: "Packed Qty", allocatedQuantity: "Allocated Qty",
  shippedQuantity: "Shipped Qty", receivedQuantity: "Received Qty", orderedQuantity: "Ordered Qty", unitPrice: "Unit Price",
  sku: "SKU", name: "Name", barcode: "Barcode", price: "Sales Price", weightOz: "Weight (oz)", jobId: "Job",
  assignedToUserId: "Assignee", expectedShipDate: "Expected Ship Date", deletedAt: "Deleted At",
  cancelReasonId: "Cancel Reason", isBackOrder: "Is Back Order", masterOrderId: "Master Order",
  addressVerificationStatus: "Address Verification Status", workflowBlocked: "Workflow Blocked",
  pickShortStatus: "Pick Short Status", packShortStatus: "Pack Short Status", labelStatus: "Label Status",
};

const ENTITY_FIELD_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  shipment_order: { code: "Shipment Order Code", orderDate: "Order Date", storeOrderNumber: "Store Order Number" },
  purchase_order: {
    code: "Purchase Order Code", vendorName: "Vendor", poDate: "PO Date", poType: "PO Type", receivedAt: "Actual Receiving Date",
    completedAt: "Completed Date", cancelledAt: "Cancelled Date", plannedReceivingDate: "Planned Receiving Date",
    plannedArrivalDate: "Planned Arrival Date", actualArrivalDate: "Actual Arrival Date", purchasePrice: "Purchase Price",
    totalQuantity: "Total Quantity", statusChangeReason: "Status Change Reason",
  },
  purchase_order_line: { unitCost: "Price Per Item", receivingLocationId: "Receiving Location" },
};

/**
 * `*Id` fields are logged with the referenced record's display value, never a raw id
 * (A0 "no raw UUIDs"; docs/requests/orders-outbound.md REQ-8). Unknown ids keep the id.
 */
const LOOKUP_NAME = "SELECT name AS v FROM lookup_values WHERE id =";
const ID_RESOLVERS: Readonly<Record<string, string>> = {
  cancelReasonId: LOOKUP_NAME, packingWarningTypeId: LOOKUP_NAME, orderTypeId: LOOKUP_NAME, adjustmentReasonId: LOOKUP_NAME,
  poTypeId: LOOKUP_NAME, damageReasonId: LOOKUP_NAME, returnReasonId: LOOKUP_NAME, productTypeId: LOOKUP_NAME, productGroupId: LOOKUP_NAME,
  shipmentPackageId: "SELECT code AS v FROM shipment_packages WHERE id =",
  warehouseId: "SELECT code AS v FROM warehouses WHERE id =",
  clientId: "SELECT name AS v FROM clients WHERE id =",
  dedicatedClientId: "SELECT name AS v FROM clients WHERE id =",
  masterOrderId: "SELECT code AS v FROM shipment_orders WHERE id =",
  mergedIntoOrderId: "SELECT code AS v FROM shipment_orders WHERE id =",
  retailerId: "SELECT name AS v FROM retailers WHERE id =",
  carrierServiceId: "SELECT name AS v FROM carrier_services WHERE id =",
  returnCarrierServiceId: "SELECT name AS v FROM carrier_services WHERE id =",
  customerId: "SELECT trim(first_name || ' ' || last_name) AS v FROM customers WHERE id =",
  vendorId: "SELECT display_name AS v FROM vendors WHERE id =",
  productId: "SELECT sku AS v FROM products WHERE id =",
  locationId: "SELECT code AS v FROM locations WHERE id =",
  receivingLocationId: "SELECT code AS v FROM locations WHERE id =",
  returnAddressId: "SELECT coalesce(name, company_name, trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) AS v FROM addresses WHERE id =",
  assignedToUserId: "SELECT name AS v FROM users WHERE id =",
  assigneeUserId: "SELECT name AS v FROM users WHERE id =",
};

/** Display value for an id-valued field, or the formatted value when the field has no resolver / the id is unknown. */
export function resolveFieldValue(tx: Tx, field: string, value: string): string {
  const query = ID_RESOLVERS[field];
  if (!query || value === "") return value;
  try {
    return tx.get<{ v: string | null }>(sql`${sql.raw(query)} ${value}`)?.v || value;
  } catch {
    // A failed lookup must never block the write it documents; keep the raw value.
    return value;
  }
}

/** Columns that never produce change-log rows. */
const IGNORED_FIELDS = new Set(["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "version"]);

export function humanize(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function fieldLabel(entityType: string, field: string): string {
  return ENTITY_FIELD_LABELS[entityType]?.[field] ?? COMMON_LABELS[field] ?? humanize(field);
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? humanize(entityType);
}

interface EntityRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityCode?: string | null;
}

type ChangeRow = typeof schema.changeLog.$inferInsert;

function insert(tx: Tx, ctx: DomainCtx, rows: readonly ChangeRow[]): number {
  if (rows.length === 0) return 0;
  tx.insert(schema.changeLog).values(rows.map((r) => ({ ...r, userId: ctx.userId, source: ctx.source }))).run();
  return rows.length;
}

export function recordCreate(tx: Tx, ctx: DomainCtx, ref: EntityRef): void {
  const name = ref.entityCode ? `${entityLabel(ref.entityType)} ${ref.entityCode}` : entityLabel(ref.entityType);
  insert(tx, ctx, [{ ...ref, entityCode: ref.entityCode ?? null, type: "Create", message: `${name} is created.`, source: ctx.source }]);
}

export function recordDelete(tx: Tx, ctx: DomainCtx, ref: EntityRef): void {
  const name = ref.entityCode ? `${entityLabel(ref.entityType)} ${ref.entityCode}` : entityLabel(ref.entityType);
  insert(tx, ctx, [{ ...ref, entityCode: ref.entityCode ?? null, type: "Delete", message: `${name} is deleted.`, source: ctx.source }]);
}

export interface FieldChange {
  readonly field: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** Field-by-field diff of two row snapshots (ignoring stamps). */
export function diffRows(entityType: string, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): FieldChange[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (IGNORED_FIELDS.has(field) || !(field in after)) continue;
    const from = formatValue(before[field]);
    const to = formatValue(after[field]);
    if (from !== to) changes.push({ field, label: fieldLabel(entityType, field), from, to });
  }
  return changes;
}

/** Writes one row per changed field: "<Label> is modified. old --> new". Returns the count. */
export function recordUpdate(
  tx: Tx,
  ctx: DomainCtx,
  ref: EntityRef & { readonly before: Readonly<Record<string, unknown>>; readonly after: Readonly<Record<string, unknown>> },
): number {
  const changes = diffRows(ref.entityType, ref.before, ref.after)
    .map((c) => (ID_RESOLVERS[c.field] ? { ...c, from: resolveFieldValue(tx, c.field, c.from), to: resolveFieldValue(tx, c.field, c.to) } : c));
  return insert(tx, ctx, changes.map((c) => ({
    entityType: ref.entityType, entityId: ref.entityId, entityCode: ref.entityCode ?? null, type: "Update",
    field: c.field, fieldLabel: c.label, fromValue: c.from, toValue: c.to,
    message: `${c.label} is modified. ${c.from} --> ${c.to}`, source: ctx.source,
  })));
}

/** Line-level entry, e.g. "MLT-WIDGET-01 -> Received Qty is modified. 0 --> 24". */
export function recordLine(
  tx: Tx,
  ctx: DomainCtx,
  ref: EntityRef & {
    readonly lineEntityType: string;
    readonly lineEntityId: string;
    readonly lineLabel: string;
    readonly field: string;
    readonly from: unknown;
    readonly to: unknown;
  },
): void {
  const label = fieldLabel(ref.lineEntityType, ref.field);
  const from = formatValue(ref.from);
  const to = formatValue(ref.to);
  if (from === to) return;
  insert(tx, ctx, [{
    entityType: ref.lineEntityType, entityId: ref.lineEntityId, entityCode: ref.entityCode ?? null,
    parentEntityType: ref.entityType, parentEntityId: ref.entityId, type: "Update",
    field: ref.field, fieldLabel: label, fromValue: from, toValue: to,
    message: `${ref.lineLabel} -> ${label} is modified. ${from} --> ${to}`, source: ctx.source,
  }]);
}

interface LineRef extends EntityRef {
  readonly lineEntityType: string;
  readonly lineEntityId: string;
  readonly lineLabel: string;
}

function lineEvent(tx: Tx, ctx: DomainCtx, ref: LineRef, type: "Create" | "Delete"): void {
  const verb = type === "Create" ? "created" : "deleted";
  insert(tx, ctx, [{
    entityType: ref.lineEntityType, entityId: ref.lineEntityId, entityCode: ref.entityCode ?? null,
    parentEntityType: ref.entityType, parentEntityId: ref.entityId, type,
    message: `${ref.lineLabel} -> ${entityLabel(ref.lineEntityType)} is ${verb}.`, source: ctx.source,
  }]);
}

/** Line-level Create row with parent ids, e.g. "MLT-WIDGET-01 -> Purchase Order Line is created." */
export function recordLineCreate(tx: Tx, ctx: DomainCtx, ref: LineRef): void {
  lineEvent(tx, ctx, ref, "Create");
}

/** Line-level Delete row with parent ids, e.g. "MLT-WIDGET-01 -> Purchase Order Line is deleted." */
export function recordLineDelete(tx: Tx, ctx: DomainCtx, ref: LineRef): void {
  lineEvent(tx, ctx, ref, "Delete");
}

/** Most recent value a field changed *from* when it became `toValue` (e.g. status before On Hold). */
export function lastFromValue(tx: Tx, entityType: string, entityId: string, field: string, toValue: string): string | null {
  const row = tx.select({ fromValue: schema.changeLog.fromValue }).from(schema.changeLog)
    .where(and(eq(schema.changeLog.entityType, entityType), eq(schema.changeLog.entityId, entityId),
      eq(schema.changeLog.field, field), eq(schema.changeLog.toValue, toValue)))
    .orderBy(desc(sql`rowid`)).get();
  return row?.fromValue ?? null;
}
