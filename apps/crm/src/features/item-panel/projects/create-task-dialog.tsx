'use client';
/**
 * "Create task" from a CRM record: pick a project (most recently used first), name the task,
 * optionally set status, assignee, due date, priority and notes. The task is created in KitStak
 * Projects, linked to this record, and shows up for the team there right away.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import { ArrowUpRight } from 'lucide-react';
import type { BridgePriority, BridgeTask, WritableProject } from '@kitstak/pm-bridge/types';
import {
  Button,
  Combobox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  Select,
  Textarea,
  labelColorStyle,
  toLabelColor,
  toast,
} from '@/components/ui';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import { useCreateItemTask, useProjectOptions } from './api';
import { ProjectsMark } from './projects-mark';

const PRIORITIES: readonly { value: BridgePriority; label: string }[] = [
  { value: 'none', label: 'No priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const UNASSIGNED = '__none__';

function Swatch({ color }: { readonly color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-[3px] bg-[var(--lc-bg)]"
      style={labelColorStyle(toLabelColor(color, 'blue'))}
    />
  );
}

export interface CreateTaskDialogProps {
  readonly itemId: string;
  readonly recordName: string;
  readonly term: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Preselect a project (e.g. "Add task" on a linked project card). */
  readonly projectId?: string | null;
  readonly onCreated?: (task: BridgeTask) => void;
}

