"use client";

/**
 * RMA "Photos & documents" tab: evidence for a return (damage claims). Photos taken per line at
 * the Return Station are stored as return_order attachments named "<SKU> · <file>", so they
 * are grouped here by line; anything else lands under "General". View (lightbox), download,
 * upload (optionally for a line) and delete (Change Status permission, with confirmation).
 */
import * as React from "react";
import { Camera, Download, Eye, FileText, ImageOff, Trash2, Upload } from "lucide-react";
import { attachmentSchema, fileUrl, parseList, type Attachment } from "@/components/shared/contracts";
import { attachmentsQueryKey } from "@/components/shared/document-upload-modal";
import { uploadFile } from "@/components/shared/upload-file";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { useQueryClient } from "@tanstack/react-query";
import { photoGroups, type PhotoGroup } from "./rma-photos-model";
import { errorText } from "./returns-client";

const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

export function RmaPhotos({ returnOrderId, rmaCode, skus, canEdit }: {
  readonly returnOrderId: string; readonly rmaCode: string; readonly skus: readonly string[]; readonly canEdit: boolean;
}) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const key = attachmentsQueryKey("return_order", returnOrderId);
  const q = useApiQuery<unknown>(key, "/api/attachments", { query: { entityType: "return_order", entityId: returnOrderId } });
  const docs = parseList(attachmentSchema, q.data?.data);
  const groups = photoGroups(docs, skus);
  const [viewing, setViewing] = React.useState<Attachment | null>(null);
  const [deleting, setDeleting] = React.useState<Attachment | null>(null);
  const [lineSku, setLineSku] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    try {
      for (const raw of Array.from(files)) {
        const file = lineSku ? new File([raw], `${lineSku} · ${raw.name}`.slice(0, 200), { type: raw.type }) : raw;
        const fileId = await uploadFile(file, "attachment", { entityType: "return_order", entityId: returnOrderId });
        await apiRequest("/api/attachments", { method: "POST", body: { entityType: "return_order", entityId: returnOrderId, documentType: "Other", fileId } });
        ok += 1;
      }
      toast.success(ok === 1 ? "File added" : `${ok} files added`, lineSku ? `Attached to ${lineSku} on ${rmaCode}.` : `Attached to ${rmaCode}.`);
    } catch (e) {
      toast.error(ok ? `${ok} added, the rest failed` : "Upload failed", errorText(e));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      await qc.invalidateQueries({ queryKey: key });
    }
  };

  const remove = async (a: Attachment) => {
    try {
      await apiRequest(`/api/attachments?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
      toast.success("Deleted", `${a.fileName ?? "File"} was removed from ${rmaCode}.`);
    } catch (e) {
      toast.error("Not deleted", errorText(e));
    } finally {
      await qc.invalidateQueries({ queryKey: key });
    }
  };

  return (
    <section aria-label="Photos and documents" className="flex flex-col gap-4" data-testid="rma-photos">
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-sunken/40 p-3">
          <div className="flex min-w-[200px] flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Attach to line</span>
            <Select aria-label="Attach to line" value={lineSku} clearable placeholder="General (whole RMA)" options={skus.map((s) => ({ value: s, label: s }))} onChange={(v) => setLineSku(v)} />
          </div>
          <input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" id="rma-photo-input" onChange={(e) => void upload(e.target.files)} />
          <Button variant="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" aria-hidden />{uploading ? "Uploading…" : "Add photos or files"}
          </Button>
          <p className="text-[11px] text-secondary">PNG, JPEG, WebP or PDF. Photos taken at the Return Station appear here automatically.</p>
        </div>
      ) : null}
      {q.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-square" />)}</div>
      ) : q.error ? (
        <Callout variant="error" title="Could not load the photos" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>}>{q.error.message}</Callout>
      ) : groups.length === 0 ? (
        <EmptyState compact icon={Camera} title="No photos or documents yet"
          description={canEdit ? "Add photos of the returned units, the box or the label to support a damage claim." : "Photos taken at the Return Station appear here."} />
      ) : (
        groups.map((g) => <Group key={g.key} group={g} onView={setViewing} onDelete={canEdit ? setDeleting : undefined} fmtDate={fmt.gridDateTime} />)
      )}
      <Dialog open={Boolean(viewing)} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent size="lg">
          <DialogHeader title={viewing?.fileName ?? "Photo"} description={viewing ? `${viewing.uploadedByName ?? viewing.uploadedBy ?? "Unknown"} · ${fmt.gridDateTime(viewing.createdAt)}` : undefined} />
          <DialogBody>
            {viewing ? (viewing.mime?.startsWith("image/")
              // eslint-disable-next-line @next/next/no-img-element -- served by /api/files with auth
              ? <img src={fileUrl(viewing.fileId)} alt={viewing.fileName ?? "Return photo"} className="mx-auto max-h-[70vh] rounded-md object-contain" />
              : <iframe title={viewing.fileName ?? "Document"} src={fileUrl(viewing.fileId)} className="h-[70vh] w-full rounded-md border border-border" />) : null}
            {viewing ? <div className="mt-3 flex justify-end"><a href={fileUrl(viewing.fileId, true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-surface-sunken"><Download className="h-3.5 w-3.5" aria-hidden />Download</a></div> : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => { if (!o) setDeleting(null); }} variant="danger" icon={Trash2}
        title={`Delete ${deleting?.fileName ?? "this file"}?`} description={`It is removed from ${rmaCode} and can't be restored.`}
        confirmLabel="Delete" cancelLabel="Keep" onConfirm={async () => { if (deleting) await remove(deleting); setDeleting(null); }} />
    </section>
  );
}

function Group({ group, onView, onDelete, fmtDate }: {
  readonly group: PhotoGroup; readonly onView: (a: Attachment) => void; readonly onDelete?: (a: Attachment) => void; readonly fmtDate: (iso: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid={`rma-photo-group-${group.key}`}>
      <h3 className="text-[12px] font-semibold text-foreground">{group.label} <span className="font-normal text-faint">({group.items.length})</span></h3>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {group.items.map(({ attachment: a, displayName, isImage }) => (
          <li key={a.id} className="group overflow-hidden rounded-lg border border-border bg-surface">
            <button type="button" onClick={() => onView(a)} aria-label={`View ${displayName}`}
              className="flex aspect-[4/3] w-full items-center justify-center bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {isImage ? <Thumb fileId={a.fileId} alt={displayName} /> : <FileText className="h-8 w-8 text-secondary" aria-hidden />}
            </button>
            <div className="flex items-center gap-1 px-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground" title={displayName}>{displayName}</span>
                <span className="block truncate text-[11px] text-faint">{a.uploadedByName ?? a.uploadedBy ?? "Unknown"} · {fmtDate(a.createdAt)}</span>
              </span>
              <Tooltip content="View"><Button variant="ghost" size="icon-sm" aria-label={`View ${displayName}`} onClick={() => onView(a)}><Eye className="h-3.5 w-3.5" aria-hidden /></Button></Tooltip>
              <Tooltip content="Download"><a href={fileUrl(a.fileId, true)} aria-label={`Download ${displayName}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-secondary hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Download className="h-3.5 w-3.5" aria-hidden /></a></Tooltip>
              {onDelete ? <Tooltip content="Delete"><Button variant="ghost" size="icon-sm" aria-label={`Delete ${displayName}`} onClick={() => onDelete(a)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button></Tooltip> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thumb({ fileId, alt }: { readonly fileId: string; readonly alt: string }) {
  const [broken, setBroken] = React.useState(false);
  if (broken) return <ImageOff className="h-7 w-7 text-faint" aria-label="Preview unavailable" />;
  // eslint-disable-next-line @next/next/no-img-element -- served by /api/files with auth
  return <img src={fileUrl(fileId)} alt={alt} loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />;
}
