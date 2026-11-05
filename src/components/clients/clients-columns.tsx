"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ClientListRow } from "@/server/repositories/clients";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
import {
  ClientAvatar,
  ClientRowActions,
  ContactCell,
  PlanChip,
  displayClientCode,
  displayPhone,
} from "./client-cells";

/**
 * Inactive clients render dormant: every text cell in the row drops to
 * slate-400 so the record reads as muted at a glance, not just the pill.
 */
function isInactive(row: ClientListRow): boolean {
  return row.status === "Inactive";
}

function NumberCell({
  value,
  dimZero,
  muted,
}: {
  value: number;
  dimZero?: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "block w-full pr-3 text-right tabular-nums",
        muted ? "text-slate-400" : dimZero && value === 0 ? "text-faint" : "text-body"
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
      <span
        className={cn(
          "cursor-pointer font-medium hover:underline",
          isInactive(row.original) ? "text-slate-400" : "text-primary"
        )}
      >
        {displayClientCode(row.original.code)}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 230,
    cell: ({ row }) => {
      const muted = isInactive(row.original);
      return (
        <span className="flex min-w-0 items-center gap-2.5">
          <ClientAvatar name={row.original.name} muted={muted} />
          <span
            className={cn(
              "truncate text-[13px] font-medium",
              muted ? "text-slate-400" : "text-foreground"
            )}
          >
            {row.original.name}
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: "contactName",
    header: "Contact",
    size: 210,
    cell: ({ row }) => (
      <ContactCell
        name={row.original.contactName}
        email={row.original.contactEmail}
        muted={isInactive(row.original)}
      />
    ),
  },
  {
    accessorKey: "phone",
    header: "Phone",
    size: 136,
    // tabular-nums keeps digit columns aligned; letter-spacing is pinned to
    // normal so the plain "-" separator sits tight: "(312) 241-8142".
    cell: ({ row }) => (
      <span
        className={cn(
          "tabular-nums [letter-spacing:normal]",
          isInactive(row.original) ? "text-slate-400" : "text-secondary"
        )}
      >
        {displayPhone(row.original.phone, row.original.code)}
      </span>
    ),
  },
  {
    accessorKey: "billingPlan",
    header: "Billing Plan",
    size: 130,
    cell: ({ row }) => (
      <PlanChip plan={row.original.billingPlan} muted={isInactive(row.original)} />
    ),
  },
  {
    accessorKey: "productCount",
    header: "Products",
    size: 92,
    cell: ({ row }) => (
      <NumberCell value={row.original.productCount} muted={isInactive(row.original)} />
    ),
  },
  {
    accessorKey: "openOrders",
    header: "Open Orders",
    size: 108,
    // An inactive client cannot have open orders. The seed (read-only shared
    // foundation) still carries a nonzero count for Pixel & Pine, so we clamp
    // to 0 at display time; the durable fix is zeroing it in seed data — see
    // the shared-component request accompanying this change.
    cell: ({ row }) => (
      <NumberCell
        value={isInactive(row.original) ? 0 : row.original.openOrders}
        dimZero
        muted={isInactive(row.original)}
      />
    ),
  },
  {
    accessorKey: "totalOrders",
    header: "Total Orders",
    size: 108,
    cell: ({ row }) => (
      <NumberCell value={row.original.totalOrders} muted={isInactive(row.original)} />
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 96,
    cell: ({ row }) => <StatusPill status={row.original.status} />,
  },
  {
    accessorKey: "createdAt",
    header: "Client Since",
    size: 118,
    cell: ({ row }) => (
      <span className={isInactive(row.original) ? "text-slate-400" : "text-secondary"}>
        {formatDate(row.original.createdAt)}
      </span>
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
