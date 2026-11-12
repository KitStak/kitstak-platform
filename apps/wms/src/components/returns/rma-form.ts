/**
 * Create RMA form model (PURE, unit tested): form values, the per-step zod schemas
 * (built from the loaded shippable order so quantity caps are enforced client-side
 * too) and the `POST /api/returns` payload.
 */
import { z } from 'zod';
import { labelPayload, validateLabel, type ReturnLabelValue } from './return-label-fields-model';
import type { ShippableOrder } from './return-types';
import { isDateOnly } from './date-only';

export interface RmaLineValue {
  readonly orderLineId: string;
  readonly selected: boolean;
  readonly quantity: number | null;
  readonly reasonId: string | null;
}

/** Return info recorded without buying a label (Logiwa Return section: carrier, option, cost, tracking numbers). */
export interface ReturnInfoValue {
  readonly carrierCode: string | null;
  readonly carrierServiceName: string;
  readonly shippingCost: number | null;
  readonly trackingNumbers: readonly string[];
}

export const EMPTY_RETURN_INFO: ReturnInfoValue = {
  carrierCode: null,
  carrierServiceName: '',
  shippingCost: null,
  trackingNumbers: [],
};
export const MAX_TRACKING_NUMBERS = 10;

export interface RmaFormValues {
  orderId: string;
  lines: RmaLineValue[];
  expectedReturnDate: string | null;
  note: string;
  createLabel: boolean;
  label: ReturnLabelValue;
  returnAddressId: string | null;
  returnInfo: ReturnInfoValue;
}

/**
 * Adds a typed tracking number to the list (trimmed, upper-cased duplicates rejected, max 10,
 * max 60 characters). Returns the new list or the reason it was not added.
 */
/** Return shipping cost check, shared by Create RMA and Edit return info (PURE). */
export function returnCostError(cost: number | null | undefined): string | null {
  if (cost === null || cost === undefined) return null;
  if (!Number.isFinite(cost)) return 'Enter a valid cost';
  if (cost < 0) return "Cost can't be negative";
  if (cost > 100_000) return 'Check the cost';
  return null;
}

export function addTrackingNumber(
  list: readonly string[],
  raw: string,
): { readonly list: readonly string[]; readonly error: string | null } {
  const t = raw.trim();
  if (!t) return { list, error: 'Enter a tracking number' };
  if (t.length > 60) return { list, error: 'Max 60 characters' };
  if (list.some((x) => x.toUpperCase() === t.toUpperCase())) return { list, error: `${t} is already added` };
  if (list.length >= MAX_TRACKING_NUMBERS)
    return { list, error: `Up to ${MAX_TRACKING_NUMBERS} tracking numbers` };
  return { list: [...list, t], error: null };
}

/** Field errors of the Return shipping step (PURE): date, label fields when buying, manual cost. */
export function shippingIssues(
  v: Pick<RmaFormValues, 'expectedReturnDate' | 'createLabel' | 'label' | 'returnInfo'>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (v.expectedReturnDate && !isDateOnly(v.expectedReturnDate))
    out.expectedReturnDate = 'Enter a valid date';
  if (v.createLabel) {
    for (const [key, message] of Object.entries(validateLabel(v.label)))
      out[`label.${key}`] = message as string;
  } else {
    const cost = v.returnInfo?.shippingCost;
    const costErr = returnCostError(cost);
    if (costErr) out['returnInfo.shippingCost'] = costErr;
    if ((v.returnInfo?.trackingNumbers?.length ?? 0) > MAX_TRACKING_NUMBERS)
      out['returnInfo.trackingNumbers'] = `Up to ${MAX_TRACKING_NUMBERS} tracking numbers`;
  }
  return out;
}

/**
 * Fresh line values for an order. A single returnable line is pre-selected with its full
 * returnable qty; otherwise nothing is selected and quantities stay empty, so a quantity
 * on screen always means the line is in the RMA (see `lineEdit`).
 */
export function initialLines(order: ShippableOrder): RmaLineValue[] {
  const returnable = order.lines.filter((l) => l.returnable > 0 && !l.isNonReturnable);
  return order.lines.map((l) => ({
    orderLineId: l.orderLineId,
    selected: returnable.length === 1 && returnable[0]?.orderLineId === l.orderLineId,
    quantity: returnable.length === 1 && returnable[0]?.orderLineId === l.orderLineId ? l.returnable : null,
    reasonId: null,
  }));
}

export function orderStepSchema(order: ShippableOrder | null | undefined): z.ZodType {
  return z.object({ orderId: z.string() }).superRefine((v, ctx) => {
    if (!v.orderId) ctx.addIssue({ code: 'custom', path: ['orderId'], message: 'Choose a shipped order' });
    else if (order && order.id === v.orderId && !order.eligible)
      ctx.addIssue({
        code: 'custom',
        path: ['orderId'],
        message: order.reason ?? "This order can't be returned",
      });
  });
}

export function linesStepSchema(order: ShippableOrder | null | undefined, requireReason: boolean): z.ZodType {
  return z.object({ lines: z.array(z.any()) }).superRefine((v, ctx) => {
    const lines = v.lines as RmaLineValue[];
    if (!lines.some((l) => l.selected)) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Select at least one item to return' });
      return;
    }
    lines.forEach((l, i) => {
      if (!l.selected) return;
      const src = order?.lines.find((x) => x.orderLineId === l.orderLineId);
      if (!l.quantity || l.quantity < 1)
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'quantity'], message: 'Enter at least 1' });
      else if (src && l.quantity > src.returnable)
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'quantity'],
          message: `Max ${src.returnable} (shipped ${src.shippedQty}, already returned ${src.alreadyReturned})`,
        });
      if (requireReason && !l.reasonId)
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'reasonId'], message: 'Choose a return reason' });
    });
  });
}

