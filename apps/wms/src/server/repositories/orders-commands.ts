/**
 * Shipment Orders write side (BUILD_PLAN M01). Everything goes through the foundation
 * domain (`orders.createOrder/updateOrder/...`, `stateMachines`, `changeLog`).
 *
 * LOCAL ADAPTER (docs/requests/orders-outbound.md REQ-1): `orderHeaderSchema` does not
 * yet carry the wizard's shipping / billing / retailer / return / tax fields. Until it
 * does, `applyExtras` writes those columns in the same transaction as the domain call
 * and logs them with human-readable values. Remove it once REQ-1 lands.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { schema } from "@/server/db";
import { allocation, changeLog, jobs, orders, runBulk, sequences, tasks, type BulkResult, type DomainCtx } from "@/server/domain";
import { verifyAddress, type AddressCheck } from "@/server/domain/address-verification";
import { DomainError } from "@/server/domain/errors";
import { checkScope } from "@/server/domain/types";
import { BILLING_PARTY_TYPES, EXPORT_REASONS, TAX_TYPES } from "@/lib/enums";
import type { OrderRecord } from "./orders";
import { changeLogMark, tidyOrderChangeLog } from "./orders-change-log";
import { dbGet, withWriteTx } from "@/server/db/sql";

const so = schema.shipmentOrders;
const optText = (max = 500) => z.string().trim().max(max).nullish();
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

const billingAddressSchema = z.object({
  firstName: optText(100), lastName: optText(100), email: optText(200), phone: optText(50),
  line1: optText(256), line2: optText(256), city: optText(100), state: optText(100), postalCode: optText(10),
  country: optText(100), companyName: optText(200),
});

/** Columns the domain header schema does not cover yet (REQ-1). */
export const orderExtrasSchema = z.object({
  taxType: z.enum(TAX_TYPES).nullish(),
  taxId: optText(100),
  useShipAsBilling: z.boolean().optional(),
  billingAddress: billingAddressSchema.nullish(),
  scheduledPickupDate: isoDate.nullish(),
  scheduledShipmentDate: isoDate.nullish(),
  shippingChargesBillingType: z.enum(BILLING_PARTY_TYPES).nullish(),
  taxDutiesBillingType: z.enum(BILLING_PARTY_TYPES).nullish(),
  shippingAccountNumber: optText(100),
  taxDutiesAccountNumber: optText(100),
  shipmentPackageId: z.string().max(64).nullish(),
  totalShippingCost: z.number().min(0).max(1_000_000).optional(),
  discount: z.number().min(0).max(1_000_000).optional(),
  trackingNumber: optText(100),
  trackingNumbers: z.array(z.string().trim().min(1).max(100)).max(50).nullish(),
  reasonForExport: z.enum(EXPORT_REASONS).nullish(),
  returnAddressId: z.string().max(64).nullish(),
  returnCarrierServiceId: z.string().max(64).nullish(),
  returnShippingCost: z.number().min(0).max(1_000_000).nullish(),
  returnTrackingNumbers: z.array(z.string().trim().min(1).max(100)).max(50).nullish(),
  fraud: optText(500),
  packingWarningTypeId: z.string().max(64).nullish(),
  giftNote: optText(500),
  retailerId: z.string().max(64).nullish(),
  bol: optText(100), pro: optText(100), retailerPo: optText(100), dept: optText(100), markFor: optText(200),
  retailerCustomerAccount: optText(100),
  customerId: z.string().max(64).nullish(),
  priorityRank: z.number().int().min(0).max(9999).optional(),
});
export type OrderExtras = z.output<typeof orderExtrasSchema>;
const EXTRA_KEYS = Object.keys(orderExtrasSchema.shape) as (keyof OrderExtras)[];

/** `autoCode: true` = the client showed a sequence-generated code: the server assigns the next free one at save. */
export const createOrderBodySchema = orders.createOrderSchema.extend(orderExtrasSchema.shape).extend({ autoCode: z.boolean().optional() });
export type CreateOrderBody = z.input<typeof createOrderBodySchema>;

export const updateOrderBodySchema = z.object({
  version: z.number().int().positive(),
  patch: orders.orderHeaderSchema.partial().extend(orderExtrasSchema.shape).default({}),
  lines: orders.updateOrderSchema.shape.lines,
});
export type UpdateOrderBody = z.input<typeof updateOrderBodySchema>;

