"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { PriorityFlag, StatusPill } from "@/components/ui/status-pill";
import {
  AssigneeCell,
  JobCode,
  ProgressCell,
  warehouseOf,
  type JobListRow,
} from "./jobs-shared";

function Dash() {
  return <span className="text-[12px] text-faint">—</span>;
}

/** Column set for the Job Management grid — mirrors the Logiwa jobs grid. */
export const JOB_COLUMNS: ColumnDef<JobListRow, unknown>[] = [
  {
    id: "warehouse",
    header: "Warehouse",
    enableSorting: false,
    size: 170,
    cell: ({ row }) => (
      <span className="text-[13px] text-body">{warehouseOf(row.original.code)}</span>
    ),
  },
  {
    accessorKey: "clientName",
    header: "Client",
    size: 150,
    cell: ({ row }) =>
      row.original.clientName ? (
        <span className="block max-w-[150px] truncate text-[13px] text-body">
          {row.original.clientName}
        </span>
      ) : (
        <Dash />
      ),
  },
  {
    accessorKey: "waveNumber",
    header: "Wave No",
    size: 100,
    cell: ({ row }) =>
      row.original.waveNumber ? (
        <span className="text-[13px] tabular-nums text-body">
          {row.original.waveNumber}
        </span>
      ) : (
        <Dash />
      ),
  },
  {
    accessorKey: "ruleName",
    header: "Rule Name",
    size: 160,
    cell: ({ row }) =>
      row.original.ruleName ? (
        <span className="block max-w-[160px] truncate text-[13px] text-body">
          {row.original.ruleName}
        </span>
      ) : (
        <Dash />
      ),
  },
  {
    accessorKey: "code",
    header: "Job Code",
    size: 120,
    cell: ({ row }) => <JobCode code={row.original.code} />,
  },
  {
    accessorKey: "jobType",
    header: "Job Type",
    size: 170,
    cell: ({ row }) => (
      <span className="block max-w-[170px] truncate text-[13px] text-body">
        {row.original.jobType}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 110,
    cell: ({ row }) => <StatusPill status={row.original.status} />,
  },
  {
    accessorKey: "priority",
    header: "Priority",
    size: 90,
    cell: ({ row }) => <PriorityFlag priority={row.original.priority} />,
  },
  {
    accessorKey: "orderCount",
    header: "Orders",
    size: 72,
    cell: ({ row }) => (
      <span className="block text-right text-[13px] tabular-nums text-body">
        {formatNumber(row.original.orderCount)}
      </span>
    ),
  },
  {
    accessorKey: "unitCount",
    header: "Units",
    size: 72,
    cell: ({ row }) => (
      <span className="block text-right text-[13px] tabular-nums text-body">
        {formatNumber(row.original.unitCount)}
      </span>
    ),
  },
  {
    id: "progress",
    header: "Progress",
    enableSorting: false,
    size: 130,
    cell: ({ row }) => (
      <ProgressCell
        completed={row.original.completedUnits}
        total={row.original.unitCount}
      />
    ),
  },
  {
    accessorKey: "assigneeName",
    header: "Assigned To",
    size: 160,
    cell: ({ row }) => <AssigneeCell name={row.original.assigneeName} />,
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    size: 150,
    cell: ({ row }) => (
      <span className="text-[12px] tabular-nums text-secondary">
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
  },
];
