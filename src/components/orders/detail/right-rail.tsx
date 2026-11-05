"use client";

import * as React from "react";
import Link from "next/link";
import { Briefcase, ChevronDown, Download, FileText, Tag as TagIcon } from "lucide-react";
import type { OrderDetail } from "@/server/repositories/orders";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { StatusPill } from "@/components/ui/status-pill";
import { assignedJobType, lastUpdateOf, warehouseNameOf } from "./order-derive";

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
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[12px] text-faint">Last Update</span>
            <span className="text-right">
              <span className="block text-[13px] font-medium tabular-nums text-body">
                {formatDateTime(lastUpdateOf(order))}
              </span>
              <Link
                href="/reports"
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Show Change Log
              </Link>
            </span>
          </div>
        </div>
        <div className="mt-1 border-t border-border/70 pt-1.5">
          <SummaryRow label="Price" value={formatMoney(total)} />
          <SummaryRow label="Discount" value={formatMoney(discount)} />
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

function AssignedJobCard({ detail }: { detail: OrderDetail }) {
  const { order } = detail;
  if (!order.jobId) return null;
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-3.5">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-secondary">
          Assigned Job
        </h3>
        <Briefcase className="h-3.5 w-3.5 text-faint" aria-hidden />
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          <Briefcase className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <Link
            href="/jobs"
            className="block truncate text-[13px] font-medium text-primary hover:underline"
          >
            {order.jobId}
          </Link>
          <p className="truncate text-[11px] text-faint">{assignedJobType(detail)}</p>
        </div>
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
      <Dropdown
        className="w-full"
        panelClassName="w-full"
        trigger={(open) => (
          <Button variant="secondary" size="lg" className="w-full" aria-expanded={open}>
            Other Actions
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </Button>
        )}
      >
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
      </Dropdown>
      <SummaryCard detail={detail} />
      <AssignedJobCard detail={detail} />
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
    </aside>
  );
}
