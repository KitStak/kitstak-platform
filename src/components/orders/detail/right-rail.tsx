"use client";

import * as React from "react";
import Link from "next/link";
import {
  Briefcase,
  ChevronDown,
  Download,
  FileText,
  Receipt,
  Tag as TagIcon,
  X,
} from "lucide-react";
import type { OrderDetail } from "@/server/repositories/orders";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { StatusPill } from "@/components/ui/status-pill";
import {
  assignedJobType,
  formatWeightOz,
  lastUpdateOf,
  warehouseNameOf,
} from "./order-derive";

/**
 * Full-width "Other Actions" menu local to the order rail. The shared ui
 * Dropdown shrink-wraps its trigger (inline-flex), which left the button
 * narrow and left-aligned under "Save Shipment Order"; this trigger spans
 * the rail with a centered label so the two actions stack as one block.
 */
function OtherActionsMenu({
  children,
}: {
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = React.useCallback(() => setOpen(false), []);

  return (
    <div ref={rootRef} className="relative w-full">
      <Button
        variant="secondary"
        size="lg"
        className="w-full justify-center"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        Other Actions
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </Button>
      {open ? (
        <div className="absolute inset-x-0 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12px] text-faint">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-[13px]",
          strong ? "font-semibold text-foreground" : "font-medium text-body"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Money value with the order currency suffix so all summary rows match. */
function MoneyValue({ amount }: { amount: number }) {
  return (
    <>
      {formatMoney(amount)}
      <span className="ml-1 text-[11px] font-medium text-faint">USD</span>
    </>
  );
}

function SummaryCard({ detail }: { detail: OrderDetail }) {
  const { order } = detail;
  const total = order.salesPrice;
  const discount = 0;
  return (
    <Card>
      <div className="border-b border-border px-4 pb-3 pt-3.5">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-secondary">
          Summary
        </h3>
      </div>
      <div className="px-4 py-2.5">
        <p className="text-[11px] text-faint">Order Code</p>
        <p className="text-lg font-semibold tracking-[-0.01em] text-foreground">
          {order.code}
        </p>
        <div className="mt-1.5 border-t border-border/70 pt-1">
          <SummaryRow label="Warehouse" value={warehouseNameOf(order.warehouseId)} />
          <SummaryRow
            label="Order Type"
            value={order.orderType === "D2C" ? "D2C Order" : "B2B Order"}
          />
          <SummaryRow
            label="Store Order Number"
            value={order.storeOrderNumber ?? "—"}
          />
          <SummaryRow label="Status" value={<StatusPill status={order.status} />} />
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-faint">Last Update</span>
              <span className="text-right text-[13px] font-medium tabular-nums text-body">
                {formatDateTime(lastUpdateOf(order))}
              </span>
            </div>
            <div className="mt-1 flex justify-end">
              <Link
                href="/reports"
                className="text-[12px] font-medium leading-4 text-primary hover:underline"
              >
                Show Change Log
              </Link>
            </div>
          </div>
        </div>
        <div className="mt-1 border-t border-border/70 pt-1.5">
          <SummaryRow label="Price" value={<MoneyValue amount={total} />} />
          <SummaryRow label="Discount" value={<MoneyValue amount={discount} />} />
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 pb-1">
            <span className="text-[13px] font-semibold text-foreground">Total</span>
            <span className="text-[14px] font-semibold tabular-nums text-foreground">
              {formatMoney(total - discount)}
              <span className="ml-1 text-[11px] font-medium text-faint">USD</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Logiwa parity: job id link + job type subtitle + remove icon per row. */
function AssignedJobsCard({ detail }: { detail: OrderDetail }) {
  const { order } = detail;
  if (!order.jobId) return null;
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-3.5">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-secondary">
          Assigned Jobs
        </h3>
        <Briefcase className="h-3.5 w-3.5 text-faint" aria-hidden />
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          <Briefcase className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href="/jobs"
            className="block truncate text-[13px] font-medium text-primary hover:underline"
          >
            {order.jobId}
          </Link>
          <p className="truncate text-[11px] text-faint">{assignedJobType(detail)}</p>
        </div>
        <button
          type="button"
          aria-label={`Remove job ${order.jobId} from this order`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint outline-none transition-colors hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </Card>
  );
}

/* 3PL billing rates for the seeded demo warehouse (per-order presentation). */
const PICK_PACK_FIRST_UNIT_USD = 2.85;
const PICK_PACK_ADDL_UNIT_USD = 0.65;
const PACKAGING_FEE_USD = 1.1;
const SHIPPING_BASE_USD = 4.2;
const SHIPPING_PER_OZ_USD = 0.08;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function ChargeRow({ label, hint, amount }: { label: string; hint: string; amount: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-body">{label}</span>
        <span className="block truncate text-[11px] text-faint">{hint}</span>
      </span>
      <span className="shrink-0 text-[13px] font-medium tabular-nums text-body">
        {formatMoney(amount)}
      </span>
    </div>
  );
}

/**
 * Billing charges derived from the order itself (unit count and weight), so
 * the rail runs the height of the form column instead of trailing dead space
 * below Documents.
 */
function BillingChargesCard({ detail }: { detail: OrderDetail }) {
  const { order } = detail;
  const units = order.totalQuantity;
  const pickPack =
    units > 0
      ? roundMoney(PICK_PACK_FIRST_UNIT_USD + Math.max(0, units - 1) * PICK_PACK_ADDL_UNIT_USD)
      : 0;
  const packaging = units > 0 ? PACKAGING_FEE_USD : 0;
  const shipping = roundMoney(SHIPPING_BASE_USD + order.totalWeightOz * SHIPPING_PER_OZ_USD);
  const total = roundMoney(pickPack + packaging + shipping);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-3.5">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-secondary">
          Billing Charges
        </h3>
        <Receipt className="h-3.5 w-3.5 text-faint" aria-hidden />
      </div>
      <div className="divide-y divide-border/70 py-1">
        <ChargeRow
          label="Pick & Pack"
          hint={`${formatNumber(units)} ${units === 1 ? "unit" : "units"}`}
          amount={pickPack}
        />
        <ChargeRow label="Packaging" hint="Standard box & dunnage" amount={packaging} />
        <ChargeRow
          label="Shipping"
          hint={
            order.carrier
              ? `${order.carrier} · ${formatWeightOz(order.totalWeightOz)}`
              : `Estimated · ${formatWeightOz(order.totalWeightOz)}`
          }
          amount={shipping}
        />
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <span className="text-[13px] font-semibold text-foreground">Total Charges</span>
        <span className="text-[13px] font-semibold tabular-nums text-foreground">
          {formatMoney(total)}
          <span className="ml-1 text-[11px] font-medium text-faint">USD</span>
        </span>
      </div>
    </Card>
  );
}

function DocumentRow({
  label,
  hint,
  disabled,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors",
        "hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        "disabled:pointer-events-none disabled:opacity-45"
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-soft text-secondary">
        <FileText className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-body">{label}</span>
        <span className="block truncate text-[11px] text-faint">{hint}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-faint" aria-hidden />
    </button>
  );
}

export interface OrderRightRailProps {
  detail: OrderDetail;
}

export function OrderRightRail({ detail }: OrderRightRailProps) {
  const { order } = detail;
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[320px]">
      <Button variant="primary" size="lg" className="w-full">
        Save Shipment Order
      </Button>
      <OtherActionsMenu>
        {(close) => (
          <>
            <DropdownItem onClick={close}>
              <FileText className="h-3.5 w-3.5 text-faint" aria-hidden />
              Print Packing Slip
            </DropdownItem>
            <DropdownItem onClick={close}>
              <TagIcon className="h-3.5 w-3.5 text-faint" aria-hidden />
              Add Tag
            </DropdownItem>
            <DropdownItem onClick={close}>
              <Briefcase className="h-3.5 w-3.5 text-faint" aria-hidden />
              Duplicate Order
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem destructive onClick={close}>
              Cancel Order
            </DropdownItem>
          </>
        )}
      </OtherActionsMenu>
      <SummaryCard detail={detail} />
      <AssignedJobsCard detail={detail} />
      <Card>
        <div className="border-b border-border px-4 pb-3 pt-3.5">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-secondary">
            Documents
          </h3>
        </div>
        <div className="divide-y divide-border/70 py-1">
          <DocumentRow label="Packing Slip" hint={`${order.code} · PDF, 1 page`} />
          <DocumentRow
            label="Shipping Label"
            hint={
              order.trackingNumber
                ? `${order.carrier ?? "Carrier"} · 4×6 ZPL`
                : "Available after carrier assignment"
            }
            disabled={!order.trackingNumber}
          />
        </div>
      </Card>
      <BillingChargesCard detail={detail} />
    </aside>
  );
}
