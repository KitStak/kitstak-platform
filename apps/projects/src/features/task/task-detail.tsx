'use client';
import './task.css';
/**
 * Task detail, shared by the side drawer (`?task=OPS-42` on any page) and the full page
 * (/p/OPS/42). Header: breadcrumb, previous / next, followers, open full page, actions menu.
 * Body: title, properties, description (autosaving rich text), subtasks, dependencies, linked
 * CRM/WMS records, files, time tracking, and comments interleaved with history. Wide layouts
 * (≥ 880px) move properties and time into a right sidebar. Files dropped anywhere attach.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react';
import { Button, EmptyState, IconButton, Skeleton, Tooltip, cn, toast } from '@/components/ui';
import { EntityIcon, StatusIcon } from '@/components/pm';
import { isEditableTarget, useHotkey } from '@/lib/hooks/use-hotkeys';
import { useProject, useTask, useTaskAttachments } from '@/lib/hooks/use-data';
import { TASKS_DELETED_EVENT } from '@/lib/hooks/use-task-mutations';
import { addDaysIso, todayIso } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { parseTaskKey } from '@/lib/task-key';
import type { TaskDetail } from '@/lib/types';
import { ProjectProvider } from '@/features/projects/project-context';
import { ActivityFeed } from './activity-feed';
import { AttachmentsSection, DropOverlay } from './attachments-section';
import { BlockedBanner, DependenciesSection } from './dependencies-section';
import { DescriptionEditor } from './description-editor';
import { LinksSection } from './links-section';
import { SubtasksSection } from './subtasks-section';
import { OpenFullPageLink, TaskActionsMenu, useTaskActions } from './task-actions-menu';
import { TaskContextProvider, useTaskContext } from './task-context';
import { TASK_PANEL_ATTR, useTaskNeighbours } from './task-nav';
import { TaskProperties } from './task-properties';
import { TimeSection } from './time-section';
import { useTaskUploads } from './use-task-uploads';
import { WatchersButton } from './watchers';
import { taskKeyAction } from './task-keys';
import { useShell } from '@/features/shell/shell-context';

export interface TaskDetailViewProps {
  /** Task uuid or key (OPS-42). */
  readonly taskRef: string;
  readonly variant?: 'drawer' | 'page';
  readonly onDeleted?: () => void;
  readonly initialData?: TaskDetail;
  /** Drawer: close button handler. */
  readonly onClose?: () => void;
  /** Open another task in place (drawer swaps the `?task=` param; page navigates). */
  readonly onOpenTask?: (key: string, options?: { replace?: boolean }) => void;
}

/** Keys pressed inside these belong to them, not to task navigation. */
const BUSY_KEYS_SELECTOR =
  '[role="menu"], [role="listbox"], [role="toolbar"], [role="radiogroup"], [role="separator"], [aria-roledescription="sortable"], [data-radix-popper-content-wrapper], [cmdk-root]';

/** Width at which properties move into a right-hand sidebar. */
const WIDE_PX = 880;

function useWide(ref: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= WIDE_PX));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}

/**
 * The shared task key map inside the drawer and on the task page: Ctrl/Cmd+Enter marks it done
 * (or reopens it), Ctrl/Cmd+. copies its link, I assigns it to you, T / Shift+T make it due
 * today / tomorrow. In the drawer the keys only count while focus is in the panel; outside it,
 * the view behind acts on its cursor task (which is the task the drawer shows).
 */