function splitExtras<T extends Record<string, unknown>>(input: T): { header: Omit<T, keyof OrderExtras>; extras: Partial<OrderExtras> } {
  const header: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((EXTRA_KEYS as string[]).includes(key)) {
      if (value !== undefined) extras[key] = value;
    } else header[key] = value;
  }
  return { header: header as Omit<T, keyof OrderExtras>, extras: extras as Partial<OrderExtras> };
}

/* --------------------------------------------------- human-readable values */

const nameOf = async (db: AppDb, table: "retailers" | "lookup" | "package" | "service" | "address", id: unknown): Promise<string | null> => {
  if (typeof id !== "string" || !id) return null;
  switch (table) {
    case "retailers": return (await db.select({ v: schema.retailers.name }).from(schema.retailers).where(eq(schema.retailers.id, id)).limit(1))[0]?.v ?? null;
    case "lookup": return (await db.select({ v: schema.lookupValues.name }).from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).limit(1))[0]?.v ?? null;
    case "package": return (await db.select({ v: schema.shipmentPackages.code }).from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, id)).limit(1))[0]?.v ?? null;
    case "service": return (await db.select({ v: schema.carrierServices.name }).from(schema.carrierServices).where(eq(schema.carrierServices.id, id)).limit(1))[0]?.v ?? null;
    case "address": return (await db.select({ v: schema.addresses.name }).from(schema.addresses).where(eq(schema.addresses.id, id)).limit(1))[0]?.v ?? null;
  }
};

/** Snapshot of the extra fields with ids resolved to names (change-log values). */
export async function displayExtras(db: AppDb, values: Readonly<Record<string, unknown>>, keys: readonly string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const v = values[key];
    switch (key) {
      case "retailerId": out.retailer = await nameOf(db, "retailers", v); break;
      case "packingWarningTypeId": out.packingWarningType = await nameOf(db, "lookup", v); break;
      case "shipmentPackageId": out.shipmentPackage = await nameOf(db, "package", v); break;
      case "returnCarrierServiceId": out.returnShippingOption = await nameOf(db, "service", v); break;
      case "returnAddressId": out.returnAddress = await nameOf(db, "address", v); break;
      case "customerId": break;
      case "trackingNumbers":
      case "returnTrackingNumbers": out[key] = Array.isArray(v) ? v.join(", ") : v ?? null; break;
      case "billingAddress": {
        const a = v as Record<string, unknown> | null | undefined;
        out.billingAddress = a ? [a.line1, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ") : null;
        break;
      }
      default: out[key] = v ?? null;
    }
  }
  return out;
}

async function applyExtras(tx: AppDb, ctx: DomainCtx, order: OrderRecord, extras: Partial<OrderExtras>, log: boolean): Promise<void> {
  const keys = Object.keys(extras);
  if (keys.length === 0) return;
  if (extras.retailerId && !(await tx.select({ id: schema.retailers.id }).from(schema.retailers).where(eq(schema.retailers.id, extras.retailerId)).limit(1))[0]) {
    throw new DomainError("VALIDATION", "Retailer not found");
  }
  if (extras.shipmentPackageId) {
    const pkg = (await tx.select({ wh: schema.shipmentPackages.warehouseId }).from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, extras.shipmentPackageId)).limit(1))[0];
    if (!pkg || pkg.wh !== order.warehouseId) throw new DomainError("VALIDATION", "Shipment package not found in this warehouse");
  }
  const set = Object.fromEntries(keys.map((k) => [k, (extras as Record<string, unknown>)[k] ?? null])) as Partial<typeof so.$inferInsert>;
  if (extras.totalShippingCost === undefined) delete set.totalShippingCost;
  if (extras.discount === undefined) delete set.discount;
  await tx.update(so).set({ ...set, updatedBy: ctx.userId }).where(eq(so.id, order.id));
  if (log) {
    const before = await displayExtras(tx, order as unknown as Record<string, unknown>, keys);
    const after = await displayExtras(tx, extras as Record<string, unknown>, keys);
    await changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before, after });
  }
}

/* ------------------------------------------------------------ create/update */

async function loadOrder(tx: AppDb, ctx: DomainCtx, id: string): Promise<OrderRecord> {
  return await orders.loadOrderRow(tx, ctx, id);
}

