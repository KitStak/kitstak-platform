/**
 * Shipment Plan commands (M02 owns `shipment_plans` / `shipment_plan_orders`): create, edit
 * (optimistic concurrency), delete (Open only), status changes through the state machine,
 * add/remove orders, Ship (through `shipping.shipOrders`) and the Manifest/BOL printout.
 * Every write records field-level change_log rows with display values (never raw ids).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { SHIPMENT_PLAN_STATUSES, type ShipmentPlanStatus } from "@/lib/enums";
import {
  ACTIVE_PLAN_STATUSES, PLAN_CREATE_STATUSES, in3ToFt3, orderEligibilityReason, ozToLb, planDeleteBlockReason,
  planEditBlockReason, planShipBlockReason,
} from "@/lib/grid-defs/shipping/shipment-plans";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError, validationError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient, hasWarehouse } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { recordCreate, recordDelete, recordUpdate } from "@/server/domain/change-log";
import { next as nextCode, peek } from "@/server/domain/sequences";
import { shipping } from "@/server/domain";
import { stateMachines } from "@/server/domain/state-machines";
import type { BulkResult, DomainCtx, Tx } from "@/server/domain/types";
import { printToFile } from "@/server/print";
import { assertVersion, bulkIdsSchema, idSchema } from "./platform-common";
import { loadPlanRow, type PlanRow } from "./shipment-plans-lists";

const ENTITY = "shipment_plan";
const MAX_ORDERS = 500;

/* ---------------------------------------------------------------- schemas */

