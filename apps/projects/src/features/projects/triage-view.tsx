'use client';
/**
 * Triage tab (/p/OPS/triage): requests wait here before they become tasks. Form answers (when
 * the form says "Send to Triage"), requests from teammates and sibling apps. Pick one, read it,
 * then accept it (becomes a task), decline it, snooze it, or merge it into a task that already
 * covers it. Keyboard: j/k to move, a accept, d decline, s snooze, m merge.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Check, CircleSlash, ClipboardList, FileText, GitMerge, Inbox, Mail, Plus, RotateCcw, User } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Field,
  Input,
  IsoDatePicker,
  Kbd,
  Select,
  Skeleton,
  Textarea,
  ToggleGroup,
  UserPicker,
  cn,
  toast,
} from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/pm';
import { Panel } from '@/components/layout/page';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { addDaysIso, formatRelative, startOfWeekIso, todayIso } from '@/lib/dates';
import { useHotkey } from '@/lib/hooks/use-hotkeys';
import { usePeople, useTriage } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import type { TriageItemDTO } from '@/lib/types';
import { acceptTriageItemAction, createTriageItemAction, declineTriageItemAction, mergeTriageItemAction, reopenTriageItemAction, snoozeTriageItemAction } from '@/server/actions/triage';
import { TaskPickerList } from '@/features/task/task-picker';
import { useShell } from '@/features/shell/shell-context';
import { useCurrentProject } from './project-context';

type Filter = 'open' | 'snoozed' | 'decided';

const SOURCE_TEXT: Record<TriageItemDTO['source'], string> = {
  manual: 'Request',
  form: 'Form',
  crm: 'CRM',
  wms: 'Warehouse',
  portal: 'Portal',
  api: 'App',
};

const STATE_TEXT: Record<TriageItemDTO['state'], string> = {
  pending: 'Waiting',
  snoozed: 'Snoozed',
  accepted: 'Accepted',
  declined: 'Declined',
  merged: 'Merged',
};

function useRefresh() {
  const queryClient = useQueryClient();
  const { project } = useCurrentProject();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['project', project.key, 'triage'] });
    void queryClient.invalidateQueries({ queryKey: qk.projectTasks(project.key) });
  };
}

function NewRequestDialog({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { project } = useCurrentProject();
  const refresh = useRefresh();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('none');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const result = await createTriageItemAction({ projectId: project.id, title, description: description || null, priority });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't send the request", result.error.message);
      return;
    }
    toast.success('Request sent to Triage');
    refresh();
    setTitle('');
    setDescription('');
    setPriority('none');
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader icon={<Inbox aria-hidden className="size-5 text-primary-text" />} title="New request" description={`It waits in ${project.name} Triage until someone accepts it into a task.`} />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field label="What is needed?" required>
            {({ inputId }) => <Input id={inputId} autoFocus value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add a second dock door to the receiving plan" data-testid="triage-new-title" />}
          </Field>
          <Field label="Details" hint="Optional. Why it matters and anything the team should know.">
            {({ inputId, describedBy }) => <Textarea id={inputId} aria-describedby={describedBy} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <Field label="How urgent is it?">
            {({ inputId }) => <Select id={inputId} value={priority} onValueChange={(v) => setPriority(v as Priority)} options={PRIORITIES.map((p) => ({ value: p, label: p === 'none' ? 'Not sure' : PRIORITY_LABELS[p] }))} />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={!title.trim()} data-testid="triage-new-submit">
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AcceptDialog({ item, open, onOpenChange, onDone }: { readonly item: TriageItemDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onDone: () => void }) {
  const { statuses } = useCurrentProject();
  const { user } = useShell();
  const people = usePeople();
  const { openTask } = useTaskDrawer();
  const [title, setTitle] = useState(item.title);
  const [statusId, setStatusId] = useState<string>('default');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const accept = async () => {
    setSaving(true);
    const result = await acceptTriageItemAction({ itemId: item.id, title, statusId: statusId === 'default' ? undefined : statusId, assigneeId: assigneeId ?? undefined, priority, dueDate });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't accept the request", result.error.message);
      return;
    }
    toast.success(`Accepted as ${result.data.task.key}`, result.data.task.title);
    onOpenChange(false);
    onDone();
    openTask(result.data.task.key);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader icon={<Check aria-hidden className="size-5 text-success-text" />} title="Accept into the project" description="It becomes a task. Change anything before it lands on the board." />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field label="Task title" required>
            {({ inputId }) => <Input id={inputId} value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              {({ inputId }) => (
                <Select id={inputId} value={statusId} onValueChange={setStatusId} options={[{ value: 'default', label: 'First column' }, ...statuses.filter((s) => s.category !== 'done' && s.category !== 'cancelled').map((s) => ({ value: s.id, label: s.name }))]} />
              )}
            </Field>
            <Field label="Priority">
              {({ inputId }) => <Select id={inputId} value={priority} onValueChange={(v) => setPriority(v as Priority)} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Assignee</span>
              <UserPicker people={people.data ?? []} meId={user.id} value={assigneeId} onChange={setAssigneeId} className="h-9 w-full" aria-label="Assignee" placeholder="Nobody yet" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Due date</span>
              <IsoDatePicker value={dueDate} onChange={setDueDate} placeholder="No due date" aria-label="Due date" />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void accept()} loading={saving} disabled={!title.trim()} data-testid="triage-accept-confirm">
            Accept as task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ item, open, onOpenChange, onDone }: { readonly item: TriageItemDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const decline = async () => {
    setSaving(true);
    const result = await declineTriageItemAction({ itemId: item.id, reason: reason || null });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't decline the request", result.error.message);
      return;
    }
    onOpenChange(false);
    onDone();
    toast.undo(`Declined “${item.title}”`, {
      onUndo: async () => {
        const undo = await reopenTriageItemAction({ itemId: item.id });
        if (!undo.ok) throw new Error(undo.error.message);
        onDone();
      },
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Decline this request?" description="It leaves the queue. You can still find it under Done." />
        <DialogBody className="pb-4">
          <Field label="Reason" hint="Optional. Saved with the request.">
            {({ inputId, describedBy }) => <Textarea id={inputId} aria-describedby={describedBy} rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Out of scope for this project" autoFocus />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void decline()} loading={saving} data-testid="triage-decline-confirm">
            Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SnoozeDialog({ item, open, onOpenChange, onDone }: { readonly item: TriageItemDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onDone: () => void }) {
  const today = todayIso();
  const [custom, setCustom] = useState<string | null>(null);
  const snooze = async (until: string) => {
    const result = await snoozeTriageItemAction({ itemId: item.id, until });
    if (!result.ok) {
      toast.error("Couldn't snooze the request", result.error.message);
      return;
    }
    onOpenChange(false);
    onDone();
    toast.undo(`Snoozed until ${new Date(`${until}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`, {
      onUndo: async () => {
        const undo = await reopenTriageItemAction({ itemId: item.id });
        if (!undo.ok) throw new Error(undo.error.message);
        onDone();
      },
    });
  };
  const choices = [
    { label: 'Tomorrow', date: addDaysIso(today, 1) },
    { label: 'In 3 days', date: addDaysIso(today, 3) },
    { label: 'Next Monday', date: addDaysIso(startOfWeekIso(today), 7) },
    { label: 'In 2 weeks', date: addDaysIso(today, 14) },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader icon={<AlarmClock aria-hidden className="size-5 text-icon" />} title="Snooze until" description="It leaves the queue and comes back on that day." />
        <DialogBody className="flex flex-col gap-2 pb-4">
          {choices
            .filter((choice, index) => choices.findIndex((other) => other.date === choice.date) === index)
            .map((choice) => (
              <Button key={choice.label} variant="secondary" onClick={() => void snooze(choice.date)} data-testid="triage-snooze-choice">
                <span className="flex w-full items-center justify-between gap-3">
                  <span>{choice.label}</span>
                  <span className="text-xs text-fg-muted">{new Date(`${choice.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                </span>
              </Button>
            ))}
          <div className="mt-2 flex items-center gap-2">
            <IsoDatePicker value={custom} onChange={setCustom} placeholder="Pick a day" aria-label="Snooze until" />
            <Button disabled={!custom || custom <= today} onClick={() => custom && void snooze(custom)}>
              Snooze
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog({ item, open, onOpenChange, onDone }: { readonly item: TriageItemDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onDone: () => void }) {
  const { project } = useCurrentProject();
  const merge = async (taskId: string, key: string) => {
    const result = await mergeTriageItemAction({ itemId: item.id, taskId });
    if (!result.ok) {
      toast.error("Couldn't merge the request", result.error.message);
      return;
    }
    toast.success(`Merged into ${key}`, 'The request text was added to the task as a comment.');
    onOpenChange(false);
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader icon={<GitMerge aria-hidden className="size-5 text-icon" />} title="Merge as a duplicate" description="Pick the task that already covers this. The request is added to it as a comment." />
        <DialogBody className="pb-4">
          <TaskPickerList projectKey={project.key} exclude={new Set()} onPick={(task) => void merge(task.id, task.key)} placeholder="Find the task it duplicates" />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function RequestRow({ item, selected, onSelect }: { readonly item: TriageItemDTO; readonly selected: boolean; readonly onSelect: () => void }) {
  return (
    <li data-triage-id={item.id}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        data-testid="triage-item"
        className={cn(
          'flex w-full items-start gap-2.5 border-l-2 px-3 py-2.5 text-left outline-none focus-visible:bg-hover',
          selected ? 'border-primary bg-primary-subtle/40' : 'border-transparent hover:bg-hover',
        )}
      >
        <span className="mt-0.5 shrink-0">{item.priority !== 'none' ? <PriorityIcon priority={item.priority} /> : <span className="block size-4 rounded-full border border-dashed border-border-strong" aria-hidden />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-muted">
            <span>{item.sourceLabel ?? SOURCE_TEXT[item.source]}</span>
            {item.requesterName ? <span aria-hidden>·</span> : null}
            {item.requesterName ? <span className="truncate">{item.requesterName}</span> : null}
            <span aria-hidden>·</span>
            <span className="shrink-0">{item.state === 'snoozed' && item.snoozedUntil ? `until ${item.snoozedUntil.slice(5).replace('-', '/')}` : formatRelative(item.createdAt)}</span>
          </span>
        </span>
        {item.state !== 'pending' && item.state !== 'snoozed' ? (
          <Badge size="sm" tone={item.state === 'accepted' ? 'success' : item.state === 'merged' ? 'info' : 'neutral'}>
            {STATE_TEXT[item.state]}
          </Badge>
        ) : null}
      </button>
    </li>
  );
}

function RequestDetail({ item, onAction }: { readonly item: TriageItemDTO; readonly onAction: (kind: 'accept' | 'decline' | 'snooze' | 'merge') => void }) {
  const { capabilities } = useCurrentProject();
  const { openTask } = useTaskDrawer();
  const refresh = useRefresh();
  const canDecide = capabilities['task:create'];
  const open = item.state === 'pending' || item.state === 'snoozed';
  const reopen = async () => {
    const result = await reopenTriageItemAction({ itemId: item.id });
    if (!result.ok) {
      toast.error("Couldn't put it back", result.error.message);
      return;
    }
    toast.success('Back in the queue');
    refresh();
  };
  return (
    <article className="flex min-w-0 flex-col gap-4 p-5" data-testid="triage-detail" aria-label={item.title}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge tone="outline" size="sm" icon={item.source === 'form' ? <ClipboardList aria-hidden /> : <FileText aria-hidden />}>
            {item.sourceLabel ?? SOURCE_TEXT[item.source]}
          </Badge>
          <Badge size="sm" tone={item.state === 'accepted' ? 'success' : item.state === 'declined' ? 'neutral' : item.state === 'merged' ? 'info' : 'warning'}>
            {STATE_TEXT[item.state]}
            {item.state === 'snoozed' && item.snoozedUntil ? ` until ${item.snoozedUntil}` : ''}
          </Badge>
          <span>Sent {formatRelative(item.createdAt)}</span>
        </div>
        <h2 className="text-lg font-semibold text-fg">{item.title}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-secondary">
          {item.requesterName ? (
            <span className="inline-flex items-center gap-1.5">
              <User aria-hidden className="size-3.5 text-icon" />
              {item.requesterName}
            </span>
          ) : null}
          {item.requesterEmail ? (
            <a href={`mailto:${item.requesterEmail}`} className="inline-flex items-center gap-1.5 text-fg-link hover:underline">
              <Mail aria-hidden className="size-3.5" />
              {item.requesterEmail}
            </a>
          ) : null}
          {item.priority !== 'none' ? (
            <span className="inline-flex items-center gap-1.5">
              <PriorityIcon priority={item.priority} />
              {PRIORITY_LABELS[item.priority]}
            </span>
          ) : null}
        </div>
      </header>

      {open && canDecide ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-sunken/60 p-2" role="toolbar" aria-label="Decide">
          <Button size="sm" leadingIcon={<Check aria-hidden />} onClick={() => onAction('accept')} data-testid="triage-accept">
            Accept <Kbd className="ml-1">A</Kbd>
          </Button>
          <Button size="sm" variant="secondary" leadingIcon={<GitMerge aria-hidden />} onClick={() => onAction('merge')} data-testid="triage-merge">
            Merge <Kbd className="ml-1">M</Kbd>
          </Button>
          <Button size="sm" variant="secondary" leadingIcon={<AlarmClock aria-hidden />} onClick={() => onAction('snooze')} data-testid="triage-snooze">
            Snooze <Kbd className="ml-1">S</Kbd>
          </Button>
          <Button size="sm" variant="ghost" leadingIcon={<CircleSlash aria-hidden />} onClick={() => onAction('decline')} data-testid="triage-decline">
            Decline <Kbd className="ml-1">D</Kbd>
          </Button>
        </div>
      ) : null}

      {item.task ? (
        <button type="button" onClick={() => openTask(item.task!.key)} className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-left text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
          <StatusIcon category={item.task.statusCategory} size={16} />
          <span className="font-key text-xs text-fg-muted">{item.task.key}</span>
          <span className="min-w-0 flex-1 truncate text-fg">{item.task.title}</span>
          <span className="text-xs text-fg-link">{item.state === 'merged' ? 'Merged into this task' : 'Open task'}</span>
        </button>
      ) : null}
      {item.state === 'declined' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm text-fg-secondary">
          <span>{item.declineReason ? `Declined: ${item.declineReason}` : 'Declined without a reason.'}</span>
          {canDecide ? (
            <Button size="sm" variant="ghost" leadingIcon={<RotateCcw aria-hidden />} onClick={() => void reopen()}>
              Put back in the queue
            </Button>
          ) : null}
        </div>
      ) : null}

      {item.description ? (
        <div className="ks-prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: item.description }} />
      ) : (
        <p className="text-sm text-fg-muted">No details were sent with this request.</p>
      )}
    </article>
  );
}

export function TriageView() {
  const { project, capabilities } = useCurrentProject();
  const [filter, setFilter] = useState<Filter>('open');
  const queue = useTriage(project.key, filter);
  const refresh = useRefresh();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'accept' | 'decline' | 'snooze' | 'merge' | 'new' | null>(null);
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const counts = queue.data?.counts;
  const canDecide = capabilities['task:create'];
  const canRequest = capabilities['comment:create'];

  const move = (step: number) => {
    if (!items.length) return;
    const index = selected ? items.findIndex((item) => item.id === selected.id) : -1;
    const next = items[Math.min(items.length - 1, Math.max(0, index + step))];
    if (next) {
      setSelectedId(next.id);
      document.querySelector(`[data-triage-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  };
  const actionable = Boolean(selected && canDecide && (selected.state === 'pending' || selected.state === 'snoozed') && !dialog);
  useHotkey('j', () => move(1), { enabled: !dialog });
  useHotkey('k', () => move(-1), { enabled: !dialog });
  useHotkey('a', () => setDialog('accept'), { enabled: actionable });
  useHotkey('d', () => setDialog('decline'), { enabled: actionable });
  useHotkey('s', () => setDialog('snooze'), { enabled: actionable });
  useHotkey('m', () => setDialog('merge'), { enabled: actionable });

  const afterDecision = () => {
    const index = selected ? items.findIndex((item) => item.id === selected.id) : -1;
    const next = items[index + 1] ?? items[index - 1] ?? null;
    setSelectedId(next?.id ?? null);
    refresh();
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5" data-testid="triage-view">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[min(100%,320px)] flex-1">
          <h2 className="text-base font-semibold text-fg">Triage</h2>
          <p className="text-sm text-fg-muted">New requests wait here before they join the project. Accept the good ones, merge duplicates, snooze or decline the rest.</p>
        </div>
        <ToggleGroup
          label="Show"
          value={filter}
          onValueChange={(value) => {
            setFilter(value);
            setSelectedId(null);
          }}
          options={[
            { value: 'open', label: `Waiting${counts?.pending ? ` (${counts.pending})` : ''}` },
            { value: 'snoozed', label: `Snoozed${counts?.snoozed ? ` (${counts.snoozed})` : ''}` },
            { value: 'decided', label: 'Done' },
          ]}
        />
        {canRequest ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setDialog('new')} data-testid="triage-new">
            New request
          </Button>
        ) : null}
      </div>

      {queue.isPending ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <Skeleton height={320} />
          <Skeleton height={320} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-panel">
          <EmptyState
            illustration="inbox"
            title={filter === 'open' ? 'Triage is clear' : filter === 'snoozed' ? 'Nothing is snoozed' : 'No decisions yet'}
            description={
              filter === 'open'
                ? 'New requests show up here. Turn on “Send responses to Triage first” in a form, or send a request yourself.'
                : filter === 'snoozed'
                  ? 'Snoozed requests come back to Waiting on the day you pick.'
                  : 'Accepted, merged and declined requests are listed here.'
            }
            actions={filter === 'open' && canRequest ? <Button leadingIcon={<Plus aria-hidden />} onClick={() => setDialog('new')}>New request</Button> : null}
          />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <Panel bodyClassName="p-0">
            <ul className="flex max-h-[calc(100dvh-300px)] flex-col divide-y divide-border-subtle overflow-y-auto" aria-label="Requests">
              {items.map((item) => (
                <RequestRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />
              ))}
            </ul>
            <p className="border-t border-border-subtle px-3 py-2 text-2xs text-fg-muted">
              <Kbd>J</Kbd> <Kbd>K</Kbd> to move between requests
            </p>
          </Panel>
          <div className="rounded-xl border border-border-subtle bg-panel shadow-xs">{selected ? <RequestDetail item={selected} onAction={setDialog} /> : null}</div>
        </div>
      )}

      <NewRequestDialog open={dialog === 'new'} onOpenChange={(open) => setDialog(open ? 'new' : null)} />
      {selected && dialog === 'accept' ? <AcceptDialog item={selected} open onOpenChange={(open) => setDialog(open ? 'accept' : null)} onDone={afterDecision} /> : null}
      {selected && dialog === 'decline' ? <DeclineDialog item={selected} open onOpenChange={(open) => setDialog(open ? 'decline' : null)} onDone={afterDecision} /> : null}
      {selected && dialog === 'snooze' ? <SnoozeDialog item={selected} open onOpenChange={(open) => setDialog(open ? 'snooze' : null)} onDone={afterDecision} /> : null}
      {selected && dialog === 'merge' ? <MergeDialog item={selected} open onOpenChange={(open) => setDialog(open ? 'merge' : null)} onDone={afterDecision} /> : null}
    </div>
  );
}
