/**
 * Work order domain model (pure TS, shared by the wizard, the bulk-action guards, the
 * API validators and the unit tests). No React, no DB.
 */
import { z } from "zod";
import { WORK_ORDER_TYPES, type WorkOrderStatus } from "@/lib/enums";

export const WO_CODE_MAX = 40;
export const WO_NOTE_MAX = 1000;
export const WO_INSTRUCTIONS_MAX = 4000;
export const MAX_KIT_QTY = 100_000;

/** Logiwa's exact unsaved-changes copy for the Create/Edit Work Order drawer. */
export const WO_UNSAVED_TITLE = "You have unsaved changes!";
export const WO_UNSAVED_DESCRIPTION = "If you leave this form, all unsaved changes will be lost. Are you sure you want to leave this form?";

export const BUILD_FOR = ["Stock", "SO"] as const;
export type BuildFor = (typeof BUILD_FOR)[number];
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).nullish().transform((v) => (v ? v : null));
const optionalId = z.string().trim().max(64).nullish().transform((v) => (v ? v : null));
const optionalIso = z.string().trim().max(40).nullish().transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Enter a valid date");

/** Source inventory for one component (needed for "without picking" work orders). */
export const componentSourceSchema = z.object({
  componentProductId: z.string().trim().min(1).max(64),
  locationId: optionalId,
  lpId: optionalId,
  lotNumber: optionalText(120),
  expiryDate: optionalText(40),
  productionDate: optionalText(40),
});
export type ComponentSource = z.output<typeof componentSourceSchema>;

export const workOrderInputSchema = z.object({
  warehouseId: z.string({ message: "Select warehouse is required." }).trim().min(1, "Select warehouse is required."),
  clientId: z.string({ message: "Select client is required." }).trim().min(1, "Select client is required."),
  code: z.string({ message: "Enter Work Order Code is required." }).trim().min(1, "Enter Work Order Code is required.").max(WO_CODE_MAX, `At most ${WO_CODE_MAX} characters`)
    .regex(/^[A-Za-z0-9._\-/]+$/, "Use letters, numbers, dot, dash, slash or underscore"),
  type: z.enum(WORK_ORDER_TYPES, { message: "Select Work Order Type is required." }),
  extraNote: optionalText(WO_NOTE_MAX),
  buildFor: z.enum(BUILD_FOR).default("Stock"),
  shipmentOrderId: optionalId,
  kitProductId: z.string({ message: "Select a kit" }).trim().min(1, "Select a kit"),
  requestedQty: z.number({ message: "Enter the kit quantity" }).int("Whole numbers only").min(1, "At least 1").max(MAX_KIT_QTY, `At most ${MAX_KIT_QTY}`),
  components: z.array(componentSourceSchema).max(200).default([]),
  kittingInstructions: optionalText(WO_INSTRUCTIONS_MAX),
  plannedStartAt: optionalIso,
  plannedFinishAt: optionalIso,
  actualStartAt: optionalIso,
  actualFinishAt: optionalIso,
  customFields: z.record(z.string(), z.union([z.string().max(500), z.boolean(), z.null()])).default({}),
}).superRefine((v, ctx) => {
  if (v.buildFor === "SO" && !v.shipmentOrderId) ctx.addIssue({ code: "custom", path: ["shipmentOrderId"], message: "Select Shipment Order is required." });
  if (v.plannedStartAt && v.plannedFinishAt && Date.parse(v.plannedFinishAt) < Date.parse(v.plannedStartAt)) {
    ctx.addIssue({ code: "custom", path: ["plannedFinishAt"], message: "Planned finish must be after planned start" });
  }
  if (v.actualStartAt && v.actualFinishAt && Date.parse(v.actualFinishAt) < Date.parse(v.actualStartAt)) {
    ctx.addIssue({ code: "custom", path: ["actualFinishAt"], message: "Actual finish must be after actual start" });
  }
});
export type WorkOrderInput = z.output<typeof workOrderInputSchema>;

export const workOrderUpdateSchema = z.object({ version: z.number().int().min(1), data: workOrderInputSchema });

const qtySchema = z.number({ message: "Enter a quantity" }).int("Whole numbers only").min(1, "At least 1").max(MAX_KIT_QTY);

export const createKitSchema = z.object({
  workOrderId: z.string().trim().min(1).max(64),
  version: z.number().int().min(1).optional(),
  qty: qtySchema,
  locationId: z.string({ message: "Select an output location" }).trim().min(1, "Select an output location"),
  lpId: optionalId,
  lotNumber: optionalText(120),
  expiryDate: optionalText(40),
  productionDate: optionalText(40),
});
export type CreateKitInput = z.output<typeof createKitSchema>;