/** `opts.trigger`: imports pass "Shipment Order Imported" so M12 workflows on that trigger run. */
export async function createOrder(tx: AppDb, ctx: DomainCtx, body: z.output<typeof createOrderBodySchema>, opts: orders.CreateOrderOptions = {}): Promise<OrderRecord> {
  const { autoCode, ...rest } = body;
  const { header, extras } = splitExtras(rest);
  // A stale auto code (another user saved it first) must never block the save: take the next free value.
  if (autoCode) delete (header as { code?: string }).code;
  if (extras.customerId) {
    const customer = (await tx.select().from(schema.customers).where(eq(schema.customers.id, extras.customerId)).limit(1))[0];
    if (!customer || customer.clientId !== header.clientId) throw new DomainError("VALIDATION", "Customer not found for this client");
  }
  const order = await orders.createOrder(tx, ctx, header as orders.CreateOrderInput, opts);
  await applyExtras(tx, ctx, order, extras, false);
  // One change-log entry per line is written by `orders.createOrder` itself (REQ-2 applied).
  return await loadOrder(tx, ctx, order.id);
}

export async function updateOrder(tx: AppDb, ctx: DomainCtx, id: string, body: z.output<typeof updateOrderBodySchema>): Promise<OrderRecord> {
  const mark = await changeLogMark(tx);
  const out = await updateOrderInner(tx, ctx, id, body);
  // One readable entry per user-visible field (Priority "3 · High --> 5 · Urgent", formatted dates).
  await tidyOrderChangeLog(tx, [out.id], mark);
  return out;
}

async function updateOrderInner(tx: AppDb, ctx: DomainCtx, id: string, body: z.output<typeof updateOrderBodySchema>): Promise<OrderRecord> {
  const before = await loadOrder(tx, ctx, id);
  const { header, extras } = splitExtras(body.patch as Record<string, unknown>);
  if ("warehouseId" in header || "clientId" in header) throw new DomainError("VALIDATION", "Warehouse and client can't be changed on an existing order.");
  const updated = await orders.updateOrder(tx, ctx, { id, version: body.version, patch: header, lines: body.lines });
  const changedExtras = Object.fromEntries(Object.entries(extras).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify((before as Record<string, unknown>)[k] ?? null)));
  if (Object.keys(changedExtras).length > 0) {
    const terminal = ["Shipped", "Partially Shipped", "Delivered", "Cancelled"].includes(before.status);
    const allowed = new Set(["giftNote", "fraud", "returnCarrierServiceId", "returnShippingCost", "returnTrackingNumbers", "returnAddressId"]);
    if (terminal && Object.keys(changedExtras).some((k) => !allowed.has(k))) {
      throw new DomainError("INVALID_STATE", `Only notes and return info can be changed on an order in ${before.status} status.`);
    }
    await applyExtras(tx, ctx, updated, changedExtras, true);
  }
  return await loadOrder(tx, ctx, id);
}

/** Line add / edit / delete on a saved order: the domain replaces the full line set. */
export type LineOp =
  | { readonly kind: "add"; readonly line: orders.OrderLineInput }
  | { readonly kind: "edit"; readonly lineId: string; readonly patch: Partial<orders.OrderLineInput> }
  | { readonly kind: "delete"; readonly lineId: string };

export async function changeLine(tx: AppDb, ctx: DomainCtx, orderId: string, version: number, op: LineOp): Promise<OrderRecord> {
  const order = await loadOrder(tx, ctx, orderId);
  const current = await tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id));
  const asInput = (l: (typeof current)[number]) => ({
    id: l.id, productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, packType: l.packType,
    lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate, damageReason: l.damageReason,
    pinnedLocationId: l.pinnedLocationId, pinnedLpId: l.pinnedLpId, lineNote1: l.lineNote1, lineNote2: l.lineNote2, lineNote3: l.lineNote3,
  });
  let next: (orders.OrderLineInput & { id?: string })[] = current.map(asInput);
  if (op.kind === "add") next = [...next, { ...op.line }];
  else {
    if (!current.some((l) => l.id === op.lineId)) throw new DomainError("NOT_FOUND", "Order line not found");
    if (op.kind === "delete") {
      if (current.length === 1) throw new DomainError("VALIDATION", "An order needs at least one line. Cancel or delete the order instead.");
      next = next.filter((l) => l.id !== op.lineId);
    } else next = next.map((l) => (l.id === op.lineId ? { ...l, ...op.patch, id: l.id } : l));
  }
  return await orders.updateOrder(tx, ctx, { id: order.id, version, lines: next });
}

