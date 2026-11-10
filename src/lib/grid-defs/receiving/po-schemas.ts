/**
 * Purchase order form + command schemas (M05). Pure TS (zod) shared by the wizard,
 * the receive drawer and the API handlers, so client and server agree on every rule
 * and every inline message.
 */
import { z } from "zod";
import { PO_STATUSES, PO_TYPES } from "@/lib/enums";

export const PO_CODE_MAX = 50;
export const PO_REFERENCE_MAX = 100;
export const PO_NOTE_MAX = 500;
export const MAX_PO_LINES = 500;
export const MAX_LINE_QTY = 1_000_000;

const isoDate = z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date");
const optionalDate = z.union([isoDate, z.literal(""), z.null()]).optional().transform((v) => (v ? new Date(v).toISOString() : null));
const optionalText = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`).optional().nullable().transform((v) => (v ? v : null));

export const poLineSchema = z.object({
  /** Existing line id on edit; absent for a new line. */
  id: z.string().trim().min(1).max(64).optional(),
  productId: z.string().trim().min(1, "Choose a product"),
  packType: z.string().trim().min(1).max(60).default("Each"),
  orderedQuantity: z.number({ message: "Quantity is required" }).int("Use a whole number").min(1, "Quantity must be at least 1").max(MAX_LINE_QTY, "Quantity is too large"),
  unitCost: z.number({ message: "Price per pack type is required" }).min(0, "Price can't be negative").max(10_000_000, "Price is too large"),
  receivingLocationId: z.string().trim().max(64).optional().nullable(),
  lotNumber: optionalText(100),
  expiryDate: optionalDate,
  productionDate: optionalDate,
  lpTypeId: z.string().trim().max(64).optional().nullable(),
  lpNumber: optionalText(100),
  note: optionalText(500),
});
export type PoLineInput = z.input<typeof poLineSchema>;
export type PoLineValues = z.output<typeof poLineSchema>;

export const customFieldValuesSchema = z.record(z.string(), z.union([z.string().max(500), z.boolean(), z.null()])).default({});

export const poHeaderSchema = z.object({
  warehouseId: z.string().trim().min(1, "Warehouse is required"),
  clientId: z.string().trim().min(1, "Client is required"),
  code: z.string().trim().min(1, "PO number is required").max(PO_CODE_MAX, `Use at most ${PO_CODE_MAX} characters`)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, "Use letters, numbers, spaces, dots, dashes or slashes"),
  poType: z.enum(PO_TYPES, { message: "PO type is required" }),
  poDate: isoDate.transform((v) => new Date(v).toISOString()),
  plannedReceivingDate: optionalDate,
  receivedAt: optionalDate,
  plannedArrivalDate: optionalDate,
  actualArrivalDate: optionalDate,
  referenceNumber: optionalText(PO_REFERENCE_MAX),
  note: optionalText(PO_NOTE_MAX),
});

export const poCreateSchema = poHeaderSchema.extend({
  vendorId: z.string().trim().min(1, "Select a vendor"),
  lines: z.array(poLineSchema).min(1, "Add at least one product").max(MAX_PO_LINES, `At most ${MAX_PO_LINES} lines`),
  customFields: customFieldValuesSchema,
});
export type PoCreateInput = z.input<typeof poCreateSchema>;
export type PoCreateValues = z.output<typeof poCreateSchema>;

/** Edit: the client is locked, so it is not accepted; `version` guards stale edits. */
export const poUpdateSchema = poCreateSchema.omit({ clientId: true }).extend({ version: z.number().int().min(1) });
export type PoUpdateValues = z.output<typeof poUpdateSchema>;

export const poStatusChangeSchema = z.object({
  status: z.enum(PO_STATUSES),
  reason: z.string().trim().min(3, "Enter a reason (at least 3 characters)").max(250, "Use at most 250 characters"),
  version: z.number().int().min(1),
});

export const bulkIdsBodySchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1, "Select at least one purchase order").max(1000, "At most 1000 records at once"),
});

/* ------------------------------------------------------------ receiving */

export const receiveSerialSchema = z.string().trim().min(1, "Serial number can't be empty").max(100);

export const receiveLineSchema = z.object({
  lineId: z.string().trim().min(1),
  quantity: z.number({ message: "Enter a quantity" }).int("Use a whole number").min(1, "Quantity must be at least 1").max(MAX_LINE_QTY),
  locationId: z.string().trim().min(1, "Choose a receiving location"),
  lpMode: z.enum(["none", "existing", "new"]).default("none"),
  lpId: z.string().trim().max(64).optional().nullable(),
  lpTypeId: z.string().trim().max(64).optional().nullable(),
  lotNumber: optionalText(100),
  expiryDate: optionalDate,
  productionDate: optionalDate,
  damageReason: optionalText(60),
  damageImageFileId: z.string().trim().max(64).optional().nullable(),
  serials: z.array(receiveSerialSchema).max(MAX_LINE_QTY).default([]),
  note: optionalText(500),
});
export type ReceiveLineInput = z.input<typeof receiveLineSchema>;
export type ReceiveLineValues = z.output<typeof receiveLineSchema>;

export const receiveBodySchema = z.object({
  lines: z.array(receiveLineSchema).min(1, "Enter a quantity for at least one line").max(MAX_PO_LINES),
  /** Over-receipt must be confirmed explicitly. */
  allowOverReceipt: z.boolean().default(false),
  version: z.number().int().min(1).optional(),
});
export type ReceiveBodyValues = z.output<typeof receiveBodySchema>;

/** Tracking requirements of a product for receiving (flags + screen config). */
export interface TrackingRequirements {
  readonly lot: boolean;
  readonly expiry: boolean;
  readonly production: boolean;
  readonly serial: boolean;
}

/** Inline messages for missing tracking data, keyed by receive-line field. Pure (unit tested). */
export function trackingIssues(line: { lotNumber?: string | null; expiryDate?: string | null; productionDate?: string | null; serials?: readonly string[]; quantity: number; uomRatio?: number }, req: TrackingRequirements, sku: string): Readonly<Record<string, string>> {
  const issues: Record<string, string> = {};
  if (req.lot && !line.lotNumber) issues.lotNumber = `${sku} is lot tracked: enter a lot/batch number.`;
  if (req.expiry && !line.expiryDate) issues.expiryDate = `${sku} is expiry tracked: enter an expiry date.`;
  if (req.production && !line.productionDate) issues.productionDate = `${sku} tracks production date: enter one.`;
  if (req.serial) {
    const need = line.quantity * (line.uomRatio ?? 1);
    const have = line.serials?.length ?? 0;
    if (have !== need) issues.serials = `${need} serial number${need === 1 ? "" : "s"} required; ${have} entered.`;
  }
  return issues;
}

/** Difference shown on receiving screens: received − ordered (negative = short). */
export function receivingDifference(ordered: number, received: number): number {
  return received - ordered;
}

/** Σ qty × price, rounded to cents (0.1 rule). */
export function purchasePriceOf(lines: readonly { readonly orderedQuantity: number; readonly unitCost: number }[]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.orderedQuantity * l.unitCost, 0) * 100) / 100;
}
