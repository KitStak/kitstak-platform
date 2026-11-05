"use client";

import * as React from "react";
import Link from "next/link";
import {
  BarChart3,
  Boxes,
  CalendarClock,
  ChevronDown,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  History,
  Layers,
  Loader2,
  RotateCcw,
  ScanBarcode,
  Search,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Breadcrumbs } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Consistent card inset. */
const CARD_INSET = "p-4";
/** Mocked pagination totals for the recent-runs table. */
const TOTAL_RUN_COUNT = 48;
const DEFAULT_RUNS_PAGE_SIZE = 12;
const PAGE_SIZE_OPTIONS = [12, 25, 50] as const;
/** Live in-progress run mock: baseline values the ticker advances from. */
const IN_PROGRESS_BASE_SECONDS = 52;
const IN_PROGRESS_BASE_ROWS = 2340;
const IN_PROGRESS_ROWS_PER_SECOND = 47;
/** Locale-pinned formatter so SSR and client render identical digits. */
const ROW_COUNT_FORMATTER = new Intl.NumberFormat("en-US");
/**
 * Canonical "Run by" value for system-initiated runs. Rendered with a small
 * clock glyph (not italics) so the system actor reads as a distinct entity
 * in the people column.
 */
const SYSTEM_RUN_ACTOR = "Scheduler";

interface AvailableReportDef {
  name: string;
  description: string;
  icon: LucideIcon;
  /** Soft icon-tile color classes. */
  tile: string;
  href: string;
  lastRun: string;
  rowCount: string;
  owner: string;
}

interface UpcomingReportDef {
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
}

const AVAILABLE_REPORTS: AvailableReportDef[] = [
  {
    name: "Inventory Snapshot",
    description:
      "Point-in-time on hand, allocated and damaged quantities for every SKU.",
    icon: Boxes,
    tile: "bg-primary-soft text-primary",
    href: "/reports/inventory-snapshot",
    lastRun: "11/5/2026 7:42 AM",
    rowCount: "1,192 rows",
    owner: "Operations",
  },
  {
    name: "Transaction History",
    description:
      "Every inbound receipt and outbound shipment with operator attribution.",
    icon: History,
    tile: "bg-info-soft text-info",
    href: "/reports/transaction-history",
    lastRun: "11/5/2026 7:38 AM",
    rowCount: "4,867 rows",
    owner: "Compliance",
  },
];

const UPCOMING_REPORTS: UpcomingReportDef[] = [
  {
    name: "Kit Inventory",
    description: "Component availability and buildable quantity for kit SKUs.",
    icon: Layers,
    category: "Inventory",
  },
  {
    name: "Serial Numbers",
    description: "Serial-tracked units with receipt and shipment lineage.",
    icon: ScanBarcode,
    category: "Inventory",
  },
  {
    name: "Shortage Report",
    description: "Order lines blocked by insufficient pickable inventory.",
    icon: TriangleAlert,
    category: "Fulfillment",
  },
  {
    name: "Channel Sales",
    description: "Shipped units and revenue by sales channel and store.",
    icon: BarChart3,
    category: "Fulfillment",
  },
  {
    name: "User Performance",
    description: "Picks, packs and counts completed per operator, per shift.",
    icon: UserRound,
    category: "Fulfillment",
  },
  {
    name: "Billing Export",
    description: "3PL billable activity rollup, ready for client invoicing.",
    icon: FileSpreadsheet,
    category: "Compliance",
  },
];

type RunStatus = "Completed" | "In Progress" | "Error";
type RunFormat = "CSV" | "XLSX";

interface ReportRunRow {
  report: string;
  format: RunFormat;
  fileSize: string;
  destination: string;
  runBy: string;
  started: string;
  duration: string;
  rows: string;
  status: RunStatus;
  /** Short diagnosis shown under the report name on failed runs. */
  errorReason?: string;
}