function useTaskKeys(actions: ReturnType<typeof useTaskActions>) {
  const { task, canEdit, patch, variant } = useTaskContext();
  const { user } = useShell();
  const ref = useRef({ actions, task, canEdit, patch, userId: user.id });
  useEffect(() => {
    ref.current = { actions, task, canEdit, patch, userId: user.id };
  });
  useEffect(() => {
    const run = (event: KeyboardEvent): boolean => {
      const action = taskKeyAction(event);
      if (!action) return false;
      const { actions: current, task: shown, canEdit: editable, patch: save, userId } = ref.current;
      if (action === 'copy-link') {
        void current.copyLink();
        return true;
      }
      if (!editable) return false;
      if (action === 'toggle-done') {
        void current.toggleDone();
        return true;
      }
      if (action === 'assign-me' && shown.assigneeId !== userId) {
        const previous = shown.assigneeId;
        void save({ assigneeId: userId });
        toast.undo(`Assigned ${shown.key} to you`, { onUndo: () => void save({ assigneeId: previous }) });
        return true;
      }
      if (action === 'due-today' || action === 'due-tomorrow') {
        const dueDate = action === 'due-today' ? todayIso() : addDaysIso(todayIso(), 1);
        const previous = shown.dueDate;
        void save({ dueDate });
        toast.undo(`${shown.key} is due ${action === 'due-today' ? 'today' : 'tomorrow'}`, { onUndo: () => void save({ dueDate: previous }) });
        return true;
      }
      return false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isEditableTarget(target) || target?.closest(BUSY_KEYS_SELECTOR)) return;
      if (variant === 'page' && document.querySelector('[role="dialog"][data-state="open"], [role="menu"], [cmdk-root]')) return;
      if (run(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    if (variant === 'page') {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const panel = document.querySelector<HTMLElement>(`[${TASK_PANEL_ATTR}]`);
    if (!panel) return undefined;
    panel.addEventListener('keydown', onKey);
    return () => panel.removeEventListener('keydown', onKey);
  }, [variant]);
}

function TaskTitle() {
  const { task, canEdit, patch, statusById } = useTaskContext();
  const actions = useTaskActions();
  useTaskKeys(actions);
  const [draft, setDraft] = useState<string | null>(null);
  const status = statusById.get(task.statusId);
  const closed = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== task.title) void patch({ title: next });
  };
  return (
    <div className="flex items-start gap-2.5">
      <Tooltip content={!canEdit ? (status?.name ?? '') : closed ? 'Reopen' : 'Mark done'}>
        <button
          type="button"
          disabled={!canEdit || (!actions.doneStatus && !closed)}
          onClick={() => void actions.toggleDone()}
          aria-label={closed ? `Reopen ${task.key}` : `Mark ${task.key} done`}
          data-testid="task-done-toggle"
          className="mt-0.5 @min-[560px]:mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:bg-transparent"
        >
          <StatusIcon category={task.statusCategory} color={status?.color} size={22} />
        </button>
      </Tooltip>
      {canEdit ? (
        <textarea
          value={draft ?? task.title}
          onChange={(event) => setDraft(event.target.value.replace(/\n/g, ' '))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
              requestAnimationFrame(() => (event.target as HTMLTextAreaElement).blur());
            }
          }}
          rows={1}
          maxLength={500}
          aria-label="Task name"
          data-testid="task-title-input"
          className={cn(
            'min-w-0 flex-1 resize-none rounded-md bg-transparent px-1.5 py-0.5 text-xl leading-8 @min-[560px]:text-2xl @min-[560px]:leading-9 font-semibold tracking-[-0.01em] text-fg outline-none [field-sizing:content]',
            'hover:bg-hover focus-visible:bg-panel focus-visible:ring-2 focus-visible:ring-focus/30',
            closed && 'text-fg-secondary',
          )}
        />
      ) : (
        <h1 className="min-w-0 flex-1 px-1.5 py-0.5 text-xl leading-8 @min-[560px]:text-2xl @min-[560px]:leading-9 font-semibold tracking-[-0.01em] text-fg">
          {task.title}
        </h1>
      )}
    </div>
  );
}

function Breadcrumb() {
  const { task, project, openTask } = useTaskContext();
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-fg-secondary">
        <li className="flex min-w-0 shrink items-center">
          <Link
            href={routes.project(project.key)}
            className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
          >
            <EntityIcon icon={project.icon} color={project.color} size={18} />
            <span className="truncate">{project.name}</span>
          </Link>
        </li>
        {task.parent ? (
          <>
            <li aria-hidden className="shrink-0 text-fg-muted">
              <ChevronRight className="size-3.5" />
            </li>
            <li className="flex min-w-[4ch] shrink-[2] items-center">
              <button
                type="button"
                onClick={() => openTask(task.parent!.key)}
                className="truncate rounded-sm px-1 py-0.5 font-mono text-xs hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                title={task.parent.title}
              >
                {task.parent.key}
              </button>
            </li>
          </>
        ) : null}
        <li aria-hidden className="shrink-0 text-fg-muted">
          <ChevronRight className="size-3.5" />
        </li>
        <li className="shrink-0">
          <span aria-current="page" className="px-1 font-mono text-xs font-medium text-fg">
            {task.key}
          </span>
        </li>
      </ol>
    </nav>
  );
}

