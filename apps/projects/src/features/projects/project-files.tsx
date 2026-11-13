'use client';
/**
 * Files tab: every attachment in the project (uploaded here or on a task), newest first.
 * Drag files anywhere on the page or use Upload; filter by kind, search by name, open the task a
 * file belongs to, download, and delete with undo. Images show a thumbnail.
 */
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, File as FileIcon, FileArchive, FileSpreadsheet, FileText, Image as ImageIcon, LayoutGrid, List, Search, Trash2, Upload } from 'lucide-react';
import { Button, EmptyState, IconButton, Input, Skeleton, ToggleGroup, cn, toast } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { MAX_ATTACHMENT_BYTES } from '@/lib/constants';
import { useProjectFiles, useProjectTasks } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import type { AttachmentDTO } from '@/lib/types';
import { deleteAttachmentAction, restoreAttachmentAction, uploadAttachmentAction } from '@/server/actions/attachments';
import { LocalTime } from '@/features/task/local-time';
import { useCurrentProject } from './project-context';

type Kind = 'all' | 'images' | 'documents' | 'other';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindOf(file: AttachmentDTO): Exclude<Kind, 'all'> {
  if (file.contentType.startsWith('image/')) return 'images';
  if (/pdf|word|document|text|sheet|excel|csv|presentation|powerpoint/.test(file.contentType)) return 'documents';
  return 'other';
}

function FileGlyph({ file, className }: { readonly file: AttachmentDTO; readonly className?: string }) {
  const type = file.contentType;
  const Icon = type.startsWith('image/') ? ImageIcon : /sheet|excel|csv/.test(type) ? FileSpreadsheet : /zip|compressed|tar/.test(type) ? FileArchive : /pdf|word|document|text/.test(type) ? FileText : FileIcon;
  return <Icon aria-hidden className={className} />;
}

