/**
 * Shipment Plan drawer model (PURE): form values, step schemas, defaults, detail → form
 * mapping and form → API body. Unit-tested in tests/unit/shipping.
 */
import { z } from 'zod';
import { PLAN_CREATE_STATUSES } from '@/lib/grid-defs/shipping/shipment-plans';
import { SHIPMENT_PLAN_STATUSES, type ShipmentPlanStatus } from '@/lib/enums';

export interface PlanOrderItem {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly totalQuantity: number;
}

export interface PlanFormValues {
  code: string;
  warehouseId: string;
  clientId: string | null;
  carrierConnectionId: string | null;
  truckPlateNumber: string;
  loadingGateLocationId: string | null;
  loadingGateLabel: string;
  status: ShipmentPlanStatus;
  plannedShipmentAt: string | null;
  actualShipmentAt: string | null;
  loadingStartedAt: string | null;
  loadingCompletedAt: string | null;
  truckDepartedAt: string | null;
  expectedTotalVolume: number;
  expectedTotalWeight: number;
  preventLpnEditDuringLoading: boolean;
  note: string;
  customerId: string | null;
  customerLabel: string;
  customerAddressId: string | null;
  retailerId: string | null;
  customFields: Record<string, string | boolean | null>;
  orders: PlanOrderItem[];
}

const isoOrNull = z.string().nullable();
const after = (a: string | null, b: string | null): boolean => !a || !b || new Date(b) >= new Date(a);

export const generalStepSchema = z
  .object({
    code: z.string().trim().min(1, 'Enter a plan code').max(40, 'Use at most 40 characters'),
    warehouseId: z.string().min(1, 'Select a warehouse'),
    status: z.enum(SHIPMENT_PLAN_STATUSES, { message: 'Select a status' }),
    truckPlateNumber: z.string().max(40, 'Use at most 40 characters'),
    note: z.string().max(2000, 'Use at most 2000 characters'),
    expectedTotalVolume: z.number({ message: 'Enter a number' }).min(0, "Can't be negative"),
    expectedTotalWeight: z.number({ message: 'Enter a number' }).min(0, "Can't be negative"),
    loadingStartedAt: isoOrNull,
    loadingCompletedAt: isoOrNull,
    truckDepartedAt: isoOrNull,
  })
  .refine((v) => after(v.loadingStartedAt, v.loadingCompletedAt), {
    path: ['loadingCompletedAt'],
    message: "Loading can't complete before it started",
  })
  .refine((v) => after(v.loadingCompletedAt, v.truckDepartedAt), {
    path: ['truckDepartedAt'],
    message: "The truck can't depart before loading completed",
  });

export const othersStepSchema = z
  .object({ customerId: z.string().nullable(), customerAddressId: z.string().nullable() })
  .refine((v) => !v.customerAddressId || Boolean(v.customerId), {
    path: ['customerAddressId'],
    message: 'Pick a customer first',
  });

export const ordersStepSchema = z.object({
  orders: z.array(z.object({ id: z.string() })).max(500, 'A plan holds at most 500 orders'),
});

export function emptyPlanForm(code: string, warehouseId: string | null): PlanFormValues {
  return {
    code,
    warehouseId: warehouseId ?? '',
    clientId: null,
    carrierConnectionId: null,
    truckPlateNumber: '',
    loadingGateLocationId: null,
    loadingGateLabel: '',
    status: 'Open',
    plannedShipmentAt: null,
    actualShipmentAt: null,
    loadingStartedAt: null,
    loadingCompletedAt: null,
    truckDepartedAt: null,
    expectedTotalVolume: 0,
    expectedTotalWeight: 0,
    preventLpnEditDuringLoading: false,
    note: '',
    customerId: null,
    customerLabel: '',
    customerAddressId: null,
    retailerId: null,
    customFields: {},
    orders: [],
  };
}

