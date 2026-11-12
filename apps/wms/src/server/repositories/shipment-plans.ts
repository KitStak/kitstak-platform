/**
 * Shipment Plan commands (M02 owns `shipment_plans` / `shipment_plan_orders`): create, edit
 * (optimistic concurrency), delete (Open only), status changes through the state machine,
 * add/remove orders, Ship (through `shipping.shipOrders`) and the Manifest/BOL printout.
 * Every write records field-level change_log rows with display values (never raw ids).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SHIPMENT_PLAN_STATUSES, type ShipmentPlanStatus } from '@/lib/enums';
import {
  ACTIVE_PLAN_STATUSES,
  PLAN_CREATE_STATUSES,
  orderEligibilityReason,
  planDeleteBlockReason,
  mergeLifecycleTimes,
  noActiveLabelMessage,
  planChangeMessage,
  planChangeValue,
  planEditBlockReason,
  planShipBlockReason,
  planStatusNote,
  isAutoExpectedLoad,
  planLoadingBlockReason,
  LOADED_ORDER_STATUSES,
  editableLifecycleTimes,
} from '@/lib/grid-defs/shipping/shipment-plans';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError, validationError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient, hasWarehouse } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { diffRows, recordCreate, recordDelete } from '@/server/domain/change-log';
import { next as nextCode, peek } from '@/server/domain/sequences';
import { shipping } from '@/server/domain';
import { localDate } from '@/server/domain/shipping/common';
import { stateMachines } from '@/server/domain/state-machines';
import type { BulkResult, DomainCtx, Tx } from '@/server/domain/types';
import { assertVersion, bulkIdsSchema, idSchema } from './platform-common';
import { loadPlanRow, sumOrderLines, type PlanRow } from './shipment-plans-lists';
import { dbAll, dbRun, mapSeq, withWriteTx } from '@/server/db/sql';

const ENTITY = 'shipment_plan';
const MAX_ORDERS = 500;

/* ---------------------------------------------------------------- schemas */

const isoOrNull = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), 'Enter a valid date and time');
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));
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
  customFields: z
    .record(z.string().max(40), z.union([z.string().max(500), z.boolean(), z.null()]))
    .default({}),
  orderIds: z.array(idSchema).max(MAX_ORDERS, `At most ${MAX_ORDERS} orders per plan`).default([]),
});

/**
 * Create accepts only the create statuses (Open) and defaults to Open when omitted. Any other status
 * (for example "Shipped") is a VALIDATION with `fieldErrors.status`, never silently coerced: the
 * lifecycle statuses are reached through POST /[id]/status and /[id]/ship.
 */
export const createPlanSchema = planFieldsSchema.extend({
  status: z
    .enum(PLAN_CREATE_STATUSES, {
      error: 'A new plan starts as Open. Change the status after it is created.',
    })
    .default('Open'),
});
export const updatePlanSchema = planFieldsSchema.extend({ version: z.number().int().min(1) });
export type PlanInput = z.output<typeof planFieldsSchema>;

export const planStatusSchema = z.object({
  status: z.enum(SHIPMENT_PLAN_STATUSES),
  version: z.number().int().min(1).optional(),
});
export const planOrdersSchema = z.object({ orderIds: bulkIdsSchema });
export const planIdsSchema = z.object({ ids: bulkIdsSchema });

/* ---------------------------------------------------------------- helpers */

/**
 * Field-level change-log rows for a plan with sentences people can read wherever the log is shown (plan
 * Timeline, the global Change Log report, exports): "Added orders SO1, SO2.", "Status changed from Open to
 * Shipped.", "Loading started set to 11/10/2026 6:36 AM EST.". from/to hold the same display values (dates
 * in the warehouse's zone), so consumers that rebuild "<Label> is modified. a --> b" stay readable too.
 */
async function recordUpdate(
  tx: Tx,
  ctx: DomainCtx,
  ref: {
    entityType: string;
    entityId: string;
    entityCode: string;
    before: Readonly<Record<string, unknown>>;
    after: Readonly<Record<string, unknown>>;
  },
): Promise<number> {
  const changes = diffRows(ref.entityType, ref.before, ref.after);
  if (changes.length === 0) return 0;
  const tz =
    (
      await tx
        .select({ tz: schema.warehouses.timezone })
        .from(schema.shipmentPlans)
        .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.shipmentPlans.warehouseId))
        .where(eq(schema.shipmentPlans.id, ref.entityId))
        .limit(1)
    )[0]?.tz ?? null;
  await tx.insert(schema.changeLog).values(
    changes.map((c) => {
      const from = planChangeValue(c.from, tz);
      const to = planChangeValue(c.to, tz);
      return {
        entityType: ref.entityType,
        entityId: ref.entityId,
        entityCode: ref.entityCode,
        type: 'Update' as const,
        field: c.field,
        fieldLabel: c.label,
        fromValue: from,
        toValue: to,
        message: planChangeMessage(c.field, c.label, from, to),
        userId: ctx.userId,
        source: ctx.source,
      };
    }),
  );
  return changes.length;
}

type PlanTable = typeof schema.shipmentPlans.$inferSelect;

async function loadPlan(tx: Tx, auth: AuthContext, id: string): Promise<PlanTable> {
  const plan = (
    await tx.select().from(schema.shipmentPlans).where(eq(schema.shipmentPlans.id, id)).limit(1)
  )[0];
  if (
    !plan ||
    !hasWarehouse(auth.scope, plan.warehouseId) ||
    (plan.clientId && !hasClient(auth.scope, plan.clientId))
  )
    throw notFoundError('Shipment plan');
  return plan;
}

const fieldError = (field: string, message: string): AppError =>
  validationError(message, { [field]: [message] });

