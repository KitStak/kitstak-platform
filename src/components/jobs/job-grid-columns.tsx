"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
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

/**
 * Column set for the Job Management grid — mirrors the Logiwa jobs grid.
 *
 * Header strings are pre-uppercased: sortable headers render inside a
 * <button>, and Tailwind preflight resets `text-transform` on buttons, so
 * the grid's `uppercase` header class never reaches them. Uppercasing the
 * strings keeps every header consistent (11px / 0.04em tracking / faint
 * color come from the shared grid header cell) while still letting the
 * grid treat headers as plain strings for CSV export and column toggles.
 *
 * Priority is intentionally not in the default column set: current seed
 * data gives almost every job "None", so the column reads as dead. It can
 * return once jobs carry real priority values (see sharedComponentRequests).
 */
export const JOB_COLUMNS: ColumnDef<JobListRow, unknown>[] = [
  {
    id: "warehouse",
    header: "WAREHOUSE",
    enableSorting: false,
    size: 170,
    cell: ({ row }) => (
      <span className="text-[13px] text-body">{warehouseOf(row.original.code)}</span>
    ),
  },
  {
    accessorKey: "clientName",
    header: "CLIENT",
    /* 130 (was 150): Client has slack at 1440px; the 20px moved to Rule Name
       so the distinguishing rule suffix survives truncation. */
    size: 130,
    cell: ({ row }) =>
      row.original.clientName ? (
        <span
          className="block max-w-[130px] truncate text-[13px] text-body"
          title={row.original.clientName}
        >
          {row.original.clientName}
        </span>
      ) : (
        <Dash />
      ),
  },
  {
    accessorKey: "waveNumber",
    header: "WAVE NO",
    size: 100,
    cell: ({ row }) =>
      row.original.waveNumber ? (
        /* tracking-normal + tabular-nums: both code columns (Wave No and Job
           Code) must set identically — no letter-spacing utility anywhere. */
        <span className="text-[13px] tabular-nums tracking-normal text-body">
          {row.original.waveNumber}
        </span>
      ) : (
        <Dash />
      ),
  },
  {
    accessorKey: "ruleName",
    header: "RULE NAME",
    /* 180 (was 160, slack taken from Client): CSS truncation only — never
       string-slice. title= gives the full rule name as a tooltip, and the
       extra width lets "Weekly Cycle Count — Zone…" keep its distinguishing
       suffix at 1440px instead of clipping right after the em dash. */
    size: 180,
    cell: ({ row }) =>
      row.original.ruleName ? (
        <span
          className="block max-w-[180px] truncate text-[13px] text-body"
          title={row.original.ruleName}
        >
          {row.original.ruleName}
        </span>
      ) : (
        <Dash />
      ),
  },
  {
    accessorKey: "code",
    header: "JOB CODE",
    size: 120,
    cell: ({ row }) => <JobCode code={row.original.code} />,
  },
  {
    accessorKey: "jobType",
    header: "JOB TYPE",
    size: 170,
    cell: ({ row }) => (
      <span className="block max-w-[170px] truncate text-[13px] text-body">
        {row.original.jobType}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "STATUS",
    size: 110,
    cell: ({ row }) => <StatusPill status={row.original.status} />,
  },
  {
    accessorKey: "orderCount",
    header: "ORDERS",
    size: 72,
    cell: ({ row }) => (
      <span className="block text-right text-[13px] tabular-nums text-body">
        {formatNumber(row.original.orderCount)}
      </span>
    ),
  },
  {
    accessorKey: "unitCount",
    header: "UNITS",
    size: 72,
    cell: ({ row }) => (
      <span className="block text-right text-[13px] tabular-nums text-body">
        {formatNumber(row.original.unitCount)}
      </span>
    ),
  },
  {
    id: "progress",
    header: "PROGRESS",
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
    header: "ASSIGNED TO",
    size: 160,
    cell: ({ row }) => <AssigneeCell name={row.original.assigneeName} />,
  },
  {
    accessorKey: "createdAt",
    header: "CREATED",
    size: 150,
    cell: ({ row }) => (
      <span className="text-[12px] tabular-nums text-secondary">
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
  },
];