/* ----------------------------------------------------------- code / address */

export async function peekOrderCode(tx: AppDb): Promise<string> {
  return await withWriteTx(tx, async (inner) => await orders.peekFreeOrderCode(inner));
}

export async function codeAvailable(db: AppDb, code: string, excludeId?: string): Promise<boolean> {
  const row = (await db.select({ id: so.id }).from(so).where(eq(sql`upper(${so.code})`, code.trim().toUpperCase())).limit(1))[0];
  return !row || row.id === excludeId;
}

export const addressCheckSchema = z.object({
  line1: z.string().trim().min(1, "Address line 1 is required").max(256),
  line2: z.string().trim().max(256).nullish(),
  city: z.string().trim().max(100).default(""),
  state: z.string().trim().max(100).nullish(),
  postalCode: z.string().trim().max(10).default(""),
  country: z.string().trim().min(1).max(100),
});

export function checkAddress(input: z.output<typeof addressCheckSchema>): AddressCheck {
  return verifyAddress(input);
}

/** Re-verifies a saved order's ship-to address and stores the normalized result. */
export async function verifyOrderAddress(tx: AppDb, ctx: DomainCtx, orderId: string, version: number): Promise<OrderRecord> {
  const order = await loadOrder(tx, ctx, orderId);
  const check = verifyAddress({ line1: order.shipAddress, line2: order.shipAddress2, city: order.shipCity, state: order.shipState, postalCode: order.shipZip, country: order.shipCountry });
  if (order.version !== version) throw new DomainError("CONFLICT", "This record changed since you opened it — Reload");
  const after = (await tx.update(so).set({
    shipAddress: check.normalized.line1, shipAddress2: null, shipState: check.normalized.state ?? order.shipState, shipCountry: check.normalized.country,
    addressVerificationStatus: check.status, addressVerificationNotes: [...check.notes], skipAddressVerification: false,
    updatedBy: ctx.userId, version: sql`${so.version} + 1`,
  }).where(eq(so.id, order.id)).returning())[0];
  await changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: order, after });
  return after;
}

/* ------------------------------------------------- stranded allocations */

/** An order allocated this long ago without a picking job is stranded (not a Backorder → job hand-off in progress). */
export const STRANDED_ALLOCATION_MS = 15 * 60_000;

/**
 * Ready to Pick with no picking job is a state Logiwa never produces: allocation happens when
 * the job is created. The standalone allocate API (`/api/ops/allocate`) or an abandoned job
 * modal can still leave one behind, so such orders are deallocated back to Open (the domain
 * logs the status and line allocation changes). Returns the codes reverted.
 */
export async function revertStrandedAllocations(db: AppDb, ctx: DomainCtx, opts: { readonly olderThanMs?: number; readonly now?: number; readonly ids?: readonly string[] } = {}): Promise<readonly string[]> {
  const cutoff = new Date((opts.now ?? Date.now()) - (opts.olderThanMs ?? STRANDED_ALLOCATION_MS)).toISOString();
  const conds = [eq(so.status, "Ready to Pick"), isNull(so.jobId), isNull(so.deletedAt), sql`${so.updatedAt} <= ${cutoff}`];
  if (opts.ids) {
    if (opts.ids.length === 0) return [];
    conds.push(inArray(so.id, [...opts.ids]));
  }
  const stranded = await db.select({ id: so.id, code: so.code }).from(so).where(and(...conds));
  if (stranded.length === 0) return [];
  const result = await allocation.deallocate(db, ctx, { orderIds: stranded.map((r) => r.id) });
  const ok = new Set(result.succeeded);
  return stranded.filter((r) => ok.has(r.id)).map((r) => r.code);
}

let lastStrandedSweep = 0;
/** At most once a minute per server process: sweep stranded allocations (called from the backlog list). */
export async function sweepStrandedAllocations(db: AppDb, ctx: DomainCtx, now: number = Date.now()): Promise<readonly string[]> {
  if (now - lastStrandedSweep < 60_000) return [];
  lastStrandedSweep = now;
  try {
    return await revertStrandedAllocations(db, ctx, { now });
  } catch (error) {
    console.warn("[orders] stranded allocation sweep skipped", error);
    return [];
  }
}

/* ---------------------------------------------------------- bulk commands */