/** Validates every reference (scope, warehouse match, gate area, dependent address) and the date order. */
async function validateRefs(tx: Tx, auth: AuthContext, input: PlanInput): Promise<void> {
  if (!hasWarehouse(auth.scope, input.warehouseId))
    throw fieldError('warehouseId', 'Select a warehouse you have access to');
  if (input.clientId && !hasClient(auth.scope, input.clientId))
    throw fieldError('clientId', 'Select a client you have access to');
  if (input.carrierConnectionId) {
    const conn = (
      await tx
        .select()
        .from(schema.carrierConnections)
        .where(eq(schema.carrierConnections.id, input.carrierConnectionId))
        .limit(1)
    )[0];
    if (!conn || conn.warehouseId !== input.warehouseId)
      throw fieldError('carrierConnectionId', 'This carrier is not set up for the selected warehouse');
  }
  if (input.loadingGateLocationId) {
    const gate = (
      await tx
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, input.loadingGateLocationId))
        .limit(1)
    )[0];
    if (!gate || gate.warehouseId !== input.warehouseId)
      throw fieldError(
        'loadingGateLocationId',
        'The loading gate must be a location in the selected warehouse',
      );
    if (gate.areaType !== 'Loading' && gate.areaType !== 'Shipment')
      throw fieldError('loadingGateLocationId', 'Pick a location in a Loading or Shipment area');
  }
  if (input.customerId) {
    const cu = (
      await tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)).limit(1)
    )[0];
    if (!cu || !hasClient(auth.scope, cu.clientId)) throw fieldError('customerId', 'Customer not found');
    if (input.clientId && cu.clientId !== input.clientId)
      throw fieldError('customerId', 'This customer belongs to another client');
  }
  if (input.customerAddressId) {
    const ad = (
      await tx
        .select()
        .from(schema.addresses)
        .where(eq(schema.addresses.id, input.customerAddressId))
        .limit(1)
    )[0];
    if (!input.customerId || !ad || ad.ownerType !== 'customer' || ad.ownerId !== input.customerId)
      throw fieldError('customerAddressId', 'Pick an address of the selected customer');
  }
  if (
    input.retailerId &&
    !(await tx.select().from(schema.retailers).where(eq(schema.retailers.id, input.retailerId)).limit(1))[0]
  )
    throw fieldError('retailerId', 'Retailer not found');
  const order: readonly [keyof PlanInput, keyof PlanInput, string][] = [
    ['loadingStartedAt', 'loadingCompletedAt', "Loading can't complete before it started"],
    ['loadingCompletedAt', 'truckDepartedAt', "The truck can't depart before loading completed"],
  ];
  for (const [a, b, message] of order) {
    const from = input[a] as string | null;
    const to = input[b] as string | null;
    if (from && to && new Date(to) < new Date(from)) throw fieldError(b, message);
  }
}

/** Validates orders for the plan; throws one VALIDATION listing every ineligible order. */
async function validateOrders(
  tx: Tx,
  auth: AuthContext,
  plan: { id?: string; warehouseId: string; clientId: string | null },
  orderIds: readonly string[],
): Promise<void> {
  if (orderIds.length === 0) return;
  const orders = await tx
    .select()
    .from(schema.shipmentOrders)
    .where(inArray(schema.shipmentOrders.id, [...orderIds]));
  const problems: string[] = [];
  for (const id of orderIds) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.deletedAt || !hasWarehouse(auth.scope, o.warehouseId) || !hasClient(auth.scope, o.clientId)) {
      problems.push(`${id} was not found or is not in this warehouse`);
      continue;
    }
    const reason = orderEligibilityReason(o, plan);
    if (reason) problems.push(`${o.code} ${reason}`);
  }
  const busy = await tx
    .select({ code: schema.shipmentOrders.code, plan: schema.shipmentPlans.code })
    .from(schema.shipmentPlanOrders)
    .innerJoin(schema.shipmentPlans, eq(schema.shipmentPlans.id, schema.shipmentPlanOrders.planId))
    .innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.shipmentPlanOrders.orderId))
    .where(
      and(
        inArray(schema.shipmentPlanOrders.orderId, [...orderIds]),
        inArray(schema.shipmentPlans.status, [...ACTIVE_PLAN_STATUSES]),
        plan.id ? sql`${schema.shipmentPlans.id} <> ${plan.id}` : undefined,
      ),
    );
  for (const b of busy) problems.push(`${b.code} is already in plan ${b.plan}`);
  if (problems.length > 0) {
    const message =
      problems.length === 1
        ? `Order ${problems[0]}.`
        : `${problems.length} orders can't be added: ${problems.slice(0, 4).join('; ')}${problems.length > 4 ? '…' : ''}.`;
    throw new AppError('RULE_VIOLATION', message, { fieldErrors: { orderIds: [message] } });
  }
}

/** Human-readable snapshot for the change log (names instead of ids). */
async function displaySnapshot(
  tx: Tx,
  p: Partial<PlanTable>,
  orderCodes: readonly string[],
): Promise<Record<string, unknown>> {
  const wh = p.warehouseId
    ? (await tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, p.warehouseId)).limit(1))[0]
        ?.code
    : null;
  const client = p.clientId
    ? (await tx.select().from(schema.clients).where(eq(schema.clients.id, p.clientId)).limit(1))[0]?.name
    : null;
  const carrier = p.carrierConnectionId
    ? (
        await tx
          .select()
          .from(schema.carrierConnections)
          .where(eq(schema.carrierConnections.id, p.carrierConnectionId))
          .limit(1)
      )[0]
    : null;
  const gate = p.loadingGateLocationId
    ? (
        await tx
          .select()
          .from(schema.locations)
          .where(eq(schema.locations.id, p.loadingGateLocationId))
          .limit(1)
      )[0]?.code
    : null;
  const cu = p.customerId
    ? (await tx.select().from(schema.customers).where(eq(schema.customers.id, p.customerId)).limit(1))[0]
    : null;
  const ad = p.customerAddressId
    ? (
        await tx.select().from(schema.addresses).where(eq(schema.addresses.id, p.customerAddressId)).limit(1)
      )[0]
    : null;
  const retailer = p.retailerId
    ? (await tx.select().from(schema.retailers).where(eq(schema.retailers.id, p.retailerId)).limit(1))[0]
        ?.name
    : null;
  return {
    code: p.code,
    status: p.status,
    warehouse: wh ?? null,
    client: client ?? null,
    carrier: carrier ? `${carrier.setupName} - ${carrier.accountPrefix}` : null,
    truckPlateNumber: p.truckPlateNumber ?? null,
    loadingGate: gate ?? null,
    plannedShipmentAt: p.plannedShipmentAt ?? null,
    actualShipmentAt: p.status === 'Shipped' ? (p.actualShipmentAt ?? null) : null,
    loadingStartedAt: p.loadingStartedAt ?? null,
    loadingCompletedAt: p.loadingCompletedAt ?? null,
    truckDepartedAt: p.truckDepartedAt ?? null,
    expectedTotalVolume: p.expectedTotalVolume ?? 0,
    expectedTotalWeight: p.expectedTotalWeight ?? 0,
    preventLpnEditDuringLoading: p.preventLpnEditDuringLoading ?? false,
    note: p.note ?? null,
    customer: cu ? `${cu.firstName} ${cu.lastName}` : null,
    customerAddress: ad ? `${ad.line1}, ${ad.city}` : null,
    retailer: retailer ?? null,
    customFields: p.customFields ?? {},
    orders: [...orderCodes].sort().join(', '),
  };
}

