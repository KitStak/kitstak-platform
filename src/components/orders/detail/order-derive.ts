import type { OrderDetail, OrderDetailHeader } from "@/server/repositories/orders";
import type { WizardStepState } from "./wizard-stepper";

/** Seeded warehouses (MLT1 default). Fallback keeps unknown ids readable. */
const WAREHOUSE_NAMES: Record<string, string> = {
  "wh-mlt1": "MLT1 – Main Fulfillment",
  "wh-ks2": "KS2 – Overflow",
};

export function warehouseNameOf(warehouseId: string): string {
  return WAREHOUSE_NAMES[warehouseId] ?? warehouseId.toUpperCase();
}

export type SectionKey =
  | "details"
  | "customer"
  | "products"
  | "shipping"
  | "other"
  | "confirm";

export interface SectionStates {
  details: WizardStepState;
  customer: WizardStepState;
  products: WizardStepState;
  shipping: WizardStepState;
  other: WizardStepState;
  confirm: WizardStepState;
}

const DONE_STATUSES = ["Shipped", "Delivered"];
const PROBLEM_STATUSES = ["Shortage", "On Hold", "Cancelled"];

/** Derive per-step completion from the order data itself. */
export function deriveSectionStates(detail: OrderDetail): SectionStates {
  const { order, lines } = detail;
  const hasAddress = Boolean(
    order.shipAddress && order.shipCity && order.shipZip && order.customerEmail.includes("@")
  );
  const fullyPicked = lines.length > 0 && lines.every((l) => l.pickedQuantity >= l.quantity);
  const hasShortage = order.status === "Shortage";
  return {
    details: order.expectedShipDate ? "complete" : "attention",
    customer: hasAddress ? "complete" : "attention",
    products: hasShortage ? "attention" : lines.length > 0 && fullyPicked ? "complete" : "none",
    // Shipping is complete iff a carrier has been assigned.
    shipping: order.carrier ? "complete" : "attention",
    other: order.note ? "complete" : "none",
    confirm: DONE_STATUSES.includes(order.status)
      ? "complete"
      : PROBLEM_STATUSES.includes(order.status)
        ? "attention"
        : "none",
  };
}

/** Logiwa shows job type next to the assigned job code; synthesize from line shape. */
export function assignedJobType(detail: OrderDetail): string {
  const units = detail.lines.reduce((sum, l) => sum + l.quantity, 0);
  if (detail.lines.length > 1) return "Multi Item Orders";
  return units > 1 ? "Multi Unit Orders" : "Single Unit Orders";
}

/** "2 lb 4.5 oz" style weight from total ounces. */
export function formatWeightOz(totalOz: number): string {
  const lb = Math.floor(totalOz / 16);
  const oz = Math.round((totalOz - lb * 16) * 10) / 10;
  if (lb === 0) return `${oz} oz`;
  if (oz === 0) return `${lb} lb`;
  return `${lb} lb ${oz} oz`;
}

export function lastUpdateOf(order: OrderDetailHeader): string {
  return order.deliveredAt ?? order.shippedAt ?? order.expectedShipDate ?? order.createdAt;
}
