/**
 * Bulk Label ▾ for shipment orders: Create / Reprint / Void / Return label, through the
 * foundation shipping engine (`domain/shipping`). Carrier calls are async, so these run
 * outside the route transaction and report a per-order outcome.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { schema } from "@/server/db";
import { shipping, type DomainCtx } from "@/server/domain";
import { describeError, DomainError } from "@/server/domain/errors";
import { orders } from "@/server/domain";

export const LABEL_ACTIONS = ["create", "void", "reprint", "return", "void-return"] as const;
export type LabelAction = (typeof LABEL_ACTIONS)[number];

export const labelBulkSchema = z.object({
  action: z.enum(LABEL_ACTIONS),
  ids: z.array(z.string().min(1).max(64)).min(1).max(200),
});

export const VOID_GUARD = "You can't void the labels for orders without a tracking number.";
export const REPRINT_GUARD = "The orders which you have selected has no label to reprint.";

export interface LabelOutcome {
  readonly id: string;
  readonly code: string;
  readonly ok: boolean;
  readonly message: string;
  readonly trackingNumber?: string;
  readonly fileIds?: readonly string[];
}

export interface LabelBulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
  readonly outcomes: readonly LabelOutcome[];
  readonly fileIds: readonly string[];
}

const DEFAULT_DIMS = { length: 10, width: 8, height: 4 };

/** One package from the order's shipment package, else the largest product dims. */
export function packageFor(db: AppDb, order: typeof schema.shipmentOrders.$inferSelect): { weightOz: number; length: number; width: number; height: number; shipmentPackageId: string | null } {
  const weightOz = Math.max(1, Math.round(order.totalWeightOz * 100) / 100);
  if (order.shipmentPackageId) {
    const pkg = db.select().from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, order.shipmentPackageId)).get();
    if (pkg) return { weightOz: weightOz + (pkg.weightUnit === "Pound" ? pkg.emptyWeight * 16 : pkg.emptyWeight), length: pkg.length, width: pkg.width, height: pkg.height, shipmentPackageId: pkg.id };
  }
  const dims = db.select({ l: schema.products.lengthIn, w: schema.products.widthIn, h: schema.products.heightIn }).from(schema.orderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId)).where(eq(schema.orderLines.orderId, order.id)).all();
  const max = (pick: (d: { l: number; w: number; h: number }) => number, fallback: number) => Math.max(fallback / 4, ...dims.map(pick), 1);
  return {
    weightOz,
    length: dims.length ? max((d) => d.l, DEFAULT_DIMS.length) : DEFAULT_DIMS.length,
    width: dims.length ? max((d) => d.w, DEFAULT_DIMS.width) : DEFAULT_DIMS.width,
    height: dims.length ? max((d) => d.h, DEFAULT_DIMS.height) : DEFAULT_DIMS.height,
    shipmentPackageId: null,
  };
}

async function carrierFor(db: AppDb, ctx: DomainCtx, order: typeof schema.shipmentOrders.$inferSelect, pkg: ReturnType<typeof packageFor>): Promise<{ connectionId: string; serviceId: string }> {
  if (order.carrierConnectionId && order.carrierServiceId) return { connectionId: order.carrierConnectionId, serviceId: order.carrierServiceId };
  const shop = await shipping.rateShop(db, ctx, { orderId: order.id, packages: [pkg], presetId: order.rateShoppingPresetId });
  if (!shop.selected) throw new DomainError("VALIDATION", "No carrier service returned a rate. Choose a carrier and service on the order first.");
  return { connectionId: shop.selected.carrierConnectionId, serviceId: shop.selected.carrierServiceId };
}

function activeShipments(db: AppDb, orderId: string, labelType: "Shipping Label" | "Return Label") {
  return db.select().from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, orderId), eq(schema.shipments.labelType, labelType), eq(schema.shipments.labelStatus, "Active"))).all();
}

