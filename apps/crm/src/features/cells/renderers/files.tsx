'use client';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Eye, FilePlus2, Paperclip, Upload, X } from 'lucide-react';
import { Button, IconButton, Spinner, Tooltip, cn, toast } from '@/components/ui';
import type { FileDto } from '@/server/services/contracts/dto';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { formatBytes } from '../lib/format';
import { readIds } from '../lib/values';
import { EmptyGhost, EmptyListMessage } from '../parts/common';
import { FileLightbox, FileThumb } from '../parts/file-thumb';

const MAX_VISIBLE = 3;

function useCellFiles(ctx: CellRenderContext, extra: readonly FileDto[] = []) {
  const pool = ctx.services.files;
  const value = ctx.value;
  return useMemo(() => {
    const ids = readIds(value, 'fileIds');
    const byId = new Map<string, FileDto>([...(pool ?? []), ...extra].map((file) => [file.id, file]));
    return ids.map((id) => ({ id, file: byId.get(id) ?? null }));
  }, [extra, pool, value]);
}

/** Upload OS files to the item and append them to the cell. */
function useUploader(ctx: CellRenderContext) {
  const [uploading, setUploading] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<FileDto[]>([]);
  const upload = ctx.services.uploadFile;
  const start = async (list: FileList | readonly File[]) => {
    if (!upload) return;
    const files = Array.from(list);
    setUploading((current) => [...current, ...files.map((file) => file.name)]);
    const done: FileDto[] = [];
    for (const file of files) {
      try {
        done.push(await upload(ctx.item, ctx.column, file));
      } catch (error) {
        toast.error(`Couldn't upload ${file.name}`, error instanceof Error ? error.message : undefined);
      } finally {
        setUploading((current) => {
          const index = current.indexOf(file.name);
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
        });
      }
    }
    if (done.length) {
      setUploaded((current) => [...current, ...done]);
      ctx.commit({ fileIds: [...readIds(ctx.value, 'fileIds'), ...done.map((file) => file.id)] });
      toast.success(done.length === 1 ? `${done[0]?.name ?? 'File'} uploaded` : `${done.length} files uploaded`);
    }
  };
  return { uploading, uploaded, start, enabled: Boolean(upload) && !ctx.readOnly };
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function FilesDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const { uploading, uploaded, start, enabled } = useUploader(ctx);
  const entries = useCellFiles(ctx, uploaded);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const known = entries.map((entry) => entry.file).filter((file): file is FileDto => file !== null);

  const dropProps = enabled
    ? {
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length) void start(event.dataTransfer.files);
        },
      }
    : {};

  return (
    <span className="flex min-w-0 flex-1 items-center justify-center gap-1 self-stretch px-2" {...dropProps}>
      {entries.length === 0 && uploading.length === 0 && !ctx.readOnly ? <EmptyGhost icon={<Paperclip aria-hidden />} label="Add files" /> : null}
      {entries.slice(0, MAX_VISIBLE).map((entry, index) => (
        <Tooltip key={entry.id} content={entry.file ? `${entry.file.name} · ${formatBytes(entry.file.size)}` : 'File'} side="top">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Open ${entry.file?.name ?? 'file'}`}
            onClick={(event) => {
              event.stopPropagation();
              const position = entry.file ? known.indexOf(entry.file) : -1;
              if (position >= 0) setViewing(position);
              else ctx.startEdit();
            }}
            className="inline-flex rounded-xs transition-transform duration-[var(--duration-instant)] hover:scale-110 focus-visible:outline-2 focus-visible:outline-focus"
            data-index={index}
          >
            <FileThumb file={entry.file} url={entry.file ? ctx.services.fileUrl?.(entry.file.id) : undefined} />
          </button>
        </Tooltip>
      ))}
      {entries.length > MAX_VISIBLE ? (
        <span className="inline-flex h-6 items-center rounded-sm bg-muted px-1.5 text-xs font-semibold text-fg-secondary">+{entries.length - MAX_VISIBLE}</span>
      ) : null}
      {uploading.length ? <Spinner size="xs" label={`Uploading ${uploading.length} file${uploading.length === 1 ? '' : 's'}`} className="text-primary" /> : null}
      {dragging ? (
        <span className="ks-drop-overlay">
          <Upload aria-hidden className="size-3.5" /> Drop to upload
        </span>
      ) : null}
      {/* Portaled dialog: keep its clicks from reaching the cell (which would open the editor). */}
      <span className="contents" onClick={(event) => event.stopPropagation()}>
        <FileLightbox files={known} index={viewing} onIndexChange={setViewing} fileUrl={ctx.services.fileUrl} />
      </span>
    </span>
  );
}

function FilesEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const { uploading, uploaded, start, enabled } = useUploader(ctx);
  const entries = useCellFiles(ctx, uploaded);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const known = entries.map((entry) => entry.file).filter((file): file is FileDto => file !== null);

  const remove = (id: string) => {
    const before = readIds(ctx.value, 'fileIds');
    const next = before.filter((entry) => entry !== id);
    ctx.commit(next.length ? { fileIds: next } : null);
    toast.undo('File removed from the cell', { onUndo: () => ctx.commit({ fileIds: before }) });
  };

  return (
    <div className="flex w-[300px] flex-col gap-2" data-testid="files-editor">
      {entries.length === 0 && uploading.length === 0 ? <EmptyListMessage>No files yet</EmptyListMessage> : null}
      <ul className="-mx-1 flex max-h-60 flex-col overflow-y-auto" aria-label="Files">
        {entries.map((entry) => (
          <li key={entry.id} className="group/file mx-1 flex h-10 items-center gap-2.5 rounded-sm px-1.5 hover:bg-hover">
            <FileThumb file={entry.file} url={entry.file ? ctx.services.fileUrl?.(entry.file.id) : undefined} size="md" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-fg">{entry.file?.name ?? 'Unavailable file'}</span>
              <span className="text-xs text-fg-muted">{entry.file ? formatBytes(entry.file.size) : ctx.services.filesLoading ? 'Loading…' : 'Removed or not accessible'}</span>
            </span>
            {entry.file ? (
              <IconButton size="xs" label="Preview" icon={<Eye aria-hidden />} onClick={() => setViewing(known.indexOf(entry.file as FileDto))} />
            ) : null}
            {!ctx.readOnly ? <IconButton size="xs" variant="danger" label="Remove from cell" icon={<X aria-hidden />} onClick={() => remove(entry.id)} /> : null}
          </li>
        ))}
        {uploading.map((name, index) => (
          <li key={`${name}-${index}`} className="mx-1 flex h-10 items-center gap-2.5 px-1.5 text-sm text-fg-secondary" aria-busy="true">
            <span className="inline-flex size-8 items-center justify-center rounded-xs bg-muted">
              <Spinner size="xs" label={null} />
            </span>
            <span className="truncate">{name}</span>
          </li>
        ))}
      </ul>
      {enabled ? (
        <div
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void start(event.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-md border-[1.5px] border-dashed p-4 text-center transition-colors duration-[var(--duration-fast)]',
            dragging ? 'border-primary bg-highlight' : 'border-border-default',
          )}
        >
          <FilePlus2 aria-hidden className="size-5 text-icon" />
          <p className="text-sm text-fg-secondary">Drag files here or</p>
          <Button autoFocus size="sm" variant="secondary" leadingIcon={<Upload aria-hidden />} onClick={() => input.current?.click()}>
            Upload from computer
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void start(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      ) : (
        <p className="text-xs text-fg-muted">{ctx.readOnly ? 'Read-only' : 'Uploads are unavailable here.'}</p>
      )}
      <FileLightbox files={known} index={viewing} onIndexChange={setViewing} fileUrl={ctx.services.fileUrl} />
    </div>
  );
}

export const filesRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, width: 300 },
  Display: FilesDisplay,
  Editor: FilesEditor,
};
