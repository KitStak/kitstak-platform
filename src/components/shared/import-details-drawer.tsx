"use client";

/**
 * Import batch details (`GET /api/imports/batches/[id]` → `{ batch, rows }`): summary
 * counts and the row results, with "Show Errors" narrowing to failed rows.
 */
import * as React from "react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { fileUrl, importBatchSchema, importRowSchema, type ImportBatch } from "./contracts";

const detailsSchema = z.object({ batch: importBatchSchema, rows: z.array(importRowSchema).default([]) });
const rowsSchema = z.array(importRowSchema);

/**
 * The endpoint answers the list envelope (rows in `data`, the batch in `meta.batch`); the older
 * `{ batch, rows }` body is still accepted. Exported for tests.
 */
export function parseImportDetails(body: { readonly data?: unknown; readonly meta?: unknown } | undefined): { readonly batch: ImportBatch | null; readonly rows: z.infer<typeof rowsSchema> } | null {
  if (!body) return null;
  const legacy = detailsSchema.safeParse(body.data);
  if (legacy.success) return legacy.data;
  const rows = rowsSchema.safeParse(body.data);
  if (!rows.success) return null;
  const batch = importBatchSchema.safeParse((body.meta as { batch?: unknown } | undefined)?.batch);
  return { batch: batch.success ? batch.data : null, rows: rows.data };
}

export function ImportDetailsDrawer({ batch, onOpenChange }: { readonly batch: ImportBatch | null; readonly onOpenChange: (open: boolean) => void }) {
  const fmt = useFormat();
  const [errorsOnly, setErrorsOnly] = React.useState(false);
  const query = useApiQuery<unknown>(["import-batch", batch?.id ?? ""], batch ? `/api/imports/batches/${encodeURIComponent(batch.id)}` : null);
  const parsed = parseImportDetails(query.data);
  const rows = parsed?.rows ?? [];
  const shown = errorsOnly ? rows.filter((r) => !r.success) : rows;
  // The details endpoint carries the raw uploader id; keep the history row's display name.
  const current = parsed?.batch ? { ...parsed.batch, uploadedByName: parsed.batch.uploadedByName ?? batch?.uploadedByName ?? null } : batch;

  return (
    <Drawer
      open={batch !== null}
      onOpenChange={onOpenChange}
      width={60}
      title="Import details"
      description={current ? `Uploaded ${fmt.dateTime(current.createdAt)} by ${current.uploadedByName ?? current.uploadedBy ?? "Unknown"}` : undefined}
      footer={
        current?.errorFileId || current?.fileId ? (
          <div className="ml-auto flex items-center gap-2">
            {current.fileId ? (
              <a href={fileUrl(current.fileId, true)} download className={buttonVariants({ variant: "secondary" })}>
                Download Original File
              </a>
            ) : null}
            {current.errorFileId ? (
              <a href={fileUrl(current.errorFileId, true)} download className={buttonVariants({ variant: "secondary" })}>
                Download Error File
              </a>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {current ? (
        <div className="mb-4 grid grid-cols-4 gap-3">
          {[
            ["Status", <StatusPill key="s" status={current.status} domain="integration" />],
            ["Master rows", fmt.number(current.masterRowCount)],
            ["Success", <span key="ok" className="text-success">{fmt.number(current.successCount)}</span>],
            ["Error", <span key="err" className={cn(current.errorCount > 0 && "text-danger")}>{fmt.number(current.errorCount)}</span>],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-border p-3">
              <p className="text-2xs font-semibold text-faint">{label}</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</p>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mb-3 flex justify-end">
        <Switch label="Show errors" checked={errorsOnly} onCheckedChange={setErrorsOnly} />
      </div>
      {query.isPending ? (
        <SkeletonTable rows={6} columns={3} />
      ) : query.error ? (
        <EmptyState compact title="Could not load the import details" description={query.error.message} action={<Button size="sm" onClick={() => void query.refetch()}>Retry</Button>} />
      ) : shown.length === 0 ? (
        <EmptyState compact title={errorsOnly ? "No errors in this import" : "No rows recorded"} />
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg border border-border text-sm">
          <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
            <tr>
              <th scope="col" className="w-20 px-3 py-2">Row</th>
              <th scope="col" className="w-28 px-3 py-2">Result</th>
              <th scope="col" className="px-3 py-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.rowNumber} className="border-t border-border">
                <td className="px-3 py-2 tabular-nums text-secondary">{r.rowNumber}</td>
                <td className="px-3 py-2">
                  <StatusPill status={r.success ? "Successful" : "Error"} domain="integration" size="sm" />
                </td>
                <td className="px-3 py-2 text-body">{r.message ?? (r.success ? "Imported" : "Failed")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  );
}