async function orderCodesOf(tx: Tx, planId: string): Promise<string[]> {
  return (
    await tx
      .select({ code: schema.shipmentOrders.code })
      .from(schema.shipmentPlanOrders)
      .innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.shipmentPlanOrders.orderId))
      .where(eq(schema.shipmentPlanOrders.planId, planId))
  ).map((r) => r.code);
}

function columnsOf(input: PlanInput): Omit<typeof schema.shipmentPlans.$inferInsert, 'code'> {
  return {
    warehouseId: input.warehouseId,
    clientId: input.clientId,
    carrierConnectionId: input.carrierConnectionId,
    truckPlateNumber: input.truckPlateNumber,
    loadingGateLocationId: input.loadingGateLocationId,
    status: input.status,
    plannedShipmentAt: input.plannedShipmentAt,
    actualShipmentAt: input.actualShipmentAt,
    loadingStartedAt: input.loadingStartedAt,
    loadingCompletedAt: input.loadingCompletedAt,
    truckDepartedAt: input.truckDepartedAt,
    expectedTotalVolume: Math.round(input.expectedTotalVolume * 100) / 100,
    expectedTotalWeight: Math.round(input.expectedTotalWeight * 100) / 100,
    preventLpnEditDuringLoading: input.preventLpnEditDuringLoading,
    note: input.note,
    customerId: input.customerId,
    customerAddressId: input.customerAddressId,
    retailerId: input.retailerId,
    customFields: input.customFields,
  };
}

/**
 * Expected load defaults to the orders' totals: a plan saved with 0 lb and 0 ft3 (the wizard default)
 * takes the sum of its orders, so the detail page never shows an empty Expected load.
 */
export async function withOrderTotals<T extends PlanInput>(
  tx: Tx,
  auth: AuthContext,
  input: T,
  orderIds: readonly string[],
): Promise<T> {
  if (orderIds.length === 0 || input.expectedTotalWeight > 0 || input.expectedTotalVolume > 0) return input;
  const t = await estimateTotals(tx, auth, orderIds);
  return { ...input, expectedTotalWeight: t.weightLb, expectedTotalVolume: t.volumeFt3 };
}

/* --------------------------------------------------------------- commands */

export async function nextPlanCode(tx: Tx): Promise<string> {
  return await peek(tx, 'shipmentPlan');
}

/**
 * Domain-level validation for every caller (route, import, automation, tests): trims and normalises the
 * input through the same schema the routes use, so a bad payload is a VALIDATION with fieldErrors and
 * never a raw SQLite constraint error. A blank / whitespace-only code means "assign the next code".
 */
export function parsePlanInput<
  S extends typeof planFieldsSchema | typeof createPlanSchema | typeof updatePlanSchema,
>(schemaDef: S, input: unknown): z.output<S> {
  const raw = input && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {};
  // Totals the caller left out (or sent as null) default to 0, like the wizard.
  for (const k of ['expectedTotalVolume', 'expectedTotalWeight'] as const)
    if (raw[k] === null || raw[k] === undefined) delete raw[k];
  const parsed = schemaDef.safeParse(raw);
  if (parsed.success) return parsed.data as z.output<S>;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = parsed.error.issues[0];
  throw validationError(
    parsed.error.issues.length === 1 && first ? first.message : 'Check the highlighted plan fields',
    fieldErrors,
  );
}

