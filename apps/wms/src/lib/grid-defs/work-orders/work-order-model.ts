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
  warehouseId: z.string({ message: "Warehouse is required" }).trim().min(1, "Warehouse is required"),
  clientId: z.string({ message: "Client is required" }).trim().min(1, "Client is required"),
  code: z.string({ message: "Work order code is required" }).trim().min(1, "Work order code is required").max(WO_CODE_MAX, `At most ${WO_CODE_MAX} characters`)
    .regex(/^[A-Za-z0-9._\-/]+$/, "Use letters, numbers, dot, dash, slash or underscore"),
  type: z.enum(WORK_ORDER_TYPES, { message: "Work order type is required" }),
  extraNote: optionalText(WO_NOTE_MAX),
  buildFor: z.enum(BUILD_FOR).default("Stock"),
  shipmentOrderId: optionalId,
  kitProductId: z.string({ message: "Select a kit" }).trim().min(1, "Select a kit"),
  requestedQty: z.number({ message: "Enter the kit quantity" }).int("Whole kits only").min(1, "At least 1").max(MAX_KIT_QTY, `At most ${MAX_KIT_QTY.toLocaleString("en-US")}`),
  components: z.array(componentSourceSchema).max(200).default([]),
  kittingInstructions: optionalText(WO_INSTRUCTIONS_MAX),
  plannedStartAt: optionalIso,
  plannedFinishAt: optionalIso,
  actualStartAt: optionalIso,
  actualFinishAt: optionalIso,
  customFields: z.record(z.string(), z.union([z.string().max(500), z.boolean(), z.null()])).default({}),
}).superRefine((v, ctx) => {
  if (v.buildFor === "SO" && !v.shipmentOrderId) ctx.addIssue({ code: "custom", path: ["shipmentOrderId"], message: "Shipment order is required" });
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
  /** Kitting task time range (Logiwa Create Kit step 2); the server stamps now when omitted. */
  actualStartAt: optionalIso,
  actualFinishAt: optionalIso,
  /**
   * Source Location / LP confirmed on step 1 of the Create Kit drawer. When present the server
   * re-checks it against the components' chosen sources (or the kitting area with picking).
   * Several sources (one scan per source location) are sent comma-separated; each is checked.
   */
  sourceScan: optionalText(600),
  /**
   * Client-generated key, one per Create Kit drawer submit. A retry with the same key replays the
   * first result instead of consuming components twice.
   */
  idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional(),
  /**
   * With picking only: explicitly confirm "Complete pending picks and build". Without it the
   * server refuses to build while component picking tasks are still open. Needs the picking
   * permission and a planner role.
   */
  completePendingPicks: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (v.actualStartAt && v.actualFinishAt && Date.parse(v.actualFinishAt) < Date.parse(v.actualStartAt)) {
    ctx.addIssue({ code: "custom", path: ["actualFinishAt"], message: "Actual finish must be after actual start" });
  }
});
type CreateKitParsed = z.output<typeof createKitSchema>;
export type CreateKitInput = Omit<CreateKitParsed, "actualStartAt" | "actualFinishAt" | "sourceScan"> & {
  readonly actualStartAt?: string | null;
  readonly actualFinishAt?: string | null;
  readonly sourceScan?: string | null;
};

/** Per-component attributes on Disassemble (Logiwa "••• Add Attribute"). */
export const componentAttributeSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  lotNumber: optionalText(120),
  expiryDate: optionalText(40),
  productionDate: optionalText(40),
});
export type ComponentAttribute = z.output<typeof componentAttributeSchema>;

export const disassembleSchema = z.object({
  workOrderId: z.string().trim().min(1).max(64),
  version: z.number().int().min(1).optional(),
  qty: qtySchema,
  /** Kit stock bucket to break down. */
  sourceInventoryId: z.string({ message: "Select the kit stock to disassemble" }).trim().min(1, "Select the kit stock to disassemble"),
  targetLocationId: z.string({ message: "Select a component location" }).trim().min(1, "Select a component location"),
  targetLpId: optionalId,
  componentAttributes: z.array(componentAttributeSchema).max(200).optional(),
});
export type DisassembleInput = z.output<typeof disassembleSchema>;

