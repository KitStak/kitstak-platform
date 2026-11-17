'use client';

/**
 * "Project tasks" rail card on shipment order, work order, purchase order and cycle count pages: the KitStak Projects tasks
 * linked to this record (live status, assignee, due date) plus linked projects with progress,
 * and "Create task" to plan follow-up work without leaving the WMS. Hidden entirely when
 * Projects isn't available to this install or user.
 */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, MoreHorizontal, Plus, Unlink } from 'lucide-react';
import { StatusIcon } from '@kitstak/ui/status-icon';
import { displayText } from '@kitstak/ui/text';
import type { BridgePriority, BridgeTask, WritableProject } from '@kitstak/pm-bridge/types';
import { apiFetch } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldError, FieldLabel } from '@/components/ui/form/form-field';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

/** Project task confirmations land bottom left, where KitStak Projects and CRM show theirs. */
const PROJECT_TOAST = { placement: 'bottom-start' } as const;
import { Tooltip } from '@/components/ui/tooltip';
import { RailCard } from '@/components/orders/wizard/order-summary';
import type { ProjectOptionsDto, RecordProjectsDto } from '@/server/projects/bridge';

type RecordKind = 'order' | 'work-order' | 'receipt' | 'count';

const API_BASE: Readonly<Record<RecordKind, string>> = {
  order: '/api/orders',
  'work-order': '/api/work-orders',
  receipt: '/api/purchase-orders',
  count: '/api/counts',
};
const NOUN: Readonly<Record<RecordKind, string>> = {
  order: 'order',
  'work-order': 'work order',
  receipt: 'purchase order',
  count: 'cycle count',
};
const PLACEHOLDER: Readonly<Record<RecordKind, string>> = {
  order: 'e.g. Confirm the delivery window with the customer',
  'work-order': 'e.g. Order extra boxes for this kit run',
  receipt: 'e.g. Check the damaged cartons with the vendor',
  count: 'e.g. Recount bin D1-04 and fix the variance',
};

