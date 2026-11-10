/**
 * PO wizard form model: values, per-step schemas and the API payload mapping.
 * Pure (no React) so it is unit tested.
 */
import { z } from "zod";
import { PO_TYPES } from "@/lib/enums";
import { PO_CODE_MAX, PO_NOTE_MAX, PO_REFERENCE_MAX, purchasePriceOf } from "@/lib/grid-defs/receiving/po-schemas";
import type { PoDetail, Tracking } from "../receiving-shared";

export interface LineDraft {
  /** Persisted line id (edit) — absent for new lines. */
  readonly id?: string;
  /** Client key for React lists. */
  readonly key: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly packTypes: readonly { readonly packType: string; readonly uomQty: number }[];
  readonly tracking: Tracking;
  readonly packType: string;
  readonly orderedQuantity: number;
  readonly unitCost: number;
  readonly receivedQuantity: number;
  readonly receivingLocationId: string | null;
  readonly receivingLocationCode: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly lpTypeId: string | null;
  readonly lpTypeCode: string | null;
  readonly lpNumber: string | null;
  readonly note: string | null;
}

export interface PoFormValues {
  warehouseId: string;
  clientId: string;
  clientLabel: string;
  code: string;
  /** Set by the inline uniqueness check; non-empty blocks step 1. */
  codeConflict: string;
  poType: string;
  poDate: string | null;
  plannedReceivingDate: string | null;
  receivedAt: string | null;
  plannedArrivalDate: string | null;
  actualArrivalDate: string | null;
  referenceNumber: string;
  note: string;
  lines: LineDraft[];
  vendorId: string;
  vendorLabel: string;
  customFields: Record<string, string | boolean | null>;
}

export const STEP_KEYS = ["details", "products", "vendor", "other", "confirm"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const detailsStepSchema = z
  .object({
    warehouseId: z.string().min(1, "Warehouse is required"),
    clientId: z.string().min(1, "Client is required"),
    code: z.string().trim().min(1, "PO number is required").max(PO_CODE_MAX, `Use at most ${PO_CODE_MAX} characters`)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, "Use letters, numbers, spaces, dots, dashes or slashes"),
    codeConflict: z.string().optional(),
    poType: z.string().refine((v) => (PO_TYPES as readonly string[]).includes(v), "PO type is required"),
    poDate: z.string({ message: "PO date is required" }).min(1, "PO date is required"),
    referenceNumber: z.string().max(PO_REFERENCE_MAX, `Use at most ${PO_REFERENCE_MAX} characters`),
    note: z.string().max(PO_NOTE_MAX, `Use at most ${PO_NOTE_MAX} characters`),
  })
  .superRefine((v, ctx) => {
    if (v.codeConflict) ctx.addIssue({ code: "custom", path: ["code"], message: v.codeConflict });
  });

export const productsStepSchema = z.object({ lines: z.array(z.unknown()).min(1, "Add at least one product") });
export const vendorStepSchema = z.object({ vendorId: z.string().min(1, "Select a vendor") });

export function nowRounded(now: Date = new Date()): string {
  const d = new Date(now);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export function emptyValues(defaults: { warehouseId?: string | null; clientId?: string | null } = {}): PoFormValues {
  return {
    warehouseId: defaults.warehouseId ?? "", clientId: defaults.clientId ?? "", clientLabel: "", code: "", codeConflict: "", poType: "Purchase Order",
    poDate: nowRounded(), plannedReceivingDate: null, receivedAt: null, plannedArrivalDate: null, actualArrivalDate: null,
    referenceNumber: "", note: "", lines: [], vendorId: "", vendorLabel: "", customFields: {},
  };
}

export function valuesFromDetail(po: PoDetail): PoFormValues {
  return {
    warehouseId: po.warehouseId, clientId: po.clientId, clientLabel: po.clientName, code: po.code, codeConflict: "", poType: po.poType,
    poDate: po.poDate, plannedReceivingDate: po.plannedReceivingDate, receivedAt: po.receivedAt, plannedArrivalDate: po.plannedArrivalDate,
    actualArrivalDate: po.actualArrivalDate, referenceNumber: po.referenceNumber ?? "", note: po.note ?? "", vendorId: po.vendorId ?? "",
    vendorLabel: po.vendorName, customFields: { ...po.customFields },
    lines: po.lines.map((l) => ({
      id: l.id, key: l.id, productId: l.productId, sku: l.sku, productName: l.productName, barcode: l.barcode, imageUrl: l.imageUrl, uom: l.uom,
      packTypes: [{ packType: l.packType, uomQty: l.uomQuantity }], tracking: l.tracking, packType: l.packType, orderedQuantity: l.orderedQuantity,
      unitCost: l.unitCost, receivedQuantity: l.receivedQuantity, receivingLocationId: l.receivingLocationId, receivingLocationCode: l.receivingLocationCode,
      lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate, lpTypeId: l.lpTypeId, lpTypeCode: l.lpTypeCode, lpNumber: l.lpNumber, note: l.note,
    })),
  };
}

export const linesTotal = (lines: readonly Pick<LineDraft, "orderedQuantity" | "unitCost">[]): number => purchasePriceOf(lines);
export const linesQty = (lines: readonly Pick<LineDraft, "orderedQuantity">[]): number => lines.reduce((s, l) => s + l.orderedQuantity, 0);
export const skuCount = (lines: readonly Pick<LineDraft, "productId">[]): number => new Set(lines.map((l) => l.productId)).size;

/** Rail ring: %0 → %25 → %50 → %75 → %100 by step (Logiwa parity). */
export function stepPercent(stepIndex: number, total: number = STEP_KEYS.length): number {
  if (total <= 1) return 100;
  return Math.round((Math.max(0, Math.min(stepIndex, total - 1)) / (total - 1)) * 100);
}

const blankToNull = (v: string): string | null => (v.trim() ? v.trim() : null);

/** Wizard values → `POST /api/purchase-orders` / `PATCH /api/purchase-orders/[id]` body. */
export function toPayload(v: PoFormValues, version?: number): Record<string, unknown> {
  return {
    warehouseId: v.warehouseId, clientId: v.clientId, code: v.code.trim(), poType: v.poType, poDate: v.poDate,
    plannedReceivingDate: v.plannedReceivingDate, receivedAt: v.receivedAt, plannedArrivalDate: v.plannedArrivalDate, actualArrivalDate: v.actualArrivalDate,
    referenceNumber: blankToNull(v.referenceNumber), note: blankToNull(v.note), vendorId: v.vendorId, customFields: v.customFields,
    lines: v.lines.map((l) => ({
      ...(l.id ? { id: l.id } : {}), productId: l.productId, packType: l.packType, orderedQuantity: l.orderedQuantity, unitCost: l.unitCost,
      receivingLocationId: l.receivingLocationId, lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate,
      lpTypeId: l.lpTypeId, lpNumber: l.lpNumber, note: l.note,
    })),
    ...(version !== undefined ? { version } : {}),
  };
}

let counter = 0;
export const newLineKey = (): string => `new-${Date.now().toString(36)}-${(counter++).toString(36)}`;
