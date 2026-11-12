"use client";

/**
 * Document upload modal (BUILD_PLAN F4.4): document type + file (image or PDF, ≤ 10 MB).
 * Uploads the file (`POST /api/files`), then links it to the record
 * (`POST /api/attachments { entityType, entityId, documentType, fileId }`).
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ATTACHMENT_DOCUMENT_TYPES } from "@/lib/enums";
import { apiRequest, isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { ATTACHMENT_ACCEPT, MAX_UPLOAD_BYTES, uploadFile } from "./upload-file";

export const attachmentsQueryKey = (entityType: string, entityId: string) => ["attachments", entityType, entityId] as const;

type DocumentType = (typeof ATTACHMENT_DOCUMENT_TYPES)[number];

export interface DocumentUploadModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entityType: string;
  readonly entityId: string;
  readonly documentTypes?: readonly DocumentType[];
  readonly onUploaded?: () => void;
}

export function DocumentUploadModal({ open, onOpenChange, entityType, entityId, documentTypes = ATTACHMENT_DOCUMENT_TYPES, onUploaded }: DocumentUploadModalProps) {
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = React.useState<DocumentType | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState<number | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const busy = progress !== undefined;
  const reason = busy ? "Uploading…" : !documentType ? "Choose a document type" : !file ? "Choose a file to upload" : null;

  const reset = () => {
    setDocumentType(null);
    setFile(null);
    setProgress(undefined);
    setError(undefined);
  };

  const submit = async () => {
    if (!file || !documentType) return;
    setError(undefined);
    setProgress(30);
    try {
      const fileId = await uploadFile(file, "attachment", { entityType, entityId });
      setProgress(80);
      await apiRequest("/api/attachments", { method: "POST", body: { entityType, entityId, documentType, fileId } });
      toast.success("Success", `${file.name} uploaded`);
      await queryClient.invalidateQueries({ queryKey: attachmentsQueryKey(entityType, entityId) });
      onUploaded?.();
      reset();
      onOpenChange(false);
    } catch (e) {
      setProgress(undefined);
      setError(isApiError(e) ? e.message : "Upload failed");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) reset();
        if (!busy) onOpenChange(o);
      }}
    >
      <DialogContent size="md">
        <DialogHeader title="Upload document" description="Images or PDF, up to 10 MB." />
        <DialogBody className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
            <span>
              Document Type <span className="text-danger">*</span>
            </span>
            <Select<DocumentType> aria-label="Document type" value={documentType} onChange={setDocumentType} placeholder="Select a document type" options={documentTypes.map((t) => ({ value: t, label: t }))} />
          </label>
          <FileDropzone
            accept={ATTACHMENT_ACCEPT}
            maxSizeBytes={MAX_UPLOAD_BYTES}
            maxFiles={1}
            disabled={busy}
            onFiles={(files) => {
              setFile(files[0] ?? null);
              setError(undefined);
            }}
            items={file ? [{ id: "file", name: file.name, size: file.size, progress, error }] : []}
            onRemove={busy ? undefined : () => setFile(null)}
            hint="PNG, JPG, GIF, WEBP or PDF"
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <DisabledReason reason={reason}>
            <Button variant="primary" disabled={Boolean(reason)} onClick={() => void submit()}>
              Upload
            </Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