export async function cancelPicking(tx: AppDb, ctx: DomainCtx, ids: readonly string[]): Promise<BulkResult> {
  return await runBulk(tx, ids, async (inner, id) => {
    const order = await loadOrder(inner, ctx, id);
    const active = await inner.select({ id: schema.tasks.id, status: schema.tasks.status }).from(schema.tasks)
      .where(and(eq(schema.tasks.orderId, id), inArray(schema.tasks.status, ["Pending", "Started"]), inArray(schema.tasks.taskType, ["Picking", "Packing", "Sorting"])));
    if (active.length === 0) throw new DomainError("INVALID_STATE", "The Cancel Picking operation is only available for the orders that have active picking/packing tasks.");
    if (active.some((t) => t.status === "Started")) throw new DomainError("INVALID_STATE", `Picking has started for ${order.code}; finish or cancel the started tasks from the job first.`);
    const mark = await changeLogMark(inner);
    const jobCode = order.jobId ? (await inner.select({ code: schema.jobs.code }).from(schema.jobs).where(eq(schema.jobs.id, order.jobId)).limit(1))[0]?.code ?? null : null;
    await tasks.cancel(inner, ctx, { taskIds: active.map((t) => t.id) });
    const fresh = await loadOrder(inner, ctx, id);
    if (!fresh.jobId && ["Ready to Pick", "Shortage"].includes(fresh.status)) await allocation.deallocate(inner, ctx, { orderIds: [id] });
    // Job unassignment is logged symmetrically with assignment ("Job is modified. Job005302 --> —").
    if (jobCode && !fresh.jobId && !(await jobRemovalLogged(inner, id, mark))) {
      await changeLog.recordUpdate(inner, ctx, { entityType: "shipment_order", entityId: id, entityCode: order.code, before: { jobId: jobCode }, after: { jobId: null } });
    }
  });
}

async function jobRemovalLogged(tx: AppDb, orderId: string, mark: number): Promise<boolean> {
  return Boolean(await dbGet<{ n: number }>(tx, sql`SELECT 1 AS n FROM change_log WHERE rowid > ${mark} AND entity_type = 'shipment_order' AND entity_id = ${orderId} AND field = 'jobId' LIMIT 1`));
}

async function resolveShort(tx: AppDb, ctx: DomainCtx, ids: readonly string[], field: "pickShortStatus" | "packShortStatus"): Promise<BulkResult> {
  const label = field === "pickShortStatus" ? "pick short" : "pack short";
  return await runBulk(tx, ids, async (inner, id) => {
    const order = await loadOrder(inner, ctx, id);
    if (order[field] !== "Open") throw new DomainError("INVALID_STATE", `Order ${order.code} has no open ${label} to resolve.`);
    await inner.update(so).set({ [field]: "Resolved", updatedBy: ctx.userId, version: sql`${so.version} + 1` }).where(eq(so.id, id));
    await changeLog.recordUpdate(inner, ctx, { entityType: "shipment_order", entityId: id, entityCode: order.code, before: { [field]: order[field] }, after: { [field]: "Resolved" } });
  });
}

export const resolvePickShort = async (tx: AppDb, ctx: DomainCtx, ids: readonly string[]): Promise<BulkResult> => await resolveShort(tx, ctx, ids, "pickShortStatus");
export const resolvePackShort = async (tx: AppDb, ctx: DomainCtx, ids: readonly string[]): Promise<BulkResult> => await resolveShort(tx, ctx, ids, "packShortStatus");

export const returnInfoSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(1000),
  returnCarrierServiceId: z.string().max(64).nullish(),
  returnShippingCost: z.number().min(0).max(1_000_000).nullish(),
  returnTrackingNumbers: z.array(z.string().trim().min(1).max(100)).max(50).nullish(),
}).refine((b) => b.returnCarrierServiceId !== undefined || b.returnShippingCost !== undefined || b.returnTrackingNumbers !== undefined, {
  message: "Enter at least one return field", path: ["returnCarrierServiceId"],
});

export async function updateReturnInfo(tx: AppDb, ctx: DomainCtx, input: z.output<typeof returnInfoSchema>): Promise<BulkResult> {
  const { ids, ...fields } = input;
  const extras = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<OrderExtras>;
  return await runBulk(tx, ids, async (inner, id) => {
    const order = await loadOrder(inner, ctx, id);
    if (!["Shipped", "Partially Shipped", "Delivered"].includes(order.status)) throw new DomainError("INVALID_STATE", `Return info applies to shipped orders; ${order.code} is ${order.status}.`);
    await applyExtras(inner, ctx, order, extras, true);
    await inner.update(so).set({ version: sql`${so.version} + 1` }).where(eq(so.id, id));
  });
}

