'use client';
/**
 * File gallery: every file on the board (file columns and updates) as a grid or list, with
 * search, type filter, sort, a lightbox with ←/→ and zoom, and a whole-view dropzone that
 * uploads into a chosen item.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
  LayoutGrid,
  Link2,
  List,
  MoreHorizontal,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import {
  Avatar,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Select,
  Skeleton,
  ToggleGroup,
  cn,
  labelColorStyle,
  toast,
} from '@/components/ui';
import { useApi, useBoardFiles, useOrgId } from '@/lib/hooks';
import { toastError } from '@/lib/hooks/cache';
import { queryKeys } from '@/lib/query-keys';
import type { FileDto } from '@/server/services/contracts/dto';
import { ViewCanvas, ViewError, ViewToolbar } from '../components/view-shell';
import { useViewConfig, useViewModel } from '../hooks';
import { filesSettings } from '../lib/config';
import { formatIso } from '../lib/dates';
import { extensionOf, fileKind, filterFiles, formatBytes, KIND_COLOR, KIND_LABEL, type FileKind, type KindFilter } from '../lib/files';
import type { BoardViewProps } from '../types';

const KIND_ICON: Record<FileKind, LucideIcon> = {
  image: FileImage,
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: FileText,
  archive: FileArchive,
  media: FileVideo,
  other: FileIcon,
};

function TypeTile({ file, className }: { readonly file: FileDto; readonly className?: string }) {
  const kind = fileKind(file);
  const Icon = KIND_ICON[kind];
  return (
    <div style={labelColorStyle(KIND_COLOR[kind])} className={cn('flex flex-col items-center justify-center gap-1.5 bg-[var(--lc-subtle)] text-[var(--lc-text)]', className)}>
      <Icon aria-hidden className="size-8" strokeWidth={1.5} />
      <span className="rounded-xs bg-[var(--lc-bg)] px-1.5 text-2xs font-bold text-[var(--lc-fg)]">{extensionOf(file.name) || KIND_LABEL[kind]}</span>
    </div>
  );
}

function Thumb({ file, className }: { readonly file: FileDto; readonly className?: string }) {
  const [failed, setFailed] = useState(false);
  if (fileKind(file) !== 'image' || failed) return <TypeTile file={file} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated API url, not optimizable
    <img src={file.url} alt="" loading="lazy" onError={() => setFailed(true)} className={cn('object-cover', className)} />
  );
}

export function FilesSkeleton() {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading files" className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-4 p-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel">
          <Skeleton height={120} rounded="sm" className="rounded-none" />
          <div className="flex flex-col gap-1.5 p-3">
            <Skeleton height={12} width="70%" rounded="full" />
            <Skeleton height={10} width="45%" rounded="full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FilesView({ boardId, view, onOpenItem, className }: BoardViewProps) {
  const model = useViewModel(boardId, view);
  const { allItems, users, noun, canEdit } = model;
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const files = useBoardFiles(boardId);
  const { save } = useViewConfig<Record<string, unknown>>(boardId, view, 'files');
  const settings = filesSettings(view.config);
  const [preview, setPreview] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [confirm, setConfirm] = useState<FileDto | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [staged, setStaged] = useState<File[] | null>(null);
  const [targetItem, setTargetItem] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const itemNames = useMemo(() => new Map(allItems.map((item) => [item.id, item.name])), [allItems]);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const visible = useMemo(
    () =>
      filterFiles(
        // Files of deleted / archived items (not in the payload) aren't reachable: leave them out.
        (files.data ?? []).filter((file) => !file.itemId || itemNames.has(file.itemId)),
        { query: model.search, kind: settings.kind as KindFilter, sort: settings.sort, itemNames },
      ),
    [files.data, model.search, settings.kind, settings.sort, itemNames],
  );
  const current = preview === null ? null : (visible[preview] ?? null);

  const remove = useMutation({
    mutationFn: (file: FileDto) => api.files.remove(file.id),
    onMutate: async (file) => {
      const key = queryKeys.boardFiles(orgId, boardId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<FileDto[]>(key);
      queryClient.setQueryData<FileDto[]>(key, (list) => list?.filter((entry) => entry.id !== file.id));
      return { previous };
    },
    onError: (error, _file, context) => {
      queryClient.setQueryData(queryKeys.boardFiles(orgId, boardId), context?.previous);
      toastError(error, "Couldn't delete the file");
    },
    onSuccess: (_data, file) => {
      toast.success(`Deleted ${file.name}`);
      if (file.itemId) void queryClient.invalidateQueries({ queryKey: queryKeys.itemFiles(orgId, file.itemId) });
    },
  });

  const upload = useMutation({
    mutationFn: async (input: { itemId: string; files: File[] }) => {
      for (const file of input.files) await api.items.upload(input.itemId, file);
      return input.files.length;
    },
    onSuccess: (count, input) => {
      toast.success(`Uploaded ${count} ${count === 1 ? 'file' : 'files'}`, `Attached to ${itemNames.get(input.itemId) ?? noun.toLowerCase()}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.boardFiles(orgId, boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.itemFiles(orgId, input.itemId) });
      setStaged(null);
    },
    onError: (error) => toastError(error, "Couldn't upload the files"),
  });

  const step = useCallback((delta: number) => setPreview((index) => (index === null || visible.length === 0 ? index : (index + delta + visible.length) % visible.length)), [visible.length]);
  useEffect(() => {
    if (preview === null) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview, step]);

  const stage = (list: FileList | null) => {
    if (!list || list.length === 0 || !canEdit) return;
    setStaged([...list]);
    setTargetItem((value) => value ?? allItems[0]?.id);
  };
  const onDragEnter = (event: DragEvent) => {
    if (!canEdit || !event.dataTransfer.types.includes('Files')) return;
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    stage(event.dataTransfer.files);
  };

  const copyLink = (file: FileDto) => {
    void navigator.clipboard?.writeText(new URL(api.files.url(file.id), window.location.origin).toString());
    toast.success('Link copied');
  };

  const menu = (file: FileDto, index: number) => (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton size="xs" label={`Actions for ${file.name}`} icon={<MoreHorizontal aria-hidden />} className="bg-panel/90 data-[state=open]:bg-hover" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<Eye aria-hidden />} onSelect={() => setPreview(index)}>
          Preview
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Download aria-hidden />} onSelect={() => window.open(api.files.url(file.id, true), '_blank', 'noopener')}>
          Download
        </DropdownMenuItem>
        {file.itemId ? (
          <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => file.itemId && onOpenItem?.(file.itemId)}>
            Open {noun.toLowerCase()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => copyLink(file)}>
          Copy link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" disabled={!canEdit} onSelect={() => setConfirm(file)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const meta = (file: FileDto) => {
    const uploader = file.uploadedBy ? usersById.get(file.uploadedBy) : undefined;
    return { uploader, date: formatIso(file.createdAt.slice(0, 10), 'full') };
  };

  let body;
  if ((files.isError && !files.data) || (model.query.isError && !model.query.data)) body = <ViewError onRetry={() => void files.refetch()} what="files" />;
  else if (!files.data || !model.query.data) body = <FilesSkeleton />;
  else if ((files.data ?? []).length === 0)
    body = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          title="No files yet"
          description="Files from file columns and updates collect here."
          actions={
            canEdit ? (
              <Button leadingIcon={<Upload aria-hidden />} onClick={() => inputRef.current?.click()} disabled={allItems.length === 0}>
                Upload files
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  else if (visible.length === 0)
    body = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          illustration="search"
          size="sm"
          title="No files match"
          description="Try another search or file type."
          actions={
            <Button variant="secondary" size="sm" onClick={() => { model.clearSearch(); save({ kind: 'all' }); }}>
              Clear filters
            </Button>
          }
        />
      </div>
    );
  else if (settings.layout === 'list')
    body = (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 overflow-hidden rounded-lg border border-border-subtle bg-panel text-sm" data-testid="files-list">
          <thead>
            <tr className="text-left text-xs font-semibold text-fg-muted">
              {['Name', noun, 'Uploaded by', 'Date', 'Size', ''].map((header) => (
                <th key={header} scope="col" className="h-9 border-b border-border-subtle px-3 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((file, index) => {
              const info = meta(file);
              return (
                <tr key={file.id} className="group hover:bg-muted" data-testid="file-row">
                  <td className="h-11 border-b border-border-subtle px-3">
                    <button type="button" onClick={() => setPreview(index)} className="flex min-w-0 items-center gap-2.5 rounded-xs text-left hover:text-primary-text focus-visible:outline-2 focus-visible:outline-focus">
                      <Thumb file={file} className="size-7 shrink-0 overflow-hidden rounded-sm [&_svg]:size-4 [&>span]:hidden" />
                      <span className="truncate font-medium">{file.name}</span>
                    </button>
                  </td>
                  <td className="border-b border-border-subtle px-3">
                    {file.itemId ? (
                      <button type="button" onClick={() => file.itemId && onOpenItem?.(file.itemId)} className="max-w-56 truncate text-fg-secondary hover:text-primary-text hover:underline">
                        {itemNames.get(file.itemId)}
                      </button>
                    ) : null}
                  </td>
                  <td className="border-b border-border-subtle px-3 text-fg-secondary">{info.uploader?.name ?? 'None'}</td>
                  <td className="border-b border-border-subtle px-3 text-fg-secondary tabular-nums">{info.date}</td>
                  <td className="border-b border-border-subtle px-3 text-fg-secondary tabular-nums">{formatBytes(file.size)}</td>
                  <td className="w-10 border-b border-border-subtle px-2">{menu(file, index)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  else
    body = (
      <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-4 overflow-y-auto p-4 max-[480px]:grid-cols-2 max-[480px]:gap-3 max-[480px]:p-3" data-testid="files-grid">
        {visible.map((file, index) => {
          const info = meta(file);
          return (
            <li key={file.id} className="group/tile relative flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-out hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0" data-testid="file-tile">
              <button type="button" onClick={() => setPreview(index)} aria-label={`Preview ${file.name}`} className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
                <Thumb file={file} className="h-[120px] w-full" />
              </button>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-[var(--duration-fast)] group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 max-[768px]:opacity-100">
                <IconButton size="xs" label={`Download ${file.name}`} icon={<Download aria-hidden />} className="bg-panel/90" onClick={() => window.open(api.files.url(file.id, true), '_blank', 'noopener')} />
                {menu(file, index)}
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 p-3">
                <span className="truncate text-sm font-medium text-fg" title={file.name}>
                  {file.name}
                </span>
                {file.itemId ? (
                  <button type="button" onClick={() => file.itemId && onOpenItem?.(file.itemId)} className="truncate text-left text-xs text-fg-muted hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                    {itemNames.get(file.itemId)}
                  </button>
                ) : null}
                <span className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
                  {info.uploader ? <Avatar name={info.uploader.name} src={info.uploader.image} size="xs" /> : null}
                  <span className="truncate tabular-nums">
                    {info.date} · {formatBytes(file.size)}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    );

  return (
    <ViewCanvas testId="files-view" busy={!files.data} className={className}>
      <ViewToolbar
        search={model.search}
        onSearch={model.setSearch}
        searchLabel="Search files"
        end={
          <>
            <ToggleGroup
              size="sm"
              label="Layout"
              value={settings.layout}
              onValueChange={(value) => save({ layout: value }, { immediate: true })}
              options={[
                { value: 'grid', label: 'Grid', icon: <LayoutGrid aria-hidden />, iconOnly: true },
                { value: 'list', label: 'List', icon: <List aria-hidden />, iconOnly: true },
              ]}
            />
            {canEdit ? (
              <Button size="sm" leadingIcon={<Upload aria-hidden />} onClick={() => inputRef.current?.click()} disabled={allItems.length === 0}>
                <span className="max-[480px]:sr-only">Add files</span>
              </Button>
            ) : null}
          </>
        }
      >
        <span className="w-36" data-testid="files-kind">
          <Select
            size="sm"
            aria-label="File type"
            value={settings.kind}
            onValueChange={(value) => save({ kind: value }, { immediate: true })}
            options={[
              { value: 'all', label: 'All types' },
              { value: 'image', label: 'Images' },
              { value: 'pdf', label: 'PDFs' },
              { value: 'doc', label: 'Documents' },
              { value: 'sheet', label: 'Spreadsheets' },
              { value: 'other', label: 'Other' },
            ]}
          />
        </span>
        <span className="w-36">
          <Select
            size="sm"
            aria-label="Sort files"
            value={settings.sort}
            onValueChange={(value) => save({ sort: value }, { immediate: true })}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'name', label: 'Name' },
              { value: 'size', label: 'Largest first' },
            ]}
          />
        </span>
        {files.data ? (
          <span className="text-sm text-fg-secondary tabular-nums max-[640px]:hidden">
            {visible.length} {visible.length === 1 ? 'file' : 'files'}
          </span>
        ) : null}
      </ViewToolbar>
      <div className="relative flex min-h-0 flex-1 flex-col bg-sunken" onDragEnter={onDragEnter} onDragOver={(event) => canEdit && event.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
        {body}
        {dragOver ? (
          <div className="pointer-events-none absolute inset-3 z-[var(--z-overlay)] flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary-subtle/90 animate-fade-in" data-testid="files-dropzone">
            <span className="flex items-center gap-2 text-md font-semibold text-primary-text">
              <Upload aria-hidden className="size-5" /> Drop to upload
            </span>
          </div>
        ) : null}
      </div>
      <input ref={inputRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { stage(event.target.files); event.target.value = ''; }} data-testid="files-input" />

      <Dialog open={staged !== null} onOpenChange={(open) => !open && !upload.isPending && setStaged(null)}>
        <DialogContent size="sm" data-testid="files-upload-dialog">
          <DialogHeader title={`Upload ${staged?.length ?? 0} ${staged?.length === 1 ? 'file' : 'files'}`} description={`Choose the ${noun.toLowerCase()} to attach them to.`} />
          <DialogBody>
            <Select
              aria-label={noun}
              value={targetItem}
              onValueChange={setTargetItem}
              options={allItems.slice(0, 300).map((item) => ({ value: item.id, label: item.name }))}
              placeholder={`Choose a ${noun.toLowerCase()}`}
            />
            <ul className="mt-3 flex max-h-32 flex-col gap-1 overflow-y-auto text-sm text-fg-secondary">
              {staged?.map((file) => (
                <li key={`${file.name}-${file.size}`} className="flex justify-between gap-3">
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 tabular-nums">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStaged(null)} disabled={upload.isPending}>
              Cancel
            </Button>
            <Button loading={upload.isPending} disabled={!targetItem} onClick={() => targetItem && staged && upload.mutate({ itemId: targetItem, files: staged })}>
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={current !== null} onOpenChange={(open) => { if (!open) { setPreview(null); setZoomed(false); } }}>
        <DialogContent
          size="xl"
          data-testid="files-lightbox"
          className="w-[min(1100px,calc(100vw-24px))]"
          // Focus the dialog itself (not a tooltipped button) so the first Escape closes it.
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          {current ? (
            <>
              <DialogHeader
                title={current.name}
                description={[KIND_LABEL[fileKind(current)], formatBytes(current.size), current.itemId ? itemNames.get(current.itemId) : null].filter(Boolean).join(' · ')}
              />
              <DialogBody className="pb-4">
                <div className="relative flex h-[min(64vh,640px)] items-center justify-center overflow-auto rounded-lg bg-sunken">
                  {fileKind(current) === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated API url
                    <img src={current.url} alt={current.name} className={cn('transition-transform duration-[var(--duration-normal)] ease-out', zoomed ? 'max-w-none scale-150 cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain')} onClick={() => setZoomed((value) => !value)} />
                  ) : (
                    <TypeTile file={current} className="size-48 rounded-xl [&_svg]:size-14" />
                  )}
                  {visible.length > 1 ? (
                    <>
                      <IconButton label="Previous file" shortcut={['←']} icon={<ChevronLeft aria-hidden />} onClick={() => step(-1)} variant="outline" round className="absolute top-1/2 left-3 -translate-y-1/2 shadow-md" />
                      <IconButton label="Next file" shortcut={['→']} icon={<ChevronRight aria-hidden />} onClick={() => step(1)} variant="outline" round className="absolute top-1/2 right-3 -translate-y-1/2 shadow-md" />
                    </>
                  ) : null}
                </div>
              </DialogBody>
              <DialogFooter>
                <span className="mr-auto text-sm text-fg-muted tabular-nums">
                  {(preview ?? 0) + 1} of {visible.length}
                </span>
                {fileKind(current) === 'image' ? (
                  <Button variant="ghost" leadingIcon={zoomed ? <ZoomOut aria-hidden /> : <ZoomIn aria-hidden />} onClick={() => setZoomed((value) => !value)}>
                    {zoomed ? 'Fit' : 'Zoom'}
                  </Button>
                ) : null}
                {current.itemId ? (
                  <Button variant="secondary" onClick={() => { const id = current.itemId; setPreview(null); if (id) onOpenItem?.(id); }}>
                    Open {noun.toLowerCase()}
                  </Button>
                ) : null}
                <Button leadingIcon={<Download aria-hidden />} onClick={() => window.open(api.files.url(current.id, true), '_blank', 'noopener')}>
                  Download
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Delete ${confirm?.name ?? 'file'}?`}
        description={`It will be removed from its ${noun.toLowerCase()} for everyone.`}
        confirmLabel="Delete file"
        destructive
        onConfirm={() => {
          if (confirm) remove.mutate(confirm);
          setConfirm(null);
        }}
      />
      <span className="sr-only" aria-live="polite">
        {files.data ? `${visible.length} files shown` : ''}
      </span>
    </ViewCanvas>
  );
}