export const disassembleSchema = z.object({
  workOrderId: z.string().trim().min(1).max(64),
  version: z.number().int().min(1).optional(),
  qty: qtySchema,
  /** Kit stock bucket to break down. */
  sourceInventoryId: z.string({ message: "Select the kit stock to disassemble" }).trim().min(1, "Select the kit stock to disassemble"),
  targetLocationId: z.string({ message: "Select a component location" }).trim().min(1, "Select a component location"),
  targetLpId: optionalId,
});
export type DisassembleInput = z.output<typeof disassembleSchema>;

/* ------------------------------------------------------------ formulas */

export interface BomLine {
  readonly bomQty: number;
  readonly freeQty: number;
}

/** Net Kitting Capacity = min over components of ⌊free component qty ÷ BOM qty⌋ (0 without components). */
export function netKittingCapacity(lines: readonly BomLine[]): number {
  if (lines.length === 0) return 0;
  return Math.max(0, Math.min(...lines.map((l) => (l.bomQty > 0 ? Math.floor(Math.max(0, l.freeQty) / l.bomQty) : 0))));
}

/** Required Kitting Qty = max(0, pending order qty − current kit stock). */
export function requiredKittingQty(pendingOrderQty: number, currentInventoryQty: number): number {
  return Math.max(0, pendingOrderQty - currentInventoryQty);
}

/** Reorder Qty = max(0, total order qty − total available). */
export function reorderQty(totalOrderQty: number, totalAvailableQty: number): number {
  return Math.max(0, totalOrderQty - totalAvailableQty);
}

/** Whole days since `createdAt` (Logiwa "Age"). */
export function ageInDays(createdAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - Date.parse(createdAt);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

/** Kits still to build. */
export const remainingQty = (wo: { readonly requestedQty: number; readonly processedQty: number }): number => Math.max(0, wo.requestedQty - wo.processedQty);

/* -------------------------------------------------------- action guards */

export interface WoActionRow {
  readonly status: WorkOrderStatus;
  readonly type: WorkOrderType;
  readonly requestedQty: number;
  readonly processedQty: number;
}

export function editReason(wo: WoActionRow): string | null {
  if (wo.status === "Completed" || wo.status === "Cancelled") return `${wo.status} work orders can't be edited`;
  return null;
}

export function deleteReason(wo: WoActionRow): string | null {
  return wo.status === "Open" ? null : "Only Open work orders can be deleted";
}

export function createKitReason(wo: WoActionRow): string | null {
  if (wo.status === "Completed") return "This work order is already completed";
  if (wo.status === "Cancelled") return "Cancelled work orders can't build kits";
  if (wo.status === "Shortage") return "Components are short; allocate them first";
  if (wo.type === "Work Order with Picking" && wo.status === "Open") return "Run Picking/Job Operations first to allocate the components";
  if (remainingQty(wo) <= 0) return "Every requested kit is built";
  return null;
}

export function disassembleReason(wo: WoActionRow): string | null {
  if (wo.status === "Cancelled") return "Cancelled work orders can't be disassembled";
  if (wo.processedQty <= 0) return "No kits were built by this work order";
  return null;
}

export function pickingReason(wo: WoActionRow): string | null {
  if (wo.type !== "Work Order with Picking") return "Only work orders with picking create picking jobs";
  if (wo.status !== "Open" && wo.status !== "Shortage") return `Only Open or Shortage work orders can be allocated (this one is ${wo.status})`;
  return null;
}

export function cancelPickingReason(wo: WoActionRow): string | null {
  if (wo.type !== "Work Order with Picking") return "Only work orders with picking have picking to cancel";
  if (wo.status !== "In Process" && wo.status !== "Shortage") return "Only In Process or Shortage work orders have picking to cancel";
  if (wo.processedQty > 0) return "Kits were already built from this work order";
  return null;
}

export function printReason(wo: WoActionRow): string | null {
  if (wo.status === "Cancelled") return "Cancelled work orders have no picking list";
  return null;
}

/** First reason across a selection ("WO000012: …"), or null when every row passes. */
export function selectionReason<T extends WoActionRow & { readonly code: string }>(rows: readonly T[], guard: (row: T) => string | null, opts: { readonly single?: boolean } = {}): string | null {
  if (rows.length === 0) return "Select at least one work order";
  if (opts.single && rows.length > 1) return "Select one work order";
  for (const row of rows) {
    const reason = guard(row);
    if (reason) return rows.length > 1 ? `${row.code}: ${reason}` : reason;
  }
  return null;
}

export function cancelReason(wo: WoActionRow): string | null {
  if (wo.status === "Completed" || wo.status === "Cancelled") return `${wo.status} work orders can't be cancelled`;
  if (wo.processedQty > 0) return "Kits were already built from this work order";
  return null;
}
