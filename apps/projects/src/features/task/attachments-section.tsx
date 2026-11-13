'use client';
/**
 * Files on a task: upload (button, drag and drop anywhere on the task, or paste in a comment),
 * image thumbnails with a full-screen viewer, download, delete with undo.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button, IconButton, Skeleton, Spinner, Tooltip, cn, toast } from '@/components/ui';
import { formatRelative } from '@/lib/dates';
import { useTaskAttachments } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import type { AttachmentDTO } from '@/lib/types';
import { deleteAttachmentAction, restoreAttachmentAction } from '@/server/actions/attachments';
import { useShell } from '@/features/shell/shell-context';
import { SectionHeading } from './property-row';
import { useTaskContext } from './task-context';
import { fileKind, formatBytes, isImageType } from './task-utils';
import type { useTaskUploads } from './use-task-uploads';

type Uploads = ReturnType<typeof useTaskUploads>;

function KindIcon({ file, className }: { readonly file: AttachmentDTO; readonly className?: string }) {
  const kind = fileKind(file.name, file.contentType);
  const Icon =
    kind === 'Image'
      ? FileImage
      : kind === 'Spreadsheet'
        ? FileSpreadsheet
        : kind === 'Archive'
          ? FileArchive
          : kind === 'PDF' || kind === 'Document'
            ? FileText
            : FileIcon;
  return <Icon aria-hidden className={className} />;
}

function FileTile({
  file,
  onOpen,
  onDelete,
  canDelete,
}: {
  readonly file: AttachmentDTO;
  readonly onOpen: () => void;
  readonly onDelete: () => void;
  readonly canDelete: boolean;
}) {
  const people = usePeopleMap();
  const image = isImageType(file.contentType);
  const uploader = file.uploadedBy ? people.get(file.uploadedBy)?.name : undefined;
  return (
    <li
      className="group/file relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel transition-shadow hover:shadow-sm"
      data-testid="attachment-tile"
    >
      <button
        type="button"
        onClick={onOpen}
        className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        aria-label={image ? `View ${file.name}` : `Open ${file.name}`}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file route; next/image can't proxy it
          <img src={file.url} alt="" loading="lazy" className="h-24 w-full bg-sunken object-cover" />
        ) : (
          <span className="flex h-24 w-full flex-col items-center justify-center gap-1 bg-sunken text-icon">
            <KindIcon file={file} className="size-7" />
            <span className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">
              {fileKind(file.name, file.contentType)}
            </span>
          </span>
        )}
      </button>
      <div className="flex min-w-0 flex-col px-2.5 py-2">
        <span className="truncate text-sm font-medium text-fg" title={file.name}>
          {file.name}
        </span>
        <span className="truncate text-2xs text-fg-muted">
          {formatBytes(file.sizeBytes)} · {uploader ? `${uploader.split(' ')[0]}, ` : ''}
          {formatRelative(file.createdAt)}
        </span>
      </div>
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-md bg-raised/95 p-0.5 opacity-0 shadow-sm ring-1 ring-border-subtle transition-opacity group-focus-within/file:opacity-100 group-hover/file:opacity-100 max-sm:opacity-100">
        <Tooltip content="Download">
          <a
            href={`${file.url}?download=1`}
            aria-label={`Download ${file.name}`}
            className="inline-flex size-7 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong"
          >
            <Download aria-hidden className="size-3.5" />
          </a>
        </Tooltip>
        {canDelete ? (
          <IconButton
            size="sm"
            label={`Delete ${file.name}`}
            icon={<Trash2 aria-hidden />}
            onClick={onDelete}
          />
        ) : null}
      </div>
    </li>
  );
}

export function Lightbox({
  files,
  index,
  onIndex,
  onClose,
}: {
  readonly files: readonly AttachmentDTO[];
  readonly index: number | null;
  readonly onIndex: (index: number) => void;
  readonly onClose: () => void;
}) {
  const file = index === null ? null : files[index];
  const go = (delta: number) =>
    index !== null && files.length > 1 && onIndex((index + delta + files.length) % files.length);
  return (
    <DialogPrimitive.Root open={Boolean(file)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/90 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[var(--z-modal)] flex flex-col outline-none data-[state=open]:animate-fade-in"
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') go(1);
            if (event.key === 'ArrowLeft') go(-1);
          }}
          aria-describedby={undefined}
        >
          {file ? (
            <>
              <div className="flex h-14 shrink-0 items-center gap-3 px-4 text-white">
                <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium">
                  {file.name}{' '}
                  <span className="font-normal text-white/60">· {formatBytes(file.sizeBytes)}</span>
                  {files.length > 1 ? (
                    <span className="ml-2 font-normal text-white/60 tabular-nums">
                      {index! + 1} of {files.length}
                    </span>
                  ) : null}
                </DialogPrimitive.Title>
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex size-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
                  aria-label="Open in a new tab"
                >
                  <ExternalLink aria-hidden className="size-4" />
                </a>
                <a
                  href={`${file.url}?download=1`}
                  className="inline-flex size-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
                  aria-label="Download"
                >
                  <Download aria-hidden className="size-4" />
                </a>
                <DialogPrimitive.Close
                  className="inline-flex size-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
                  aria-label="Close viewer"
                >
                  <X aria-hidden className="size-5" />
                </DialogPrimitive.Close>
              </div>
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6"
                onClick={(event) => event.target === event.currentTarget && onClose()}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- private file route */}
                <img
                  src={file.url}
                  alt={file.name}
                  className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
                />
                {files.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => go(-1)}
                      aria-label="Previous image"
                      className="absolute top-1/2 left-4 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                    >
                      <ChevronLeft aria-hidden className="size-6" />
                    </button>
                    <button
                      type="button"
                      onClick={() => go(1)}
                      aria-label="Next image"
                      className="absolute top-1/2 right-4 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                    >
                      <ChevronRight aria-hidden className="size-6" />
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <DialogPrimitive.Title className="sr-only">Image viewer</DialogPrimitive.Title>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AttachmentsSection({ uploads }: { readonly uploads: Uploads }) {
  const { task, canUpload, canDelete, live } = useTaskContext();
  const { user } = useShell();
  const queryClient = useQueryClient();
  const files = useTaskAttachments(task.id, { enabled: live });
  const input = useRef<HTMLInputElement>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const list = files.data ?? [];
  const images = list.filter((file) => isImageType(file.contentType));

  const remove = async (file: AttachmentDTO) => {
    const key = qk.taskAttachments(task.id);
    const before = queryClient.getQueryData<AttachmentDTO[]>(key);
    queryClient.setQueryData<AttachmentDTO[]>(key, (current) =>
      current?.filter((entry) => entry.id !== file.id),
    );
    const result = await deleteAttachmentAction({ attachmentId: file.id });
    if (!result.ok) {
      queryClient.setQueryData(key, before);
      toast.error("Couldn't delete that file", result.error.message);
      return;
    }
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: qk.projectFiles(task.projectKey) });
      void queryClient.invalidateQueries({ queryKey: qk.taskActivity(task.id) });
    };
    invalidate();
    toast.undo(`Deleted “${file.name}”`, {
      onUndo: async () => {
        const undo = await restoreAttachmentAction({ attachmentId: file.id });
        if (!undo.ok) throw new Error(undo.error.message);
        invalidate();
      },
    });
  };

  const open = (file: AttachmentDTO) => {
    if (isImageType(file.contentType)) setViewer(images.findIndex((entry) => entry.id === file.id));
    else window.open(file.url, '_blank', 'noopener,noreferrer');
  };

  const count = list.length + uploads.queue.length;
  if (!canUpload && count === 0 && !files.isLoading) return null;

  return (
    <section aria-labelledby="task-files-heading" data-testid="task-attachments">
      <SectionHeading
        id="task-files-heading"
        icon={<Paperclip aria-hidden />}
        count={count || undefined}
        actions={
          canUpload ? (
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Upload aria-hidden />}
              onClick={() => input.current?.click()}
            >
              Upload
            </Button>
          ) : null
        }
      >
        Files
      </SectionHeading>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        data-testid="task-file-input"
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = '';
          if (picked.length) void uploads.upload(picked);
        }}
      />
      {files.isLoading && task.attachmentCount > 0 ? (
        // Real tile frames from the first paint (icon, room for name and size), never blank boxes.
        <ul className="mt-2 grid grid-cols-2 gap-2 @min-[560px]:grid-cols-3 @min-[900px]:grid-cols-4" aria-busy="true" aria-label="Loading files">
          {Array.from({ length: Math.min(task.attachmentCount, 8) }, (_, index) => (
            <li key={index} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel">
              <span className="flex h-24 w-full items-center justify-center bg-sunken text-icon">
                <FileText aria-hidden className="size-7 opacity-60" />
              </span>
              <span className="flex flex-col gap-1.5 px-2.5 py-2.5">
                <Skeleton height={12} width="70%" />
                <Skeleton height={10} width="45%" />
              </span>
            </li>
          ))}
        </ul>
      ) : files.isLoading ? null : count === 0 ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-default px-4 py-5 text-sm text-fg-muted transition-colors hover:border-primary hover:bg-primary-subtle hover:text-primary-text focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Upload aria-hidden className="size-4" />
          <span>
            Drop files here or <span className="font-medium text-fg-link">browse</span> · up to 25 MB each
          </span>
        </button>
      ) : (
        <ul className="mt-2 grid grid-cols-2 gap-2 @min-[560px]:grid-cols-3 @min-[900px]:grid-cols-4">
          {uploads.queue.map((item) => (
            <li
              key={item.id}
              className="relative flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel"
              aria-busy="true"
            >
              <span className="relative flex h-24 items-center justify-center bg-sunken">
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover opacity-50"
                  />
                ) : null}
                <Spinner size="md" label={`Uploading ${item.name}`} />
              </span>
              <span className="flex flex-col px-2.5 py-2">
                <span className="truncate text-sm font-medium text-fg">{item.name}</span>
                <span className="text-2xs text-fg-muted">Uploading · {formatBytes(item.size)}</span>
              </span>
            </li>
          ))}
          {list.map((file) => (
            <FileTile
              key={file.id}
              file={file}
              onOpen={() => open(file)}
              onDelete={() => void remove(file)}
              canDelete={canDelete || file.uploadedBy === user.id}
            />
          ))}
        </ul>
      )}
      <Lightbox files={images} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
    </section>
  );
}

/** Full-surface overlay shown while files are dragged over the task. */
export function DropOverlay({ taskKey, active }: { readonly taskKey: string; readonly active: boolean }) {
  return (
    <div
      aria-hidden={!active}
      className={cn(
        'pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-[color-mix(in_srgb,var(--surface-raised),var(--primary)_8%)] transition-opacity duration-[var(--duration-fast)]',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="flex flex-col items-center gap-2 text-primary-text">
        <Upload aria-hidden className="size-8" />
        <p className="text-md font-semibold">Drop to attach to {taskKey}</p>
        <p className="text-sm text-fg-secondary">Up to 25 MB per file</p>
      </div>
    </div>
  );
}