async function runOne(db: AppDb, ctx: DomainCtx, action: LabelAction, id: string): Promise<LabelOutcome> {
  const order = orders.loadOrderRow(db, ctx, id);
  switch (action) {
    case "create": {
      const pkg = packageFor(db, order);
      const carrier = await carrierFor(db, ctx, order, pkg);
      const res = await shipping.createLabel(db, ctx, { orderId: order.id, carrierConnectionId: carrier.connectionId, carrierServiceId: carrier.serviceId, packages: [pkg], source: "OrderGrid" });
      return { id, code: order.code, ok: true, message: `Label created · ${res.masterTrackingNumber}`, trackingNumber: res.masterTrackingNumber, fileIds: res.shipments.flatMap((s) => (s.labelFileId ? [s.labelFileId] : [])) };
    }
    case "reprint": {
      const labels = activeShipments(db, order.id, "Shipping Label");
      const fileIds = labels.flatMap((s) => (s.labelFileId ? [s.labelFileId] : []));
      if (fileIds.length === 0) throw new DomainError("INVALID_STATE", REPRINT_GUARD);
      return { id, code: order.code, ok: true, message: `${fileIds.length} label${fileIds.length === 1 ? "" : "s"} ready`, fileIds };
    }
    case "void":
    case "void-return": {
      const type = action === "void" ? "Shipping Label" : "Return Label";
      const labels = activeShipments(db, order.id, type).filter((s) => !s.actualShipmentAt || type === "Return Label");
      if (labels.length === 0 || (type === "Shipping Label" && !order.trackingNumber && labels.length === 0)) throw new DomainError("INVALID_STATE", VOID_GUARD);
      let voided = 0;
      const seen = new Set<string>();
      for (const s of labels) {
        const key = s.masterTrackingNumber ?? s.trackingNumber;
        if (seen.has(key)) continue;
        seen.add(key);
        voided += (await shipping.voidLabel(db, ctx, { shipmentId: s.id })).voided;
      }
      return { id, code: order.code, ok: true, message: `${voided} label${voided === 1 ? "" : "s"} voided` };
    }
    case "return": {
      const pkg = packageFor(db, order);
      const shipped = db.select().from(schema.shipments)
        .where(and(eq(schema.shipments.orderId, order.id), eq(schema.shipments.labelType, "Shipping Label"), eq(schema.shipments.labelStatus, "Active"))).get();
      const serviceId = order.returnCarrierServiceId ?? shipped?.carrierServiceId ?? order.carrierServiceId;
      const service = serviceId ? db.select().from(schema.carrierServices).where(eq(schema.carrierServices.id, serviceId)).get() : undefined;
      const connectionId = service?.connectionId ?? shipped?.carrierConnectionId ?? order.carrierConnectionId;
      if (!service || !connectionId) throw new DomainError("VALIDATION", `Order ${order.code} has no carrier service to create a return label with. Set the return shipping option first.`);
      const res = await shipping.createReturnLabel(db, ctx, { orderId: order.id, carrierConnectionId: connectionId, carrierServiceId: service.id, package: pkg });
      return { id, code: order.code, ok: true, message: `Return label created · ${res.trackingNumber}`, trackingNumber: res.trackingNumber, fileIds: res.shipment.labelFileId ? [res.shipment.labelFileId] : [] };
    }
  }
}

export async function runLabelBulk(db: AppDb, ctx: DomainCtx, input: z.output<typeof labelBulkSchema>): Promise<LabelBulkResult> {
  const outcomes: LabelOutcome[] = [];
  const codes = new Map(db.select({ id: schema.shipmentOrders.id, code: schema.shipmentOrders.code }).from(schema.shipmentOrders)
    .where(and(inArray(schema.shipmentOrders.id, input.ids), isNull(schema.shipmentOrders.deletedAt))).all().map((r) => [r.id, r.code]));
  for (const id of [...new Set(input.ids)]) {
    try {
      outcomes.push(await runOne(db, ctx, input.action, id));
    } catch (error) {
      outcomes.push({ id, code: codes.get(id) ?? "Order", ok: false, message: describeError(error).message });
    }
  }
  return {
    succeeded: outcomes.filter((o) => o.ok).map((o) => o.id),
    failed: outcomes.filter((o) => !o.ok).map((o) => ({ id: o.id, code: o.code, message: o.message })),
    outcomes,
    fileIds: outcomes.flatMap((o) => o.fileIds ?? []),
  };
}