export async function createPlan(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  rawInput: PlanInput,
): Promise<PlanRow> {
  let input: PlanInput = parsePlanInput(createPlanSchema, rawInput);
  if (!(PLAN_CREATE_STATUSES as readonly string[]).includes(input.status))
    throw fieldError('status', 'A new plan starts as Open. Change the status after it is created.');
  // Execution timestamps are set by lifecycle transitions, never entered at creation.
  input = {
    ...input,
    actualShipmentAt: null,
    loadingStartedAt: null,
    loadingCompletedAt: null,
    truckDepartedAt: null,
  };
  await validateRefs(tx, auth, input);
  await validateOrders(
    tx,
    auth,
    { warehouseId: input.warehouseId, clientId: input.clientId },
    input.orderIds,
  );
  const code = input.code ?? (await nextCode(tx, 'shipmentPlan'));
  if (
    (
      await tx
        .select({ id: schema.shipmentPlans.id })
        .from(schema.shipmentPlans)
        .where(eq(schema.shipmentPlans.code, code))
        .limit(1)
    )[0]
  ) {
    throw new AppError('DUPLICATE', `Shipment plan code ${code} is already used`, {
      fieldErrors: { code: ['This code is already used'] },
    });
  }
  input = await withOrderTotals(tx, auth, input, input.orderIds);
  const row = (
    await tx
      .insert(schema.shipmentPlans)
      .values({ ...columnsOf(input), code, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning()
  )[0];
  const orderIds = [...new Set(input.orderIds)];
  if (orderIds.length > 0)
    await tx
      .insert(schema.shipmentPlanOrders)
      .values(orderIds.map((orderId) => ({ planId: row.id, orderId, status: row.status })));
  await recordCreate(tx, ctx, { entityType: ENTITY, entityId: row.id, entityCode: code });
  if (orderIds.length > 0)
    await recordUpdate(tx, ctx, {
      entityType: ENTITY,
      entityId: row.id,
      entityCode: code,
      before: { orders: '' },
      after: { orders: (await orderCodesOf(tx, row.id)).sort().join(', ') },
    });
  return await loadPlanRow(tx, auth.scope, row.id);
}

export async function updatePlan(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  id: string,
  rawInput: PlanInput & { version: number },
): Promise<PlanRow> {
  let input: PlanInput & { version: number } = parsePlanInput(updatePlanSchema, rawInput);
  const plan = await loadPlan(tx, auth, id);
  assertVersion(plan.version, input.version);
  const blocked = planEditBlockReason(plan.status);
  if (blocked) throw new AppError('INVALID_STATE', `${blocked}.`);
  if (input.status !== plan.status) {
    if (input.status === 'Shipped') throw fieldError('status', "Use Ship to ship the plan's orders");
    const check = stateMachines.shipmentPlan.canTransition(plan.status, input.status);
    if (!check.ok) throw fieldError('status', check.reason);
    const loading = await loadingBlock(tx, id, input.status, input.orderIds);
    if (loading) throw fieldError('status', loading);
  }
  await validateRefs(tx, auth, input);
  const beforeCodes = await orderCodesOf(tx, id);
  const before = await displaySnapshot(tx, plan, beforeCodes);
  const current = (
    await tx
      .select({ orderId: schema.shipmentPlanOrders.orderId })
      .from(schema.shipmentPlanOrders)
      .where(eq(schema.shipmentPlanOrders.planId, id))
  ).map((r) => r.orderId);
  const wanted = new Set(input.orderIds);
  const added = [...wanted].filter((o) => !current.includes(o));
  const removed = current.filter((o) => !wanted.has(o));
  if (input.warehouseId !== plan.warehouseId && current.length > 0 && removed.length < current.length) {
    throw fieldError('warehouseId', "Remove the plan's orders before moving it to another warehouse");
  }
  await validateOrders(tx, auth, { id, warehouseId: input.warehouseId, clientId: input.clientId }, added);
  const code = input.code ?? plan.code;
  if (
    code !== plan.code &&
    (
      await tx
        .select({ id: schema.shipmentPlans.id })
        .from(schema.shipmentPlans)
        .where(eq(schema.shipmentPlans.code, code))
        .limit(1)
    )[0]
  ) {
    throw new AppError('DUPLICATE', `Shipment plan code ${code} is already used`, {
      fieldErrors: { code: ['This code is already used'] },
    });
  }
  input = { ...(await withOrderTotals(tx, auth, input, [...wanted])), version: input.version };
  // Execution timestamps are stamped by the lifecycle (status changes / Ship). Once a stage is
  // reached its time may be corrected here (Logiwa General step); every correction is change-logged.
  const times = mergeLifecycleTimes(
    plan.status,
    {
      actualShipmentAt: plan.actualShipmentAt,
      loadingStartedAt: plan.loadingStartedAt,
      loadingCompletedAt: plan.loadingCompletedAt,
      truckDepartedAt: plan.truckDepartedAt,
    },
    {
      actualShipmentAt: input.actualShipmentAt,
      loadingStartedAt: input.loadingStartedAt,
      loadingCompletedAt: input.loadingCompletedAt,
      truckDepartedAt: input.truckDepartedAt,
    },
  );
  if (times.error) throw fieldError(times.error.field, times.error.message);
  input = { ...input, ...times.values };
  const updated = (
    await tx
      .update(schema.shipmentPlans)
      .set({
        ...columnsOf(input),
        ...stampTimes(plan, input.status, input),
        code,
        updatedBy: ctx.userId,
        version: sql`${schema.shipmentPlans.version} + 1`,
      })
      .where(and(eq(schema.shipmentPlans.id, id), eq(schema.shipmentPlans.version, plan.version)))
      .returning()
  )[0];
  if (!updated) throw new AppError('CONFLICT', 'This plan changed since you opened it. Reload and try again.');
  if (removed.length > 0)
    await tx
      .delete(schema.shipmentPlanOrders)
      .where(
        and(eq(schema.shipmentPlanOrders.planId, id), inArray(schema.shipmentPlanOrders.orderId, removed)),
      );
  if (added.length > 0)
    await tx
      .insert(schema.shipmentPlanOrders)
      .values(added.map((orderId) => ({ planId: id, orderId, status: updated.status })));
  await syncOrderStatuses(tx, id, updated.status);
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: updated.code,
    before,
    after: await displaySnapshot(tx, updated, await orderCodesOf(tx, id)),
  });
  return await loadPlanRow(tx, auth.scope, id);
}

/** Loading Started / Completed need every order Ready to Ship (or shipped). */
async function loadingBlock(
  tx: Tx,
  planId: string,
  status: ShipmentPlanStatus,
  orderIds?: readonly string[],
): Promise<string | null> {
  if (status !== 'Loading Started' && status !== 'Loading Completed') return null;
  const ids = orderIds
    ? [...new Set(orderIds)]
    : (
        await tx
          .select({ id: schema.shipmentPlanOrders.orderId })
          .from(schema.shipmentPlanOrders)
          .where(eq(schema.shipmentPlanOrders.planId, planId))
      ).map((r) => r.id);
  if (ids.length === 0) return planLoadingBlockReason(0, 0);
  const rows = await tx
    .select({ code: schema.shipmentOrders.code, status: schema.shipmentOrders.status })
    .from(schema.shipmentOrders)
    .where(inArray(schema.shipmentOrders.id, ids));
  const waiting = rows.filter((o) => !(LOADED_ORDER_STATUSES as readonly string[]).includes(o.status));
  const reason = planLoadingBlockReason(rows.length, rows.length - waiting.length);
  return reason
    ? `${reason} (${waiting
        .slice(0, 3)
        .map((o) => `${o.code}: ${o.status}`)
        .join(', ')}${waiting.length > 3 ? ', …' : ''})`
    : null;
}

/** Sets the lifecycle timestamps a status implies, when the user left them empty. */
function stampTimes(
  plan: Pick<PlanTable, 'loadingStartedAt' | 'loadingCompletedAt' | 'actualShipmentAt' | 'truckDepartedAt'>,
  status: ShipmentPlanStatus,
  input?: Partial<PlanInput>,
): Partial<PlanTable> {
  const now = new Date().toISOString();
  const pick = (key: 'loadingStartedAt' | 'loadingCompletedAt' | 'actualShipmentAt' | 'truckDepartedAt') =>
    (input && input[key] !== undefined ? input[key] : plan[key]) ?? now;
  if (status === 'Loading Started') return { loadingStartedAt: pick('loadingStartedAt') };
  if (status === 'Loading Completed')
    return { loadingStartedAt: pick('loadingStartedAt'), loadingCompletedAt: pick('loadingCompletedAt') };
  // Ship records only the actual shipment time. Loading / departure stages the plan never reached stay blank
  // (no fabricated times: dock KPIs such as load duration and dwell read these columns). They can be filled in later.
  if (status === 'Shipped') return { actualShipmentAt: now };
  return {};
}

