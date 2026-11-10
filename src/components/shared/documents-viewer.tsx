"use client";

/**
 * Documents list for a record (`GET /api/attachments?entityType&entityId`): type, name,
 * uploader, date, with View (inline image/PDF), Download and Delete
 * (`DELETE /api/attachments?id=`) plus the Upload entry point.
 */
import * as React from "react";
import { Download, Eye, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { useFormat } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBytes } from "@/components/ui/file-dropzone";
import { SkeletonText } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { attachmentSchema, fileUrl, parseList, type Attachment } from "./contracts";
import { DocumentUploadModal, attachmentsQueryKey } from "./document-upload-modal";

export interface DocumentsViewerProps {
  readonly entityType: string;
  readonly entityId: string;
  readonly canEdit?: boolean;
}

export function DocumentsViewer({ entityType, entityId, canEdit = false }: DocumentsViewerProps) {
  const fmt = useFormat();
  const key = attachmentsQueryKey(entityType, entityId);
  const query = useApiQuery<unknown>(key, "/api/attachments", { query: { entityType, entityId } });
  const docs = parseList(attachmentSchema, query.data?.data);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [viewing, setViewing] = React.useState<Attachment | null>(null);
  const [deleting, setDeleting] = React.useState<Attachment | null>(null);
  const remove = useApiMutation<Attachment, unknown>({
    path: (a) => `/api/attachments?id=${encodeURIComponent(a.id)}`,
    method: "DELETE",
    body: () => undefined,
    invalidate: [key],
    successMessage: (_d, a) => `${a.fileName ?? a.documentType} deleted`,
  });

  return (
    <section aria-label="Documents" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Paperclip className="h-3.5 w-3.5 text-secondary" aria-hidden />
          Documents {docs.length ? <span className="text-faint">({docs.length})</span> : null}
        </h3>
        {canEdit ? (
          <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload
          </Button>
        ) : null}
      </div>
      {query.isPending ? (
        <SkeletonText lines={3} />
      ) : query.error ? (
        <EmptyState compact title="Could not load documents" description={query.error.message} action={<Button size="sm" onClick={() => void query.refetch()}>Retry</Button>} />
      ) : docs.length === 0 ? (
        <EmptyState compact icon={FileText} title="No documents yet" description="Packing instructions, invoices and labels attached to this record appear here." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-soft text-secondary">
                <FileText className="h-4 w-4" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-foreground">{d.fileName ?? d.documentType}</span>
                <span className="truncate text-[11px] text-faint">
                  {d.documentType}
                  {d.size ? ` · ${formatBytes(d.size)}` : ""} · {d.uploadedByName ?? d.uploadedBy ?? "Unknown"} · {fmt.dateTime(d.createdAt)}
                </span>
              </span>
              <Tooltip content="View">
                <Button variant="ghost" size="icon-sm" aria-label={`View ${d.fileName ?? d.documentType}`} onClick={() => setViewing(d)}>
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </Tooltip>
              <Tooltip content="Download">
                <a href={fileUrl(d.fileId, true)} download aria-label={`Download ${d.fileName ?? d.documentType}`} className="flex h-7 w-7 items-center justify-center rounded-md text-secondary hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                  <Download className="h-3.5 w-3.5" aria-hidden />
                </a>
              </Tooltip>
              {canEdit ? (
                <Tooltip content="Delete">
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.fileName ?? d.documentType}`} onClick={() => setDeleting(d)}>
                    <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
                  </Button>
                </Tooltip>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? <DocumentUploadModal open={uploadOpen} onOpenChange={setUploadOpen} entityType={entityType} entityId={entityId} /> : null}
      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent size="xl">
          <DialogHeader title={viewing?.fileName ?? viewing?.documentType ?? "Document"} description={viewing?.documentType} />
          <DialogBody>
            {viewing ? (
              viewing.mime?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated file route, not optimisable
                <img src={fileUrl(viewing.fileId)} alt={viewing.fileName ?? viewing.documentType} className="mx-auto max-h-[70vh] rounded-md" />
              ) : (
                <iframe title={viewing.fileName ?? "Document"} src={fileUrl(viewing.fileId)} className="h-[70vh] w-full rounded-md border border-border" />
              )
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this document?"
        description={deleting ? `${deleting.fileName ?? deleting.documentType} will be removed from this record.` : undefined}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting);
          setDeleting(null);
        }}
      />
    </section>
  );
}