function TaskNav({ onNavigate }: { readonly onNavigate: (key: string) => void }) {
  const { task, statuses, variant } = useTaskContext();
  const nav = useTaskNeighbours(task.key, task.projectKey, statuses, { preferPage: variant === 'drawer' });
  const go = (delta: 1 | -1) => {
    const list = nav.refreshList();
    const index = list.indexOf(task.key);
    const target = list[index + delta];
    if (index >= 0 && target) onNavigate(target);
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  // Drawer: ↑/↓ and j/k while focus is in the panel. Listening on the panel itself runs before
  // any page-level shortcut of the view behind (a list's own arrow keys), and stops it.
  useEffect(() => {
    if (variant !== 'drawer') return;
    const panel = document.querySelector<HTMLElement>(`[${TASK_PANEL_ATTR}]`);
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const delta = event.key === 'ArrowDown' || event.key === 'j' ? 1 : event.key === 'ArrowUp' || event.key === 'k' ? -1 : 0;
      if (!delta) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isEditableTarget(target) || target?.closest(BUSY_KEYS_SELECTOR)) return;
      event.preventDefault();
      event.stopPropagation();
      goRef.current(delta);
    };
    panel.addEventListener('keydown', onKey);
    return () => panel.removeEventListener('keydown', onKey);
  }, [variant]);

  // Full page: j / k (arrows keep scrolling the page).
  const pageOptions = { enabled: variant === 'page' && nav.total > 1 } as const;
  useHotkey('j', () => go(1), pageOptions);
  useHotkey('k', () => go(-1), pageOptions);
  if (nav.total < 2 || nav.index < 0) return null;
  return (
    <div
      className="flex shrink-0 items-center"
      role="group"
      aria-label={`Task ${nav.index + 1} of ${nav.total}`}
    >
      <IconButton
        size="sm"
        label="Previous task"
        shortcut={['K']}
        icon={<ChevronUp aria-hidden />}
        disabled={!nav.prev}
        onClick={() => go(-1)}
        data-testid="task-prev"
      />
      <span aria-hidden className="hidden min-w-12 text-center text-xs text-fg-muted tabular-nums sm:inline">
        {nav.index + 1} / {nav.total}
      </span>
      <IconButton
        size="sm"
        label="Next task"
        shortcut={['J']}
        icon={<ChevronDown aria-hidden />}
        disabled={!nav.next}
        onClick={() => go(1)}
        data-testid="task-next"
      />
    </div>
  );
}

function TaskHeader({
  onClose,
  onNavigate,
}: {
  readonly onClose?: () => void;
  readonly onNavigate: (key: string) => void;
}) {
  const { variant } = useTaskContext();
  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center gap-1.5 border-b border-border-subtle pr-2 pl-3',
        variant === 'page' && 'rounded-t-xl',
      )}
    >
      <Breadcrumb />
      <TaskNav onNavigate={onNavigate} />
      <span aria-hidden className="mx-0.5 hidden h-5 w-px shrink-0 bg-border-subtle sm:block" />
      <WatchersButton />
      {variant === 'drawer' ? <OpenFullPageLink /> : null}
      <TaskActionsMenu />
      {onClose ? (
        <DialogPrimitive.Close asChild>
          <IconButton
            label="Close"
            icon={<X aria-hidden />}
            shortcut={['Esc']}
            data-testid="task-drawer-close"
          />
        </DialogPrimitive.Close>
      ) : null}
    </header>
  );
}

function Section({ children }: { readonly children: ReactNode }) {
  return <div className="border-t border-border-subtle pt-5">{children}</div>;
}

