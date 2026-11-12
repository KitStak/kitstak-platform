/**
 * Entity registry for the foundation-owned platform APIs (BUILD_PLAN F7).
 *
 * Tags, change log, attachments, notes and file downloads all point at "some business
 * record" through `(entityType, entityId)`. This registry tells those routes, per entity
 * type, which table holds the record, which columns carry its warehouse/client scope and
 * which permission keys gate viewing, editing, tagging and its change log.
 *
 * Scope is always checked through the owning record: a record outside the user's scope
 * is reported as NOT_FOUND (0.4 #5), never FORBIDDEN.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { AppDb } from '@/server/api/db';
import { forbiddenError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { canAny } from '@/server/auth/permissions';
import { assertInScope } from '@/server/auth/scope';
import * as s from '@/server/db/schema';

export type EntityAction = 'view' | 'edit' | 'tag' | 'changeLog';

export interface EntityDef {
  readonly type: string;
  readonly label: string;
  readonly table: PgTable;
  readonly id: PgColumn;
  readonly code: PgColumn | null;
  readonly warehouseId: PgColumn | null;
  readonly clientId: PgColumn | null;
  readonly permissions: Readonly<Record<EntityAction, readonly string[]>>;
}

interface DefInput {
  readonly label: string;
  readonly table: PgTable;
  readonly id: PgColumn;
  readonly code?: PgColumn | null;
  readonly warehouseId?: PgColumn | null;
  readonly clientId?: PgColumn | null;
  readonly view: readonly string[];
  readonly edit: readonly string[];
  readonly tag?: readonly string[];
  readonly changeLog?: readonly string[];
}

const REPORT_CHANGE_LOG = 'reports.change_log.view';

function def(type: string, input: DefInput): EntityDef {
  return {
    type,
    label: input.label,
    table: input.table,
    id: input.id,
    code: input.code ?? null,
    warehouseId: input.warehouseId ?? null,
    clientId: input.clientId ?? null,
    permissions: {
      view: input.view,
      edit: input.edit,
      tag: input.tag ?? [],
      changeLog: [...(input.changeLog ?? input.view), REPORT_CHANGE_LOG],
    },
  };
}

const DEFS: readonly EntityDef[] = [
  def('shipment_order', {
    label: 'Shipment Order',
    table: s.shipmentOrders,
    id: s.shipmentOrders.id,
    code: s.shipmentOrders.code,
    warehouseId: s.shipmentOrders.warehouseId,
    clientId: s.shipmentOrders.clientId,
    view: ['fulfillment.shipment_orders.view'],
    edit: ['fulfillment.shipment_orders.edit', 'fulfillment.shipment_orders.other_documents_upload'],
    tag: ['fulfillment.shipment_orders.tag'],
    changeLog: ['fulfillment.shipment_orders.change_log'],
  }),
  def('purchase_order', {
    label: 'Purchase Order',
    table: s.purchaseOrders,
    id: s.purchaseOrders.id,
    code: s.purchaseOrders.code,
    warehouseId: s.purchaseOrders.warehouseId,
    clientId: s.purchaseOrders.clientId,
    view: ['inventory.purchase_orders.view'],
    edit: ['inventory.purchase_orders.edit', 'inventory.purchase_orders.upload_documents'],
    tag: ['inventory.purchase_orders.tag'],
    changeLog: ['inventory.purchase_orders.change_log'],
  }),
  def('return_order', {
    label: 'Return Order',
    table: s.returnOrders,
    id: s.returnOrders.id,
    code: s.returnOrders.rmaCode,
    warehouseId: s.returnOrders.warehouseId,
    clientId: s.returnOrders.clientId,
    // Station operators attach per-line photos while receiving, without Change Status.
    view: ['inventory.return_orders.view'],
    edit: ['inventory.return_orders.change_status', 'inventory.return_station.receive_return'],
    tag: ['inventory.return_orders.tag'],
  }),
  def('work_order', {
    label: 'Work Order',
    table: s.workOrders,
    id: s.workOrders.id,
    code: s.workOrders.code,
    warehouseId: s.workOrders.warehouseId,
    clientId: s.workOrders.clientId,
    view: ['inventory.work_orders.view'],
    edit: ['inventory.work_orders.edit'],
    tag: ['inventory.work_orders.tag'],
  }),
  def('product', {
    label: 'Product',
    table: s.products,
    id: s.products.id,
    code: s.products.sku,
    clientId: s.products.clientId,
    view: ['settings.products.view'],
    edit: ['settings.products.edit'],
    changeLog: ['settings.products.change_log'],
  }),
  def('listing', {
    label: 'Product Listing',
    table: s.productListings,
    id: s.productListings.id,
    code: s.productListings.sellerSku,
    clientId: s.productListings.clientId,
    view: ['settings.product_listing.view'],
    edit: ['settings.product_listing.manage_tags'],
    tag: ['settings.product_listing.tag'],
  }),
  def('location', {
    label: 'Location',
    table: s.locations,
    id: s.locations.id,
    code: s.locations.code,
    warehouseId: s.locations.warehouseId,
    view: ['settings.locations.view'],
    edit: ['settings.locations.edit'],
    changeLog: ['settings.locations.change_log'],
  }),
  def('license_plate', {
    label: 'License Plate',
    table: s.licensePlates,
    id: s.licensePlates.id,
    code: s.licensePlates.number,
    warehouseId: s.licensePlates.warehouseId,
    clientId: s.licensePlates.clientId,
    view: ['settings.lp_numbers.view'],
    edit: ['settings.lp_numbers.edit'],
    changeLog: ['settings.lp_numbers.change_log'],
  }),
  def('job', {
    label: 'Job',
    table: s.jobs,
    id: s.jobs.id,
    code: s.jobs.code,
    warehouseId: s.jobs.warehouseId,
    clientId: s.jobs.clientId,
    view: ['fulfillment.job_management.view'],
    edit: ['fulfillment.job_management.assign'],
  }),
  def('task', {
    label: 'Task',
    table: s.tasks,
    id: s.tasks.id,
    code: s.tasks.taskNo,
    warehouseId: s.tasks.warehouseId,
    clientId: s.tasks.clientId,
    view: ['fulfillment.task_details.view'],
    edit: ['fulfillment.task_details.update_task'],
  }),
  def('shipment_plan', {
    label: 'Shipment Plan',
    table: s.shipmentPlans,
    id: s.shipmentPlans.id,
    code: s.shipmentPlans.code,
    warehouseId: s.shipmentPlans.warehouseId,
    clientId: s.shipmentPlans.clientId,
    view: ['fulfillment.shipment_plan.view'],
    edit: ['fulfillment.shipment_plan.edit'],
  }),
  def('count_plan', {
    label: 'Count Plan',
    table: s.countPlans,
    id: s.countPlans.id,
    code: s.countPlans.code,
    warehouseId: s.countPlans.warehouseId,
    view: ['inventory.count_plans.view'],
    edit: ['inventory.count_plans.edit'],
  }),
  def('end_of_day_manifest', {
    label: 'End Of Day',
    table: s.endOfDayManifests,
    id: s.endOfDayManifests.id,
    code: s.endOfDayManifests.shipDate,
    warehouseId: s.endOfDayManifests.warehouseId,
    view: ['fulfillment.end_of_day.view'],
    edit: ['fulfillment.end_of_day.print_end_of_the_day_report'],
  }),
  def('client', {
    label: 'Client',
    table: s.clients,
    id: s.clients.id,
    code: s.clients.code,
    clientId: s.clients.id,
    view: ['settings.clients.view'],
    edit: ['settings.clients.edit'],
    changeLog: ['settings.clients.change_log'],
  }),
  def('vendor', {
    label: 'Vendor',
    table: s.vendors,
    id: s.vendors.id,
    code: s.vendors.displayName,
    clientId: s.vendors.clientId,
    view: ['settings.vendors.view'],
    edit: ['settings.vendors.edit'],
    changeLog: ['settings.vendors.change_log'],
  }),
  def('wave_rule', {
    label: 'Wave Rule',
    table: s.waveRules,
    id: s.waveRules.id,
    code: s.waveRules.name,
    warehouseId: s.waveRules.warehouseId,
    view: ['automation.wave_rules.view'],
    edit: ['automation.wave_rules.edit'],
    changeLog: ['automation.wave_rules.change_log'],
  }),
  def('job_type', {
    label: 'Job Type',
    table: s.jobTypes,
    id: s.jobTypes.id,
    code: s.jobTypes.code,
    warehouseId: s.jobTypes.warehouseId,
    view: ['settings.job_types.view'],
    edit: ['settings.job_types.edit'],
    changeLog: ['settings.job_types.change_log'],
  }),
  def('retailer', {
    label: 'Retailer',
    table: s.retailers,
    id: s.retailers.id,
    code: s.retailers.name,
    view: ['settings.retailers.view'],
    edit: ['settings.retailers.edit'],
  }),
  def('billing_contract', {
    label: 'Billing Contract',
    table: s.billingContracts,
    id: s.billingContracts.id,
    code: s.billingContracts.name,
    warehouseId: s.billingContracts.warehouseId,
    clientId: s.billingContracts.clientId,
    view: ['settings.billing.view'],
    edit: ['settings.billing.edit'],
    changeLog: ['settings.billing.change_log'],
  }),
  def('billing_report', {
    label: 'Billing Report',
    table: s.billingReports,
    id: s.billingReports.id,
    code: s.billingReports.billNumber,
    warehouseId: s.billingReports.warehouseId,
    clientId: s.billingReports.clientId,
    view: ['settings.billing_report.view'],
    edit: ['settings.billing_report.approve'],
  }),
  def('vas_operation', {
    label: 'VAS Operation',
    table: s.vasOperations,
    id: s.vasOperations.id,
    warehouseId: s.vasOperations.warehouseId,
    clientId: s.vasOperations.clientId,
    view: ['settings.vas_operations.view'],
    edit: ['settings.vas_operations.edit'],
  }),
  def('customer', {
    label: 'Customer',
    table: s.customers,
    id: s.customers.id,
    code: s.customers.email,
    clientId: s.customers.clientId,
    view: ['settings.customers.view'],
    edit: ['settings.customers.edit'],
  }),
  // M12 automation + integrations (REQ-AI-R4-1): workflows / presets with a null warehouse or
  // client apply to all, which the scope check treats as unscoped on that axis.
  def('algorithm', {
    label: 'Algorithm',
    table: s.algorithms,
    id: s.algorithms.id,
    code: s.algorithms.name,
    warehouseId: s.algorithms.warehouseId,
    view: ['automation.algorithms.view'],
    edit: ['automation.algorithms.edit'],
    changeLog: ['automation.algorithms.change_log'],
  }),
  def('workflow', {
    label: 'Workflow',
    table: s.workflows,
    id: s.workflows.id,
    code: s.workflows.name,
    warehouseId: s.workflows.warehouseId,
    clientId: s.workflows.clientId,
    view: ['automation.workflows.view'],
    edit: ['automation.workflows.edit'],
    changeLog: ['automation.workflows.change_log'],
  }),
  def('rate_shopping_preset', {
    label: 'Rate Shopping Preset',
    table: s.rateShoppingPresets,
    id: s.rateShoppingPresets.id,
    code: s.rateShoppingPresets.name,
    warehouseId: s.rateShoppingPresets.warehouseId,
    clientId: s.rateShoppingPresets.clientId,
    view: ['automation.rate_shopping.view'],
    edit: ['automation.rate_shopping.edit'],
    changeLog: ['automation.rate_shopping.change_log'],
  }),
  def('channel_connection', {
    label: 'Store Connection',
    table: s.channelConnections,
    id: s.channelConnections.id,
    code: s.channelConnections.storeName,
    clientId: s.channelConnections.clientId,
    view: [
      'integrations.integrations.create_setup',
      'integrations.integrations.edit_setup',
      'integrations.integrations.delete_setup',
    ],
    edit: ['integrations.integrations.edit_setup'],
  }),
  def('carrier_connection', {
    label: 'Carrier Setup',
    table: s.carrierConnections,
    id: s.carrierConnections.id,
    code: s.carrierConnections.setupName,
    warehouseId: s.carrierConnections.warehouseId,
    view: [
      'integrations.integrations.create_setup',
      'integrations.integrations.edit_setup',
      'integrations.integrations.delete_setup',
    ],
    edit: ['integrations.integrations.edit_setup'],
  }),
];

const BY_TYPE: ReadonlyMap<string, EntityDef> = new Map(DEFS.map((d) => [d.type, d]));

/** Every entity type the platform APIs accept (zod enum source). */
export const PLATFORM_ENTITY_TYPES = DEFS.map((d) => d.type) as [string, ...string[]];