/** Plan-order rows mirror the plan status; orders already shipped keep "Shipped". */
async function syncOrderStatuses(tx: Tx, planId: string, status: ShipmentPlanStatus): Promise<void> {
  await dbRun(
    tx,
    sql`UPDATE shipment_plan_orders SET status = ${status} WHERE plan_id = ${planId} AND status <> 'Shipped'`,
  );
}

export async function changePlanStatus(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  id: string,
  to: ShipmentPlanStatus,
  version?: number,
): Promise<PlanRow> {
  const plan = await loadPlan(tx, auth, id);
  assertVersion(plan.version, version);
  if (to === 'Shipped')
    throw new AppError(
      'INVALID_STATE',
      "Use Ship to ship the plan's orders; the plan becomes Shipped when they are.",
    );
  const status = stateMachines.shipmentPlan.transition(plan.status, to);
  const loading = await loadingBlock(tx, id, status);
  if (loading) throw new AppError('INVALID_STATE', `${plan.code}: can't move to ${status}: ${loading}.`);
  const times = stampTimes(plan, status);
  await tx
    .update(schema.shipmentPlans)
    .set({ status, ...times, updatedBy: ctx.userId, version: sql`${schema.shipmentPlans.version} + 1` })
    .where(eq(schema.shipmentPlans.id, id));
  await syncOrderStatuses(tx, id, status);
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: plan.code,
    before: { status: plan.status, ...pickTimes(plan, times) },
    after: { status, ...times },
  });
  return await loadPlanRow(tx, auth.scope, id);
}

function pickTimes(plan: PlanTable, times: Partial<PlanTable>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(times).map((k) => [k, plan[k as keyof PlanTable] ?? null]));
}

async function planOrderIds(tx: Tx, planId: string): Promise<string[]> {
  return (
    await tx
      .select({ o: schema.shipmentPlanOrders.orderId })
      .from(schema.shipmentPlanOrders)
      .where(eq(schema.shipmentPlanOrders.planId, planId))
  ).map((r) => r.o);
}

/**
 * Orders attached or removed outside the wizard (API, import, Add order(s), Remove) keep the expected
 * load in step. The plan follows its orders while its expected weight and volume are still automatic:
 * 0/0 (never set) or equal to the totals of the orders it held before the change. A value the user
 * typed by hand is kept.
 */
async function refreshExpectedLoad(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  plan: PlanTable,
  beforeOrderIds: readonly string[],
): Promise<void> {
  const weight = plan.expectedTotalWeight ?? 0;
  const volume = plan.expectedTotalVolume ?? 0;
  if (!isAutoExpectedLoad(weight, volume, await estimateTotals(tx, auth, beforeOrderIds))) return;
  const t = await estimateTotals(tx, auth, await planOrderIds(tx, plan.id));
  if (Math.abs(t.weightLb - weight) < 0.005 && Math.abs(t.volumeFt3 - volume) < 0.005) return;
  await tx
    .update(schema.shipmentPlans)
    .set({ expectedTotalWeight: t.weightLb, expectedTotalVolume: t.volumeFt3, updatedBy: ctx.userId })
    .where(eq(schema.shipmentPlans.id, plan.id));
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: plan.id,
    entityCode: plan.code,
    before: { expectedTotalWeight: weight, expectedTotalVolume: volume },
    after: { expectedTotalWeight: t.weightLb, expectedTotalVolume: t.volumeFt3 },
  });
}

export async function addPlanOrders(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  id: string,
  orderIds: readonly string[],
): Promise<PlanRow> {
  const plan = await loadPlan(tx, auth, id);
  const blocked = planEditBlockReason(plan.status);
  if (blocked) throw new AppError('INVALID_STATE', `${blocked}.`);
  const existing = new Set(
    (
      await tx
        .select({ o: schema.shipmentPlanOrders.orderId })
        .from(schema.shipmentPlanOrders)
        .where(eq(schema.shipmentPlanOrders.planId, id))
    ).map((r) => r.o),
  );
  const added = [...new Set(orderIds)].filter((o) => !existing.has(o));
  if (existing.size + added.length > MAX_ORDERS)
    throw validationError(`A plan holds at most ${MAX_ORDERS} orders`);
  await validateOrders(tx, auth, plan, added);
  const before = (await orderCodesOf(tx, id)).sort().join(', ');
  if (added.length > 0)
    await tx
      .insert(schema.shipmentPlanOrders)
      .values(added.map((orderId) => ({ planId: id, orderId, status: plan.status })));
  await refreshExpectedLoad(tx, auth, ctx, plan, [...existing]);
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: plan.code,
    before: { orders: before },
    after: { orders: (await orderCodesOf(tx, id)).sort().join(', ') },
  });
  return await loadPlanRow(tx, auth.scope, id);
}

export async function removePlanOrders(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  id: string,
  orderIds: readonly string[],
): Promise<PlanRow> {
  const plan = await loadPlan(tx, auth, id);
  const blocked = planEditBlockReason(plan.status);
  if (blocked) throw new AppError('INVALID_STATE', `${blocked}.`);
  const before = (await orderCodesOf(tx, id)).sort().join(', ');
  const beforeIds = await planOrderIds(tx, id);
  await tx
    .delete(schema.shipmentPlanOrders)
    .where(
      and(
        eq(schema.shipmentPlanOrders.planId, id),
        inArray(schema.shipmentPlanOrders.orderId, [...orderIds]),
        sql`${schema.shipmentPlanOrders.status} <> 'Shipped'`,
      ),
    );
  await refreshExpectedLoad(tx, auth, ctx, plan, beforeIds);
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: plan.code,
    before: { orders: before },
    after: { orders: (await orderCodesOf(tx, id)).sort().join(', ') },
  });
  return await loadPlanRow(tx, auth.scope, id);
}

