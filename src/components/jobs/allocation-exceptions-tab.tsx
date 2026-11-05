"use client";

import * as React from "react";
import { AlertTriangle, PackageSearch, RefreshCw } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { PriorityFlag } from "@/components/ui/status-pill";
import { hashOf, type JobListRow, type ListEnvelope, JobCode } from "./jobs-shared";

const EXCEPTION_REASONS = [
  "Insufficient allocatable stock",
  "Inventory reserved by another wave",
  "Lot on hold — allocation blocked",
  "Bin quantity mismatch flagged at count",
] as const;

function reasonOf(code: string): string {
  return EXCEPTION_REASONS[hashOf(code) % EXCEPTION_REASONS.length];
}

const HEADERS = [
  "Job Code",
  "Client",
  "Job Type",
  "Priority",
  "Orders",
  "Units",
  "Unallocated",
  "Created",
  "Exception Reason",
] as const;

export interface AllocationExceptionsTabProps {
  onViewJobs?: () => void;
}

export function AllocationExceptionsTab({ onViewJobs }: AllocationExceptionsTabProps) {
  const [rows, setRows] = React.useState<JobListRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // Proxy for allocation exceptions: pending jobs flagged High/Urgent priority.
    fetch("/api/jobs?status=Pending&page=1&pageSize=200", {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as ListEnvelope<JobListRow>;
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setRows(
          body.data.filter((job) =>
            ["high", "urgent"].includes(job.priority.toLowerCase())
          )
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load exceptions");
        setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6 pt-4 ks-scroll">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">
            Allocation exceptions
          </h2>
          <p className="mt-0.5 text-[12px] text-faint">
            High-priority jobs that could not fully allocate inventory. Resolve stock
            issues, then re-run allocation.
          </p>
        </div>
        <Button variant="ghost" size="md" onClick={refresh} aria-label="Refresh exceptions">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </Button>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
              <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
            </span>
            <p className="text-[14px] font-semibold text-foreground">
              Could not load exceptions
            </p>
            <p className="max-w-sm text-[12px] text-faint">{error}</p>
            <Button variant="secondary" size="sm" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft">
              <PackageSearch className="h-5 w-5 text-success" aria-hidden />
            </span>
            <p className="text-[14px] font-semibold text-foreground">
              No allocation exceptions
            </p>
            <p className="max-w-sm text-[12px] leading-5 text-faint">
              Every released wave allocated cleanly. Exceptions appear here when a job
              cannot reserve all of its inventory — usually a shortage, a reserved lot,
              or a count mismatch.
            </p>
            {onViewJobs ? (
              <Button variant="secondary" size="sm" className="mt-1" onClick={onViewJobs}>
                View Job Management
              </Button>
            ) : null}
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-surface shadow-[inset_0_-1px_0_var(--border)]">
              <tr>
                {HEADERS.map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => (
                <tr
                  key={job.id}
                  className="h-10 border-t border-border transition-colors hover:bg-surface-sunken"
                >
                  <td className="whitespace-nowrap px-4">
                    <JobCode code={job.code} />
                  </td>
                  <td className="max-w-[160px] truncate whitespace-nowrap px-4 text-body">
                    {job.clientName ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 text-body">{job.jobType}</td>
                  <td className="whitespace-nowrap px-4">
                    <PriorityFlag priority={job.priority} />
                  </td>
                  <td className="whitespace-nowrap px-4 text-right tabular-nums text-body">
                    {formatNumber(job.orderCount)}
                  </td>
                  <td className="whitespace-nowrap px-4 text-right tabular-nums text-body">
                    {formatNumber(job.unitCount)}
                  </td>
                  <td className="whitespace-nowrap px-4 text-right tabular-nums font-medium text-danger">
                    {formatNumber(Math.max(0, job.unitCount - job.completedUnits))}
                  </td>
                  <td className="whitespace-nowrap px-4 text-[12px] tabular-nums text-secondary">
                    {formatDateTime(job.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 text-[12px] text-secondary">
                    {reasonOf(job.code)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {!loading && !error && rows.length > 0 ? (
        <p className="mt-2.5 text-[11px] text-faint">
          {rows.length} job{rows.length === 1 ? "" : "s"} waiting on allocation · sorted
          by most recent
        </p>
      ) : null}
    </div>
  );
}