const isoOrNull = z.string().trim().max(40).nullish().transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), "Enter a valid date and time");
const optText = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`).nullish().transform((v) => (v ? v : null));
const optId = idSchema.nullish().transform((v) => v ?? null);

export const planFieldsSchema = z.object({
  code: optText(40),
  warehouseId: idSchema,
  clientId: optId,
  carrierConnectionId: optId,
  truckPlateNumber: optText(40),
  loadingGateLocationId: optId,
  status: z.enum(SHIPMENT_PLAN_STATUSES),
  plannedShipmentAt: isoOrNull,
  actualShipmentAt: isoOrNull,
  loadingStartedAt: isoOrNull,
  loadingCompletedAt: isoOrNull,
  truckDepartedAt: isoOrNull,
  expectedTotalVolume: z.number().min(0, "Can't be negative").max(1_000_000).default(0),
  expectedTotalWeight: z.number().min(0, "Can't be negative").max(1_000_000).default(0),
  preventLpnEditDuringLoading: z.boolean().default(false),
  note: optText(2000),
  customerId: optId,
  customerAddressId: optId,
  retailerId: optId,
  customFields: z.record(z.string().max(40), z.union([z.string().max(500), z.boolean(), z.null()])).default({}),
  orderIds: z.array(idSchema).max(MAX_ORDERS, `At most ${MAX_ORDERS} orders per plan`).default([]),
});

export const createPlanSchema = planFieldsSchema;
export const updatePlanSchema = planFieldsSchema.extend({ version: z.number().int().min(1) });
export type PlanInput = z.output<typeof planFieldsSchema>;

export const planStatusSchema = z.object({ status: z.enum(SHIPMENT_PLAN_STATUSES), version: z.number().int().min(1).optional() });
export const planOrdersSchema = z.object({ orderIds: bulkIdsSchema });
export const planIdsSchema = z.object({ ids: bulkIdsSchema });

/* ---------------------------------------------------------------- helpers */

type PlanTable = typeof schema.shipmentPlans.$inferSelect;

function loadPlan(tx: Tx, auth: AuthContext, id: string): PlanTable {
  const plan = tx.select().from(schema.shipmentPlans).where(eq(schema.shipmentPlans.id, id)).get();
  if (!plan || !hasWarehouse(auth.scope, plan.warehouseId) || (plan.clientId && !hasClient(auth.scope, plan.clientId))) throw notFoundError("Shipment plan");
  return plan;
}

const fieldError = (field: string, message: string): AppError => validationError(message, { [field]: [message] });

/** Validates every reference (scope, warehouse match, gate area, dependent address) and the date order. */
function validateRefs(tx: Tx, auth: AuthContext, input: PlanInput): void {
  if (!hasWarehouse(auth.scope, input.warehouseId)) throw fieldError("warehouseId", "Select a warehouse you have access to");
  if (input.clientId && !hasClient(auth.scope, input.clientId)) throw fieldError("clientId", "Select a client you have access to");
  if (input.carrierConnectionId) {
    const conn = tx.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, input.carrierConnectionId)).get();
    if (!conn || conn.warehouseId !== input.warehouseId) throw fieldError("carrierConnectionId", "This carrier is not set up for the selected warehouse");
  }
  if (input.loadingGateLocationId) {
    const gate = tx.select().from(schema.locations).where(eq(schema.locations.id, input.loadingGateLocationId)).get();
    if (!gate || gate.warehouseId !== input.warehouseId) throw fieldError("loadingGateLocationId", "The loading gate must be a location in the selected warehouse");
    if (gate.areaType !== "Loading" && gate.areaType !== "Shipment") throw fieldError("loadingGateLocationId", "Pick a location in a Loading or Shipment area");
  }
  if (input.customerId) {
    const cu = tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)).get();
    if (!cu || !hasClient(auth.scope, cu.clientId)) throw fieldError("customerId", "Customer not found");
    if (input.clientId && cu.clientId !== input.clientId) throw fieldError("customerId", "This customer belongs to another client");
  }
  if (input.customerAddressId) {
    const ad = tx.select().from(schema.addresses).where(eq(schema.addresses.id, input.customerAddressId)).get();
    if (!input.customerId || !ad || ad.ownerType !== "customer" || ad.ownerId !== input.customerId) throw fieldError("customerAddressId", "Pick an address of the selected customer");
  }
  if (input.retailerId && !tx.select().from(schema.retailers).where(eq(schema.retailers.id, input.retailerId)).get()) throw fieldError("retailerId", "Retailer not found");
  const order: readonly [keyof PlanInput, keyof PlanInput, string][] = [
    ["loadingStartedAt", "loadingCompletedAt", "Loading can't complete before it started"],
    ["loadingCompletedAt", "truckDepartedAt", "The truck can't depart before loading completed"],
  ];
  for (const [a, b, message] of order) {
    const from = input[a] as string | null;
    const to = input[b] as string | null;
    if (from && to && new Date(to) < new Date(from)) throw fieldError(b, message);
  }
}

/** Validates orders for the plan; throws one VALIDATION listing every ineligible order. */
function validateOrders(tx: Tx, auth: AuthContext, plan: { id?: string; warehouseId: string; clientId: string | null }, orderIds: readonly string[]): void {
  if (orderIds.length === 0) return;
  const orders = tx.select().from(schema.shipmentOrders).where(inArray(schema.shipmentOrders.id, [...orderIds])).all();
  const problems: string[] = [];
  for (const id of orderIds) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.deletedAt || !hasWarehouse(auth.scope, o.warehouseId) || !hasClient(auth.scope, o.clientId)) { problems.push("An order was not found"); continue; }
    const reason = orderEligibilityReason(o, plan);
    if (reason) problems.push(`${o.code} ${reason}`);
  }
  const busy = tx.select({ code: schema.shipmentOrders.code, plan: schema.shipmentPlans.code })
    .from(schema.shipmentPlanOrders)
    .innerJoin(schema.shipmentPlans, eq(schema.shipmentPlans.id, schema.shipmentPlanOrders.planId))
    .innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.shipmentPlanOrders.orderId))
    .where(and(inArray(schema.shipmentPlanOrders.orderId, [...orderIds]), inArray(schema.shipmentPlans.status, [...ACTIVE_PLAN_STATUSES]),
      plan.id ? sql`${schema.shipmentPlans.id} <> ${plan.id}` : undefined)).all();
  for (const b of busy) problems.push(`${b.code} is already in plan ${b.plan}`);
  if (problems.length > 0) {
    const message = problems.length === 1 ? `Order ${problems[0]}.` : `${problems.length} orders can't be added: ${problems.slice(0, 4).join("; ")}${problems.length > 4 ? "…" : ""}.`;
    throw new AppError("RULE_VIOLATION", message, { fieldErrors: { orderIds: [message] } });
  }
}