const PRIORITIES: readonly { value: BridgePriority; label: string }[] = [
  { value: 'none', label: 'No priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

/** Projects stores label palette names ("blue", "green"…); the shared tokens define each one. */
const PM_COLOR_NAMES = new Set([
  'gray',
  'blue',
  'dark-blue',
  'green',
  'orange',
  'red',
  'purple',
  'sky',
  'pink',
  'teal',
  'yellow',
  'lime',
  'brown',
  'berry',
  'indigo',
  'peach',
]);
const pmColor = (name: string): string => `var(--label-${PM_COLOR_NAMES.has(name) ? name : 'gray'})`;

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Projects app mark (brand pack): three staggered bars. */
function ProjectsMark({ size = 14 }: { readonly size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="30 44 140 112">
      <rect x="38" y="52" width="80" height="26" fill="#C8102E" />
      <rect x="68" y="87" width="80" height="26" fill="#D65A6E" />
      <rect x="98" y="122" width="64" height="26" fill="#C8102E" />
    </svg>
  );
}

function TaskItem({ task, onUnlink }: { readonly task: BridgeTask; readonly onUnlink: () => void }) {
  return (
    <li className="group flex items-start gap-2.5 py-2" data-testid="wms-project-task">
      {/* Same glyph as KitStak Projects, tinted with the task's status color. */}
      <span className="mt-0.5 inline-flex">
        <StatusIcon
          category={task.status.category}
          color={task.status.color}
          size={16}
          label={task.status.name}
        />
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          title={displayText(task.title)}
          className={cn(
            'line-clamp-2 break-words text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30',
            task.done && 'text-faint line-through',
          )}
        >
          {displayText(task.title)}
        </a>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-secondary">
          {/* Task keys use the UI face with tabular figures: mono stacks draw "OPS" like "0PS". */}
          <span
            className="shrink-0 font-sans font-medium tabular-nums tracking-[0.01em]"
            data-testid="project-task-key"
          >
            {task.key}
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{task.status.name}</span>
          {task.dueDate ? (
            <>
              <span aria-hidden>·</span>
              <span className={cn('shrink-0 tabular-nums', task.overdue && 'font-semibold text-danger')}>
                {task.overdue ? 'Overdue ' : 'Due '}
                {shortDate(task.dueDate)}
              </span>
            </>
          ) : null}
        </div>
        <p className="mt-0.5 flex min-w-0 flex-wrap gap-x-1.5 text-xs text-faint">
          <span className="min-w-0 break-words">{displayText(task.projectName)}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{task.assignee ? task.assignee.name : 'Unassigned'}</span>
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More for ${task.key}`}
            className="rounded-md p-1 text-faint transition-colors hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => window.open(task.url, '_blank', 'noopener')}>
            <ArrowUpRight className="h-4 w-4" aria-hidden />
            Open {task.key} in Projects
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onUnlink} className="text-danger">
            <Unlink className="h-4 w-4" aria-hidden />
            Unlink from this record
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

interface CreateTaskDialogProps {
  readonly kind: RecordKind;
  readonly recordId: string;
  readonly recordLabel: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (task: BridgeTask) => void;
}

function CreateTaskDialog(props: CreateTaskDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* The form mounts with the dialog content, so every opening starts fresh. */}
      <DialogContent size="md" data-testid="wms-create-task-dialog">
        <CreateTaskForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function CreateTaskForm({
  kind,
  recordId,
  recordLabel,
  open,
  onOpenChange,
  onCreated,
}: CreateTaskDialogProps) {
  const options = useApiQuery<ProjectOptionsDto>(
    ['project-tasks', 'options'],
    open ? '/api/project-tasks/options' : null,
    {
      staleTime: 60_000,
    },
  );
  const projects: readonly WritableProject[] = React.useMemo(
    () => options.data?.data.projects ?? [],
    [options.data],
  );
  const people = options.data?.data.people ?? [];
  const [title, setTitle] = React.useState('');
  const [chosenProjectId, setProjectId] = React.useState<string | null>(null);
  const [statusId, setStatusId] = React.useState<string | null>(null);
  const [assigneeId, setAssigneeId] = React.useState<string | null>(null);
  const [due, setDue] = React.useState<Date | null>(null);
  const [priority, setPriority] = React.useState<BridgePriority>('none');
  const [notes, setNotes] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const titleId = React.useId();
  const projectFieldId = React.useId();

  // Until the user picks, default to the most recently used project.
  const projectId = chosenProjectId ?? projects[0]?.id ?? null;

  const project = projects.find((p) => p.id === projectId);
  const noProjects = options.isSuccess && projects.length === 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = 'Give the task a name';
    if (!projectId) next.projectId = 'Pick a project';
    setErrors(next);
    if (Object.keys(next).length || !projectId) return;
    setSaving(true);
    try {
      const task = await apiFetch<BridgeTask>(
        `${API_BASE[kind]}/${encodeURIComponent(recordId)}/project-tasks`,
        {
          method: 'POST',
          body: {
            projectId,
            title: title.trim(),
            statusId,
            assigneeId,
            priority,
            dueDate: due ? toIsoDate(due) : null,
            description: notes.trim() || null,
          },
        },
      );
      toast.success(
        `${task.key} created in ${task.projectName}`,
        `It’s linked to ${recordLabel}.`,
        PROJECT_TOAST,
      );
      onOpenChange(false);
      onCreated(task);
    } catch (error) {
      const fieldErrors = (error as { fieldErrors?: Record<string, readonly string[]> }).fieldErrors ?? {};
      const first = Object.fromEntries(
        Object.entries(fieldErrors).map(([field, messages]) => [field, messages[0] ?? '']),
      );
      if (Object.keys(first).length) setErrors(first);
      toast.error(
        'Couldn’t create the task',
        error instanceof Error ? error.message : 'Please try again.',
        PROJECT_TOAST,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col" noValidate>
      <DialogHeader
        title="Create a task in Projects"
        description={`Linked to ${NOUN[kind]} ${recordLabel}. Your team sees it in KitStak Projects.`}
      />
      <DialogBody className="flex flex-col gap-4">
        {noProjects ? (
          <p className="rounded-md border border-dashed border-border bg-surface-sunken px-3 py-3 text-center text-sm text-secondary">
            You don’t have a project you can add tasks to yet. Create one in KitStak Projects first.
          </p>
        ) : null}
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={titleId} required>
            Task name
          </FieldLabel>
          <TextField
            id={titleId}
            autoFocus
            value={title}
            maxLength={500}
            invalid={Boolean(errors.title)}
            placeholder={PLACEHOLDER[kind]}
            onChange={(event) => setTitle(event.target.value)}
            data-testid="wms-task-title"
          />
          <FieldError id={`${titleId}-error`} message={errors.title} />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={projectFieldId} required>
            Project
          </FieldLabel>
          <Combobox
            id={projectFieldId}
            aria-label="Project"
            value={projectId}
            onChange={(value) => {
              setProjectId(value);
              setStatusId(null);
            }}
            options={projects.map((p) => ({
              value: p.id,
              label: p.name,
              description: [p.key, p.spaceName].filter(Boolean).join(' · '),
            }))}
            loading={options.isPending}
            invalid={Boolean(errors.projectId)}
            placeholder="Pick a project"
            emptyText="No projects match"
            disabled={noProjects}
          />
          <FieldError id={`${projectFieldId}-error`} message={errors.projectId} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <FieldLabel>Status</FieldLabel>
            <Select
              aria-label="Status"
              value={statusId}
              onChange={setStatusId}
              options={(project?.statuses ?? [])
                .filter((s) => s.category !== 'cancelled')
                .map((s) => ({ value: s.id, label: s.name }))}
              placeholder={project?.statuses[0]?.name ?? 'First column'}
              disabled={!project}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Priority</FieldLabel>
            <Select
              aria-label="Priority"
              value={priority}
              onChange={(value) => setPriority(value ?? 'none')}
              options={PRIORITIES}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Assignee</FieldLabel>
            <Combobox
              aria-label="Assignee"
              value={assigneeId}
              onChange={(value) => setAssigneeId(value)}
              options={people.map((p) => ({ value: p.id, label: p.name, description: p.email }))}
              loading={options.isPending}
              clearable
              placeholder="No one yet"
              emptyText="No one matches"
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Due date</FieldLabel>
            <DatePicker
              aria-label="Due date"
              value={due}
              onChange={setDue}
              placeholder="No due date"
              clearable
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>Notes</FieldLabel>
          <Textarea
            rows={3}
            value={notes}
            maxLength={20_000}
            placeholder="Anything your team should know"
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving || noProjects} data-testid="wms-task-submit">
          {saving ? 'Creating…' : 'Create task'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Order pages use the rail's small caps card; work order pages use the aside's section style;
 * purchase order and count pages use a divided rail block like their other rail sections.
 */
function CardShell({
  variant,
  title,
  action,
  children,
}: {
  readonly variant: 'rail' | 'aside' | 'divided';
  readonly title: React.ReactNode;
  readonly action: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  if (variant === 'rail')
    return (
      <RailCard title={title} action={action}>
        {children}
      </RailCard>
    );
  if (variant === 'divided')
    return (
      <section
        className="flex min-w-0 flex-col gap-2 border-t border-border pt-3"
        data-testid="wms-project-tasks"
      >
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-foreground">{title}</h2>
          {action}
        </header>
        {children}
      </section>
    );
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function ProjectTasksCard({
  kind,
  recordId,
  recordLabel,
  variant = 'rail',
}: {
  readonly variant?: 'rail' | 'aside' | 'divided';
  readonly kind: RecordKind;
  /** Record id (or code). */
  readonly recordId: string;
  /** Human label for messages ("SO010421"). */
  readonly recordLabel: string;
}) {
  const queryClient = useQueryClient();
  const key = React.useMemo(() => ['project-tasks', kind, recordId] as const, [kind, recordId]);
  const query = useApiQuery<RecordProjectsDto>(
    key,
    `${API_BASE[kind]}/${encodeURIComponent(recordId)}/project-tasks`,
    {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: false,
    },
  );
  const [creating, setCreating] = React.useState(false);
  const [showDone, setShowDone] = React.useState(false);
  const data = query.data?.data;
  if (!data?.available) return null;

  const tasks = data.work.tasks;
  const open = tasks.filter((t) => !t.done);
  const doneCount = tasks.length - open.length;
  const visible = showDone ? tasks : open;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const unlink = async (linkId: string, name: string) => {
    try {
      await apiFetch(`${API_BASE[kind]}/${encodeURIComponent(recordId)}/project-tasks/${linkId}`, {
        method: 'DELETE',
      });
      toast.success(`${name} unlinked`, 'It’s still in KitStak Projects.', PROJECT_TOAST);
      refresh();
    } catch (error) {
      toast.error(
        'Couldn’t unlink it',
        error instanceof Error ? error.message : 'Please try again.',
        PROJECT_TOAST,
      );
    }
  };

  return (
    <CardShell
      variant={variant}
      title={
        <span className="inline-flex items-center gap-1.5">
          <ProjectsMark />
          Project tasks
          {open.length ? (
            <span className="rounded-full bg-neutral-soft px-1.5 text-2xs font-semibold text-secondary tabular-nums">
              {open.length}
            </span>
          ) : null}
        </span>
      }
      action={
        <Tooltip content="Create a task in KitStak Projects">
          <Button size="xs" variant="ghost" onClick={() => setCreating(true)} data-testid="wms-create-task">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create task
          </Button>
        </Tooltip>
      }
    >
      {data.work.projects.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.work.projects.map((project) => (
            <li key={project.id} className="rounded-md border border-border px-2.5 py-2">
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: pmColor(project.color) }}
                />
                <span className="truncate">{displayText(project.name)}</span>
                <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
              </a>
              <ProgressBar
                value={project.progress.percent}
                size="sm"
                label={`${project.name} progress`}
                className="mt-2"
                tone={project.progress.percent === 100 ? 'success' : 'primary'}
              />
              <p className="mt-1 text-xs text-secondary tabular-nums">
                {project.progress.total === 0
                  ? 'No tasks yet'
                  : `${project.progress.done} of ${project.progress.total} tasks done`}
                {project.progress.overdue ? (
                  <span className="text-danger"> · {project.progress.overdue} overdue</span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-secondary">No tasks linked yet.</p>
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Create task
          </Button>
        </div>
      ) : (
        <>
          {visible.length ? (
            <ul className="-my-1 divide-y divide-border">
              {visible.map((task) => (
                <TaskItem key={task.id} task={task} onUnlink={() => void unlink(task.linkId, task.key)} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">Every linked task is done.</p>
          )}
          {doneCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="self-start text-xs font-medium text-secondary hover:text-foreground hover:underline"
            >
              {showDone ? 'Hide done tasks' : `Show ${doneCount} done task${doneCount === 1 ? '' : 's'}`}
            </button>
          ) : null}
        </>
      )}
      <CreateTaskDialog
        kind={kind}
        recordId={recordId}
        recordLabel={recordLabel}
        open={creating}
        onOpenChange={setCreating}
        onCreated={refresh}
      />
    </CardShell>
  );
}