const RECENT_RUNS: ReportRunRow[] = [
  {
    report: "Transaction History",
    format: "XLSX",
    fileSize: "—",
    destination: "Email to Compliance",
    runBy: "S. Patel",
    started: "11/5/2026 7:44 AM",
    duration: "—",
    rows: "—",
    status: "In Progress",
  },
  {
    report: "Inventory Snapshot",
    format: "CSV",
    fileSize: "1.2 MB",
    destination: "Download",
    runBy: "M. Lunsford",
    started: "11/5/2026 7:42 AM",
    duration: "0:14",
    rows: "1,192",
    status: "Completed",
  },
  {
    report: "Transaction History",
    format: "XLSX",
    fileSize: "4.8 MB",
    destination: "Download",
    runBy: "M. Lunsford",
    started: "11/5/2026 7:38 AM",
    duration: "0:41",
    rows: "4,867",
    status: "Completed",
  },
  {
    report: "Inventory Snapshot",
    format: "CSV",
    fileSize: "1.2 MB",
    destination: "Email to Operations",
    runBy: SYSTEM_RUN_ACTOR,
    started: "11/5/2026 6:00 AM",
    duration: "0:13",
    rows: "1,185",
    status: "Completed",
  },
  {
    report: "Inventory Snapshot",
    format: "CSV",
    fileSize: "1.2 MB",
    destination: "Download",
    runBy: "S. Patel",
    started: "11/4/2026 4:15 PM",
    duration: "0:12",
    rows: "1,188",
    status: "Completed",
  },
  {
    report: "Transaction History",
    format: "XLSX",
    fileSize: "4.6 MB",
    destination: "Download",
    runBy: "D. Okafor",
    started: "11/4/2026 11:03 AM",
    duration: "0:36",
    rows: "4,712",
    status: "Completed",
  },
  {
    report: "Transaction History",
    format: "XLSX",
    fileSize: "—",
    destination: "Download",
    runBy: "D. Okafor",
    started: "11/3/2026 2:21 PM",
    duration: "0:04",
    rows: "—",
    status: "Error",
    errorReason: "Query timed out after 0:04",
  },
  {
    report: "Inventory Snapshot",
    format: "CSV",
    fileSize: "1.2 MB",
    destination: "Email to Operations",
    runBy: SYSTEM_RUN_ACTOR,
    started: "11/3/2026 6:00 AM",
    duration: "0:15",
    rows: "1,181",
    status: "Completed",
  },
  {
    report: "Transaction History",
    format: "XLSX",
    fileSize: "4.5 MB",
    destination: "Email to Compliance",
    runBy: SYSTEM_RUN_ACTOR,
    started: "11/2/2026 6:00 PM",
    duration: "0:38",
    rows: "4,655",
    status: "Completed",
  },
  {
    report: "Inventory Snapshot",
    format: "CSV",
    fileSize: "1.2 MB",
    destination: "Email to Operations",
    runBy: SYSTEM_RUN_ACTOR,
    started: "11/2/2026 6:00 AM",
    duration: "0:13",
    rows: "1,179",
    status: "Completed",
  },
  {
    report: "Transaction History",
    format: "XLSX",
    fileSize: "4.5 MB",
    destination: "Download",
    runBy: "M. Lunsford",
    started: "11/1/2026 3:47 PM",
    duration: "0:35",
    rows: "4,588",
    status: "Completed",
  },
  {
    report: "Inventory Snapshot",
    format: "CSV",
    fileSize: "1.1 MB",
    destination: "Email to Operations",
    runBy: SYSTEM_RUN_ACTOR,
    started: "11/1/2026 6:00 AM",
    duration: "0:14",
    rows: "1,176",
    status: "Completed",
  },
];

function SoonBadge() {
  return (
    <span className="inline-flex shrink-0 items-center self-center rounded-[4px] bg-warning-soft px-1.5 py-[2px] text-[10px] font-semibold uppercase leading-3 tracking-[0.06em] text-warning">
      Soon
    </span>
  );
}

/**
 * Single-row report card: icon + title/description on the left, run meta
 * in the center, and the run-report affordance on the right. No internal
 * footer divider — the whole card is one dense, clickable row.
 */
function AvailableReportCard({ report }: { report: AvailableReportDef }) {
  const Icon = report.icon;
  return (
    <Link
      href={report.href}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs",
        "transition-[border-color,box-shadow] duration-150 ease-out",
        "hover:border-primary/50 hover:shadow-[0_1px_3px_rgba(0,0,0,0.08)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          report.tile
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-semibold text-foreground">
          {report.name}
        </span>
        <span className="truncate text-[12px] leading-4 text-faint">
          {report.description}
        </span>
      </span>
      <span className="hidden shrink-0 flex-col items-end gap-0.5 whitespace-nowrap text-[11px] leading-4 text-faint xl:flex">
        <span>Last run {report.lastRun}</span>
        <span>
          <span className="tabular-nums">{report.rowCount}</span>
          <span aria-hidden> · </span>
          <span>Owner {report.owner}</span>
        </span>
      </span>
      <span
        className={cn(
          "inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-surface px-2.5",
          "text-[12px] font-semibold text-primary shadow-xs",
          "transition-colors duration-150 group-hover:border-primary/40 group-hover:bg-primary-soft/50"
        )}
      >
        Run report
      </span>
    </Link>
  );
}