/** Human-readable snapshot for the change log (names instead of ids). */
function displaySnapshot(tx: Tx, p: Partial<PlanTable>, orderCodes: readonly string[]): Record<string, unknown> {
  const wh = p.warehouseId ? tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, p.warehouseId)).get()?.code : null;
  const client = p.clientId ? tx.select().from(schema.clients).where(eq(schema.clients.id, p.clientId)).get()?.name : null;
  const carrier = p.carrierConnectionId ? tx.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, p.carrierConnectionId)).get() : null;
  const gate = p.loadingGateLocationId ? tx.select().from(schema.locations).where(eq(schema.locations.id, p.loadingGateLocationId)).get()?.code : null;
  const cu = p.customerId ? tx.select().from(schema.customers).where(eq(schema.customers.id, p.customerId)).get() : null;
  const ad = p.customerAddressId ? tx.select().from(schema.addresses).where(eq(schema.addresses.id, p.customerAddressId)).get() : null;
  const retailer = p.retailerId ? tx.select().from(schema.retailers).where(eq(schema.retailers.id, p.retailerId)).get()?.name : null;
  return {
    code: p.code, status: p.status, warehouse: wh ?? null, client: client ?? null,
    carrier: carrier ? `${carrier.setupName} - ${carrier.accountPrefix}` : null, truckPlateNumber: p.truckPlateNumber ?? null,
    loadingGate: gate ?? null, plannedShipmentAt: p.plannedShipmentAt ?? null, actualShipmentAt: p.actualShipmentAt ?? null,
    loadingStartedAt: p.loadingStartedAt ?? null, loadingCompletedAt: p.loadingCompletedAt ?? null, truckDepartedAt: p.truckDepartedAt ?? null,
    expectedTotalVolume: p.expectedTotalVolume ?? 0, expectedTotalWeight: p.expectedTotalWeight ?? 0,
    preventLpnEditDuringLoading: p.preventLpnEditDuringLoading ?? false, note: p.note ?? null,
    customer: cu ? `${cu.firstName} ${cu.lastName}` : null, customerAddress: ad ? `${ad.line1}, ${ad.city}` : null, retailer: retailer ?? null,
    customFields: p.customFields ?? {}, orders: [...orderCodes].sort().join(", "),
  };
}

function orderCodesOf(tx: Tx, planId: string): string[] {
  return tx.select({ code: schema.shipmentOrders.code }).from(schema.shipmentPlanOrders)
    .innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.shipmentPlanOrders.orderId))
    .where(eq(schema.shipmentPlanOrders.planId, planId)).all().map((r) => r.code);
}

function columnsOf(input: PlanInput): Omit<typeof schema.shipmentPlans.$inferInsert, "code"> {
  return {
    warehouseId: input.warehouseId, clientId: input.clientId, carrierConnectionId: input.carrierConnectionId,
    truckPlateNumber: input.truckPlateNumber, loadingGateLocationId: input.loadingGateLocationId, status: input.status,
    plannedShipmentAt: input.plannedShipmentAt, actualShipmentAt: input.actualShipmentAt, loadingStartedAt: input.loadingStartedAt,
    loadingCompletedAt: input.loadingCompletedAt, truckDepartedAt: input.truckDepartedAt,
    expectedTotalVolume: Math.round(input.expectedTotalVolume * 100) / 100, expectedTotalWeight: Math.round(input.expectedTotalWeight * 100) / 100,
    preventLpnEditDuringLoading: input.preventLpnEditDuringLoading, note: input.note, customerId: input.customerId,
    customerAddressId: input.customerAddressId, retailerId: input.retailerId, customFields: input.customFields,
  };
}

