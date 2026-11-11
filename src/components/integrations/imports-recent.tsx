"use client";

/**
 * `/imports` hub › Recent import jobs: file name, who/when (viewer's local time, the module's one
 * date format), row totals, status, and the original + error file downloads (Logiwa keeps old
 * files reachable from the import history).
 */
import Link from "next/link";
import { Download, FileWarning } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { fileUrl } from "@/components/shared/contracts";
import { DateTimeText } from "@/components/integrations/shared/shared";
import { importTitle } from "./imports-hub";

export interface RecentImportRow {
  readonly id: string;
  readonly importKey: string;
  readonly title: string;
  readonly status: string;
  readonly fileName: string | null;
  readonly fileId: string | null;
  readonly errorFileId: string | null;
  readonly createdAt: string;
  readonly uploadedBy: string | null;
  readonly successCount: number;
  readonly errorCount: number;
  readonly masterRowCount: number;
}

const linkClass = "inline-flex items-center gap-1 rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function ImportsRecentList({ rows }: { readonly rows: readonly RecentImportRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-secondary">
        No imports yet. Uploads you run from any entity page appear here.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {rows.map((b) => (
        <li key={b.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <Link href={`/imports/${b.importKey}`} className="block truncate text-sm font-medium text-primary hover:underline" title={importTitle(b.title)}>
              {importTitle(b.title)}
            </Link>
            {b.fileName ? <p className="truncate text-xs text-body" title={b.fileName}>{b.fileName}</p> : null}
            <p className="text-xs text-secondary">
              <DateTimeText value={b.createdAt} /> · {b.uploadedBy ?? "Unknown user"} · <span className="tabular-nums">{b.successCount}/{b.masterRowCount}</span> rows ok
              {b.errorCount ? <span className="text-danger">, <span className="tabular-nums">{b.errorCount}</span> {b.errorCount === 1 ? "error" : "errors"}</span> : null}
            </p>
            <p className="mt-1 flex flex-wrap gap-3">
              {b.fileId ? <a href={fileUrl(b.fileId, true)} download className={linkClass} aria-label={`Download original file ${b.fileName ?? ""}`}><Download className="h-3 w-3" aria-hidden />Original</a> : null}
              {b.errorFileId ? <a href={fileUrl(b.errorFileId, true)} download className={linkClass} aria-label="Download error file"><FileWarning className="h-3 w-3" aria-hidden />Errors</a> : null}
            </p>
          </div>
          <StatusPill status={b.status} domain="integration" size="sm" />
        </li>
      ))}
    </ul>
  );
}
