'use client';

/**
 * Files tab: every file of the item (direct uploads, update attachments, files columns) as a
 * grid or list, drag-and-drop upload with per-file progress, image thumbnails, lightbox
 * preview, download and delete with Undo.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Download,
  ExternalLink,
  LayoutGrid,
  List as ListIcon,
  MoreHorizontal,
  RotateCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  ProgressBar,
  SearchInput,
  Skeleton,
  ToggleGroup,
  cn,
  toast,
} from '@/components/ui';
import { errorMessage, toastError, useApi, useItemFiles, useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { ColumnDto, FileDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { formatBytes, formatRelativeShort, pluralize } from '../lib/format';
import { useUploadQueue, type UploadEntry } from '../hooks/use-upload-queue';
import { FileKindIcon, useNow } from '../parts/common';
import { FilesArt } from '../parts/illustrations';
import { Lightbox } from './lightbox';

type Layout = 'grid' | 'list';
const LAYOUT_KEY = 'kitstak.itemPanel.filesLayout';
const UNDO_MS = 6000;

function readLayout(): Layout {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export interface FilesTabProps {
  readonly itemId: string;
  readonly boardId: string;
  readonly term: string;
  readonly canWrite: boolean;
  readonly columns: readonly ColumnDto[];
  readonly usersById: ReadonlyMap<string, UserSummaryDto>;
}

function sourceLabel(file: FileDto, columns: readonly ColumnDto[]): string {
  if (file.updateId) return 'In an update';
  if (file.columnKey) return columns.find((column) => column.key === file.columnKey)?.title ?? 'Files column';
  return 'Uploaded';
}

function UploadRow({ entry, onRetry, onDismiss }: { readonly entry: UploadEntry; readonly onRetry: () => void; readonly onDismiss: () => void }) {
  return (
    <li className={cn('flex items-center gap-3 rounded-md border bg-panel px-3 py-2', entry.status === 'error' ? 'border-danger' : 'border-border-subtle')}>
      <FileKindIcon mime={entry.file.type} name={entry.file.name} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.file.name}</span>
          <span className="shrink-0 text-xs text-fg-muted tabular-nums">
            {entry.status === 'done' ? 'Uploaded' : entry.status === 'error' ? 'Failed' : `${Math.round(entry.progress * 100)}%`}
          </span>
        </div>
        {entry.status === 'error' ? (
          <p role="alert" className="text-xs text-danger-text">
            {entry.error}
          </p>
        ) : (
          <ProgressBar value={Math.round(entry.progress * 100)} size="sm" tone={entry.status === 'done' ? 'success' : 'data'} label={`Uploading ${entry.file.name}`} className="mt-1" />
        )}
      </div>
      {entry.status === 'error' ? <IconButton size="sm" label="Retry upload" icon={<RotateCw aria-hidden />} onClick={onRetry} /> : null}
      {entry.status !== 'done' ? (
        <IconButton size="sm" label={entry.status === 'error' ? 'Dismiss' : 'Cancel upload'} icon={<X aria-hidden />} onClick={onDismiss} />
      ) : null}
    </li>
  );
}

export function FilesTab({ itemId, boardId, term, canWrite, columns, usersById }: FilesTabProps) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const files = useItemFiles(itemId);
  const uploads = useUploadQueue(itemId, boardId);
  const now = useNow();
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [layout, setLayout] = useState<Layout>(() => (typeof window === 'undefined' ? 'grid' : readLayout()));
  const [query, setQuery] = useState('');
  const [viewer, setViewer] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (files.data ?? []).filter((file) => !hidden.has(file.id) && (!q || file.name.toLowerCase().includes(q)));
  }, [files.data, hidden, query]);

  const changeLayout = (next: Layout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // per-viewer convenience only
    }
  };

  const startUpload = useCallback(
    (list: readonly File[]) => {
      if (!canWrite || list.length === 0) return;
      void uploads.upload(list).then((done) => {
        if (done.length > 0) toast.success(done.length === 1 ? `Added ${done[0]?.name}` : `Added ${done.length} files`);
      });
    },
    [canWrite, uploads],
  );

  const commitDelete = useCallback(
    (file: FileDto) => {
      pending.current.delete(file.id);
      api.files
        .remove(file.id)
        .then(() =>
          Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.itemFiles(orgId, itemId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.boardFiles(orgId, boardId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.itemUpdates(orgId, itemId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.itemActivity(orgId, itemId) }),
          ]),
        )
        .catch((error: unknown) => {
          toastError(error, 'Could not delete the file');
        })
        .finally(() =>
          setHidden((current) => {
            const next = new Set(current);
            next.delete(file.id);
            return next;
          }),
        );
    },
    [api, boardId, itemId, orgId, queryClient],
  );

  const remove = (file: FileDto) => {
    setHidden((current) => new Set(current).add(file.id));
    pending.current.set(file.id, setTimeout(() => commitDelete(file), UNDO_MS));
    toast.undo(`Deleted ${file.name}`, {
      duration: UNDO_MS,
      onUndo: () => {
        const timer = pending.current.get(file.id);
        if (timer) clearTimeout(timer);
        pending.current.delete(file.id);
        setHidden((current) => {
          const next = new Set(current);
          next.delete(file.id);
          return next;
        });
      },
    });
  };

  useEffect(() => {
    const timers = pending.current;
    return () => {
      for (const [id, timer] of timers) {
        clearTimeout(timer);
        void api.files.remove(id).catch(() => undefined);
      }
      timers.clear();
    };
  }, [api]);

  const onDragEnter = (event: DragEvent) => {
    if (!canWrite || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!canWrite) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    startUpload([...event.dataTransfer.files]);
  };

  const fileMenu = (file: FileDto) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" label={`Actions for ${file.name}`} icon={<MoreHorizontal aria-hidden />} onClick={(event) => event.stopPropagation()} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => window.open(api.files.url(file.id), '_blank', 'noopener')}>
          Open in new tab
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Download aria-hidden />} onSelect={() => window.location.assign(api.files.url(file.id, true))}>
          Download
        </DropdownMenuItem>
        {canWrite ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={() => remove(file)}>
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const total = (files.data ?? []).filter((file) => !hidden.has(file.id)).length;

  return (
    <div
      className="relative flex min-h-[320px] flex-col gap-3"
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        if (canWrite && event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-testid="files-tab"
    >
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <Button size="sm" leadingIcon={<Upload aria-hidden />} onClick={() => input.current?.click()} data-testid="upload-files">
            Upload
          </Button>
        ) : null}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          data-testid="files-input"
          onChange={(event) => {
            startUpload([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        {total > 0 ? <span className="text-sm text-fg-secondary">{pluralize(total, 'file')}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {total > 4 ? <SearchInput value={query} onValueChange={setQuery} placeholder="Search files" size="sm" containerClassName="w-40 sm:w-52" aria-label="Search files" /> : null}
          <ToggleGroup<Layout>
            label="File layout"
            size="sm"
            value={layout}
            onValueChange={changeLayout}
            options={[
              { value: 'grid', label: 'Grid', icon: <LayoutGrid aria-hidden />, iconOnly: true },
              { value: 'list', label: 'List', icon: <ListIcon aria-hidden />, iconOnly: true },
            ]}
          />
        </div>
      </div>

      {uploads.entries.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="Uploads" aria-live="polite">
          {uploads.entries.map((entry) => (
            <UploadRow key={entry.id} entry={entry} onRetry={() => uploads.retry(entry.id)} onDismiss={() => uploads.dismiss(entry.id)} />
          ))}
        </ul>
      ) : null}

      {files.isLoading ? (
        <div role="status" aria-busy="true" aria-label="Loading files" data-skeleton className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
              <Skeleton height={104} rounded="sm" className="rounded-none" />
              <div className="flex flex-col gap-1.5 p-2.5">
                <Skeleton width="80%" height={10} rounded="full" />
                <Skeleton width="40%" height={8} rounded="full" />
              </div>
            </div>
          ))}
        </div>
      ) : files.isError ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-border-subtle bg-panel px-6 py-8 text-center">
          <p className="font-medium">Couldn’t load files</p>
          <p className="text-sm text-fg-secondary">{errorMessage(files.error)}</p>
          <Button variant="secondary" size="sm" leadingIcon={<RotateCw aria-hidden />} onClick={() => void files.refetch()}>
            Try again
          </Button>
        </div>
      ) : total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border-default bg-sunken" data-testid="files-dropzone">
          <EmptyState
            visual={<FilesArt />}
            title="No files yet"
            description={canWrite ? `Drag files here to share proposals, contracts and screenshots for this ${term.toLowerCase()}.` : 'Files added to this item will show up here.'}
            actions={
              canWrite ? (
                <Button variant="secondary" size="sm" leadingIcon={<Upload aria-hidden />} onClick={() => input.current?.click()}>
                  Choose files
                </Button>
              ) : null
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-secondary">No files match “{query}”.</p>
      ) : layout === 'grid' ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Files" data-testid="files-grid">
          {visible.map((file, index) => (
            <li key={file.id} data-testid="file-tile" className="group relative overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-out hover:-translate-y-px hover:border-border-default hover:shadow-md focus-within:border-primary">
              <button type="button" onClick={() => setViewer(index)} className="block w-full text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus" aria-label={`Preview ${file.name}`}>
                <div className="flex h-[104px] items-center justify-center overflow-hidden bg-sunken">
                  {file.mime.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated file URL
                    <img src={file.url} alt="" loading="lazy" className="size-full object-cover transition-transform duration-[var(--duration-slow)] ease-out group-hover:scale-[1.03]" />
                  ) : (
                    <FileKindIcon mime={file.mime} name={file.name} size={48} className="rounded-lg" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 p-2.5 pr-9">
                  <span className="truncate text-sm font-medium text-fg" title={file.name}>
                    {file.name}
                  </span>
                  <span className="truncate text-xs text-fg-muted">
                    {formatBytes(file.size)} · {formatRelativeShort(file.createdAt, now)}
                  </span>
                </div>
              </button>
              <div className="absolute right-1.5 bottom-2">{fileMenu(file)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-panel" aria-label="Files" data-testid="files-list">
          {visible.map((file, index) => (
            <li key={file.id} data-testid="file-tile" className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-hover">
              <button type="button" onClick={() => setViewer(index)} className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" aria-label={`Preview ${file.name}`}>
                {file.mime.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated file URL
                  <img src={file.url} alt="" loading="lazy" className="size-8 rounded-md object-cover" />
                ) : (
                  <FileKindIcon mime={file.mime} name={file.name} size={32} />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-fg">{file.name}</span>
                  <span className="truncate text-xs text-fg-muted">
                    {sourceLabel(file, columns)} · {(file.uploadedBy && usersById.get(file.uploadedBy)?.name) || 'Someone'}
                  </span>
                </span>
                <span className="hidden w-16 shrink-0 text-right text-xs text-fg-muted tabular-nums sm:block">{formatBytes(file.size)}</span>
                <span className="w-16 shrink-0 text-right text-xs text-fg-muted">{formatRelativeShort(file.createdAt, now)}</span>
              </button>
              {fileMenu(file)}
            </li>
          ))}
        </ul>
      )}

      {dragging ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex animate-fade-in flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-primary-subtle/90">
          <Upload className="size-8 text-primary-text" />
          <p className="text-md font-semibold text-primary-text">Drop to upload</p>
        </div>
      ) : null}

      <Lightbox
        files={visible}
        index={viewer}
        onIndexChange={setViewer}
        fileUrl={(id, download) => api.files.url(id, download)}
        uploaderName={(id) => (id ? (usersById.get(id)?.name ?? null) : null)}
      />
    </div>
  );
}
