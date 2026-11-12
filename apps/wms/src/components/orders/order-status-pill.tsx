/**
 * Shipment-order status pill. Open green, every in-process status one blue, Ready to Ship
 * purple, Shortage rust. Tones come from the shared label palette, so they follow both themes
 * and match `<StatusPill>` and the KitStak CRM pill exactly.
 */
import * as React from "react";
import { PillDot } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { isPartialStatus, pillClass, pillStyle, statusLabel, TONES, type StatusTone } from "@/lib/status-colors";

export type OrderTone = StatusTone;

const GREEN: OrderTone = TONES.green;
const BLUE: OrderTone = TONES.blue;
const PURPLE: OrderTone = TONES.purple;
const RUST: OrderTone = TONES.shortage;
const HOLD: OrderTone = TONES.hold;
const RED: OrderTone = TONES.red;
const GREY: OrderTone = TONES.grey;

const ORDER_TONES: Readonly<Record<string, OrderTone>> = {
  open: GREEN,
  "ready to pick": BLUE,
  "picking started": BLUE,
  picked: BLUE,
  "ready to pack": BLUE,
  "packing started": BLUE,
  "ready to sort": BLUE,
  "sorting started": BLUE,
  "ready to load": BLUE,
  "loading started": BLUE,
  "ready to ship": PURPLE,
  shipped: GREEN,
  "partially shipped": GREEN,
  delivered: GREEN,
  shortage: RUST,
  "on hold": HOLD,
  cancelled: RED,
};

export function orderStatusTone(status: string | null | undefined): OrderTone {
  return ORDER_TONES[(status ?? "").trim().toLowerCase()] ?? GREY;
}

export function OrderStatusPill({ status, size = "md", className }: { readonly status: string; readonly size?: "sm" | "md"; readonly className?: string }) {
  const tone = orderStatusTone(status);
  return (
    <span data-status={status} style={pillStyle(tone)} className={cn(pillClass(size), className)}>
      <PillDot tone={tone} partial={isPartialStatus(status)} />
      <span className="truncate">{statusLabel(status)}</span>
    </span>
  );
}