export function getEntityDef(type: string): EntityDef | undefined {
  return BY_TYPE.get(type);
}

export interface EntityRecordRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly code: string | null;
  readonly warehouseId: string | null;
  readonly clientId: string | null;
}

const NULL_SQL: SQL = sql`NULL`;

/** Loads `(type, id)` without permission checks; null when it does not exist. */
export async function findEntity(db: AppDb, type: string, id: string): Promise<EntityRecordRef | null> {
  const d = getEntityDef(type);
  if (!d) return null;
  const row = (
    await db
      .select({
        code: d.code ?? NULL_SQL,
        warehouseId: d.warehouseId ?? NULL_SQL,
        clientId: d.clientId ?? NULL_SQL,
      })
      .from(d.table)
      .where(eq(d.id, id))
      .limit(1)
  )[0] as { code: unknown; warehouseId: unknown; clientId: unknown } | undefined;
  if (!row) return null;
  const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    entityType: type,
    entityId: id,
    code: text(row.code),
    warehouseId: text(row.warehouseId),
    clientId: text(row.clientId),
  };
}

export function canOnEntity(auth: AuthContext, type: string, action: EntityAction): boolean {
  const d = getEntityDef(type);
  return d !== undefined && canAny(auth, d.permissions[action]);
}

/**
 * Resolves a record the caller may act on: unknown type → NOT_FOUND, missing permission →
 * FORBIDDEN, missing or out-of-scope record → NOT_FOUND.
 */
export async function requireEntity(
  db: AppDb,
  auth: AuthContext,
  type: string,
  id: string,
  action: EntityAction,
): Promise<EntityRecordRef> {
  const d = getEntityDef(type);
  if (!d) throw notFoundError('Item');
  if (!canAny(auth, d.permissions[action])) throw forbiddenError();
  const ref = await findEntity(db, type, id);
  assertInScope(auth.scope, ref, d.label);
  if (!ref) throw notFoundError(d.label);
  return ref;
}