export interface PlanDetailLike {
  readonly code: string;
  readonly status: ShipmentPlanStatus;
  readonly warehouseId: string;
  readonly clientId: string | null;
  readonly truckPlateNumber: string | null;
  readonly note: string | null;
  readonly plannedShipmentAt: string | null;
  readonly preventLpnEditDuringLoading: boolean;
  readonly customFields: Readonly<Record<string, string | boolean | null>>;
  readonly orders: readonly Readonly<Record<string, unknown>>[];
  readonly [key: string]: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function detailToForm(d: PlanDetailLike): PlanFormValues {
  return {
    code: d.code,
    warehouseId: d.warehouseId,
    clientId: d.clientId,
    carrierConnectionId: str(d.carrierConnectionId),
    truckPlateNumber: d.truckPlateNumber ?? '',
    loadingGateLocationId: str(d.loadingGateLocationId),
    loadingGateLabel: str(d.loadingGate) ?? '',
    status: d.status,
    plannedShipmentAt: d.plannedShipmentAt,
    actualShipmentAt: str(d.actualShipmentAt),
    loadingStartedAt: str(d.loadingStartedAt),
    loadingCompletedAt: str(d.loadingCompletedAt),
    truckDepartedAt: str(d.truckDepartedAt),
    expectedTotalVolume: num(d.expectedTotalVolume),
    expectedTotalWeight: num(d.expectedTotalWeight),
    preventLpnEditDuringLoading: d.preventLpnEditDuringLoading,
    note: d.note ?? '',
    customerId: str(d.customerId),
    customerLabel: (d.customerId ? str(d.customerName) : null) ?? '',
    customerAddressId: str(d.customerAddressId),
    retailerId: str(d.retailerId),
    customFields: { ...d.customFields },
    orders: d.orders.map((o) => ({
      id: String(o.orderId),
      code: String(o.orderCode),
      status: String(o.orderStatus),
      totalQuantity: num(o.totalQuantity),
    })),
  };
}

/** Form → POST/PATCH body (labels and order facts stripped, empty text → null). */
export function formToBody(v: PlanFormValues, version?: number): Record<string, unknown> {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  return {
    code: t(v.code),
    warehouseId: v.warehouseId,
    clientId: v.clientId,
    carrierConnectionId: v.carrierConnectionId,
    truckPlateNumber: t(v.truckPlateNumber),
    loadingGateLocationId: v.loadingGateLocationId,
    status: v.status,
    plannedShipmentAt: v.plannedShipmentAt,
    actualShipmentAt: v.actualShipmentAt,
    loadingStartedAt: v.loadingStartedAt,
    loadingCompletedAt: v.loadingCompletedAt,
    truckDepartedAt: v.truckDepartedAt,
    expectedTotalVolume: v.expectedTotalVolume,
    expectedTotalWeight: v.expectedTotalWeight,
    preventLpnEditDuringLoading: v.preventLpnEditDuringLoading,
    note: t(v.note),
    customerId: v.customerId,
    customerAddressId: v.customerId ? v.customerAddressId : null,
    retailerId: v.retailerId,
    customFields: v.customFields,
    orderIds: v.orders.map((o) => o.id),
    ...(version !== undefined ? { version } : {}),
  };
}

/** Status choices: create → Open / In Progress; edit → current + legal next (never Shipped: that is Ship). */
export function statusChoices(
  mode: 'create' | 'edit',
  current: ShipmentPlanStatus,
  next: readonly ShipmentPlanStatus[],
): readonly ShipmentPlanStatus[] {
  if (mode === 'create') return PLAN_CREATE_STATUSES;
  return [current, ...next.filter((s) => s !== 'Shipped' && s !== current)];
}

/** Whether totals still follow the orders (untouched since the last estimate). */
export function totalsFollowOrders(
  values: Pick<PlanFormValues, 'expectedTotalWeight' | 'expectedTotalVolume'>,
  last: { weightLb: number; volumeFt3: number } | null,
): boolean {
  const base = last ?? { weightLb: 0, volumeFt3: 0 };
  return values.expectedTotalWeight === base.weightLb && values.expectedTotalVolume === base.volumeFt3;
}

/* ------------------------------------------------------------ expected load */

export interface ExpectedLoadInput {
  readonly storedWeightLb: number;
  readonly storedVolumeFt3: number;
  readonly lineWeightLb: number;
  readonly lineVolumeFt3: number;
  readonly missingDimsProducts: number;
  /** Units on the plan's orders; lines with units but no weight/volume warn. */
  readonly unitCount?: number;
}

export interface ExpectedLoad {
  readonly weightLb: number;
  readonly volumeFt3: number;
  /** Where the numbers come from, shown under the tile value. */
  readonly sourceLabel: string;
  /** Order-line figures that differ from an override (own line, so it never clips). */
  readonly detail: string | null;
  readonly warning: string | null;
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * Reconciles the plan's stored expected load with the sum of its order lines. A stored value that
 * differs from the lines is labelled as an override (never shown beside a contradicting total), and
 * products without weight or dimensions produce a warning instead of a silent 0.00.
 */
export function expectedLoad(i: ExpectedLoadInput): ExpectedLoad {
  const stored = i.storedWeightLb > 0 || i.storedVolumeFt3 > 0;
  const agrees = close(i.storedWeightLb, i.lineWeightLb) && close(i.storedVolumeFt3, i.lineVolumeFt3);
  const hasLines = (i.unitCount ?? 0) > 0 || i.lineWeightLb > 0 || i.lineVolumeFt3 > 0;
  const warning =
    i.missingDimsProducts > 0
      ? `${i.missingDimsProducts} product${i.missingDimsProducts === 1 ? '' : 's'} missing weight or dimensions`
      : hasLines && (i.lineVolumeFt3 <= 0 || i.lineWeightLb <= 0)
        ? `Order lines have no ${i.lineVolumeFt3 <= 0 && i.lineWeightLb <= 0 ? 'weight or volume' : i.lineVolumeFt3 <= 0 ? 'volume' : 'weight'}: products missing dimensions`
        : null;
  // The Manifest/BOL prints each order's line weight, so the order lines are the one authoritative figure.
  // A different value entered on the plan is shown under it, labelled, never as a second headline.
  if (!(i.lineWeightLb > 0) && i.storedWeightLb > 0) {
    return {
      weightLb: i.storedWeightLb,
      volumeFt3: i.storedVolumeFt3 > 0 ? i.storedVolumeFt3 : i.lineVolumeFt3,
      sourceLabel: 'entered on plan (order lines have no weight)',
      detail: null,
      warning,
    };
  }
  const detail =
    stored && !agrees
      ? `Entered on plan: ${i.storedWeightLb.toFixed(2)} lb, ${i.storedVolumeFt3.toFixed(2)} ft³ (not printed on the BOL)`
      : null;
  return {
    weightLb: i.lineWeightLb,
    volumeFt3: i.lineVolumeFt3,
    sourceLabel: 'order lines · used on the Manifest/BOL',
    detail,
    warning,
  };
}

/** One stage of the plan lifecycle stepper. */
export interface LifecycleStep {
  readonly stage: ShipmentPlanStatus;
  readonly state: 'done' | 'current' | 'upcoming' | 'skipped';
  /** The stage's stamped time (loading started / completed, shipped), when there is one. */
  readonly at: string | null;
}

export const LIFECYCLE_STAGES: readonly ShipmentPlanStatus[] = [
  'Open',
  'In Progress',
  'Loading Started',
  'Loading Completed',
  'Shipped',
];

/**
 * Stepper states. A stage with a stamped time is done and shows the time, so a shipped plan with loading
 * times never reads "Skipped". Only a stage the plan went past with neither a stamp nor a change-log
 * transition reads "Skipped".
 */
export function lifecycleSteps(
  status: ShipmentPlanStatus,
  reached: ReadonlySet<string>,
  stamps: Readonly<Partial<Record<ShipmentPlanStatus, string | null>>>,
): readonly LifecycleStep[] {
  const at = LIFECYCLE_STAGES.indexOf(status);
  return LIFECYCLE_STAGES.map((stage, i): LifecycleStep => {
    const stamp = stamps[stage] ?? null;
    if (i === at) return { stage, state: status === 'Shipped' ? 'done' : 'current', at: stamp };
    if (i > at) return { stage, state: 'upcoming', at: null };
    const passed = Boolean(stamp) || reached.has(stage) || stage === 'Open';
    return { stage, state: passed ? 'done' : 'skipped', at: stamp };
  });
}

export { deriveFromOrders, type DerivedFromOrders } from '@/lib/grid-defs/shipping/shipment-plans';

const FIELD_NAMES: Readonly<Record<string, string>> = {
  'Loading Started At': 'Loading started',
  'Loading Completed At': 'Loading completed',
  'Truck Departed At': 'Truck departed',
  'Actual Shipment At': 'Actual shipment',
  'Planned Shipment At': 'Planned shipment',
  'Loading Gate Location Id': 'Loading gate',
};

const codesOf = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Change-log message → sentence for people: "Orders is modified.  --> SO1" → "Added order SO1";
 * "Status is modified. Open --> Shipped" → "Status changed from Open to Shipped". Unknown text passes through.
 */
export function humanizePlanChange(message: string): string {
  const m = /^(.+?) is modified\.\s*([\s\S]*?)\s*-->\s*([\s\S]*)$/.exec(message.trim());
  if (!m) return message.replace(/\s{2,}/g, ' ').trim();
  const field = m[1].trim();
  const before = m[2].trim().replace(/^—$/, '');
  const after = m[3].trim().replace(/^—$/, '');
  if (field === 'Orders') {
    const b = new Set(codesOf(before));
    const a = new Set(codesOf(after));
    const added = [...a].filter((c) => !b.has(c));
    const removed = [...b].filter((c) => !a.has(c));
    const part = (verb: string, list: string[]) =>
      `${verb} ${list.length === 1 ? 'order' : 'orders'} ${list.join(', ')}`;
    const parts = [
      added.length ? part('Added', added) : '',
      removed.length ? part(added.length ? 'removed' : 'Removed', removed) : '',
    ].filter(Boolean);
    return parts.length ? parts.join('; ') : 'Orders unchanged';
  }
  const name = FIELD_NAMES[field] ?? field;
  if (field === 'Status') return `Status changed from ${before || '—'} to ${after || '—'}`;
  if (!before && after) return `${name} set to ${after}`;
  if (before && !after) return `${name} cleared (was ${before})`;
  return `${name} changed from ${before} to ${after}`;
}

const ISO_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
/** Replaces every ISO date-time inside a change-log message with `format(iso)` (the viewer's local format). */
export function localizeIsoInText(text: string, format: (iso: string) => string): string {
  return text.replace(ISO_RE, (iso) => (Number.isNaN(Date.parse(iso)) ? iso : format(iso)));
}

/** Sub-status shown beside a plan's status pill: partial ship / loading progress, or null. */
export function planProgressNote(status: string, orderCount: number, shippedCount: number): string | null {
  if (status === 'Shipped' || status === 'Cancelled' || orderCount === 0 || shippedCount === 0) return null;
  if (shippedCount >= orderCount) return 'All orders shipped';
  return `Partially shipped · ${shippedCount} of ${orderCount}`;
}

/** Sublabel of the Shipped KPI tile, consistent with its "N of M" value. */
export function shippedTileNote(shipped: number, total: number, shippedOn: string | null): string {
  if (total === 0) return 'No orders on the plan';
  if (shipped === 0) return 'Not shipped yet';
  if (shipped < total)
    return `${shipped} ${shipped === 1 ? 'order' : 'orders'} shipped, ${total - shipped} remaining`;
  return shippedOn ? `All shipped on ${shippedOn}` : 'All orders shipped';
}
