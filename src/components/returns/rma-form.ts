/**
 * Create RMA form model (PURE, unit tested): form values, the per-step zod schemas
 * (built from the loaded shippable order so quantity caps are enforced client-side
 * too) and the `POST /api/returns` payload.
 */
import { z } from "zod";
import { labelPayload, validateLabel, type ReturnLabelValue } from "./return-label-fields-model";
import type { ShippableOrder } from "./return-types";

export interface RmaLineValue {
  readonly orderLineId: string;
  readonly selected: boolean;
  readonly quantity: number | null;
  readonly reasonId: string | null;
}

export interface RmaFormValues {
  orderId: string;
  lines: RmaLineValue[];
  expectedReturnDate: string | null;
  note: string;
  createLabel: boolean;
  label: ReturnLabelValue;
}

/** Fresh line values for an order: every returnable line pre-selected with its full returnable qty when there is one line. */
export function initialLines(order: ShippableOrder): RmaLineValue[] {
  const returnable = order.lines.filter((l) => l.returnable > 0 && !l.isNonReturnable);
  return order.lines.map((l) => ({
    orderLineId: l.orderLineId,
    selected: returnable.length === 1 && returnable[0]?.orderLineId === l.orderLineId,
    quantity: l.returnable > 0 && !l.isNonReturnable ? (returnable.length === 1 ? l.returnable : 1) : null,
    reasonId: null,
  }));
}

export function orderStepSchema(order: ShippableOrder | null | undefined): z.ZodType {
  return z.object({ orderId: z.string() }).superRefine((v, ctx) => {
    if (!v.orderId) ctx.addIssue({ code: "custom", path: ["orderId"], message: "Choose a shipped order" });
    else if (order && order.id === v.orderId && !order.eligible) ctx.addIssue({ code: "custom", path: ["orderId"], message: order.reason ?? "This order can't be returned" });
  });
}

export function linesStepSchema(order: ShippableOrder | null | undefined, requireReason: boolean): z.ZodType {
  return z.object({ lines: z.array(z.any()) }).superRefine((v, ctx) => {
    const lines = v.lines as RmaLineValue[];
    if (!lines.some((l) => l.selected)) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Select at least one item to return" });
      return;
    }
    lines.forEach((l, i) => {
      if (!l.selected) return;
      const src = order?.lines.find((x) => x.orderLineId === l.orderLineId);
      if (!l.quantity || l.quantity < 1) ctx.addIssue({ code: "custom", path: ["lines", i, "quantity"], message: "Enter at least 1" });
      else if (src && l.quantity > src.returnable) ctx.addIssue({ code: "custom", path: ["lines", i, "quantity"], message: `Max ${src.returnable} (shipped ${src.shippedQty}, already returned ${src.alreadyReturned})` });
      if (requireReason && !l.reasonId) ctx.addIssue({ code: "custom", path: ["lines", i, "reasonId"], message: "Choose a return reason" });
    });
  });
}

export const shippingStepSchema: z.ZodType = z.object({ createLabel: z.boolean() }).passthrough().superRefine((v, ctx) => {
  const values = v as unknown as RmaFormValues;
  if (values.expectedReturnDate && Number.isNaN(Date.parse(values.expectedReturnDate))) ctx.addIssue({ code: "custom", path: ["expectedReturnDate"], message: "Enter a valid date" });
  if (!values.createLabel) return;
  const errors = validateLabel(values.label);
  for (const [key, message] of Object.entries(errors)) ctx.addIssue({ code: "custom", path: ["label", key], message: message as string });
});

export interface CreateRmaPayload {
  readonly shipmentOrderId: string;
  readonly lines: readonly { readonly orderLineId: string; readonly quantity: number; readonly customerReturnReasonId: string | null }[];
  readonly expectedReturnDate: string | null;
  readonly note: string | null;
  readonly label: ReturnType<typeof labelPayload> | null;
}

export function buildCreatePayload(v: RmaFormValues): CreateRmaPayload {
  return {
    shipmentOrderId: v.orderId,
    lines: v.lines.filter((l) => l.selected && (l.quantity ?? 0) > 0).map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity ?? 0, customerReturnReasonId: l.reasonId })),
    expectedReturnDate: v.expectedReturnDate || null,
    note: v.note.trim() || null,
    label: v.createLabel ? labelPayload(v.label) : null,
  };
}

/** Units in the RMA being built. */
export function selectedUnits(v: Pick<RmaFormValues, "lines">): number {
  return v.lines.filter((l) => l.selected).reduce((s, l) => s + (l.quantity ?? 0), 0);
}