/* --------------------------------------------------------------- commands */

export function nextPlanCode(tx: Tx): string {
  return peek(tx, "shipmentPlan");
}

export function createPlan(tx: Tx, auth: AuthContext, ctx: DomainCtx, input: PlanInput): PlanRow {
  if (!(PLAN_CREATE_STATUSES as readonly string[]).includes(input.status)) throw fieldError("status", "A new plan starts as Open or In Progress");
  validateRefs(tx, auth, input);
  validateOrders(tx, auth, { warehouseId: input.warehouseId, clientId: input.clientId }, input.orderIds);
  const code = input.code ?? nextCode(tx, "shipmentPlan");
  if (tx.select({ id: schema.shipmentPlans.id }).from(schema.shipmentPlans).where(eq(schema.shipmentPlans.code, code)).get()) {
    throw new AppError("DUPLICATE", `Shipment plan code ${code} is already used`, { fieldErrors: { code: ["This code is already used"] } });
  }
  const row = tx.insert(schema.shipmentPlans).values({ ...columnsOf(input), code, createdBy: ctx.userId, updatedBy: ctx.userId }).returning().get();
  const orderIds = [...new Set(input.orderIds)];
  if (orderIds.length > 0) tx.insert(schema.shipmentPlanOrders).values(orderIds.map((orderId) => ({ planId: row.id, orderId, status: row.status }))).run();
  recordCreate(tx, ctx, { entityType: ENTITY, entityId: row.id, entityCode: code });
  if (orderIds.length > 0) recordUpdate(tx, ctx, { entityType: ENTITY, entityId: row.id, entityCode: code, before: { orders: "" }, after: { orders: orderCodesOf(tx, row.id).sort().join(", ") } });
  return loadPlanRow(tx, auth.scope, row.id);
}

export function updatePlan(tx: Tx, auth: AuthContext, ctx: DomainCtx, id: string, input: PlanInput & { version: number }): PlanRow {
  const plan = loadPlan(tx, auth, id);
  assertVersion(plan.version, input.version);
  const blocked = planEditBlockReason(plan.status);
  if (blocked) throw new AppError("INVALID_STATE", `${blocked}.`);
  if (input.status !== plan.status) {
    if (input.status === "Shipped") throw fieldError("status", "Use Ship to ship the plan's orders");
    const check = stateMachines.shipmentPlan.canTransition(plan.status, input.status);
    if (!check.ok) throw fieldError("status", check.reason);
  }
  validateRefs(tx, auth, input);
  const beforeCodes = orderCodesOf(tx, id);
  const before = displaySnapshot(tx, plan, beforeCodes);
  const current = tx.select({ orderId: schema.shipmentPlanOrders.orderId }).from(schema.shipmentPlanOrders).where(eq(schema.shipmentPlanOrders.planId, id)).all().map((r) => r.orderId);
  const wanted = new Set(input.orderIds);
  const added = [...wanted].filter((o) => !current.includes(o));
  const removed = current.filter((o) => !wanted.has(o));
  if (input.warehouseId !== plan.warehouseId && current.length > 0 && removed.length < current.length) {
    throw fieldError("warehouseId", "Remove the plan's orders before moving it to another warehouse");
  }
  validateOrders(tx, auth, { id, warehouseId: input.warehouseId, clientId: input.clientId }, added);
  const code = input.code ?? plan.code;
  if (code !== plan.code && tx.select({ id: schema.shipmentPlans.id }).from(schema.shipmentPlans).where(eq(schema.shipmentPlans.code, code)).get()) {
    throw new AppError("DUPLICATE", `Shipment plan code ${code} is already used`, { fieldErrors: { code: ["This code is already used"] } });
  }
  const updated = tx.update(schema.shipmentPlans).set({ ...columnsOf(input), ...stampTimes(plan, input.status, input), code, updatedBy: ctx.userId, version: sql`${schema.shipmentPlans.version} + 1` })
    .where(and(eq(schema.shipmentPlans.id, id), eq(schema.shipmentPlans.version, plan.version))).returning().get();
  if (!updated) throw new AppError("CONFLICT", "This record changed since you opened it — Reload");
  if (removed.length > 0) tx.delete(schema.shipmentPlanOrders).where(and(eq(schema.shipmentPlanOrders.planId, id), inArray(schema.shipmentPlanOrders.orderId, removed))).run();
  if (added.length > 0) tx.insert(schema.shipmentPlanOrders).values(added.map((orderId) => ({ planId: id, orderId, status: updated.status }))).run();
  syncOrderStatuses(tx, id, updated.status);
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: updated.code, before, after: displaySnapshot(tx, updated, orderCodesOf(tx, id)) });
  return loadPlanRow(tx, auth.scope, id);
}