/**
 * LOCAL ADAPTER (REQ-3): detaches the order's not-yet-shipped serial numbers. Replace
 * with `ledger.unassignOrderSerials` once foundation adds it.
 */
export async function removeSerials(tx: AppDb, ctx: DomainCtx, ids: readonly string[]): Promise<BulkResult> {
  return await runBulk(tx, ids, async (inner, id) => {
    const order = await loadOrder(inner, ctx, id);
    const lines = await inner.select({ id: schema.orderLines.id, sku: schema.products.sku }).from(schema.orderLines)
      .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId)).where(eq(schema.orderLines.orderId, id));
    let removed = 0;
    for (const line of lines) {
      const serials = await inner.select().from(schema.serialNumbers).where(and(eq(schema.serialNumbers.orderLineId, line.id), isNull(schema.serialNumbers.shipmentId)));
      if (serials.length === 0) continue;
      await inner.update(schema.serialNumbers).set({ orderLineId: null, updatedBy: ctx.userId }).where(inArray(schema.serialNumbers.id, serials.map((s) => s.id)));
      await changeLog.recordLine(inner, ctx, { entityType: "shipment_order", entityId: id, entityCode: order.code, lineEntityType: "order_line", lineEntityId: line.id, lineLabel: line.sku, field: "serialNumbers", from: serials.map((s) => s.primarySerial).join(", "), to: "" });
      removed += serials.length;
    }
    if (removed === 0) throw new DomainError("INVALID_STATE", `Order ${order.code} has no serial numbers to remove.`);
  });
}

/** Removes the order from its job (Assigned Jobs "x"). */
export async function unassignJob(tx: AppDb, ctx: DomainCtx, orderId: string, jobId: string): Promise<OrderRecord> {
  const order = await loadOrder(tx, ctx, orderId);
  await jobs.removeOrderFromJob(tx, ctx, { jobId, orderId: order.id });
  return await loadOrder(tx, ctx, orderId);
}

/**
 * Duplicate re-bases the expected shipment date on the new order date: the copy keeps the source's
 * lead time (expected - ordered), so it is never expected to ship before it was ordered (critic r5).
 * A source with no date, an unparsable one, or a negative lead time gives no expected date.
 */
export function rebaseExpectedShipDate(srcOrderDate: string | null | undefined, srcExpected: string | null | undefined, now: Date = new Date()): string | null {
  if (!srcExpected) return null;
  const expected = Date.parse(srcExpected);
  if (Number.isNaN(expected)) return null;
  const ordered = srcOrderDate ? Date.parse(srcOrderDate) : Number.NaN;
  const lead = Number.isNaN(ordered) ? 0 : expected - ordered;
  if (lead < 0) return null;
  return new Date(now.getTime() + lead).toISOString();
}

