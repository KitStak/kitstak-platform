"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ClientListRow } from "@/server/repositories/clients";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
import { ClientAvatar, ClientRowActions, ContactCell, PlanChip } from "./client-cells";

function NumberCell({ value, dimZero }: { value: number; dimZero?: boolean }) {
  return (
    <span
      className={cn(
        "block w-full pr-3 text-right tabular-nums",
        dimZero && value === 0 ? "text-faint" : "text-body"
      )}
    >
      {formatNumber(value)}
    </span>
  );
}

export const CLIENT_COLUMNS: ColumnDef<ClientListRow, unknown>[] = [
  {
    accessorKey: "code",
    header: "Client Code",
    size: 112,
    cell: ({ row }) => (
      <span className="cursor-pointer font-medium text-primary hover:underline">
        {row.original.code}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 230,
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <ClientAvatar name={row.original.name} />
        <span className="truncate text-[13px] font-medium text-foreground">
          {row.original.name}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "contactName",
    header: "Contact",
    size: 210,
    cell: ({ row }) => (
      <ContactCell name={row.original.contactName} email={row.original.contactEmail} />
    ),
  },
  {
    accessorKey: "phone",
    header: "Phone",
    size: 136,
    cell: ({ row }) => (
      <span className="tabular-nums text-secondary">{row.original.phone}</span>
    ),
  },
  {
    accessorKey: "billingPlan",
    header: "Billing Plan",
    size: 130,
    cell: ({ row }) => <PlanChip plan={row.original.billingPlan} />,
  },
  {
    accessorKey: "productCount",
    header: "Products",
    size: 92,
    cell: ({ row }) => <NumberCell value={row.original.productCount} />,
  },
  {
    accessorKey: "openOrders",
    header: "Open Orders",
    size: 108,
    cell: ({ row }) => <NumberCell value={row.original.openOrders} dimZero />,
  },
  {
    accessorKey: "totalOrders",
    header: "Total Orders",
    size: 108,
    cell: ({ row }) => <NumberCell value={row.original.totalOrders} />,
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 96,
    cell: ({ row }) => <StatusPill status={row.original.status} />,
  },
  {
    accessorKey: "createdAt",
    header: "Since",
    size: 110,
    cell: ({ row }) => (
      <span className="text-secondary">{formatDate(row.original.createdAt)}</span>
    ),
  },
  {
    id: "actions",
    header: "",
    size: 44,
    enableSorting: false,
    cell: ({ row }) => <ClientRowActions name={row.original.name} />,
  },
];