/** Sets the lifecycle timestamps a status implies, when the user left them empty. */
function stampTimes(plan: Pick<PlanTable, "loadingStartedAt" | "loadingCompletedAt" | "actualShipmentAt" | "truckDepartedAt">, status: ShipmentPlanStatus, input?: Partial<PlanInput>): Partial<PlanTable> {
  const now = new Date().toISOString();
  const pick = (key: "loadingStartedAt" | "loadingCompletedAt" | "actualShipmentAt" | "truckDepartedAt") => (input && input[key] !== undefined ? input[key] : plan[key]) ?? now;
  if (status === "Loading Started") return { loadingStartedAt: pick("loadingStartedAt") };
  if (status === "Loading Completed") return { loadingStartedAt: pick("loadingStartedAt"), loadingCompletedAt: pick("loadingCompletedAt") };
  if (status === "Shipped") return { loadingStartedAt: pick("loadingStartedAt"), loadingCompletedAt: pick("loadingCompletedAt"), actualShipmentAt: now, truckDepartedAt: pick("truckDepartedAt") };
  return {};
}

/** Plan-order rows mirror the plan status; orders already shipped keep "Shipped". */
function syncOrderStatuses(tx: Tx, planId: string, status: ShipmentPlanStatus): void {
  tx.run(sql`UPDATE shipment_plan_orders SET status = ${status} WHERE plan_id = ${planId} AND status <> 'Shipped'`);
}

export function changePlanStatus(tx: Tx, auth: AuthContext, ctx: DomainCtx, id: string, to: ShipmentPlanStatus, version?: number): PlanRow {
  const plan = loadPlan(tx, auth, id);
  assertVersion(plan.version, version);
  if (to === "Shipped") throw new AppError("INVALID_STATE", "Use Ship to ship the plan's orders; the plan becomes Shipped when they are.");
  const status = stateMachines.shipmentPlan.transition(plan.status, to);
  const times = stampTimes(plan, status);
  tx.update(schema.shipmentPlans).set({ status, ...times, updatedBy: ctx.userId, version: sql`${schema.shipmentPlans.version} + 1` }).where(eq(schema.shipmentPlans.id, id)).run();
  syncOrderStatuses(tx, id, status);
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: plan.code, before: { status: plan.status, ...pickTimes(plan, times) }, after: { status, ...times } });
  return loadPlanRow(tx, auth.scope, id);
}

function pickTimes(plan: PlanTable, times: Partial<PlanTable>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(times).map((k) => [k, plan[k as keyof PlanTable] ?? null]));
}

export function addPlanOrders(tx: Tx, auth: AuthContext, ctx: DomainCtx, id: string, orderIds: readonly string[]): PlanRow {
  const plan = loadPlan(tx, auth, id);
  const blocked = planEditBlockReason(plan.status);
  if (blocked) throw new AppError("INVALID_STATE", `${blocked}.`);
  const existing = new Set(tx.select({ o: schema.shipmentPlanOrders.orderId }).from(schema.shipmentPlanOrders).where(eq(schema.shipmentPlanOrders.planId, id)).all().map((r) => r.o));
  const added = [...new Set(orderIds)].filter((o) => !existing.has(o));
  if (existing.size + added.length > MAX_ORDERS) throw validationError(`A plan holds at most ${MAX_ORDERS} orders`);
  validateOrders(tx, auth, plan, added);
  const before = orderCodesOf(tx, id).sort().join(", ");
  if (added.length > 0) tx.insert(schema.shipmentPlanOrders).values(added.map((orderId) => ({ planId: id, orderId, status: plan.status }))).run();
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: plan.code, before: { orders: before }, after: { orders: orderCodesOf(tx, id).sort().join(", ") } });
  return loadPlanRow(tx, auth.scope, id);
}