function TaskBody({
  onClose,
  onNavigate,
}: {
  readonly onClose?: () => void;
  readonly onNavigate: (key: string) => void;
}) {
  const { task, variant, canUpload } = useTaskContext();
  const root = useRef<HTMLDivElement>(null);
  const wide = useWide(root);
  const uploads = useTaskUploads(task);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const isFileDrag = (event: React.DragEvent) => canUpload && event.dataTransfer.types.includes('Files');

  const main = (
    <div className="flex min-w-0 flex-col gap-5">
      <BlockedBanner />
      <TaskTitle />
      {wide ? null : (
        <div className="-mt-1">
          <TaskProperties compact />
        </div>
      )}
      <DescriptionEditor />
      <Section>
        <SubtasksSection />
      </Section>
      <Section>
        <DependenciesSection />
      </Section>
      <LinksBlock />
      <FilesBlock uploads={uploads} />
      {wide ? null : <TimeBlock />}
      <Section>
        <ActivityFeed />
      </Section>
    </div>
  );

  return (
    <div
      ref={root}
      className="@container relative flex min-h-0 flex-1 flex-col"
      data-testid="task-detail"
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (isFileDrag(event)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        depth.current = 0;
        setDragging(false);
        if (!isFileDrag(event) || event.defaultPrevented) return;
        event.preventDefault();
        const files = [...event.dataTransfer.files];
        if (files.length) void uploads.upload(files);
      }}
    >
      <TaskHeader onClose={onClose} onNavigate={onNavigate} />
      <div className={cn('min-h-0 flex-1', variant === 'drawer' && 'overflow-y-auto')} data-task-scroll>
        {wide ? (
          <div className="grid grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 px-8 py-6">{main}</div>
            <aside
              aria-label="Task details"
              className="flex flex-col gap-5 border-l border-border-subtle bg-sunken/40 px-5 py-6"
            >
              <TaskProperties />
              <div className="border-t border-border-subtle pt-5">
                <TimeSection />
              </div>
            </aside>
          </div>
        ) : (
          <div className="px-4 py-5 sm:px-6">{main}</div>
        )}
      </div>
      <DropOverlay taskKey={task.key} active={dragging} />
    </div>
  );
}

function LinksBlock() {
  return (
    <SectionIfContent>
      <LinksSection />
    </SectionIfContent>
  );
}

function FilesBlock({ uploads }: { readonly uploads: ReturnType<typeof useTaskUploads> }) {
  return (
    <SectionIfContent>
      <AttachmentsSection uploads={uploads} />
    </SectionIfContent>
  );
}

function TimeBlock() {
  return (
    <SectionIfContent>
      <TimeSection />
    </SectionIfContent>
  );
}

/** Divider + spacing that disappears when the child renders nothing (e.g. no links possible). */
function SectionIfContent({ children }: { readonly children: ReactNode }) {
  return (
    <div className="border-t border-border-subtle pt-5 empty:hidden [&:not(:has(section))]:hidden">
      {children}
    </div>
  );
}

export function TaskDetailSkeleton({ variant = 'drawer' }: { readonly variant?: 'drawer' | 'page' }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading task"
      className="flex flex-col"
      data-testid="task-detail-loading"
    >
      <div className="flex h-12 items-center gap-2 border-b border-border-subtle px-4">
        <Skeleton width={18} height={18} rounded="sm" />
        <Skeleton width={140} height={14} />
        <Skeleton width={56} height={14} />
        <div className="ml-auto flex gap-1.5">
          <Skeleton width={28} height={28} rounded="md" />
          <Skeleton width={28} height={28} rounded="md" />
        </div>
      </div>
      <div className={cn('flex flex-col gap-5 py-6', variant === 'page' ? 'px-8' : 'px-6')}>
        <div className="flex items-center gap-3">
          <Skeleton width={24} height={24} rounded="full" />
          <Skeleton height={28} width="65%" />
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton width={96} height={14} />
              <Skeleton width={index % 3 === 0 ? 120 : 90} height={14} />
            </div>
          ))}
        </div>
        <Skeleton height={14} width={90} />
        <Skeleton height={96} rounded="lg" />
        <Skeleton height={14} width={90} />
        <Skeleton height={36} />
        <Skeleton height={36} />
      </div>
    </div>
  );
}