export const shippingStepSchema: z.ZodType = z
  .object({ createLabel: z.boolean() })
  .passthrough()
  .superRefine((v, ctx) => {
    for (const [path, message] of Object.entries(shippingIssues(v as unknown as RmaFormValues)))
      ctx.addIssue({ code: 'custom', path: path.split('.'), message });
  });

export interface CreateRmaPayload {
  readonly shipmentOrderId: string;
  readonly lines: readonly {
    readonly orderLineId: string;
    readonly quantity: number;
    readonly customerReturnReasonId: string | null;
  }[];
  readonly expectedReturnDate: string | null;
  readonly note: string | null;
  readonly label: ReturnType<typeof labelPayload> | null;
  readonly returnAddressId: string | null;
  readonly returnInfo: {
    readonly carrierCode: string | null;
    readonly carrierServiceName: string | null;
    readonly shippingCost: number | null;
    readonly trackingNumbers: readonly string[];
  } | null;
}

export function buildCreatePayload(v: RmaFormValues): CreateRmaPayload {
  return {
    shipmentOrderId: v.orderId,
    lines: v.lines
      .filter((l) => l.selected && (l.quantity ?? 0) > 0)
      .map((l) => ({
        orderLineId: l.orderLineId,
        quantity: l.quantity ?? 0,
        customerReturnReasonId: l.reasonId,
      })),
    expectedReturnDate: v.expectedReturnDate || null,
    note: v.note.trim() || null,
    label: v.createLabel ? labelPayload(v.label) : null,
    returnAddressId: v.returnAddressId || null,
    returnInfo: v.createLabel ? null : manualInfoPayload(v.returnInfo),
  };
}

/** Manual return info, or null when nothing was entered. */
export function manualInfoPayload(i: ReturnInfoValue | null | undefined): CreateRmaPayload['returnInfo'] {
  if (!i) return null;
  const out = {
    carrierCode: i.carrierCode || null,
    carrierServiceName: i.carrierServiceName.trim() || null,
    shippingCost: i.shippingCost ?? null,
    trackingNumbers: i.trackingNumbers.map((t) => t.trim()).filter(Boolean),
  };
  return out.carrierCode || out.carrierServiceName || out.shippingCost !== null || out.trackingNumbers.length
    ? out
    : null;
}

/**
 * Wizard rail progress: one third per COMPLETE step.
 * - Order: complete as soon as an eligible order is chosen (on any step).
 * - Items: complete once the Items step was reached and at least one unit is selected (a line
 *   preselected on step 1 does not count before the user has seen it).
 * - Return shipping: complete once reached and its required fields are valid (a label being
 *   bought needs carrier and service, etc.). 100% / "Ready to create" only then.
 */
export function rmaProgress(
  v: Partial<
    Pick<RmaFormValues, 'orderId' | 'lines' | 'expectedReturnDate' | 'createLabel' | 'label' | 'returnInfo'>
  >,
  ctx: {
    readonly orderEligible: boolean;
    readonly reachedStep: number;
    readonly orderState?: 'loading' | 'error' | 'missing' | 'ineligible' | null;
  },
): { readonly percent: number; readonly label: string } {
  const step = Math.max(0, Math.min(2, Math.floor(ctx.reachedStep)));
  const order = Boolean(v.orderId) && ctx.orderEligible;
  const items = step >= 1 && selectedUnits({ lines: v.lines ?? [] }) > 0;
  const issues = shippingIssues({
    expectedReturnDate: v.expectedReturnDate ?? null,
    createLabel: Boolean(v.createLabel),
    label: v.label ?? ({} as ReturnLabelValue),
    returnInfo: v.returnInfo ?? EMPTY_RETURN_INFO,
  });
  const shipping = step >= 2 && Object.keys(issues).length === 0;
  const done = Number(order) + Number(items) + Number(shipping);
  const percent = Math.round((done / 3) * 100);
  if (order && items && shipping) return { percent: 100, label: 'Ready to create' };
  // Keep the rail in step with the step body: an order being fetched / failed / refused says so.
  const pending =
    !order && v.orderId
      ? (
          {
            loading: 'Loading the order…',
            error: 'The order could not be loaded',
            missing: 'Order not found',
            ineligible: "This order can't be returned",
          } as const
        )[ctx.orderState ?? 'loading']
      : null;
  const label = pending
    ? pending
    : !order
      ? 'Choose an order'
      : step === 0
        ? 'Order chosen. Continue to items'
        : !items
          ? 'Choose the items'
          : step < 2
            ? 'Items chosen. Continue to return shipping'
            : v.createLabel
              ? 'Complete the return label fields'
              : 'Fix the return shipping fields';
  return { percent, label };
}

/** Units in the RMA being built. */
export function selectedUnits(v: Pick<RmaFormValues, 'lines'>): number {
  return v.lines.filter((l) => l.selected).reduce((s, l) => s + (l.quantity ?? 0), 0);
}

/**
 * Keeps the checkbox and the quantity in sync on the Items step: checking a line fills its
 * full returnable qty, unchecking clears it, typing a qty above 0 selects the line and
 * clearing it (or 0) deselects it.
 */
export function lineEdit(
  line: RmaLineValue,
  returnable: number,
  edit: { readonly selected: boolean } | { readonly quantity: number | null },
): RmaLineValue {
  if ('selected' in edit)
    return {
      ...line,
      selected: edit.selected,
      quantity: edit.selected ? (line.quantity && line.quantity > 0 ? line.quantity : returnable) : null,
    };
  const q = edit.quantity;
  return { ...line, quantity: q && q > 0 ? q : null, selected: Boolean(q && q > 0) };
}