export function CreateTaskDialog(props: CreateTaskDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* The form mounts with the dialog content, so every opening starts fresh. */}
      <DialogContent size="md" data-testid="crm-create-task-dialog">
        <CreateTaskForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function CreateTaskForm({
  itemId,
  recordName,
  term,
  open,
  onOpenChange,
  projectId: initialProjectId,
  onCreated,
}: CreateTaskDialogProps) {
  const { user } = useOrg();
  const options = useProjectOptions(open);
  const create = useCreateItemTask(itemId);
  const [title, setTitle] = useState('');
  const [chosenProjectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  const [statusId, setStatusId] = useState<string | undefined>(undefined);
  const [assigneeId, setAssigneeId] = useState<string>(user.id);
  const [due, setDue] = useState<Date | null>(null);
  const [priority, setPriority] = useState<BridgePriority>('none');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const projects = useMemo(() => options.data?.projects ?? [], [options.data?.projects]);
  // Until the user picks, default to the most recently used project.
  const projectId = chosenProjectId ?? projects[0]?.id ?? null;

  const project: WritableProject | undefined = projects.find((entry) => entry.id === projectId);
  const statusOptions = useMemo(
    () =>
      (project?.statuses ?? [])
        .filter((status) => status.category !== 'cancelled')
        .map((status) => ({ value: status.id, label: status.name, icon: <Swatch color={status.color} /> })),
    [project],
  );
  const people = useMemo(
    () => [
      { value: UNASSIGNED, label: 'No one yet' },
      ...(options.data?.people ?? []).map((person) => ({
        value: person.id,
        label: person.id === user.id ? `${person.name} (you)` : person.name,
        description: person.email,
        keywords: [person.email],
      })),
    ],
    [options.data?.people, user.id],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = 'Give the task a name';
    if (!projectId) next.projectId = 'Pick a project';
    setErrors(next);
    if (Object.keys(next).length > 0 || !projectId) return;
    try {
      const task = await create.mutateAsync({
        projectId,
        title: title.trim(),
        statusId: statusId ?? null,
        assigneeId: assigneeId === UNASSIGNED ? null : assigneeId,
        dueDate: due ? format(due, 'yyyy-MM-dd') : null,
        priority,
        description: notes.trim() || null,
      });
      onOpenChange(false);
      toast.success(
        `${task.key} created in ${task.projectName}`,
        `It’s linked to this ${term.toLowerCase()} and shows up for your team in Projects.`,
      );
      onCreated?.(task);
    } catch (error) {
      if (error instanceof ApiClientError) {
        const issues =
          (error.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
        if (issues.length) setErrors(Object.fromEntries(issues.map((issue) => [issue.path, issue.message])));
      }
      toast.error('Couldn’t create the task', errorMessage(error));
    }
  };

  const noProjects = options.isSuccess && projects.length === 0;

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col" noValidate>
      <DialogHeader
        icon={
          <span className="flex size-9 items-center justify-center rounded-lg bg-sunken">
            <ProjectsMark size={20} />
          </span>
        }
        title="Create a task in Projects"
        description={
          <>
            Linked to the {term.toLowerCase()} <span className="font-medium text-fg">{recordName}</span>.
          </>
        }
      />
      <DialogBody className="flex flex-col gap-4 pb-5">
        {noProjects ? (
          <div className="rounded-lg border border-dashed border-border-default bg-sunken px-4 py-5 text-center text-sm text-fg-secondary">
            You don’t have a project you can add tasks to yet. Create a project first, then come back here.
          </div>
        ) : null}
        <Field label="Task name" required error={errors.title}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              invalid={invalid}
              autoFocus
              value={title}
              maxLength={500}
              placeholder={`e.g. Send the welcome kit to ${recordName}`}
              onChange={(event) => setTitle(event.target.value)}
              data-testid="crm-task-title"
            />
          )}
        </Field>
        <Field label="Project" required error={errors.projectId}>
          {({ inputId, invalid }) => (
            <Combobox
              id={inputId}
              aria-label="Project"
              invalid={invalid}
              value={projectId}
              onValueChange={(value) => {
                setProjectId(value);
                setStatusId(undefined);
              }}
              options={projects.map((entry) => ({
                value: entry.id,
                label: entry.name,
                description: [entry.key, entry.spaceName].filter(Boolean).join(' · '),
                keywords: [entry.key],
                icon: <Swatch color={entry.color} />,
              }))}
              placeholder={options.isPending ? 'Loading projects…' : 'Pick a project'}
              searchPlaceholder="Search projects…"
              emptyMessage={options.isPending ? 'Loading projects…' : 'No projects match'}
              disabled={options.isPending || noProjects}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            {({ inputId }) => (
              <Select
                id={inputId}
                aria-label="Status"
                value={statusId ?? statusOptions[0]?.value}
                onValueChange={setStatusId}
                options={statusOptions}
                placeholder="First column"
                disabled={!project}
              />
            )}
          </Field>
          <Field label="Priority">
            {({ inputId }) => (
              <Select
                id={inputId}
                aria-label="Priority"
                value={priority}
                onValueChange={(value) => setPriority(value as BridgePriority)}
                options={PRIORITIES}
              />
            )}
          </Field>
          <Field label="Assignee" error={errors.assigneeId}>
            {({ inputId, invalid }) => (
              <Combobox
                id={inputId}
                aria-label="Assignee"
                invalid={invalid}
                value={assigneeId}
                onValueChange={(value) => setAssigneeId(value ?? UNASSIGNED)}
                options={people}
                searchPlaceholder="Search people…"
                emptyMessage="No one matches"
              />
            )}
          </Field>
          <Field label="Due date" error={errors.dueDate}>
            {({ inputId }) => (
              <DatePicker
                id={inputId}
                aria-label="Due date"
                value={due}
                onChange={setDue}
                placeholder="No due date"
              />
            )}
          </Field>
        </div>
        <Field label="Notes" hint="Optional. Shows as the task description in Projects.">
          {({ inputId, describedBy }) => (
            <Textarea
              id={inputId}
              aria-describedby={describedBy}
              rows={3}
              value={notes}
              maxLength={20_000}
              placeholder="Anything your team should know"
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
      </DialogBody>
      <DialogFooter className="justify-between">
        {project ? (
          <a
            href={projectUrlFor(project.key)}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1 text-sm text-fg-secondary hover:text-fg hover:underline sm:inline-flex"
          >
            Open {project.key} in Projects
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={create.isPending}
            disabled={noProjects}
            data-testid="crm-task-submit"
          >
            Create task
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

const PROJECTS_URL = (process.env.NEXT_PUBLIC_PROJECTS_URL ?? 'http://localhost:3400').replace(/\/+$/, '');

export function projectUrlFor(key: string): string {
  return `${PROJECTS_URL}/p/${encodeURIComponent(key)}`;
}
