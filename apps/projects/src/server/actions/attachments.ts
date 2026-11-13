'use server';
import { z } from 'zod';
import { deleteAttachment, restoreAttachment, uploadAttachment } from '@/server/domain';
import { MAX_ATTACHMENT_BYTES } from '@/lib/constants';
import { runAction } from './_action';
import { uuid } from './schemas';

const uploadSchema = z.object({
  taskId: uuid.nullable().optional(),
  projectId: uuid.optional(),
  file: z.instanceof(File, { message: 'Choose a file to upload.' }).refine((file) => file.size <= MAX_ATTACHMENT_BYTES, 'Files can be up to 25 MB.'),
});

/** Upload one file. Call with a FormData containing `file` and `taskId` (or `projectId`). */
export async function uploadAttachmentAction(formData: FormData) {
  const input = {
    file: formData.get('file'),
    taskId: (formData.get('taskId') as string | null) || null,
    projectId: (formData.get('projectId') as string | null) || undefined,
  };
  return runAction(uploadSchema, input, async (data, ctx) =>
    uploadAttachment(ctx, {
      taskId: data.taskId ?? null,
      projectId: data.projectId,
      name: data.file.name,
      contentType: data.file.type || 'application/octet-stream',
      bytes: new Uint8Array(await data.file.arrayBuffer()),
    }),
  );
}

const idSchema = z.object({ attachmentId: uuid });
export async function deleteAttachmentAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteAttachment(ctx, data.attachmentId));
}
export async function restoreAttachmentAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreAttachment(ctx, data.attachmentId));
}
