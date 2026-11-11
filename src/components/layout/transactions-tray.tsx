"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Download, History, RefreshCw } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { useFormat } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusPill } from "@/components/ui/status-pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/tooltip";
import { TRANSACTIONS_OPEN_EVENT, TRANSACTIONS_REFRESH_EVENT } from "@/lib/transactions-events";
import { HeaderIconButton } from "./header-icon-button";

export interface BackgroundTask {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: "queued" | "started" | "completed" | "error";
  readonly progress: number;
  readonly rowCount: number | null;
  readonly errorMessage: string | null;
  readonly fileId: string | null;
  readonly fileName: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export const TRANSACTIONS_QUERY_KEY = ["background-tasks"] as const;
export { TRANSACTIONS_REFRESH_EVENT } from "@/lib/transactions-events";
export const ACTIVE_POLL_MS = 5000;
const TRAY_PAGE_SIZE = 20;

const STATUS_LABEL: Readonly<Record<BackgroundTask["status"], string>> = {
  queued: "Queued",
  started: "Started",
  completed: "Completed",
  error: "Error",
};

export function isTaskActive(task: Pick<BackgroundTask, "status">): boolean {
  return task.status === "queued" || task.status === "started";
}

/** Finished (completed or failed) tasks can be cleared from the tray; running ones cannot. */
export function isTaskFinished(task: Pick<BackgroundTask, "status">): boolean {
  return task.status === "completed" || task.status === "error";
}

/** Tasks still shown after "Clear completed" (cleared ids are hidden unless still running). */
export function visibleTasks(tasks: readonly BackgroundTask[], cleared: ReadonlySet<string>): readonly BackgroundTask[] {
  return tasks.filter((task) => !cleared.has(task.id) || !isTaskFinished(task));
}

export const TRAY_CLEARED_STORAGE_KEY = "ks:transactions-cleared";
const MAX_CLEARED_IDS = 200;
export const NOTHING_TO_CLEAR_REASON = "No finished transactions to clear";
export const TRAY_RETRY_HINT = "Failed downloads can be retried from Excel Export History.";

function readCleared(): ReadonlySet<string> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(TRAY_CLEARED_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** Per-viewer "Clear completed" (a tray convenience; the tasks stay in Export History). */
function useClearedTasks(): readonly [ReadonlySet<string>, (ids: readonly string[]) => void] {
  // Cleared ids only affect the list inside the (client-only) popover and never the
  // badge, so reading storage in the initializer cannot cause a hydration mismatch.
  const [cleared, setCleared] = React.useState<ReadonlySet<string>>(() => (typeof window === "undefined" ? new Set() : readCleared()));
  const clear = React.useCallback((ids: readonly string[]) => {
    setCleared((previous) => {
      const next = new Set([...previous, ...ids].slice(-MAX_CLEARED_IDS));
      try {
        window.localStorage.setItem(TRAY_CLEARED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Storage blocked (private mode): the clear still applies for this session.
      }
      return next;
    });
  }, []);
  return [cleared, clear];
}

/** Tasks created today (local time) — Logiwa clears completed transactions daily. */
export function todaysTasks(tasks: readonly BackgroundTask[], now: Date = new Date()): readonly BackgroundTask[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return tasks.filter((task) => isTaskActive(task) || Date.parse(task.createdAt) >= start);
}

function TaskRow({ task }: { readonly task: BackgroundTask }) {
  const format = useFormat();
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
          <p className="text-2xs text-faint">
            {format.dateTime(task.createdAt)}
            {task.rowCount !== null ? ` · ${task.rowCount} rows` : ""}
          </p>
        </div>
        <StatusPill status={STATUS_LABEL[task.status]} domain="export" size="sm" />
      </div>
      {isTaskActive(task) ? <ProgressBar value={task.progress} size="sm" showValue label={`${task.title} progress`} /> : null}
      {task.status === "completed" ? <ProgressBar value={100} tone="success" size="sm" showValue label={`${task.title} progress`} /> : null}
      {task.status === "error" && task.errorMessage ? <p className="text-2xs text-danger">{task.errorMessage}</p> : null}
      {task.status === "completed" && task.fileId ? (
        <a href={`/api/files/${task.fileId}?download=1`} className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <Download className="h-3 w-3" aria-hidden />
          {task.fileName ?? "Download"}
        </a>
      ) : null}
    </li>
  );
}

/** Header Transactions tray: background imports/exports/bulk ops. Polls while one is active. */
export function TransactionsTray() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const tasks = useApiQuery<readonly BackgroundTask[]>(TRANSACTIONS_QUERY_KEY, "/api/background-tasks", {
    query: { ps: TRAY_PAGE_SIZE },
    refetchInterval: (q) => ((q.state.data?.data ?? []).some(isTaskActive) ? ACTIVE_POLL_MS : false),
  });

  React.useEffect(() => {
    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY });
    };
    const show = (): void => {
      refresh();
      setOpen(true);
    };
    window.addEventListener(TRANSACTIONS_REFRESH_EVENT, refresh);
    window.addEventListener(TRANSACTIONS_OPEN_EVENT, show);
    return () => {
      window.removeEventListener(TRANSACTIONS_REFRESH_EVENT, refresh);
      window.removeEventListener(TRANSACTIONS_OPEN_EVENT, show);
    };
  }, [queryClient]);

  const [cleared, clearTasks] = useClearedTasks();
  const list = visibleTasks(todaysTasks(tasks.data?.data ?? []), cleared);
  const activeCount = list.filter(isTaskActive).length;
  const finishedIds = list.filter(isTaskFinished).map((task) => task.id);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HeaderIconButton label="Transactions" badge={activeCount > 0 ? activeCount : undefined} pulse={activeCount > 0}>
          <History className="h-4 w-4" aria-hidden />
        </HeaderIconButton>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        tabIndex={-1}
        className="w-[360px] p-0 outline-none"
        // Focus the panel itself, not its first focusable child (the (i) tip), so the tooltip
        // does not auto-open over the task list.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
          <ArrowLeftRight className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">Transactions</h2>
          <InfoTip content="View the progress and status of your background tasks. Completed transactions are cleared daily." />
          <button type="button" aria-label="Refresh transactions" onClick={() => void tasks.refetch()} className="ml-auto rounded p-1 text-faint hover:bg-neutral-soft hover:text-secondary">
            <RefreshCw className={tasks.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden />
          </button>
        </div>
        {tasks.isLoading ? (
          <div className="space-y-2 p-3"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : tasks.isError ? (
          <div className="px-3 py-6 text-center text-xs text-danger">
            Could not load transactions.{" "}
            <button type="button" onClick={() => void tasks.refetch()} className="font-semibold underline">Retry</button>
          </div>
        ) : list.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-secondary">No background jobs today. Exports and imports appear here.</p>
        ) : (
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">{list.map((task) => <TaskRow key={task.id} task={task} />)}</ul>
        )}
        <div className="flex flex-col gap-2 border-t border-border bg-surface-sunken px-3 py-2.5">
          <p className="text-2xs text-secondary">{TRAY_RETRY_HINT}</p>
          <div className="flex items-center justify-between gap-2">
            <DisabledReason reason={finishedIds.length === 0 ? NOTHING_TO_CLEAR_REASON : null}>
              <Button size="sm" variant="secondary" disabled={finishedIds.length === 0} onClick={() => clearTasks(finishedIds)}>
                Clear completed
              </Button>
            </DisabledReason>
            <Link href="/reports/export-history" onClick={() => setOpen(false)} className={buttonVariants({ variant: "primary", size: "sm" })}>
              <History className="h-3.5 w-3.5" aria-hidden />
              Excel Export History
            </Link>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