export function removePlanOrders(tx: Tx, auth: AuthContext, ctx: DomainCtx, id: string, orderIds: readonly string[]): PlanRow {
  const plan = loadPlan(tx, auth, id);
  const blocked = planEditBlockReason(plan.status);
  if (blocked) throw new AppError("INVALID_STATE", `${blocked}.`);
  const before = orderCodesOf(tx, id).sort().join(", ");
  tx.delete(schema.shipmentPlanOrders).where(and(eq(schema.shipmentPlanOrders.planId, id), inArray(schema.shipmentPlanOrders.orderId, [...orderIds]), sql`${schema.shipmentPlanOrders.status} <> 'Shipped'`)).run();
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: plan.code, before: { orders: before }, after: { orders: orderCodesOf(tx, id).sort().join(", ") } });
  return loadPlanRow(tx, auth.scope, id);
}

export function deletePlans(tx: Tx, auth: AuthContext, ctx: DomainCtx, ids: readonly string[]): BulkResult {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      tx.transaction((inner) => {
        const plan = loadPlan(inner, auth, id);
        const blocked = planDeleteBlockReason(plan.status);
        if (blocked) throw new AppError("INVALID_STATE", `${plan.code}: ${blocked}.`);
        inner.delete(schema.shipmentPlanOrders).where(eq(schema.shipmentPlanOrders.planId, id)).run();
        inner.delete(schema.shipmentPlans).where(eq(schema.shipmentPlans.id, id)).run();
        recordDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: plan.code });
      });
      succeeded.push(id);
    } catch (error: unknown) {
      failed.push({ id, code: (error as { code?: string }).code ?? "INTERNAL", message: error instanceof Error ? error.message : "Delete failed" });
    }
  }
  return { succeeded, failed };
}

/* ------------------------------------------------------------------- ship */

export interface PlanShipOutcome {
  readonly planId: string;
  readonly planCode: string;
  readonly planStatus: ShipmentPlanStatus;
  readonly shipped: readonly string[];
  readonly failed: readonly { readonly orderCode: string; readonly message: string }[];
}

/** Truck loads ship under the plan's BOL, so parcel labels are optional (labelled packages still join the EOD manifest). */
const DONE = new Set(["Shipped", "Partially Shipped", "Delivered"]);

