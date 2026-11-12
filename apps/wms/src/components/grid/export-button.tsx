"use client";

/**
 * Export As Excel (BUILD_PLAN F4.3). Queues an async export through `POST /api/exports`
 * `{ gridKey, query, columns? }`; the file lands in the header Transactions tray and in
 * Export History. Paging params are stripped: the export covers every matching row.
 */
import * as React from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { openTransactionsTray, refreshTransactions } from "@/lib/transactions-events";

export const EXPORT_STARTED_MESSAGE = "Preparing the Excel file. It appears in the background tasks tray and in Excel Export History when ready.";
export const EXPORT_STARTED_ACTION_LABEL = "Open tasks tray";
export const EXPORT_HISTORY_HREF = "/reports/export-history";
export const BACKGROUND_TASKS_QUERY_KEY = ["background-tasks"] as const;
/** Window event the Transactions tray listens to so it polls immediately. */
export { TRANSACTIONS_REFRESH_EVENT } from "@/lib/transactions-events";

export interface ExportColumnSpec {
  readonly key: string;
  readonly label: string;
}

/** Drops page/ps so the export is not limited to the visible page. */
export function exportQueryString(queryString: string): string {
  const params = new URLSearchParams(queryString);
  params.delete("page");
  params.delete("ps");
  return params.toString();
}

/** The viewer's IANA zone, so the file name matches the times shown in the tray. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export interface ExportButtonProps {
  readonly gridKey: string;
  readonly queryString: string;
  readonly columns?: readonly ExportColumnSpec[];
  readonly total?: number;
  readonly disabledReason?: string | null;
}

export function ExportButton({ gridKey, queryString, columns, total, disabledReason }: ExportButtonProps) {
  // Optional: the grid also renders on legacy pages without a QueryProvider.
  const queryClient = React.useContext(QueryClientContext);
  const [pending, setPending] = React.useState(false);
  const reason = disabledReason ?? (total === 0 ? "There are no records to export" : null);

  const run = async () => {
    setPending(true);
    // Immediate feedback: the POST can take a few seconds on a busy server.
    const queued = toast.show({ variant: "info", title: "Starting export…", message: "Queuing the Excel file." });
    try {
      await apiRequest("/api/exports", { method: "POST", body: { gridKey, query: exportQueryString(queryString), timeZone: browserTimeZone(), ...(columns?.length ? { columns } : {}) } });
      // Toast on the 202 itself; the tray refresh runs in the background.
      toast.dismiss(queued);
      toast.show({ variant: "success", title: "Export started", message: EXPORT_STARTED_MESSAGE, action: { label: EXPORT_STARTED_ACTION_LABEL, onClick: openTransactionsTray } });
      void queryClient?.invalidateQueries({ queryKey: BACKGROUND_TASKS_QUERY_KEY });
      refreshTransactions();
    } catch (error) {
      toast.dismiss(queued);
      toast.error("Couldn't start the export", isApiError(error) && error.message ? error.message : "Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <DisabledReason reason={pending ? "Starting export…" : reason}>
      {/* Icon-only below lg so the footer stays on one row at tablet width; the accessible name is unchanged. */}
      <Button variant="success-outline" size="sm" aria-label="Export As Excel" title="Export As Excel" disabled={pending || Boolean(reason)} onClick={() => void run()}>
        {pending ? <Spinner className="h-3.5 w-3.5" /> : <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />}
        <span className="hidden lg:inline">Export As Excel</span>
      </Button>
    </DisabledReason>
  );
}