function UpcomingReportCard({ report }: { report: UpcomingReportDef }) {
  const Icon = report.icon;
  return (
    <div
      aria-disabled="true"
      className={cn(
        "flex max-h-[120px] flex-col rounded-lg border border-border bg-surface opacity-60 shadow-xs",
        CARD_INSET
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-soft text-faint">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-h-4 items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-faint">
              {report.name}
            </span>
            <SoonBadge />
          </span>
          <span className="line-clamp-2 text-[12px] leading-4 text-faint">
            {report.description}
          </span>
        </span>
      </div>
      <div className="mt-auto pt-3 text-[11px] font-medium uppercase tracking-[0.04em] text-faint">
        {report.category}
      </div>
    </div>
  );
}

/**
 * Local status pill for report runs: every status renders at the same
 * 20px height and 92px minimum width with centered text so the STATUS
 * column rag stays clean. The in-progress spinner is 12px with a 4px gap,
 * and Error uses the dedicated danger treatment demanded by the design
 * review.
 */
const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  Completed: "border-transparent bg-success-soft text-success",
  "In Progress": "border-transparent bg-info-soft text-info",
  Error: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
};

function RunStatusPill({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-[92px] items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold leading-none",
        RUN_STATUS_STYLES[status]
      )}
    >
      {status === "In Progress" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : null}
      {status}
    </span>
  );
}