/** Inline grid edits (Logiwa edits truck columns in place): only these fields, same rules as Edit. */
export const quickPlanSchema = z.object({
  version: z.number().int().min(1),
  truckPlateNumber: optText(40).optional(),
  loadingGateLocationId: optId.optional(),
  loadingStartedAt: isoOrNull.optional(),
  loadingCompletedAt: isoOrNull.optional(),
  truckDepartedAt: isoOrNull.optional(),
});
export type QuickPlanInput = z.output<typeof quickPlanSchema>;

export async function quickUpdatePlan(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  id: string,
  patch: QuickPlanInput,
): Promise<PlanRow> {
  const p = await loadPlan(tx, auth, id);
  const raw = (p as { customFields?: unknown }).customFields;
  const customFields = (
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return {};
          }
        })()
      : (raw ?? {})
  ) as PlanInput['customFields'];
  const base: PlanInput = {
    code: p.code,
    warehouseId: p.warehouseId,
    clientId: p.clientId,
    carrierConnectionId: p.carrierConnectionId,
    truckPlateNumber: p.truckPlateNumber,
    loadingGateLocationId: p.loadingGateLocationId,
    status: p.status,
    plannedShipmentAt: p.plannedShipmentAt,
    actualShipmentAt: p.actualShipmentAt,
    loadingStartedAt: p.loadingStartedAt,
    loadingCompletedAt: p.loadingCompletedAt,
    truckDepartedAt: p.truckDepartedAt,
    expectedTotalVolume: p.expectedTotalVolume,
    expectedTotalWeight: p.expectedTotalWeight,
    preventLpnEditDuringLoading: Boolean(p.preventLpnEditDuringLoading),
    note: p.note,
    customerId: p.customerId,
    customerAddressId: p.customerAddressId,
    retailerId: p.retailerId,
    customFields,
    orderIds: await planOrderIds(tx, id),
  };
  const { version, ...fields } = patch;
  const next = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Partial<PlanInput>;
  for (const key of ['loadingStartedAt', 'loadingCompletedAt', 'truckDepartedAt'] as const) {
    if (next[key] !== undefined && !editableLifecycleTimes(p.status).has(key)) {
      throw fieldError(
        key,
        key === 'loadingStartedAt'
          ? 'Available once the plan reaches Loading Started'
          : 'Available once the plan reaches Loading Completed',
      );
    }
  }
  return await updatePlan(tx, auth, ctx, id, { ...base, ...next, version });
}

export async function deletePlans(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  ids: readonly string[],
): Promise<BulkResult> {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      await withWriteTx(tx, async (inner) => {
        const plan = await loadPlan(inner, auth, id);
        const blocked = planDeleteBlockReason(plan.status);
        if (blocked) throw new AppError('INVALID_STATE', `${plan.code}: ${blocked}.`);
        await inner.delete(schema.shipmentPlanOrders).where(eq(schema.shipmentPlanOrders.planId, id));
        await inner.delete(schema.shipmentPlans).where(eq(schema.shipmentPlans.id, id));
        await recordDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: plan.code });
      });
      succeeded.push(id);
    } catch (error: unknown) {
      failed.push({
        id,
        code: (error as { code?: string }).code ?? 'INTERNAL',
        message: error instanceof Error ? error.message : 'Delete failed',
      });
    }
  }
  return { succeeded, failed };
}

/* ------------------------------------------------------------------- ship */

export interface PlanShipOutcome {
  readonly planId: string;
  readonly planCode: string;
  readonly planStatus: ShipmentPlanStatus;
  /** Status before the ship; differs from planStatus when the ship moved the plan. */
  readonly previousStatus: ShipmentPlanStatus;
  /** Result-window note, e.g. "Plan moved from Open to Loading Started because 1 of 2 orders shipped." */
  readonly statusNote: string | null;
  readonly shipped: readonly string[];
  readonly failed: readonly { readonly orderCode: string; readonly message: string }[];
  /** Orders that shipped with a label already on a closed (signed) End Of The Day manifest. */
  readonly manifestWarnings: readonly string[];
}

const mdy = (day: string): string => day.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3/$1');

/**
 * Packages that leave after their manifest was closed: the driver signed a manifest that listed
 * them before they were loaded. Ship still goes ahead; the result window says which manifest to
 * reprint (or which package to relabel).
 */