/** Standalone Disassemble Kit (Logiwa toolbar, no work order selected): kit stock broken down by its BOM. */
export const disassembleStockSchema = z.object({
  kitProductId: z.string({ message: "Select a kit" }).trim().min(1, "Select a kit").max(64),
  qty: qtySchema,
  sourceInventoryId: z.string({ message: "Select the kit stock to disassemble" }).trim().min(1, "Select the kit stock to disassemble"),
  targetLocationId: z.string({ message: "Select a component location" }).trim().min(1, "Select a component location"),
  targetLpId: optionalId,
  componentAttributes: z.array(componentAttributeSchema).max(200).optional(),
});
export type DisassembleStockInput = z.output<typeof disassembleStockSchema>;

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

/**
 * Edit stays available after Open (Logiwa's Show Details drawer): core fields lock, while notes,
 * instructions, dates, tags and custom fields can still change. Only Cancelled is read-only.
 */
export function editReason(wo: WoActionRow): string | null {
  if (wo.status === "Cancelled") return "Cancelled work orders can't be edited";
  return null;
}

/** Core fields (warehouse, client, type, kit, qty, component sources) are locked once the work order leaves Open. */
export function coreLocked(wo: Pick<WoActionRow, "status">): boolean {
  return wo.status !== "Open";
}

export function deleteReason(wo: WoActionRow): string | null {
  if (wo.status !== "Open") return "Only Open work orders can be deleted";
  return wo.processedQty > 0 ? "Kits were already built from this work order" : null;
}

/**
 * With picking, components must be picked to the kitting area before kitting (Logiwa sequence).
 * `canForcePicks` (supervisor with picking permission) keeps Create kit open; the drawer then
 * requires an explicit "Complete pending picks and build" confirmation.
 */
export function createKitReason(wo: WoActionRow & { readonly pickTaskCount?: number; readonly pickDoneCount?: number; readonly inKittingAreaQty?: number }, opts: { readonly canForcePicks?: boolean } = {}): string | null {
  if (wo.status === "Completed") return "This work order is already completed";
  if (wo.status === "Cancelled") return "Cancelled work orders can't build kits";
  if (wo.status === "Shortage") return "Components are short; allocate them first";
  if (wo.type === "Work Order with Picking" && wo.status === "Open") return "Run Picking/Job Operations first to allocate the components";
  if (remainingQty(wo) <= 0) return "Every requested kit is built";
  const total = wo.pickTaskCount ?? 0;
  const done = wo.pickDoneCount ?? 0;
  // Allocated with a job that holds no Picking tasks: nothing reached the kitting area (not forceable).
  if (wo.type === "Work Order with Picking" && wo.status === "In Process" && wo.pickTaskCount === 0 && (wo.inKittingAreaQty ?? 0) <= 0) {
    return "Components are allocated but no picking tasks exist yet (0 picked). Run Picking/Job Operations first";
  }
  if (wo.type === "Work Order with Picking" && total > 0 && done < total && !opts.canForcePicks) {
    return `Components not yet picked to kitting area (${done}/${total} picked)`;
  }
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
  if (wo.type !== "Work Order with Picking") return "Built without picking: no picking list";
  // Completed with picking: allowed as a reprint of what was picked (audit / rework).
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

/** Live Kit quantity check for the wizard (never clamps: the typed value stays and the reason shows). */
export function kitQtyError(qty: number | null | undefined): string | null {
  if (qty === null || qty === undefined || Number.isNaN(qty)) return "Enter the kit quantity";
  if (!Number.isInteger(qty)) return "Whole kits only";
  if (qty < 1) return "At least 1";
  if (qty > MAX_KIT_QTY) return `At most ${MAX_KIT_QTY.toLocaleString("en-US")}`;
  return null;
}