/** Ships every Ready to Ship order of the plan; the plan becomes Shipped once all are. */
export function shipPlan(tx: Tx, auth: AuthContext, ctx: DomainCtx, id: string, shipDate?: string): PlanShipOutcome {
  const plan = loadPlan(tx, auth, id);
  const orders = tx.select({ id: schema.shipmentOrders.id, code: schema.shipmentOrders.code, status: schema.shipmentOrders.status })
    .from(schema.shipmentPlanOrders).innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.shipmentPlanOrders.orderId))
    .where(eq(schema.shipmentPlanOrders.planId, id)).all();
  const blocked = planShipBlockReason(plan.status, orders.length);
  if (blocked) throw new AppError("INVALID_STATE", `${plan.code}: ${blocked}.`);
  const ready = orders.filter((o) => o.status === "Ready to Ship");
  const failed: { orderCode: string; message: string }[] = orders
    .filter((o) => !DONE.has(o.status) && o.status !== "Ready to Ship")
    .map((o) => ({ orderCode: o.code, message: `${o.code} is ${o.status}; only Ready to Ship orders can be shipped.` }));
  const result = ready.length > 0 ? shipping.shipOrders(tx, ctx, { orderIds: ready.map((o) => o.id), shipDate, requireLabel: false }) : { succeeded: [], failed: [] };
  for (const f of result.failed) failed.push({ orderCode: ready.find((o) => o.id === f.id)?.code ?? "Order", message: f.message });
  const shippedIds = new Set([...orders.filter((o) => DONE.has(o.status)).map((o) => o.id), ...result.succeeded]);
  if (shippedIds.size > 0) {
    tx.update(schema.shipmentPlanOrders).set({ status: "Shipped" }).where(and(eq(schema.shipmentPlanOrders.planId, id), inArray(schema.shipmentPlanOrders.orderId, [...shippedIds]))).run();
  }
  let status = plan.status;
  const allShipped = shippedIds.size === orders.length;
  const target: ShipmentPlanStatus | null = allShipped ? "Shipped" : shippedIds.size > 0 && (status === "Open" || status === "In Progress") ? "Loading Started" : null;
  if (target && target !== status) {
    const path = stateMachines.shipmentPlan.path(status, target) ?? [];
    for (const step of path) status = stateMachines.shipmentPlan.transition(status, step);
    const times = stampTimes(plan, status);
    tx.update(schema.shipmentPlans).set({ status, ...times, updatedBy: ctx.userId, version: sql`${schema.shipmentPlans.version} + 1` }).where(eq(schema.shipmentPlans.id, id)).run();
    syncOrderStatuses(tx, id, status);
    recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: plan.code, before: { status: plan.status, ...pickTimes(plan, times) }, after: { status, ...times } });
  }
  return { planId: id, planCode: plan.code, planStatus: status, shipped: orders.filter((o) => shippedIds.has(o.id)).map((o) => o.code), failed };
}

export interface ShipPlansResult extends BulkResult {
  readonly outcomes: readonly PlanShipOutcome[];
}

export function shipPlans(tx: Tx, auth: AuthContext, ctx: DomainCtx, ids: readonly string[]): ShipPlansResult {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  const outcomes: PlanShipOutcome[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const outcome = tx.transaction((inner) => shipPlan(inner, auth, ctx, id));
      outcomes.push(outcome);
      if (outcome.failed.length === 0) succeeded.push(id);
      else failed.push({ id, code: "PARTIAL", message: `${outcome.planCode}: ${outcome.shipped.length} of ${outcome.shipped.length + outcome.failed.length} orders shipped · ${outcome.failed[0]?.message ?? ""}` });
    } catch (error: unknown) {
      failed.push({ id, code: (error as { code?: string }).code ?? "INTERNAL", message: error instanceof Error ? error.message : "Ship failed" });
    }
  }
  return { succeeded, failed, outcomes };
}

/* ------------------------------------------------------------- estimates */

/** Expected totals for a set of orders: weight lb and volume ft³ from the order lines. */
export function estimateTotals(tx: Tx, auth: AuthContext, orderIds: readonly string[]): { weightLb: number; volumeFt3: number; units: number; orders: number } {
  if (orderIds.length === 0) return { weightLb: 0, volumeFt3: 0, units: 0, orders: 0 };
  const rows = tx.all<{ warehouseId: string; clientId: string; qty: number; weightOz: number; in3: number }>(sql`
    SELECT o.warehouse_id AS warehouseId, o.client_id AS clientId, (ol.quantity - ol.cancelled_quantity) AS qty,
      p.weight_oz AS weightOz, (p.length_in * p.width_in * p.height_in) AS in3
    FROM order_lines ol JOIN shipment_orders o ON o.id = ol.order_id JOIN products p ON p.id = ol.product_id
    WHERE ol.order_id IN (${sql.join(orderIds.map((o) => sql`${o}`), sql`, `)})`);
  const visible = rows.filter((r) => hasWarehouse(auth.scope, r.warehouseId) && hasClient(auth.scope, r.clientId));
  return {
    weightLb: ozToLb(visible.reduce((s, r) => s + r.qty * (r.weightOz ?? 0), 0)),
    volumeFt3: in3ToFt3(visible.reduce((s, r) => s + r.qty * (r.in3 ?? 0), 0)),
    units: visible.reduce((s, r) => s + r.qty, 0),
    orders: new Set(orderIds).size,
  };
}