export async function closedManifestWarnings(
  tx: Tx,
  orders: readonly { readonly id: string; readonly code: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (orders.length === 0) return out;
  const rows = await dbAll<{
    orderId: string;
    carrierCode: string;
    shipDate: string;
    closeDate: string | null;
    timezone: string | null;
    packages: number;
  }>(
    tx,
    sql`
    SELECT s.order_id AS "orderId", s.carrier_code AS "carrierCode", m.ship_date AS "shipDate", m.close_date AS "closeDate", w.timezone AS timezone, COUNT(*) AS packages
    FROM shipments s JOIN end_of_day_manifests m ON m.id = s.end_of_day_manifest_id JOIN warehouses w ON w.id = m.warehouse_id
    WHERE s.order_id IN (${sql.join(
      orders.map((o) => sql`${o.id}`),
      sql`, `,
    )}) AND s.label_type = 'Shipping Label' AND s.label_status = 'Active' AND m.status = 'Closed'
    GROUP BY s.order_id, s.carrier_code, m.id, w.id`,
  );
  for (const r of rows) {
    const code = orders.find((o) => o.id === r.orderId)?.code ?? 'Order';
    const what = Number(r.packages) === 1 ? 'its package is' : `${r.packages} packages are`;
    const closed = r.closeDate ? ` on ${mdy(localDate(new Date(r.closeDate), r.timezone ?? 'UTC'))}` : '';
    out.set(
      r.orderId,
      `${code}: ${what} on the ${r.carrierCode} End Of The Day manifest for ${mdy(r.shipDate)}, which was already closed${closed}. Reprint that manifest for the carrier, or void and relabel the package so it joins today's manifest.`,
    );
  }
  return out;
}

const DONE = new Set(['Shipped', 'Partially Shipped', 'Delivered']);

/** Ships every Ready to Ship order of the plan; the plan becomes Shipped once all are. */
export async function shipPlan(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  id: string,
  shipDate?: string,
): Promise<PlanShipOutcome> {
  const plan = await loadPlan(tx, auth, id);
  const orders = await tx
    .select({
      id: schema.shipmentOrders.id,
      code: schema.shipmentOrders.code,
      status: schema.shipmentOrders.status,
    })
    .from(schema.shipmentPlanOrders)
    .innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.shipmentPlanOrders.orderId))
    .where(eq(schema.shipmentPlanOrders.planId, id));
  const loaded = orders.filter((o) => o.status === 'Ready to Ship' || DONE.has(o.status)).length;
  const readyAll = orders.filter((o) => o.status === 'Ready to Ship');
  // Every shipped order needs an active shipping label (tracking + EOD manifest line; db:verify shipped_without_label).
  const labels = await labelCounts(
    tx,
    readyAll.map((o) => o.id),
  );
  const unlabeled = readyAll.filter((o) => (labels.get(o.id)?.active ?? 0) === 0);
  const blocked = planShipBlockReason(
    plan.status,
    orders.length,
    loaded,
    orders.filter((o) => DONE.has(o.status)).length,
    unlabeled.length,
    unlabeled.map((o) => o.code).join(','),
  );
  if (blocked) throw new AppError('INVALID_STATE', `${plan.code}: ${blocked}.`);
  const ready = readyAll.filter((o) => (labels.get(o.id)?.active ?? 0) > 0);
  const failed: { orderCode: string; message: string }[] = orders
    .filter((o) => !DONE.has(o.status) && o.status !== 'Ready to Ship')
    .map((o) => ({
      orderCode: o.code,
      message: `The shipment order status is not valid (${o.status}); only Ready to Ship orders can be shipped.`,
    }));
  for (const o of unlabeled)
    failed.push({ orderCode: o.code, message: noActiveLabelMessage(o.code, labels.get(o.id)?.voided ?? 0) });
  const lateLabels = await closedManifestWarnings(tx, ready);
  const result =
    ready.length > 0
      ? await shipping.shipOrders(tx, ctx, { orderIds: ready.map((o) => o.id), shipDate, requireLabel: true })
      : { succeeded: [], failed: [] };
  for (const f of result.failed)
    failed.push({ orderCode: ready.find((o) => o.id === f.id)?.code ?? 'Order', message: f.message });
  const shippedIds = new Set([
    ...orders.filter((o) => DONE.has(o.status)).map((o) => o.id),
    ...result.succeeded,
  ]);
  if (shippedIds.size > 0) {
    await tx
      .update(schema.shipmentPlanOrders)
      .set({ status: 'Shipped' })
      .where(
        and(
          eq(schema.shipmentPlanOrders.planId, id),
          inArray(schema.shipmentPlanOrders.orderId, [...shippedIds]),
        ),
      );
  }
  let status = plan.status;
  const allShipped = shippedIds.size === orders.length;
  // A partial ship leaves the plan status alone: nobody started loading, so no loading stage or time is
  // invented (Logiwa parity). The plan becomes Shipped only once every order has shipped; the stages it
  // jumped over stay blank and read "Skipped" on the detail stepper.
  const target: ShipmentPlanStatus | null = allShipped ? 'Shipped' : null;
  if (target && target !== status) {
    const path = stateMachines.shipmentPlan.path(status, target) ?? [];
    for (const step of path) status = stateMachines.shipmentPlan.transition(status, step);
    const times = stampTimes(plan, status);
    await tx
      .update(schema.shipmentPlans)
      .set({ status, ...times, updatedBy: ctx.userId, version: sql`${schema.shipmentPlans.version} + 1` })
      .where(eq(schema.shipmentPlans.id, id));
    await syncOrderStatuses(tx, id, status);
    await recordUpdate(tx, ctx, {
      entityType: ENTITY,
      entityId: id,
      entityCode: plan.code,
      before: { status: plan.status, ...pickTimes(plan, times) },
      after: { status, ...times },
    });
  }
  return {
    planId: id,
    planCode: plan.code,
    planStatus: status,
    previousStatus: plan.status as ShipmentPlanStatus,
    statusNote: planStatusNote(plan.status as ShipmentPlanStatus, status, shippedIds.size, orders.length),
    shipped: orders.filter((o) => shippedIds.has(o.id)).map((o) => o.code),
    failed,
    manifestWarnings: result.succeeded
      .map((sid) => lateLabels.get(sid))
      .filter((w): w is string => Boolean(w)),
  };
}

/**
 * Picking/Job Operations on a plan works on the plan's orders (Logiwa parity): the shared create-job
 * modal receives the plans' unshipped, non-cancelled order ids. Plans out of scope → 404.
 */
export async function planJobOrders(
  tx: Tx,
  auth: AuthContext,
  ids: readonly string[],
): Promise<{ orderIds: string[]; plans: { id: string; code: string; orderCount: number }[] }> {
  const orderIds: string[] = [];
  const plans: { id: string; code: string; orderCount: number }[] = [];
  for (const id of [...new Set(ids)]) {
    const plan = await loadPlan(tx, auth, id);
    const rows = (
      await tx
        .select({ id: schema.shipmentOrders.id, status: schema.shipmentOrders.status })
        .from(schema.shipmentPlanOrders)
        .innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.shipmentPlanOrders.orderId))
        .where(eq(schema.shipmentPlanOrders.planId, id))
    ).filter((o) => !DONE.has(o.status) && o.status !== 'Cancelled');
    plans.push({ id, code: plan.code, orderCount: rows.length });
    for (const r of rows) if (!orderIds.includes(r.id)) orderIds.push(r.id);
  }
  return { orderIds, plans };
}

/** Active / voided shipping-label counts per order. */
async function labelCounts(
  tx: Tx,
  orderIds: readonly string[],
): Promise<Map<string, { active: number; voided: number }>> {
  const out = new Map<string, { active: number; voided: number }>();
  if (orderIds.length === 0) return out;
  const rows = await dbAll<{ orderId: string; active: number; voided: number }>(
    tx,
    sql`
    SELECT s.order_id AS "orderId", SUM((s.label_status = 'Active')::int) AS active, SUM((s.label_status = 'Voided')::int) AS voided
    FROM shipments s WHERE s.label_type = 'Shipping Label' AND s.order_id IN (${sql.join(
      orderIds.map((o) => sql`${o}`),
      sql`, `,
    )})
    GROUP BY s.order_id`,
  );
  for (const r of rows) out.set(r.orderId, { active: Number(r.active ?? 0), voided: Number(r.voided ?? 0) });
  return out;
}

export interface ShipPlansResult extends BulkResult {
  readonly outcomes: readonly PlanShipOutcome[];
}

