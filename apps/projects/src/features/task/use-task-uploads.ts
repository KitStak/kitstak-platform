'use client';
/**
 * Upload files to a task (attachments section, drag-and-drop anywhere on the task, pasted or
 * attached files in the comment box). Each file shows in `queue` while it uploads; errors toast
 * in plain words. Resolves to the uploaded attachments.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { MAX_ATTACHMENT_BYTES } from '@/lib/constants';
import { qk } from '@/lib/query-keys';
import type { AttachmentDTO } from '@/lib/types';
import { uploadAttachmentAction } from '@/server/actions/attachments';
import { formatBytes } from './task-utils';

export interface UploadItem {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly previewUrl: string | null;
}

let sequence = 0;

export function useTaskUploads(
  task: { readonly id: string; readonly projectKey: string },
  options: { readonly silent?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<readonly UploadItem[]>([]);

  const upload = useCallback(
    async (files: readonly File[]): Promise<AttachmentDTO[]> => {
      const accepted: File[] = [];
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES)
          toast.error(
            `“${file.name}” is too big`,
            `Files can be up to ${formatBytes(MAX_ATTACHMENT_BYTES)}. This one is ${formatBytes(file.size)}.`,
          );
        else if (file.size === 0)
          toast.error(`“${file.name}” is empty`, 'Choose a file that has something in it.');
        else accepted.push(file);
      }
      if (accepted.length === 0) return [];
      const items = accepted.map((file) => ({
        id: `upload-${(sequence += 1)}`,
        name: file.name,
        size: file.size,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }));
      setQueue((current) => [...current, ...items]);
      const uploaded: AttachmentDTO[] = [];
      await Promise.all(
        accepted.map(async (file, index) => {
          const item = items[index];
          const form = new FormData();
          form.set('file', file);
          form.set('taskId', task.id);
          try {
            const result = await uploadAttachmentAction(form);
            if (result.ok) uploaded.push(result.data);
            else toast.error(`Couldn't upload “${file.name}”`, result.error.message);
          } catch {
            toast.error(`Couldn't upload “${file.name}”`, 'Check your connection and try again.');
          } finally {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
            setQueue((current) => current.filter((entry) => entry.id !== item.id));
          }
        }),
      );
      if (uploaded.length) {
        void queryClient.invalidateQueries({ queryKey: qk.taskAttachments(task.id) });
        void queryClient.invalidateQueries({ queryKey: qk.taskActivity(task.id) });
        void queryClient.invalidateQueries({ queryKey: qk.projectFiles(task.projectKey) });
        void queryClient.invalidateQueries({ queryKey: qk.projectTasks(task.projectKey) });
        if (!options.silent)
          toast.success(
            uploaded.length === 1 ? `Attached “${uploaded[0].name}”` : `Attached ${uploaded.length} files`,
          );
      }
      return uploaded;
    },
    [options.silent, queryClient, task.id, task.projectKey],
  );

  return { upload, queue, uploading: queue.length > 0 } as const;
}