/* ---------------------------------------------------------- form options */

export interface PlanFormOptions {
  readonly nextCode: string;
  readonly carriers: readonly { value: string; label: string }[];
  readonly retailers: readonly { value: string; label: string }[];
  readonly addresses: readonly { value: string; label: string }[];
}

export function planFormOptions(tx: Tx, auth: AuthContext, input: { warehouseId?: string | null; customerId?: string | null }): PlanFormOptions {
  const carriers = input.warehouseId && hasWarehouse(auth.scope, input.warehouseId)
    ? tx.select().from(schema.carrierConnections).where(and(eq(schema.carrierConnections.warehouseId, input.warehouseId), eq(schema.carrierConnections.isActive, true))).all()
      .map((c) => ({ value: c.id, label: `${c.setupName} - ${c.accountPrefix}` }))
    : [];
  const retailers = tx.select().from(schema.retailers).where(eq(schema.retailers.isActive, true)).all().map((r) => ({ value: r.id, label: r.name }));
  const cu = input.customerId ? tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)).get() : null;
  const addresses = cu && hasClient(auth.scope, cu.clientId)
    ? tx.select().from(schema.addresses).where(and(eq(schema.addresses.ownerType, "customer"), eq(schema.addresses.ownerId, cu.id), eq(schema.addresses.isActive, true))).all()
      .map((a) => ({ value: a.id, label: [a.name, a.line1, a.city, a.state, a.postalCode].filter(Boolean).join(", ") }))
    : [];
  return { nextCode: nextPlanCode(tx), carriers, retailers, addresses };
}

/* ---------------------------------------------------------- manifest/BOL */

export async function printPlanBol(db: AppDb, auth: AuthContext, ids: readonly string[]): Promise<{ fileId: string; count: number }> {
  const records = [...new Set(ids)].map((id) => {
    const plan = loadPlanRow(db, auth.scope, id);
    const wh = db.select().from(schema.warehouses).where(eq(schema.warehouses.id, plan.warehouseId)).get();
    const orders = db.all<{ code: string; customerName: string; trackingNumber: string | null; weightOz: number; packages: number }>(sql`
      SELECT o.code AS code, o.customer_name AS customerName, o.tracking_number AS trackingNumber, o.total_weight_oz AS weightOz,
        MAX(1, (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active')) AS packages
      FROM shipment_plan_orders x JOIN shipment_orders o ON o.id = x.order_id WHERE x.plan_id = ${id} ORDER BY o.code`);
    if (orders.length === 0) throw new AppError("INVALID_STATE", `${plan.code} has no orders to print a Manifest/BOL for.`);
    return {
      bolNumber: plan.code as string,
      shipDate: (plan.plannedShipmentAt as string | null) ?? undefined,
      carrier: plan.carrierName ?? "Customer pickup",
      trailerNumber: (plan.truckPlateNumber as string | null) ?? undefined,
      shipFrom: { name: wh?.name ?? (plan.warehouseCode as string), address1: wh?.addressLine ?? "-", city: wh?.city ?? "-", state: wh?.state ?? undefined, postalCode: wh?.postalCode ?? undefined, country: wh?.country ?? undefined },
      specialInstructions: (plan.note as string | null) ?? undefined,
      shipments: orders.map((o) => ({ orderCode: o.code, customerName: o.customerName, trackingNumber: o.trackingNumber ?? undefined, packages: o.packages, weightLb: Math.round((o.weightOz / 16) * 100) / 100 })),
    };
  });
  const file = await printToFile(db, {
    request: { typeKey: "manifest-bol", records, options: { copies: 1 } },
    userId: auth.user.id, ownerEntityType: records.length === 1 ? ENTITY : null, ownerEntityId: records.length === 1 ? ids[0] : null,
  });
  return { fileId: file.id, count: records.length };
}