export async function shipPlans(
  tx: Tx,
  auth: AuthContext,
  ctx: DomainCtx,
  ids: readonly string[],
): Promise<ShipPlansResult> {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  const outcomes: PlanShipOutcome[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const outcome = await withWriteTx(tx, async (inner) => await shipPlan(inner, auth, ctx, id));
      outcomes.push(outcome);
      if (outcome.failed.length === 0) succeeded.push(id);
      else
        failed.push({
          id,
          code: 'PARTIAL',
          message: `${outcome.planCode}: ${outcome.shipped.length} of ${outcome.shipped.length + outcome.failed.length} orders shipped · ${outcome.failed[0]?.message ?? ''}`,
        });
    } catch (error: unknown) {
      failed.push({
        id,
        code: (error as { code?: string }).code ?? 'INTERNAL',
        message: error instanceof Error ? error.message : 'Ship failed',
      });
    }
  }
  return { succeeded, failed, outcomes };
}

/* ------------------------------------------------------------- estimates */

/** Expected totals for a set of orders: weight lb and volume ft³ from the order lines. */
export async function estimateTotals(
  tx: Tx,
  auth: AuthContext,
  orderIds: readonly string[],
): Promise<{ weightLb: number; volumeFt3: number; units: number; orders: number }> {
  const t = await sumOrderLines(tx, auth.scope, orderIds);
  return { weightLb: t.weightLb, volumeFt3: t.volumeFt3, units: t.units, orders: t.orders };
}

/* ---------------------------------------------------------- form options */

export interface PlanFormOptions {
  readonly nextCode: string;
  readonly carriers: readonly { value: string; label: string }[];
  readonly retailers: readonly { value: string; label: string }[];
  readonly addresses: readonly { value: string; label: string }[];
}

export async function planFormOptions(
  tx: Tx,
  auth: AuthContext,
  input: { warehouseId?: string | null; customerId?: string | null },
): Promise<PlanFormOptions> {
  // Without a warehouse: every active carrier setup in the caller's warehouse scope (not an empty list).
  const carriers =
    input.warehouseId && !hasWarehouse(auth.scope, input.warehouseId)
      ? []
      : (
          await tx
            .select()
            .from(schema.carrierConnections)
            .where(
              and(
                input.warehouseId ? eq(schema.carrierConnections.warehouseId, input.warehouseId) : undefined,
                eq(schema.carrierConnections.isActive, true),
              ),
            )
        )
          .filter((c) => hasWarehouse(auth.scope, c.warehouseId))
          .map((c) => ({ value: c.id, label: `${c.setupName} - ${c.accountPrefix}` }));
  const retailers = (await tx.select().from(schema.retailers).where(eq(schema.retailers.isActive, true))).map(
    (r) => ({ value: r.id, label: r.name }),
  );
  const cu = input.customerId
    ? (await tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId)).limit(1))[0]
    : null;
  const addresses =
    cu && hasClient(auth.scope, cu.clientId)
      ? (
          await tx
            .select()
            .from(schema.addresses)
            .where(
              and(
                eq(schema.addresses.ownerType, 'customer'),
                eq(schema.addresses.ownerId, cu.id),
                eq(schema.addresses.isActive, true),
              ),
            )
        ).map((a) => ({
          value: a.id,
          label: [a.name, a.line1, a.city, a.state, a.postalCode].filter(Boolean).join(', '),
        }))
      : [];
  return { nextCode: await nextPlanCode(tx), carriers, retailers, addresses };
}

/* ---------------------------------------------------------- manifest/BOL */

export async function printPlanBol(
  db: AppDb,
  auth: AuthContext,
  ids: readonly string[],
): Promise<{ fileId: string; count: number }> {
  const records = await mapSeq([...new Set(ids)], async (id) => {
    const plan = await loadPlanRow(db, auth.scope, id);
    const wh = (
      await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, plan.warehouseId)).limit(1)
    )[0];
    const orders = await dbAll<{
      code: string;
      customerName: string;
      trackingNumber: string | null;
      weightOz: number;
      packages: number;
    }>(
      db,
      sql`
      SELECT o.code AS code, o.customer_name AS "customerName", o.tracking_number AS "trackingNumber",
        -- Same figure as the plan's Expected load tile: order lines × product weight (header total as a fallback).
        COALESCE(NULLIF((SELECT SUM((ol.quantity - ol.cancelled_quantity) * COALESCE(pr.weight_oz, 0)) FROM order_lines ol JOIN products pr ON pr.id = ol.product_id WHERE ol.order_id = o.id), 0), o.total_weight_oz, 0) AS "weightOz",
        GREATEST(1, (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active')) AS packages
      FROM shipment_plan_orders x JOIN shipment_orders o ON o.id = x.order_id WHERE x.plan_id = ${id} ORDER BY o.code`,
    );
    if (orders.length === 0)
      throw new AppError('INVALID_STATE', `${plan.code} has no orders to print a Manifest/BOL for.`);
    return {
      bolNumber: plan.code as string,
      shipDate: (plan.plannedShipmentAt as string | null) ?? undefined,
      carrier: plan.carrierName ?? 'Customer pickup',
      trailerNumber: (plan.truckPlateNumber as string | null) ?? undefined,
      shipFrom: {
        name: wh?.name ?? (plan.warehouseCode as string),
        address1: wh?.addressLine ?? '-',
        city: wh?.city ?? '-',
        state: wh?.state ?? undefined,
        postalCode: wh?.postalCode ?? undefined,
        country: wh?.country ?? undefined,
      },
      specialInstructions: (plan.note as string | null) ?? undefined,
      shipments: orders.map((o) => ({
        orderCode: o.code,
        customerName: o.customerName,
        trackingNumber: o.trackingNumber ?? undefined,
        packages: o.packages,
        weightLb: Math.round((o.weightOz / 16) * 100) / 100,
      })),
    };
  });
  // Loaded on demand: the PDF stack stays out of the status / ship / list route bundles.
  const { printToFile } = await import('@/server/print');
  const file = await printToFile(db, {
    request: { typeKey: 'manifest-bol', records, options: { copies: 1 } },
    userId: auth.user.id,
    ownerEntityType: records.length === 1 ? ENTITY : null,
    ownerEntityId: records.length === 1 ? ids[0] : null,
  });
  return { fileId: file.id, count: records.length };
}
