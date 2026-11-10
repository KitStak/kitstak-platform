/**
 * M08 test world: the foundation domain world plus a kit-to-stock kit (MLT-KIT-2PK) whose
 * BOM is 2 × MLT-WIDGET-01 + 1 × MLT-GADGET-02, a kitting area and a Work Order job type.
 */
import { eq } from "drizzle-orm";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import type { WorkOrderInput } from "@/lib/grid-defs/work-orders/work-order-model";
import { workOrderInputSchema } from "@/lib/grid-defs/work-orders/work-order-model";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import type { DomainCtx } from "@/server/domain/types";
import type { Scope } from "@/server/auth/scope";
import { createWorld, locationRow, type World } from "../foundation/domain/fixtures";

export interface KitWorld extends World {
  readonly kitId: string;
  readonly kittingLocId: string;
  readonly woJobTypeId: string;
  readonly scope: Scope;
  readonly wctx: DomainCtx & { readonly scope: Scope };
}

export function createKitWorld(): KitWorld {
  const w = createWorld();
  const db = w.db;
  const kitId = db.insert(schema.products).values({
    clientId: w.clientId, sku: "MLT-KIT-2PK", barcode: "MLT-KIT-2PK", name: "MLTest 2 Pack Kit", category: "General",
    weightOz: 16, lengthIn: 6, widthIn: 4, heightIn: 4, price: 25, status: "Active", isKit: true, kitType: "Kit to Stock",
  }).returning().get().id;
  db.insert(schema.kitComponents).values([
    { kitProductId: kitId, componentProductId: w.productId, quantity: 2 },
    { kitProductId: kitId, componentProductId: w.product2Id, quantity: 1 },
  ]).run();
  const kittingLocId = db.insert(schema.locations).values(locationRow(w.warehouseId, "KIT-01", { type: "Picking", areaType: "Kitting", preventAllocation: true })).returning().get().id;
  const woJobTypeId = db.insert(schema.jobTypes).values({
    code: "WO-PICK", description: "Work Order Picking", warehouseId: w.warehouseId, operationType: "Work Order", settings: jobTypeSettingsSchema.parse({}),
  }).returning().get().id;
  const scope: Scope = { warehouseIds: [w.warehouseId], clientIds: "all" } as Scope;
  return { ...w, kitId, kittingLocId, woJobTypeId, scope, wctx: { ...w.ctx, scope } };
}

export function stock(w: World, productId: string, qty: number, locationId: string = w.loc.storageA) {
  return ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty }).bucket;
}

export function woInput(w: KitWorld, extra: Partial<Record<keyof WorkOrderInput, unknown>> = {}): WorkOrderInput {
  return workOrderInputSchema.parse({
    warehouseId: w.warehouseId, clientId: w.clientId, code: "KS-TEST-WO-E2E", type: "Work Order without Picking", buildFor: "Stock",
    kitProductId: w.kitId, requestedQty: 5,
    components: [
      { componentProductId: w.productId, locationId: w.loc.storageA },
      { componentProductId: w.product2Id, locationId: w.loc.storageA },
    ],
    ...extra,
  });
}

export const onHandAt = (w: World, productId: string, locationId?: string): number =>
  w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, productId)).all()
    .filter((b) => !locationId || b.locationId === locationId).reduce((s, b) => s + b.onHand, 0);

export const allocatedOf = (w: World, productId: string): number =>
  w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, productId)).all().reduce((s, b) => s + b.allocated, 0);
