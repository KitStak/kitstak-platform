"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { cn, formatDate, formatMoney, formatNumber } from "@/lib/utils";
import { ChannelBadge } from "@/components/ui/status-pill";
import { OrderPriorityPill } from "./order-priority-pill";
import { OrderStatusPill } from "./order-status-pill";
import type { OrderRow } from "./orders-types";

const TERMINAL_STATUSES = ["Shipped", "Delivered", "Cancelled"];

function isOverdue(row: OrderRow): boolean {
  if (!row.expectedShipDate || row.shippedAt) return false;
  if (TERMINAL_STATUSES.includes(row.status)) return false;
  const expected = new Date(row.expectedShipDate).getTime();
  return !Number.isNaN(expected) && expected < Date.now();
}

/** Column set for the Shipment Orders grid, matching the Logiwa reference layout. */
export function buildOrderColumns(): ColumnDef<OrderRow, unknown>[] {
  return [
    {
      accessorKey: "code",
      header: "Order Code",
      size: 120,
      cell: ({ row }) => (
        <Link
          href={`/orders/${row.original.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.original.code}
        </Link>
      ),
    },
    {
      accessorKey: "channel",
      header: "Store / Channel",
      size: 190,
      enableSorting: false,
      cell: ({ row }) => (
        <ChannelBadge channel={row.original.channel} store={row.original.storeName} />
      ),
    },
    {
      accessorKey: "storeOrderNumber",
      header: "Store Order #",
      size: 130,
      cell: ({ row }) =>
        row.original.storeOrderNumber ? (
          <span className="tabular-nums text-secondary">
            {row.original.storeOrderNumber}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      accessorKey: "customerName",
      header: "Customer",
      size: 180,
      cell: ({ row }) => (
        <span className="flex max-w-[200px] flex-col leading-tight">
          <span className="truncate text-body">{row.original.customerName}</span>
          <span className="truncate text-[11px] text-faint">
            {row.original.shipCity}, {row.original.shipState}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "clientName",
      header: "Client",
      size: 160,
      cell: ({ row }) => (
        <span className="block max-w-[180px] truncate text-body">
          {row.original.clientName}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 130,
      cell: ({ row }) => <OrderStatusPill status={row.original.status} />,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      size: 90,
      cell: ({ row }) => <OrderPriorityPill priority={row.original.priority} />,
    },
    {
      accessorKey: "totalQuantity",
      header: "Items",
      size: 70,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums text-body">
          {formatNumber(row.original.totalQuantity)}
        </span>
      ),
    },
    {
      accessorKey: "firstSku",
      header: "SKUs",
      size: 170,
      enableSorting: false,
      cell: ({ row }) => {
        const { firstSku, skuCount } = row.original;
        if (!firstSku || skuCount === 0) {
          return <span className="text-faint">—</span>;
        }
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className="max-w-[150px] truncate text-[12px] text-secondary">
              {firstSku}
            </span>
            {skuCount > 1 ? (
              <span className="rounded-full bg-neutral-soft px-1.5 py-px text-[10px] font-semibold tabular-nums text-neutral">
                +{skuCount - 1}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      accessorKey: "salesPrice",
      header: "Total",
      size: 90,
      cell: ({ row }) => (
        <span className="block text-right font-medium tabular-nums text-body">
          {formatMoney(row.original.salesPrice)}
        </span>
      ),
    },
    {
      accessorKey: "carrier",
      header: "Carrier / Service",
      size: 180,
      cell: ({ row }) => {
        const { carrier, shippingService } = row.original;
        if (!carrier) return <span className="text-faint">—</span>;
        return (
          <span className="flex max-w-[200px] flex-col leading-tight">
            <span className="truncate text-[12px] font-medium text-body">{carrier}</span>
            {shippingService ? (
              <span className="truncate text-[11px] text-faint">{shippingService}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      accessorKey: "orderDate",
      header: "Order Date",
      size: 110,
      cell: ({ row }) => (
        <span className="text-secondary">{formatDate(row.original.orderDate)}</span>
      ),
    },
    {
      accessorKey: "expectedShipDate",
      header: "Expected Ship",
      size: 120,
      cell: ({ row }) => {
        const overdue = isOverdue(row.original);
        return (
          <span className={cn(overdue ? "font-medium text-danger" : "text-secondary")}>
            {formatDate(row.original.expectedShipDate)}
          </span>
        );
      },
    },
  ];
}
