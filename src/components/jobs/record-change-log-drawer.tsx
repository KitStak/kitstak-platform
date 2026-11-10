"use client";

/**
 * Change Log drawer for records the shared `/api/change-log` endpoint does not list
 * (wave rules, job types). Same layout as the shared `ChangeLogDrawer`, but pages
 * through the record's own `GET <path>?page&ps` endpoint
 * (e.g. `/api/wave-rules/[id]/change-log`), which also enforces the record's permission.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, FilePlus2, PencilLine, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { changeLogEntrySchema, changeLogMessage, parseList } from "@/components/shared";

const CHANGE_LOG_PAGE_SIZE = 20;

const TYPE_META = {
  Create: { icon: FilePlus2, tile: "bg-success-soft text-success", label: "Created" },
  Update: { icon: PencilLine, tile: "bg-info-soft text-info", label: "Updated" },
  Delete: { icon: Trash2, tile: "bg-danger-soft text-danger", label: "Deleted" },
} as const;

export interface RecordChangeLogDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The record's change-log endpoint, e.g. `/api/job-types/<id>/change-log`. */
  readonly path: string;
  /** Record code shown in the title, e.g. "SO000123". */
  readonly entityCode?: string;
}

export function RecordChangeLogDrawer({ open, onOpenChange, path, entityCode }: RecordChangeLogDrawerProps) {
  const fmt = useFormat();
  const [page, setPage] = React.useState(1);
  const query = useApiQuery<unknown>(["record-change-log", path, page], open ? path : null, {
    query: { page, ps: CHANGE_LOG_PAGE_SIZE },
    placeholderData: (prev) => prev,
  });
  const entries = parseList(changeLogEntrySchema, query.data?.data);
  const total = query.data?.meta?.total ?? entries.length;
  const pageCount = Math.max(1, Math.ceil(total / CHANGE_LOG_PAGE_SIZE));

  return (
    <Drawer open={open} onOpenChange={onOpenChange} width={60} title={entityCode ? `Change log · ${entityCode}` : "Change log"} description="Every change to this record, newest first.">
      {query.isPending ? (
        <SkeletonTable rows={8} columns={4} />
      ) : query.error ? (
        <EmptyState title="Could not load the change log" description={query.error.message} action={<Button onClick={() => void query.refetch()}>Retry</Button>} compact />
      ) : entries.length === 0 ? (
        <EmptyState title="No changes recorded yet" description="Creates, edits and deletes will appear here." compact />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                <tr>
                  <th scope="col" className="w-14 px-3 py-2">Type</th>
                  <th scope="col" className="px-3 py-2">Message</th>
                  <th scope="col" className="w-44 px-3 py-2">Operation date</th>
                  <th scope="col" className="w-48 px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const meta = TYPE_META[entry.type];
                  const Icon = meta.icon;
                  return (
                    <tr key={entry.id} className="border-t border-border align-top">
                      <td className="px-3 py-2.5">
                        <span title={meta.label} className={cn("flex h-7 w-7 items-center justify-center rounded-md", meta.tile)}>
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only">{meta.label}</span>
                        </span>
                      </td>
                      <td className="break-words px-3 py-2.5 text-body">{changeLogMessage(entry)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-secondary">{fmt.dateTime(entry.at)}</td>
                      <td className="truncate px-3 py-2.5 text-secondary" title={entry.source}>
                        {entry.source}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-[12px] text-secondary">
            <span>
              {fmt.number((page - 1) * CHANGE_LOG_PAGE_SIZE + 1)}–{fmt.number(Math.min(page * CHANGE_LOG_PAGE_SIZE, total))} of {fmt.number(total)}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <span className="tabular-nums">
                {page} / {pageCount}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
