"use client";

/**
 * Shared template for `/imports/[key]` (BUILD_PLAN F4.4): title, helper text and back
 * link; the green "Download our excel template" card; dropzone + Refresh; and the
 * history grid (STATUS, MASTER ROW COUNT, SUCCESS, ERROR, UPLOADED BY, CREATED DATE
 * TIME, ACTIONS → Details / Download Original / Download Error File).
 *
 * API: `GET /api/imports/[key]?page&ps` (history), `POST /api/imports/[key]` (multipart
 * `file`), `GET /api/imports/[key]/template`, `GET /api/imports/batches/[id]`.
 */
import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Download, FileSpreadsheet, FileText, FileWarning } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { Callout } from "@/components/ui/callout";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DataGrid } from "@/components/grid/data-grid";
import { DateCell, QtyCell, UserCell } from "@/components/grid/cells";
import type { RowAction } from "@/components/grid/grid-types";
import { fileUrl, importBatchSchema, parseList, type ImportBatch } from "./contracts";
import { ImportDetailsDrawer } from "./import-details-drawer";
import { IMPORT_ACCEPT, MAX_UPLOAD_BYTES } from "./upload-file";

export const importHistoryQueryKey = (key: string) => ["imports", key] as const;
const HISTORY_PAGE_SIZE = 100;

export interface ImportPageProps {
  readonly importKey: string;
  readonly title: string;
  readonly description?: string;
  readonly backHref: string;
  readonly backLabel?: string;
}

const COLUMNS: ColumnDef<ImportBatch, unknown>[] = [
  { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <StatusPill status={row.original.status} domain="integration" /> },
  { id: "masterRowCount", header: "Master Row Count", meta: { align: "right" }, cell: ({ row }) => <QtyCell value={row.original.masterRowCount} /> },
  { id: "successCount", header: "Success", meta: { align: "right" }, cell: ({ row }) => <QtyCell value={row.original.successCount} muteZero /> },
  { id: "errorCount", header: "Error", meta: { align: "right" }, cell: ({ row }) => <span className={row.original.errorCount ? "font-semibold text-danger" : "text-faint"}>{row.original.errorCount}</span> },
  { id: "uploadedBy", header: "Uploaded by", enableSorting: false, cell: ({ row }) => <UserCell name={row.original.uploadedByName ?? row.original.uploadedBy} /> },
  { id: "createdAt", header: "Created Date Time", cell: ({ row }) => <DateCell value={row.original.createdAt} /> },
];

function download(id: string): void {
  const a = document.createElement("a");
  a.href = fileUrl(id, true);
  a.download = "";
  a.click();
}

export function ImportPage({ importKey, title, description, backHref, backLabel = "Back" }: ImportPageProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [uploading, setUploading] = React.useState<{ readonly name: string; readonly size: number; readonly error?: string } | null>(null);
  const [details, setDetails] = React.useState<ImportBatch | null>(null);
  const key = importHistoryQueryKey(importKey);
  const history = useApiQuery<unknown>(key, `/api/imports/${encodeURIComponent(importKey)}`, { query: { page, ps: HISTORY_PAGE_SIZE }, placeholderData: (p) => p });
  const batches = parseList(importBatchSchema, history.data?.data);
  const processing = batches.some((b) => b.status === "Processing");

  React.useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => void queryClient.invalidateQueries({ queryKey: key }), 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is derived from importKey
  }, [processing, importKey, queryClient]);

  const upload = async (file: File) => {
    setUploading({ name: file.name, size: file.size });
    try {
      const form = new FormData();
      form.append("file", file);
      await apiRequest(`/api/imports/${encodeURIComponent(importKey)}`, { method: "POST", body: form });
      toast.success("Import started", `${file.name} is being processed. Results appear in the history below.`);
      setUploading(null);
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      setUploading({ name: file.name, size: file.size, error: isApiError(error) ? error.message : "Upload failed" });
    }
  };

  const rowActions = (b: ImportBatch): readonly RowAction[] => [
    { key: "details", label: "Details", icon: FileText, onSelect: () => setDetails(b) },
    { key: "original", label: "Download original", icon: Download, disabledReason: b.fileId ? null : "The original file is no longer available", onSelect: () => b.fileId && download(b.fileId) },
    { key: "errors", label: "Download error file", icon: FileWarning, disabledReason: b.errorFileId ? null : "This import has no errors", onSelect: () => b.errorFileId && download(b.errorFileId) },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-4 px-6 pt-5">
        <Link href={backHref} className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-secondary hover:text-primary">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {backLabel}
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm text-secondary">{description}</p> : null}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <a href={`/api/imports/${encodeURIComponent(importKey)}/template`} download className="group flex items-center gap-3 rounded-lg border border-success/40 bg-success-soft p-4 transition-colors hover:border-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success text-white">
              <FileSpreadsheet className="h-5 w-5" aria-hidden />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-success">Download our excel template</span>
              <span className="text-xs text-secondary">Columns, an example row and field notes</span>
            </span>
            <Download className="ml-auto h-4 w-4 text-success transition-transform group-hover:translate-y-0.5" aria-hidden />
          </a>
          <FileDropzone
            accept={IMPORT_ACCEPT}
            maxSizeBytes={MAX_UPLOAD_BYTES}
            maxFiles={1}
            disabled={uploading !== null && !uploading.error}
            title="Drag and drop your .xlsx or .csv file here, or browse"
            hint="Up to 10 MB"
            onFiles={(files) => {
              const f = files[0];
              if (f) void upload(f);
            }}
            items={uploading ? [{ id: "upload", name: uploading.name, size: uploading.size, progress: uploading.error ? undefined : 50, error: uploading.error }] : []}
            onRemove={uploading?.error ? () => setUploading(null) : undefined}
          />
        </div>
        {processing ? <Callout variant="info" title="An import is processing">This page refreshes automatically until it finishes.</Callout> : null}
      </div>
      <DataGrid<ImportBatch>
        columns={COLUMNS}
        data={[...batches]}
        total={history.data?.meta?.total ?? batches.length}
        page={page}
        pageSize={HISTORY_PAGE_SIZE}
        onPageChange={setPage}
        loading={history.isPending}
        error={history.error?.message ?? null}
        onRetry={() => void history.refetch()}
        onRefresh={() => void history.refetch()}
        getRowId={(b) => b.id}
        onRowClick={(b) => setDetails(b)}
        selectable={false}
        rowActions={rowActions}
        exportName={`${importKey}-import-history`}
        emptyTitle="No imports yet"
        emptyDescription="Download the template, fill it in and drop the file above."
        toolbarLeft={<h2 className="text-base font-semibold text-foreground">Import history</h2>}
      />
      <ImportDetailsDrawer batch={details} onOpenChange={(o) => !o && setDetails(null)} />
    </div>
  );
}
