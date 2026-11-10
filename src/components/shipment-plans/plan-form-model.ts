/**
 * Shipment Plan drawer model (PURE): form values, step schemas, defaults, detail → form
 * mapping and form → API body. Unit-tested in tests/unit/shipping.
 */
import { z } from "zod";
import { PLAN_CREATE_STATUSES } from "@/lib/grid-defs/shipping/shipment-plans";
import { SHIPMENT_PLAN_STATUSES, type ShipmentPlanStatus } from "@/lib/enums";

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
    code: z.string().trim().min(1, "Enter a plan code").max(40, "Use at most 40 characters"),
    warehouseId: z.string().min(1, "Select a warehouse"),
    status: z.enum(SHIPMENT_PLAN_STATUSES, { message: "Select a status" }),
    truckPlateNumber: z.string().max(40, "Use at most 40 characters"),
    note: z.string().max(2000, "Use at most 2000 characters"),
    expectedTotalVolume: z.number({ message: "Enter a number" }).min(0, "Can't be negative"),
    expectedTotalWeight: z.number({ message: "Enter a number" }).min(0, "Can't be negative"),
    loadingStartedAt: isoOrNull,
    loadingCompletedAt: isoOrNull,
    truckDepartedAt: isoOrNull,
  })
  .refine((v) => after(v.loadingStartedAt, v.loadingCompletedAt), { path: ["loadingCompletedAt"], message: "Loading can't complete before it started" })
  .refine((v) => after(v.loadingCompletedAt, v.truckDepartedAt), { path: ["truckDepartedAt"], message: "The truck can't depart before loading completed" });

export const othersStepSchema = z
  .object({ customerId: z.string().nullable(), customerAddressId: z.string().nullable() })
  .refine((v) => !v.customerAddressId || Boolean(v.customerId), { path: ["customerAddressId"], message: "Pick a customer first" });

export const ordersStepSchema = z.object({ orders: z.array(z.object({ id: z.string() })).max(500, "A plan holds at most 500 orders") });

export function emptyPlanForm(code: string, warehouseId: string | null): PlanFormValues {
  return {
    code, warehouseId: warehouseId ?? "", clientId: null, carrierConnectionId: null, truckPlateNumber: "", loadingGateLocationId: null, loadingGateLabel: "",
    status: "Open", plannedShipmentAt: null, actualShipmentAt: null, loadingStartedAt: null, loadingCompletedAt: null, truckDepartedAt: null,
    expectedTotalVolume: 0, expectedTotalWeight: 0, preventLpnEditDuringLoading: false, note: "", customerId: null, customerLabel: "",
    customerAddressId: null, retailerId: null, customFields: {}, orders: [],
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

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function detailToForm(d: PlanDetailLike): PlanFormValues {
  return {
    code: d.code, warehouseId: d.warehouseId, clientId: d.clientId, carrierConnectionId: str(d.carrierConnectionId), truckPlateNumber: d.truckPlateNumber ?? "",
    loadingGateLocationId: str(d.loadingGateLocationId), loadingGateLabel: str(d.loadingGate) ?? "", status: d.status,
    plannedShipmentAt: d.plannedShipmentAt, actualShipmentAt: str(d.actualShipmentAt), loadingStartedAt: str(d.loadingStartedAt),
    loadingCompletedAt: str(d.loadingCompletedAt), truckDepartedAt: str(d.truckDepartedAt), expectedTotalVolume: num(d.expectedTotalVolume),
    expectedTotalWeight: num(d.expectedTotalWeight), preventLpnEditDuringLoading: d.preventLpnEditDuringLoading, note: d.note ?? "",
    customerId: str(d.customerId), customerLabel: str(d.customerName) ?? "", customerAddressId: str(d.customerAddressId), retailerId: str(d.retailerId),
    customFields: { ...d.customFields },
    orders: d.orders.map((o) => ({ id: String(o.orderId), code: String(o.orderCode), status: String(o.orderStatus), totalQuantity: num(o.totalQuantity) })),
  };
}

/** Form → POST/PATCH body (labels and order facts stripped, empty text → null). */
export function formToBody(v: PlanFormValues, version?: number): Record<string, unknown> {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  return {
    code: t(v.code), warehouseId: v.warehouseId, clientId: v.clientId, carrierConnectionId: v.carrierConnectionId, truckPlateNumber: t(v.truckPlateNumber),
    loadingGateLocationId: v.loadingGateLocationId, status: v.status, plannedShipmentAt: v.plannedShipmentAt, actualShipmentAt: v.actualShipmentAt,
    loadingStartedAt: v.loadingStartedAt, loadingCompletedAt: v.loadingCompletedAt, truckDepartedAt: v.truckDepartedAt,
    expectedTotalVolume: v.expectedTotalVolume, expectedTotalWeight: v.expectedTotalWeight, preventLpnEditDuringLoading: v.preventLpnEditDuringLoading,
    note: t(v.note), customerId: v.customerId, customerAddressId: v.customerId ? v.customerAddressId : null, retailerId: v.retailerId,
    customFields: v.customFields, orderIds: v.orders.map((o) => o.id),
    ...(version !== undefined ? { version } : {}),
  };
}

/** Status choices: create → Open / In Progress; edit → current + legal next (never Shipped: that is Ship). */
export function statusChoices(mode: "create" | "edit", current: ShipmentPlanStatus, next: readonly ShipmentPlanStatus[]): readonly ShipmentPlanStatus[] {
  if (mode === "create") return PLAN_CREATE_STATUSES;
  return [current, ...next.filter((s) => s !== "Shipped" && s !== current)];
}

/** Whether totals still follow the orders (untouched since the last estimate). */
export function totalsFollowOrders(values: Pick<PlanFormValues, "expectedTotalWeight" | "expectedTotalVolume">, last: { weightLb: number; volumeFt3: number } | null): boolean {
  const base = last ?? { weightLb: 0, volumeFt3: 0 };
  return values.expectedTotalWeight === base.weightLb && values.expectedTotalVolume === base.volumeFt3;
}
