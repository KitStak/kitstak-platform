/**
 * Uploads one file through `POST /api/files` (multipart: `file`, `purpose`, optional
 * owner) and returns the stored file id. Shared by documents and imports.
 */
import { apiFetch } from '@/lib/api-client';
import { uploadedFileSchema } from './contracts';

export type UploadPurpose = 'attachment' | 'import';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_ACCEPT: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
];
export const IMPORT_ACCEPT: readonly string[] = [
  '.xlsx',
  '.csv',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export interface UploadOwner {
  readonly entityType: string;
  readonly entityId: string;
}

export async function uploadFile(file: File, purpose: UploadPurpose, owner?: UploadOwner): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);
  if (owner) {
    form.append('ownerEntityType', owner.entityType);
    form.append('ownerEntityId', owner.entityId);
  }
  const data = await apiFetch<unknown>('/api/files', { method: 'POST', body: form });
  return uploadedFileSchema.parse(data).id;
}