/** Copies header + lines into a new Open order with the next code (dates re-based on now). */
export async function duplicateOrder(tx: AppDb, ctx: DomainCtx, orderId: string): Promise<OrderRecord> {
  const src = await loadOrder(tx, ctx, orderId);
  checkScope(ctx, src, "Shipment order");
  const lines = await tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, src.id));
  const header: orders.CreateOrderInput = {
    warehouseId: src.warehouseId, clientId: src.clientId, channel: "Manual", storeName: null, storeOrderNumber: src.storeOrderNumber,
    customerName: src.customerName, customerEmail: src.customerEmail, customerPhone: src.customerPhone, customerFirstName: src.customerFirstName,
    customerLastName: src.customerLastName, companyName: src.companyName, shipAddress: src.shipAddress, shipAddress2: src.shipAddress2,
    shipCity: src.shipCity, shipState: src.shipState, shipZip: src.shipZip, shipCountry: src.shipCountry, addressType: src.addressType,
    orderType: src.orderType, orderTypeId: src.orderTypeId, priority: src.priority, carrier: src.carrier, shippingService: src.shippingService,
    carrierConnectionId: src.carrierConnectionId, carrierServiceId: src.carrierServiceId, rateShoppingPresetId: src.rateShoppingPresetId,
    expectedShipDate: rebaseExpectedShipDate(src.orderDate, src.expectedShipDate), note: src.note, packingInstructions: src.packingInstructions,
    skipAddressVerification: src.skipAddressVerification, isGift: src.isGift, giftNote: src.giftNote, clientReferenceCode: src.clientReferenceCode,
    extraNote1: src.extraNote1, extraNote2: src.extraNote2, extraNote3: src.extraNote3, extraNote4: src.extraNote4, extraNote5: src.extraNote5,
    customFields: src.customFields ?? {},
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, packType: l.packType, lineNote1: l.lineNote1, lineNote2: l.lineNote2, lineNote3: l.lineNote3 })),
  };
  const extras: Partial<OrderExtras> = {
    taxType: src.taxType, taxId: src.taxId, useShipAsBilling: src.useShipAsBilling, billingAddress: src.billingAddress as OrderExtras["billingAddress"],
    shippingChargesBillingType: src.shippingChargesBillingType, taxDutiesBillingType: src.taxDutiesBillingType, shipmentPackageId: src.shipmentPackageId,
    reasonForExport: src.reasonForExport, packingWarningTypeId: src.packingWarningTypeId, retailerId: src.retailerId, bol: src.bol, pro: src.pro,
    retailerPo: src.retailerPo, dept: src.dept, markFor: src.markFor, retailerCustomerAccount: src.retailerCustomerAccount, customerId: src.customerId,
  };
  const copy = await createOrder(tx, ctx, createOrderBodySchema.parse({
    ...header, priorityRank: src.priorityRank, ...Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== null && v !== undefined)),
  }));
  await logOrderComment(tx, ctx, { orderId: copy.id, code: copy.code, field: "duplicatedFrom", label: "Duplicated From", value: src.code, message: `Created as a duplicate of ${src.code}.` });
  return copy;
}

/**
 * A change-log entry that is a statement, not an `old --> new` diff (duplicate origin, cancel
 * note). Written through the change-log table so it shows on the Activity tab and the drawer.
 */
export async function logOrderComment(
  tx: AppDb,
  ctx: DomainCtx,
  input: { readonly orderId: string; readonly code: string; readonly field: string; readonly label: string; readonly value: string; readonly message: string },
): Promise<void> {
  await tx.insert(schema.changeLog).values({
    entityType: "shipment_order", entityId: input.orderId, entityCode: input.code, type: "Update",
    field: input.field, fieldLabel: input.label, fromValue: null, toValue: input.value,
    message: input.message, userId: ctx.userId, source: ctx.source,
  });
}


/** Workflow-blocked banner "Release": clears the block so the order can be allocated. */
export async function releaseWorkflowBlock(tx: AppDb, ctx: DomainCtx, orderId: string, version: number): Promise<OrderRecord> {
  const order = await loadOrder(tx, ctx, orderId);
  if (order.workflowBlocked === "None") throw new DomainError("INVALID_STATE", `Order ${order.code} is not blocked by a workflow.`);
  if (order.version !== version) throw new DomainError("CONFLICT", "This record changed since you opened it — Reload");
  const after = (await tx.update(so).set({ workflowBlocked: "None", updatedBy: ctx.userId, version: sql`${so.version} + 1` })
    .where(and(eq(so.id, order.id), eq(so.version, version))).returning())[0];
  if (!after) throw new DomainError("CONFLICT", "This record changed since you opened it — Reload");
  await changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { workflowBlocked: order.workflowBlocked }, after: { workflowBlocked: "None" } });
  return after;
}

export interface OrderBillingCharge {
  readonly feeName: string;
  readonly operationType: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly totalPrice: number;
  readonly activityDate: string | null;
  readonly reportCode: string;
}

/** Billing report lines that reference this order (Billing Charges card download). */
export async function orderBillingCharges(db: AppDb, ctx: DomainCtx, orderId: string): Promise<readonly OrderBillingCharge[]> {
  const order = await loadOrder(db, ctx, orderId);
  const l = schema.billingReportLines;
  return await db.select({
    feeName: l.feeName, operationType: l.operationType, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice, totalPrice: l.adjustedPrice,
    activityDate: l.activityDate, reportCode: schema.billingReports.billNumber,
  }).from(l).innerJoin(schema.billingReports, eq(schema.billingReports.id, l.reportId))
    .where(and(eq(l.referenceNumber, order.code), eq(l.isDetail, true)));
}