export function ProjectFiles() {
  const { project, capabilities } = useCurrentProject();
  const files = useProjectFiles(project.key);
  const tasks = useProjectTasks(project.key);
  const { openTask } = useTaskDrawer();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const canUpload = capabilities['file:upload'];
  const taskById = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: qk.projectFiles(project.key) });
  const all = files.data ?? [];
  const list = all.filter((file) => (kind === 'all' || kindOf(file) === kind) && (!query.trim() || file.name.toLowerCase().includes(query.trim().toLowerCase())));
  const totalBytes = all.reduce((sum, file) => sum + file.sizeBytes, 0);

  const upload = async (picked: FileList | File[] | null) => {
    const items = Array.from(picked ?? []);
    if (!items.length) return;
    const tooBig = items.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
    for (const file of tooBig) toast.error(`${file.name} is too big`, `Files can be up to ${size(MAX_ATTACHMENT_BYTES)}.`);
    const ok = items.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
    if (!ok.length) return;
    setUploading(ok.length);
    let done = 0;
    for (const file of ok) {
      const form = new FormData();
      form.set('file', file);
      form.set('projectId', project.id);
      const result = await uploadAttachmentAction(form);
      if (!result.ok) toast.error(`Couldn't upload ${file.name}`, result.error.message);
      else done += 1;
      setUploading((n) => Math.max(0, n - 1));
    }
    refresh();
    if (done) toast.success(done === 1 ? 'File uploaded' : `${done} files uploaded`);
  };

  const remove = async (file: AttachmentDTO) => {
    const result = await deleteAttachmentAction({ attachmentId: file.id });
    if (!result.ok) {
      toast.error("Couldn't delete that file", result.error.message);
      return;
    }
    refresh();
    toast.undo(`Deleted ${file.name}`, {
      onUndo: async () => {
        const undo = await restoreAttachmentAction({ attachmentId: file.id });
        if (!undo.ok) throw new Error(undo.error.message);
        refresh();
      },
    });
  };

  const dropProps = canUpload
    ? {
        onDragOver: (event: DragEvent) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        },
        onDragLeave: (event: DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        },
      }
    : {};

  const taskLink = (file: AttachmentDTO) => {
    const task = file.taskId ? taskById.get(file.taskId) : undefined;
    if (!file.taskId) return <span className="text-xs text-fg-muted">Project file</span>;
    return task ? (
      <button type="button" data-task-key={task.key} onClick={() => openTask(task.key)} className="max-w-full truncate rounded-sm text-xs font-medium text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        {task.key} {task.title}
      </button>
    ) : (
      <span className="text-xs text-fg-muted">On a task</span>
    );
  };

  const actions = (file: AttachmentDTO) => (
    <>
      <a href={`${file.url}?download=1`} aria-label={`Download ${file.name}`} title="Download" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-icon outline-none hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus">
        <Download aria-hidden className="size-4" />
      </a>
      {capabilities['task:delete'] ? <IconButton label={`Delete ${file.name}`} icon={<Trash2 aria-hidden />} onClick={() => void remove(file)} /> : null}
    </>
  );

  return (
    <div className="relative mx-auto min-h-full w-full max-w-[1240px] px-4 py-5 sm:px-6" data-testid="project-files" {...dropProps}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-md font-semibold text-fg">Files</h2>
          <p className="text-xs text-fg-muted">{all.length ? `${all.length} ${all.length === 1 ? 'file' : 'files'} · ${size(totalBytes)}` : 'Everything attached to this project and its tasks'}</p>
        </div>
        {canUpload ? (
          <>
            <input ref={input} type="file" multiple hidden onChange={(event) => { void upload(event.target.files); event.target.value = ''; }} data-testid="files-input" />
            <Button leadingIcon={<Upload aria-hidden />} loading={uploading > 0} onClick={() => input.current?.click()}>
              {uploading > 0 ? `Uploading ${uploading}…` : 'Upload files'}
            </Button>
          </>
        ) : null}
      </div>

      {all.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a file" aria-label="Find a file" leadingIcon={<Search aria-hidden />} containerClassName="w-full sm:w-60" />
          <ToggleGroup
            label="Kind of file"
            value={kind}
            onValueChange={setKind}
            options={[
              { value: 'all', label: 'All' },
              { value: 'images', label: 'Images' },
              { value: 'documents', label: 'Documents' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <ToggleGroup
            label="Layout"
            className="ml-auto"
            value={layout}
            onValueChange={setLayout}
            options={[
              { value: 'list', label: 'List', icon: <List aria-hidden />, iconOnly: true },
              { value: 'grid', label: 'Grid', icon: <LayoutGrid aria-hidden />, iconOnly: true },
            ]}
          />
        </div>
      ) : null}

      {files.isPending ? (
        <Skeleton height={160} rounded="lg" />
      ) : all.length === 0 ? (
        <div className={cn('rounded-xl border-2 border-dashed px-6 py-4 transition-colors', dragging ? 'border-primary bg-primary-subtle' : 'border-border-default')}>
          <EmptyState
            illustration="board"
            title="No files yet"
            description={canUpload ? 'Drag files here, or upload them. Files attached to tasks show up here too.' : 'Files attached to this project and its tasks show up here.'}
            actions={canUpload ? <Button leadingIcon={<Upload aria-hidden />} onClick={() => input.current?.click()}>Upload files</Button> : null}
          />
        </div>
      ) : list.length === 0 ? (
        <EmptyState illustration="search" size="sm" title="No files match" description="Try another name or pick All." />
      ) : layout === 'list' ? (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs" data-testid="files-list">
          {list.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sunken text-icon">
                {file.contentType.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <FileGlyph file={file} className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <a href={file.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-fg hover:underline">
                  {file.name}
                </a>
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                  <span className="shrink-0">{size(file.sizeBytes)}</span>
                  <span aria-hidden>·</span>
                  {taskLink(file)}
                </div>
              </div>
              <LocalTime iso={file.createdAt} className="hidden shrink-0 text-xs text-fg-muted md:inline" />
              <PersonAvatar userId={file.uploadedBy} size="xs" />
              {actions(file)}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="files-grid">
          {list.map((file) => (
            <li key={file.id} className="group overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs">
              <a href={file.url} target="_blank" rel="noreferrer" className="flex aspect-[4/3] items-center justify-center bg-sunken text-icon outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
                {file.contentType.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt={file.name} loading="lazy" className="size-full object-cover" />
                ) : (
                  <FileGlyph file={file} className="size-8" />
                )}
              </a>
              <div className="flex items-center gap-1 p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-fg" title={file.name}>{file.name}</p>
                  <p className="truncate text-2xs text-fg-muted">{size(file.sizeBytes)}</p>
                </div>
                {actions(file)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dragging && all.length > 0 ? (
        <div className="pointer-events-none absolute inset-2 z-[var(--z-raised)] flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary-subtle/80 text-sm font-semibold text-primary-text">
          Drop to upload to {project.name}
        </div>
      ) : null}
    </div>
  );
}