function TaskProblem({
  message,
  notFound,
  onClose,
}: {
  readonly message: string;
  readonly notFound: boolean;
  readonly onClose?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      {onClose ? (
        <div className="flex h-12 items-center justify-end border-b border-border-subtle px-2">
          <DialogPrimitive.Close asChild>
            <IconButton label="Close" icon={<X aria-hidden />} shortcut={['Esc']} />
          </DialogPrimitive.Close>
        </div>
      ) : null}
      <EmptyState
        className="flex-1"
        illustration={notFound ? 'search' : 'error'}
        title={notFound ? "We couldn't find that task" : "This task didn't load"}
        description={
          notFound
            ? 'It may have been deleted, moved to another project, or you may not have access to its project.'
            : message
        }
        actions={
          <>
            {notFound ? null : (
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            )}
            <Button
              variant={notFound ? 'primary' : 'ghost'}
              onClick={() => (onClose ? onClose() : window.location.assign(routes.myWork()))}
            >
              {onClose ? 'Close' : 'Go to My work'}
            </Button>
          </>
        }
      />
    </div>
  );
}

export function TaskDetailView({
  taskRef,
  variant = 'drawer',
  onDeleted,
  initialData,
  onClose,
  onOpenTask,
}: TaskDetailViewProps) {
  const router = useRouter();
  const [live, setLive] = useState(true);
  const liveRef = useRef(true);
  const task = useTask(taskRef, { initialData, enabled: live && Boolean(taskRef) });
  const data = task.data;
  const project = useProject(data?.projectKey ?? '', { enabled: Boolean(data) });
  // Files load next to the project, not after the body renders, so the Files tiles draw real
  // names and sizes on the first paint of the panel.
  useTaskAttachments(data?.id, { enabled: live && Boolean(data?.id) && (data?.attachmentCount ?? 0) > 0 });
  const retire = useCallback(() => {
    liveRef.current = false;
    setLive(false);
  }, []);

  // Deleted from somewhere else (a board card menu, the list bulk bar…): leave instead of reloading it.
  const shownId = data?.id;
  const shownProjectKey = data?.projectKey;
  useEffect(() => {
    if (!shownId || !shownProjectKey) return undefined;
    const handle = (event: Event) => {
      const ids = (event as CustomEvent<{ ids?: readonly string[] }>).detail?.ids ?? [];
      if (!liveRef.current || !ids.includes(shownId)) return;
      retire();
      if (onDeleted) onDeleted();
      else router.push(routes.project(shownProjectKey));
    };
    window.addEventListener(TASKS_DELETED_EVENT, handle);
    return () => window.removeEventListener(TASKS_DELETED_EVENT, handle);
  }, [shownId, shownProjectKey, onDeleted, retire, router]);

  const openTask = (key: string, options?: { replace?: boolean }) => {
    if (onOpenTask) return onOpenTask(key, options);
    const parsed = parseTaskKey(key);
    if (!parsed) return;
    const href = routes.task(parsed.projectKey, parsed.number);
    if (options?.replace) router.replace(href);
    else router.push(href);
  };

  if (!data || !project.data) {
    const error = task.error ?? project.error;
    if (error) {
      const code = (error as Error & { code?: string; status?: number }).code;
      const status = (error as Error & { status?: number }).status;
      const notFound = code === 'NOT_FOUND' || code === 'FORBIDDEN' || status === 404 || status === 403;
      return <TaskProblem message={error.message} notFound={notFound} onClose={onClose} />;
    }
    return <TaskDetailSkeleton variant={variant} />;
  }

  return (
    <ProjectProvider initial={project.data}>
      <TaskContextProvider
        taskRef={taskRef}
        task={data}
        project={project.data}
        variant={variant}
        openTask={(key) => openTask(key)}
        onDeleted={onDeleted}
        live={live}
        retire={retire}
      >
        <TaskBody onClose={onClose} onNavigate={(key) => openTask(key, { replace: true })} />
      </TaskContextProvider>
    </ProjectProvider>
  );
}
