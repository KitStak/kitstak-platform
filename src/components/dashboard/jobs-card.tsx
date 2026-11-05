"use client";

import * as React from "react";
import Link from "next/link";
import { cn, formatNumber } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import type { JobsTableRow } from "@/components/dashboard/derive";

export interface JobsSummaryView {
  total: number;
  pending: number;
  inProgress: number;
  completedToday: number;
}

export interface JobsCardProps {
  summary: JobsSummaryView;
  rows: JobsTableRow[];
}

type JobDimension = "priority" | "status" | "type";

const DIMENSIONS: { key: JobDimension; label: string }[] = [
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "type", label: "Type" },
];

const ALL = "all";

function dimensionValue(row: JobsTableRow, dim: JobDimension): string {
  if (dim === "type") return row.jobType;
  if (dim === "status") return "In Progress";
  return "Standard";
}

function chipValues(rows: JobsTableRow[], dim: JobDimension): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = dimensionValue(row, dim);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[15px] font-bold tabular-nums text-foreground">
        {formatNumber(value)}
      </span>
      <span className="text-[11px] text-faint">{label}</span>
    </div>
  );
}

function PercentCell({ percent }: { percent: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1 w-20 overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            percent >= 100 ? "bg-success" : "bg-primary"
          )}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="w-9 text-right text-[12px] font-semibold tabular-nums text-secondary">
        {percent}%
      </span>
    </div>
  );
}

export function JobsCard({ summary, rows }: JobsCardProps) {
  const [dimension, setDimension] = React.useState<JobDimension>("priority");
  const [filter, setFilter] = React.useState<string>(ALL);

  const chips = React.useMemo(() => chipValues(rows, dimension), [rows, dimension]);
  const visible = React.useMemo(
    () => (filter === ALL ? rows : rows.filter((r) => dimensionValue(r, dimension) === filter)),
    [rows, dimension, filter]
  );

  const selectDimension = (next: JobDimension) => {
    setDimension(next);
    setFilter(ALL);
  };

  return (
    <Card>
      <CardHeader
        title="Jobs"
        description="Active pick, count and replenishment work across the floor"
        info
        action={
          <div className="flex items-center gap-5 pt-0.5">
            <SummaryStat label="In Progress" value={summary.inProgress} />
            <SummaryStat label="Pending" value={summary.pending} />
            <SummaryStat label="Completed Today" value={summary.completedToday} />
          </div>
        }
      />
      <div role="tablist" aria-label="Group jobs by" className="flex gap-5 border-b border-border px-5">
        {DIMENSIONS.map((d) => {
          const isActive = d.key === dimension;
          return (
            <button
              key={d.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => selectDimension(d.key)}
              className={cn(
                "-mb-px border-b-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.04em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-faint hover:border-border-strong hover:text-secondary"
              )}
            >
              {d.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 py-2.5">
        {[{ value: ALL, count: rows.length }, ...chips].map((chip) => {
          const isActive = chip.value === filter;
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => setFilter(chip.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isActive
                  ? "border-primary/40 bg-primary-soft text-primary"
                  : "border-border-strong/70 bg-surface text-secondary hover:bg-surface-sunken"
              )}
            >
              {chip.value === ALL ? "All" : chip.value}
              <span className={cn("tabular-nums", isActive ? "text-primary/70" : "text-faint")}>
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
              <th className="px-5 py-2 text-left font-semibold">Name</th>
              <th className="px-4 py-2 text-right font-semibold">Product Qty</th>
              <th className="px-4 py-2 text-right font-semibold">Order Qty</th>
              <th className="px-4 py-2 text-right font-semibold">Percentage</th>
              <th className="px-5 py-2 text-right font-semibold">Job Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-[12px] text-faint">
                  No jobs match this filter.
                </td>
              </tr>
            ) : (
              visible.map((job) => (
                <tr key={job.id} className="h-10 transition-colors hover:bg-surface-sunken">
                  <td className="px-5 py-1.5">
                    <Link
                      href="/jobs"
                      className="text-[13px] font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {job.code}
                    </Link>
                    <p className="text-[11px] leading-4 text-faint">
                      {job.jobType}
                      {job.assigneeName ? ` · ${job.assigneeName}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-1.5 text-right text-[13px] tabular-nums text-body">
                    {formatNumber(job.productQty)}
                  </td>
                  <td className="px-4 py-1.5 text-right text-[13px] tabular-nums text-body">
                    {job.orderQty === null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      formatNumber(job.orderQty)
                    )}
                  </td>
                  <td className="px-4 py-1.5">
                    <PercentCell percent={job.pctComplete} />
                  </td>
                  <td className="px-5 py-1.5 text-right text-[13px] font-medium tabular-nums text-foreground">
                    {formatNumber(job.jobQty)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-[11px] text-faint">
        <span>
          Showing <span className="font-medium tabular-nums text-secondary">{visible.length}</span>{" "}
          of <span className="font-medium tabular-nums text-secondary">{rows.length}</span> active
          jobs
        </span>
        <Link
          href="/jobs"
          className="font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Go to Job Management
        </Link>
      </div>
    </Card>
  );
}
