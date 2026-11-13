'use client';
/**
 * Item panel "Projects" tab: the KitStak Projects work linked to this record. Linked projects
 * show health, status and progress; linked tasks show live status, assignee and due date. From
 * here you can create a task (linked to this record), start a project from it (Projects wizard,
 * prefilled), link an existing project, or unlink. Everything opens in KitStak Projects.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Plus,
  Rocket,
  Unlink,
} from 'lucide-react';
import type { BridgeProject, BridgeTask } from '@kitstak/pm-bridge/types';
import {
  Avatar,
  Button,
  Combobox,
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
  ProgressBar,
  Skeleton,
  StatusPill,
  Tooltip,
  cn,
  toLabelColor,
  toast,
} from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import { useItemProjects, useLinkItemProject, useProjectOptions, useUnlinkItemWork } from './api';
import { CreateTaskDialog } from './create-task-dialog';
import { ProjectsMark } from './projects-mark';

const HEALTH: Readonly<
  Record<BridgeProject['health'], { label: string; color: 'green' | 'orange' | 'red' }>
> = {
  on_track: { label: 'On track', color: 'green' },
  at_risk: { label: 'At risk', color: 'orange' },
  off_track: { label: 'Off track', color: 'red' },
};

const PROJECT_STATUS: Readonly<Record<BridgeProject['status'], string>> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

const PRIORITY_LABEL: Readonly<Record<BridgeTask['priority'], string | null>> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: null,
};

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

function shortDate(iso: string): string {
  const date = parseISO(iso);
  return format(date, date.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

function SectionTitle({
  id,
  children,
  count,
}: {
  readonly id: string;
  readonly children: string;
  readonly count: number;
}) {
  return (
    <h3 id={id} className="flex items-center gap-2 text-sm font-semibold text-fg">
      {children}
      <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary tabular-nums">
        {count}
      </span>
    </h3>
  );
}

function ProjectCard({
  project,
  canUnlink,
  onAddTask,
  onUnlink,
}: {
  readonly project: BridgeProject;
  readonly canUnlink: boolean;
  readonly onAddTask: () => void;
  readonly onUnlink: () => void;
}) {
  const health = HEALTH[project.health];
  const { total, done, overdue, percent } = project.progress;
  const finished = project.status === 'completed' || project.archived;
  return (
    <li
      className="group/card rounded-lg border border-border-subtle bg-panel p-3 transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-default hover:shadow-xs"
      data-testid="crm-linked-project"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--lc-subtle)] text-xs font-bold text-[var(--lc-text)]"
          style={labelStyle(project.color)}
        >
          {project.key.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <a
              href={project.url}
              {...EXTERNAL}
              className="min-w-0 truncate text-base font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              title={project.name}
            >
              {project.name}
            </a>
            <span className="shrink-0 font-mono text-xs text-fg-muted">{project.key}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {finished ? (
              <StatusPill label={project.archived ? 'Archived' : 'Completed'} color="gray" />
            ) : (
              <StatusPill label={health.label} color={health.color} />
            )}
            {!finished && project.status !== 'active' ? (
              <StatusPill label={PROJECT_STATUS[project.status]} color="gray" />
            ) : null}
            {project.dueDate ? (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <CalendarDays aria-hidden className="size-3.5" />
                Due {shortDate(project.dueDate)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {project.owner ? (
            <Tooltip content={`Owner: ${project.owner.name}`}>
              <span>
                <Avatar name={project.owner.name} src={project.owner.image} size="sm" />
              </span>
            </Tooltip>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                label={`More for ${project.name}`}
                icon={<MoreHorizontal aria-hidden />}
                hideTooltip
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                icon={<ArrowUpRight aria-hidden />}
                onSelect={() => window.open(project.url, '_blank', 'noopener')}
              >
                Open in Projects
              </DropdownMenuItem>
              {!finished ? (
                <DropdownMenuItem icon={<Plus aria-hidden />} onSelect={onAddTask}>
                  Add a task here
                </DropdownMenuItem>
              ) : null}
              {canUnlink ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Unlink aria-hidden />} variant="danger" onSelect={onUnlink}>
                    Unlink from this record
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <ProgressBar
          value={percent}
          label={`${project.name} progress`}
          size="sm"
          tone={percent === 100 ? 'success' : 'primary'}
          className="flex-1"
        />
        <span className="shrink-0 text-xs text-fg-secondary tabular-nums">{percent}%</span>
      </div>
      <p className="mt-1.5 text-xs text-fg-muted tabular-nums">
        {total === 0 ? 'No tasks yet' : `${done} of ${total} task${total === 1 ? '' : 's'} done`}
        {overdue > 0 ? <span className="text-danger-text"> · {overdue} overdue</span> : null}
      </p>
    </li>
  );
}

function labelStyle(color: string) {
  const c = toLabelColor(color, 'blue');
  return {
    '--lc-subtle': `var(--label-${c}-subtle)`,
    '--lc-text': `var(--label-${c}-text)`,
  } as CSSProperties;
}

function TaskRow({ task, onUnlink }: { readonly task: BridgeTask; readonly onUnlink: () => void }) {
  const priority = PRIORITY_LABEL[task.priority];
  return (
    <li className="group/task flex min-h-11 items-center gap-2.5 px-3 py-2" data-testid="crm-linked-task">
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]',
          task.done
            ? 'border-success bg-success text-white'
            : task.status.category === 'in_progress'
              ? 'border-primary'
              : 'border-border-strong',
        )}
      >
        {task.done ? (
          <Check className="size-2.5" strokeWidth={3} />
        ) : task.status.category === 'in_progress' ? (
          <span className="size-1.5 rounded-full bg-primary" />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={task.url}
          {...EXTERNAL}
          className={cn(
            'block truncate text-base text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus',
            task.done && 'text-fg-muted line-through decoration-fg-muted/60',
          )}
          title={task.title}
        >
          {task.title}
        </a>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <span className="shrink-0 font-mono">{task.key}</span>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <span className="min-w-0 truncate">{task.projectName}</span>
          {priority ? (
            <span
              className={cn(
                'shrink-0 before:mr-1.5 before:text-fg-muted before:content-["·"]',
                task.priority === 'urgent' || task.priority === 'high' ? 'font-medium text-danger-text' : '',
              )}
            >
              {priority}
            </span>
          ) : null}
        </div>
      </div>
      <StatusPill
        label={task.status.name}
        color={toLabelColor(task.status.color)}
        className="hidden shrink-0 @min-[420px]:inline-flex"
      />
      {task.dueDate ? (
        <span
          className={cn(
            'hidden w-14 shrink-0 text-right text-xs tabular-nums @min-[360px]:inline',
            task.overdue ? 'font-medium text-danger-text' : 'text-fg-secondary',
          )}
        >
          {shortDate(task.dueDate)}
        </span>
      ) : (
        <span className="hidden w-14 shrink-0 @min-[360px]:inline" />
      )}
      {task.assignee ? (
        <Tooltip content={task.assignee.name}>
          <span className="shrink-0">
            <Avatar name={task.assignee.name} src={task.assignee.image} size="xs" />
          </span>
        </Tooltip>
      ) : (
        <span
          aria-label="Unassigned"
          className="size-5 shrink-0 rounded-full border border-dashed border-border-strong"
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="sm"
            label={`More for ${task.key}`}
            icon={<MoreHorizontal aria-hidden />}
            hideTooltip
            className="shrink-0"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            icon={<ArrowUpRight aria-hidden />}
            onSelect={() => window.open(task.url, '_blank', 'noopener')}
          >
            Open {task.key}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<Unlink aria-hidden />} variant="danger" onSelect={onUnlink}>
            Unlink from this record
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function LinkProjectDialog({
  itemId,
  open,
  onOpenChange,
  excludeIds,
}: {
  readonly itemId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly excludeIds: readonly string[];
}) {
  const options = useProjectOptions(open);
  const link = useLinkItemProject(itemId);
  const [projectId, setProjectId] = useState<string | null>(null);
  const projects = (options.data?.projects ?? []).filter((project) => !excludeIds.includes(project.id));
  const submit = async () => {
    if (!projectId) return;
    try {
      await link.mutateAsync(projectId);
      const name = projects.find((project) => project.id === projectId)?.name ?? 'Project';
      toast.success(`${name} linked`);
      setProjectId(null);
      onOpenChange(false);
    } catch (error) {
      toast.error('Couldn’t link the project', errorMessage(error));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title="Link a project"
          description="Connect a project you already have in KitStak Projects. Its progress shows up here."
        />
        <DialogBody className="pb-5">
          <Combobox
            aria-label="Project"
            value={projectId}
            onValueChange={setProjectId}
            options={projects.map((project) => ({
              value: project.id,
              label: project.name,
              description: [project.key, project.spaceName].filter(Boolean).join(' · '),
              keywords: [project.key],
            }))}
            placeholder={options.isPending ? 'Loading projects…' : 'Pick a project'}
            searchPlaceholder="Search projects…"
            emptyMessage={options.isPending ? 'Loading projects…' : 'No other projects you can edit'}
            disabled={options.isPending}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={link.isPending}
            disabled={!projectId}
            leadingIcon={<Link2 aria-hidden />}
          >
            Link project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading projects" className="flex flex-col gap-3">
      <Skeleton height={36} rounded="lg" />
      <Skeleton height={104} rounded="lg" />
      <Skeleton height={44} rounded="lg" />
      <Skeleton height={44} rounded="lg" />
    </div>
  );
}

export interface ProjectsTabProps {
  readonly itemId: string;
  readonly recordName: string;
  readonly term: string;
  readonly canEdit: boolean;
}

export function ProjectsTab({ itemId, recordName, term }: ProjectsTabProps) {
  const query = useItemProjects(itemId);
  const unlink = useUnlinkItemWork(itemId);
  const [creating, setCreating] = useState<{ projectId: string | null } | null>(null);
  const [linking, setLinking] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const data = query.data;
  const tasks = useMemo(() => data?.work.tasks ?? [], [data]);
  const openTasks = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  const doneTasks = tasks.length - openTasks.length;
  const visibleTasks = showDone ? tasks : openTasks;

  if (query.isPending) return <TabSkeleton />;
  if (query.isError) {
    return (
      <EmptyState
        size="sm"
        illustration="error"
        title="Couldn’t load projects"
        description={errorMessage(query.error)}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  if (!data || !data.available) return null;
  const projects = data.work.projects;
  const empty = projects.length === 0 && tasks.length === 0;

  const doUnlink = (linkId: string, name: string) =>
    unlink.mutate(linkId, {
      onSuccess: () => toast.success(`${name} unlinked`, 'It’s still in KitStak Projects.'),
    });

  const actions = (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        leadingIcon={<Plus aria-hidden />}
        onClick={() => setCreating({ projectId: null })}
        data-testid="crm-projects-create-task"
      >
        Create task
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="secondary"
            trailingIcon={<ChevronDown aria-hidden />}
            data-testid="crm-projects-more"
          >
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {data.createProjectUrl ? (
            <DropdownMenuItem
              icon={<Rocket aria-hidden />}
              description="Opens the Projects wizard, filled in from this record"
              onSelect={() => window.open(data.createProjectUrl as string, '_blank', 'noopener')}
            >
              Start a project
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            icon={<Link2 aria-hidden />}
            description="Connect a project you already have"
            onSelect={() => setLinking(true)}
          >
            Link a project
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<ArrowUpRight aria-hidden />}
            onSelect={() => window.open(data.projectsUrl, '_blank', 'noopener')}
          >
            Open KitStak Projects
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="flex flex-col gap-6" data-testid="crm-projects-tab">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-panel px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken">
            <ProjectsMark size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">KitStak Projects</p>
            <p className="truncate text-xs text-fg-muted tabular-nums">
              {empty
                ? 'Plan the work for this record'
                : [
                    projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : null,
                    `${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          </div>
        </div>
        {empty ? null : actions}
      </div>

      {empty ? (
        <EmptyState
          size="sm"
          illustration="board"
          title={`No projects or tasks for this ${term.toLowerCase()} yet`}
          description={`Tasks you create here land in KitStak Projects for your team and stay linked to ${recordName}, so everyone sees progress in both places.`}
          actions={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                leadingIcon={<Plus aria-hidden />}
                onClick={() => setCreating({ projectId: null })}
              >
                Create task
              </Button>
              {data.createProjectUrl ? (
                <a
                  href={data.createProjectUrl}
                  {...EXTERNAL}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-input bg-panel px-2.5 text-xs font-medium text-fg hover:bg-muted [&_svg]:size-4"
                >
                  <Rocket aria-hidden />
                  Start a project
                </a>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Link2 aria-hidden />}
                onClick={() => setLinking(true)}
              >
                Link a project
              </Button>
            </div>
          }
        />
      ) : null}

      {projects.length > 0 ? (
        <section aria-labelledby="ip-pm-projects" className="flex flex-col gap-2">
          <SectionTitle id="ip-pm-projects" count={projects.length}>
            Projects
          </SectionTitle>
          <ul className="grid gap-2 @min-[640px]:grid-cols-2">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                canUnlink={project.linkId !== null}
                onAddTask={() => setCreating({ projectId: project.id })}
                onUnlink={() => project.linkId && doUnlink(project.linkId, project.name)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {tasks.length > 0 ? (
        <section aria-labelledby="ip-pm-tasks" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle id="ip-pm-tasks" count={openTasks.length}>
              Open tasks
            </SectionTitle>
            {doneTasks > 0 ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setShowDone((value) => !value)}
                pressed={showDone}
              >
                {showDone ? 'Hide done' : `Show done (${doneTasks})`}
              </Button>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
            {visibleTasks.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-fg-secondary">
                Every linked task is done. Nice work.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {visibleTasks.map((task) => (
                  <TaskRow key={task.id} task={task} onUnlink={() => doUnlink(task.linkId, task.key)} />
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      <CreateTaskDialog
        itemId={itemId}
        recordName={recordName}
        term={term}
        open={creating !== null}
        projectId={creating?.projectId ?? null}
        onOpenChange={(open) => (open ? undefined : setCreating(null))}
      />
      <LinkProjectDialog
        itemId={itemId}
        open={linking}
        onOpenChange={setLinking}
        excludeIds={projects.map((project) => project.id)}
      />
    </div>
  );
}