function RunActionsCell({ run }: { run: ReportRunRow }) {
  if (run.status === "Completed") {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Download ${run.report} run from ${run.started}`}
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
      </Button>
    );
  }
  if (run.status === "Error") {
    return (
      <Button
        variant="ghost"
        size="icon"
        title={
          run.errorReason
            ? `Retry — ${run.errorReason}`
            : "Retry this report run"
        }
        className="hover:bg-[#FEF3F2] hover:text-[#B42318]"
        aria-label={`Retry ${run.report} run from ${run.started}`}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled
      className="disabled:opacity-40"
      aria-label={`Download unavailable while ${run.report} run is in progress`}
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
    </Button>
  );
}

/** Formats whole seconds as m:ss. */
function formatRunDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Ticks once per second from a fixed baseline. */
function useTickingSeconds(baseSeconds: number): number {
  const [elapsed, setElapsed] = React.useState(baseSeconds);
  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsed((previous) => previous + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);
  return elapsed;
}

/**
 * Live duration + row-count cells for an in-flight run: a ticking m:ss
 * timer and an advancing streamed-row estimate instead of blank em-dashes.
 */
function InProgressMetricCells() {
  const elapsedSeconds = useTickingSeconds(IN_PROGRESS_BASE_SECONDS);
  const streamedRows =
    IN_PROGRESS_BASE_ROWS +
    (elapsedSeconds - IN_PROGRESS_BASE_SECONDS) * IN_PROGRESS_ROWS_PER_SECOND;
  return (
    <>
      <td className="px-4 text-right tabular-nums text-info">
        {formatRunDuration(elapsedSeconds)}
      </td>
      <td className="px-4 text-right tabular-nums text-info">
        ~{ROW_COUNT_FORMATTER.format(streamedRows)}
      </td>
    </>
  );
}

type ReportFilter = "all" | (typeof AVAILABLE_REPORTS)[number]["name"];
type StatusFilter = "all" | RunStatus;

interface RunFilters {
  report: ReportFilter;
  status: StatusFilter;
  query: string;
}

function filterRuns(
  runs: readonly ReportRunRow[],
  filters: RunFilters
): ReportRunRow[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return runs.filter((run) => {
    if (filters.report !== "all" && run.report !== filters.report) {
      return false;
    }
    if (filters.status !== "all" && run.status !== filters.status) {
      return false;
    }
    if (normalizedQuery.length > 0) {
      const haystack = [run.report, run.runBy, run.destination, run.format];
      return haystack.some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      );
    }
    return true;
  });
}

/** Slim filter toolbar rendered above the recent-runs grid. */
function RunsToolbar({
  filters,
  dateRange,
  onFiltersChange,
  onDateRangeChange,
}: {
  filters: RunFilters;
  dateRange: string;
  onFiltersChange: (next: RunFilters) => void;
  onDateRangeChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-sunken/30 px-3 py-2">
      <Select
        aria-label="Filter by report type"
        value={filters.report}
        onChange={(event) =>
          onFiltersChange({
            ...filters,
            report: event.target.value as ReportFilter,
          })
        }
        className="h-7 w-[180px] text-[12px]"
      >
        <option value="all">All reports</option>
        {AVAILABLE_REPORTS.map((report) => (
          <option key={report.name} value={report.name}>
            {report.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by status"
        value={filters.status}
        onChange={(event) =>
          onFiltersChange({
            ...filters,
            status: event.target.value as StatusFilter,
          })
        }
        className="h-7 w-[140px] text-[12px]"
      >
        <option value="all">All statuses</option>
        <option value="Completed">Completed</option>
        <option value="In Progress">In Progress</option>
        <option value="Error">Error</option>
      </Select>
      <Select
        aria-label="Filter by date range"
        value={dateRange}
        onChange={(event) => onDateRangeChange(event.target.value)}
        className="h-7 w-[150px] text-[12px]"
      >
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="mtd">Month to date</option>
        <option value="custom">Custom range…</option>
      </Select>
      <div className="relative ml-auto w-full min-w-[160px] sm:w-[220px]">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Search report runs"
          placeholder="Search runs…"
          value={filters.query}
          onChange={(event) =>
            onFiltersChange({ ...filters, query: event.target.value })
          }
          className="h-7 pl-7 text-[12px]"
        />
      </div>
    </div>
  );
}

function RecentRunsTable() {
  const [filters, setFilters] = React.useState<RunFilters>({
    report: "all",
    status: "all",
    query: "",
  });
  const [dateRange, setDateRange] = React.useState("7d");
  const [pageSize, setPageSize] = React.useState<number>(
    DEFAULT_RUNS_PAGE_SIZE
  );

  const visibleRuns = filterRuns(RECENT_RUNS, filters);
  const isFiltered =
    filters.report !== "all" ||
    filters.status !== "all" ||
    filters.query.trim().length > 0;
  const totalCount = isFiltered ? visibleRuns.length : TOTAL_RUN_COUNT;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showingLabel =
    visibleRuns.length === 0
      ? "No runs"
      : `Showing 1–${visibleRuns.length} of ${totalCount} runs`;

  return (
    <section aria-label="Recent report runs">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
          Recent report runs
        </h2>
        <div className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        <RunsToolbar
          filters={filters}
          dateRange={dateRange}
          onFiltersChange={setFilters}
          onDateRangeChange={setDateRange}
        />
        <table className="w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col />
            <col className="w-[76px]" />
            <col className="w-[90px]" />
            <col className="w-[180px]" />
            <col className="w-[140px]" />
            <col className="w-[172px]" />
            <col className="w-[76px]" />
            <col className="w-[84px]" />
            <col className="w-[116px]" />
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr className="h-10 border-b border-border bg-surface-sunken/50 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
              <th scope="col" className="px-4 font-semibold">
                Report
              </th>
              <th scope="col" className="px-4 font-semibold">
                Format
              </th>
              <th scope="col" className="px-4 text-right font-semibold">
                File size
              </th>
              <th scope="col" className="px-4 font-semibold">
                Destination
              </th>
              <th scope="col" className="px-4 font-semibold">
                Run by
              </th>
              <th scope="col" className="px-4 font-semibold">
                Started
              </th>
              <th scope="col" className="px-4 text-right font-semibold">
                Duration
              </th>
              <th scope="col" className="px-4 text-right font-semibold">
                Rows
              </th>
              <th scope="col" className="px-4 font-semibold">
                Status
              </th>
              <th scope="col" className="pr-4 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRuns.length === 0 ? (
              <tr className="h-20">
                <td colSpan={10} className="px-4 text-center text-faint">
                  No report runs match the current filters.
                </td>
              </tr>
            ) : (
              visibleRuns.map((run, index) => (
                <tr
                  key={`${run.report}-${run.started}-${index}`}
                  className="h-10 border-b border-border text-body transition-colors last:border-b-0 hover:bg-[#F8FAFC]"
                >
                  <td className="px-4 py-1.5">
                    <div className="truncate font-medium text-foreground">
                      {run.report}
                    </div>
                    {run.errorReason ? (
                      <div
                        className="truncate text-[12px] leading-4 text-danger"
                        title={run.errorReason}
                      >
                        {run.errorReason}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 text-[12px] font-medium tracking-[0.02em] text-faint">
                    {run.format}
                  </td>
                  <td className="px-4 text-right tabular-nums text-faint">
                    {run.fileSize}
                  </td>
                  <td className="truncate px-4">{run.destination}</td>
                  <td className="truncate px-4">
                    {run.runBy === SYSTEM_RUN_ACTOR ? (
                      <span className="inline-flex items-center gap-1 text-faint">
                        <Clock className="h-3 w-3 shrink-0" aria-hidden />
                        {run.runBy}
                      </span>
                    ) : (
                      run.runBy
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 tabular-nums">
                    {run.started}
                  </td>
                  {run.status === "In Progress" ? (
                    <InProgressMetricCells />
                  ) : (
                    <>
                      <td className="px-4 text-right tabular-nums">
                        {run.duration}
                      </td>
                      <td className="px-4 text-right tabular-nums">
                        {run.rows}
                      </td>
                    </>
                  )}
                  <td className="px-4">
                    <RunStatusPill status={run.status} />
                  </td>
                  <td className="pr-4 text-right">
                    <RunActionsCell run={run} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="flex h-10 items-center justify-between gap-3 border-t border-border bg-surface-sunken/30 px-4">
          <span className="text-[12px] text-faint">{showingLabel}</span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-faint">
              Rows per page
              <Select
                value={String(pageSize)}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-7 w-[64px] text-[12px]"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <span className="min-w-8 text-center text-[12px] tabular-nums text-body">
                1/{totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={totalPages <= 1}
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** How many upcoming report names the collapsed strip previews. */
const COMING_SOON_PREVIEW_COUNT = 3;

function formatComingSoonPreview(reports: readonly UpcomingReportDef[]): string {
  const previewNames = reports
    .slice(0, COMING_SOON_PREVIEW_COUNT)
    .map((report) => report.name)
    .join(", ");
  const remainingCount = reports.length - COMING_SOON_PREVIEW_COUNT;
  return remainingCount > 0
    ? `${previewNames} +${remainingCount} more`
    : previewNames;
}

function ComingSoonSection() {
  const [isExpanded, setIsExpanded] = React.useState(false);
  return (
    <section aria-label="Coming soon">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls="coming-soon-grid"
        onClick={() => setIsExpanded((previous) => !previous)}
        className="group flex w-full items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint transition-colors group-hover:text-secondary">
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              isExpanded ? "rotate-0" : "-rotate-90"
            )}
            aria-hidden
          />
          Coming soon
        </span>
        <span className="inline-flex shrink-0 items-center rounded bg-[#EEF2F7] px-1.5 py-px text-[10px] font-semibold tabular-nums normal-case tracking-normal text-[#475467]">
          {UPCOMING_REPORTS.length}
        </span>
        {isExpanded ? null : (
          <span className="min-w-0 truncate text-[12px] normal-case tracking-normal text-faint">
            {formatComingSoonPreview(UPCOMING_REPORTS)}
          </span>
        )}
        <span className="h-px min-w-6 flex-1 bg-border" aria-hidden />
      </button>
      {isExpanded ? (
        <div
          id="coming-soon-grid"
          className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {UPCOMING_REPORTS.map((report) => (
            <UpcomingReportCard key={report.name} report={report} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReportsHeader() {
  return (
    <div className="px-6 pt-3">
      <Breadcrumbs items={[{ label: "Reports" }]} />
      <div className="mt-1.5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
            Reports
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-faint">
            Operational, inventory and compliance reporting for MLT1 – Main
            Fulfillment
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            Scheduled Exports
          </Button>
          <Button variant="primary">Create Custom Report</Button>
        </div>
      </div>
    </div>
  );
}

export function ReportsHubPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReportsHeader />
      <div className="ks-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-5">
        <div className="flex flex-col gap-7">
          <section aria-label="Available reports">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                Available reports
              </h2>
              <div className="h-px flex-1 bg-border" aria-hidden />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {AVAILABLE_REPORTS.map((report) => (
                <AvailableReportCard key={report.name} report={report} />
              ))}
            </div>
          </section>
          <RecentRunsTable />
          <ComingSoonSection />
        </div>
      </div>
    </div>
  );
}
