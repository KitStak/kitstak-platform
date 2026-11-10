"use client";

/**
 * Job Management `/jobs` (Logiwa 02 §1): 32 columns, 31 typed filters, default chip
 * "Job status in Pending, Started", and the bulk menus. Job code opens `/jobs/[id]`
 * (Logiwa has no job page).
 */
import * as React from "react";
import { CalendarClock, Workflow } from "lucide-react";
import { LinkCell } from "@/components/grid/cells";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityFlag } from "@/components/ui/status-pill";
import { JOB_COLUMNS, exportColumns } from "@/lib/grid-defs/jobs/columns";
import { JOB_DEFAULT_FILTER, JOBS_GRID } from "@/lib/grid-defs/jobs/jobs";
import { buildColumns, Dash, textCell } from "./grid-columns";
import { JobActions, type JobFacts } from "./job-actions";
import type { GridRow } from "./jobs-client";
import { ListShell } from "./list-shell";

export type JobRow = GridRow & JobFacts & { readonly waveId: string | null; readonly waveNumber: string | null };

function LabelPill({ value }: { readonly value: unknown }) {
  const v = String(value ?? "");
  if (!v) return <Dash />;
  const tone = v === "Labeled" || v === "Printed" ? "bg-[#D3F0E3] text-[#17874D]" : v.startsWith("Partially") ? "bg-[#FFF3D6] text-[#9A6700]" : "bg-[#E3E6E8] text-[#50575C]";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${tone}`}>{v}</span>;
}

const COLUMNS = buildColumns<JobRow>(JOB_COLUMNS, {
  primary: "code",
  cells: {
    code: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <LinkCell href={`/jobs/${encodeURIComponent(row.original.id)}`}>{String(row.original.code)}</LinkCell>
        {row.original.priority === "High" || row.original.priority === "Urgent" ? <PriorityFlag priority={String(row.original.priority)} /> : null}
        {Number(row.original.hasPickShort) ? <span className="rounded-full bg-[#F7E9E4] px-1.5 text-[10px] font-semibold text-[#A13406]" title="Open pick short">Short</span> : null}
      </span>
    ),
    waveNumber: ({ row }) => (row.original.waveNumber ? <LinkCell href={`/jobs/wave-log?q=${encodeURIComponent(String(row.original.waveNumber))}&qm=eq`}>{String(row.original.waveNumber)}</LinkCell> : <Dash />),
    labelStatus: ({ getValue }) => <LabelPill value={getValue()} />,
    pickListStatus: ({ getValue }) => <LabelPill value={getValue()} />,
    ruleName: ({ getValue }) => textCell(getValue()),
  },
});

const EXPORT = exportColumns(JOB_COLUMNS);

export function JobsListPage() {
  return (
    <ListShell<JobRow>
      title="Jobs"
      helper="Create jobs with wave rules, then prioritise, assign, label and print them here."
      tabs="jobs"
      gridKey={JOBS_GRID.gridKey}
      path="/api/jobs"
      fields={JOBS_GRID.fields}
      columns={COLUMNS}
      exportColumns={EXPORT}
      searchPlaceholder={JOBS_GRID.searchPlaceholder}
      defaultFilters={[JOB_DEFAULT_FILTER]}
      noun="job"
      rowHref={(row) => `/jobs/${encodeURIComponent(row.id)}`}
      trailing={({ selected, refresh }) => <JobActions jobs={selected} onChanged={refresh} />}
      emptyTitle="No open jobs"
      emptyDescription="Jobs are created when a wave rule runs or when orders are allocated manually."
      emptyAction={
        <EmptyState
          compact
          title=""
          cards={[
            { title: "Run a wave rule", description: "Select orders by your rules and turn them into jobs.", icon: Workflow, href: "/jobs/wave-rules" },
            { title: "Check the wave log", description: "See what the last waves met, allocated and created.", icon: CalendarClock, href: "/jobs/wave-log" },
          ]}
        />
      }
    />
  );
}
