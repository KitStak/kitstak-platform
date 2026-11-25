'use client';
/**
 * Quick add (press C anywhere, or the top bar "New task"). Type a sentence like
 * "Call Acme tomorrow !high @maya #sales +OPS" and the fields fill themselves in (src/lib/nl-parse.ts);
 * chips show what was understood and every field can still be set by hand. Enter saves,
 * ⌘/Ctrl+Shift+Enter saves and opens, "Add another" keeps the dialog open for the next one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { askViewOnly } from '@kitstak/ui/view-only';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, Tags, TextQuote } from 'lucide-react';
import {
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  IsoDatePicker,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Textarea,
  UserPicker,
  cn,
  taskToastId,
  toast,
  useModKey,
} from '@/components/ui';
import { EntityIcon, LabelPill, PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { usePeople, useProject, useProjects } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import { parseQuickAdd, type QuickAddToken } from '@/lib/nl-parse';
import { useWmsCodeLinks, WmsCodeLinkChips } from '@/features/integrations/wms-code-links';
import { qk } from '@/lib/query-keys';
import { createLabelAction } from '@/server/actions/structure';
import { LabelDot } from '@/features/views/field-pickers';
import { OptionList } from '@/features/views/option-list';
import { useShell, usePlanReadOnly } from '@/features/shell/shell-context';
import { useShellStore } from '@/features/shell/store';
import { SmartTitleInput, UnderstoodChips, type SmartTitleInputHandle } from './smart-title-input';

const LAST_PROJECT_KEY = 'kitstak-projects:last-quick-add-project';

function readLastProject(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Plain text → simple paragraphs (the server sanitizes rich text again). */
function textToHtml(text: string): string | null {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`);
  return paragraphs.length ? paragraphs.join('') : null;
}

/** Removes a token's text from the input and tidies the spaces around it. */
function cutToken(text: string, token: QuickAddToken): string {
  return `${text.slice(0, token.start)} ${text.slice(token.end)}`.replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
}

export function QuickAddDialog() {
  const asked = useShellStore((state) => state.quickAdd.open);
  const close = useShellStore((state) => state.closeQuickAdd);
  // View only: every way to start a task (the top bar, the home button, the C key, the command
  // palette) asks through this store. The form never opens: the person sees why, and the banner's
  // button, before they type anything.
  const readOnly = usePlanReadOnly();
  useEffect(() => {
    if (!readOnly || !asked) return;
    close();
    askViewOnly();
  }, [readOnly, asked, close]);
  const open = asked && !readOnly;
  // Remount the form on every open so its state starts from the opener's defaults.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }
  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : close())}>
      {open ? <QuickAddForm key={session} /> : null}
    </Dialog>
  );
}

function QuickAddForm() {
  const pathname = usePathname() ?? '';
  const mod = useModKey();
  const queryClient = useQueryClient();
  const { user } = useShell();
  const { openTask } = useTaskDrawer();
  const defaults = useShellStore((state) => state.quickAdd.defaults);
  const close = useShellStore((state) => state.closeQuickAdd);
  const projects = useProjects();
  const people = usePeople();
  const { createTask } = useTaskMutations();
  const today = todayIso();

  const editable = useMemo(() => (projects.data ?? []).filter((p) => !p.archivedAt && (p.role === 'owner' || p.role === 'editor')), [projects.data]);
  const [title, setTitle] = useState(defaults.text ?? '');
  const [ignore, setIgnore] = useState<readonly string[]>([]);
  /** New #label names the user confirmed with "Create label …". */
  const [createLabels, setCreateLabels] = useState<readonly string[]>([]);
  const [projectChoice, setProjectId] = useState<string | null>(() => defaults.projectId ?? null);
  const [statusChoice, setStatusId] = useState<string | undefined>(defaults.statusId);
  const [assigneeChoice, setAssigneeId] = useState<string | null>(defaults.assigneeId === undefined ? null : defaults.assigneeId);
  const [dueChoice, setDueDate] = useState<string | null>(defaults.dueDate ?? null);
  const [priorityChoice, setPriority] = useState<Priority>('none');
  const [labelChoice, setLabelIds] = useState<readonly string[]>([]);
  const [newLabelChoice, setNewLabels] = useState<readonly string[]>([]);
  const [details, setDetails] = useState<string | null>(null);
  const [another, setAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const titleRef = useRef<SmartTitleInputHandle>(null);

  // Pass 1: which project does the text point at (+OPS)? Pass 2 (below) knows that project's labels.
  const projectParse = useMemo(
    () => parseQuickAdd(title, { today, projects: editable, ignore }),
    [title, today, editable, ignore],
  );

  // Project: +project in the text → explicit choice → the project you're looking at (/p/KEY) → last used → first you can edit.
  const pathKey = /^\/p\/([^/?#]+)/.exec(pathname)?.[1];
  const selectedProject =
    editable.find((p) => p.id === projectParse.projectId) ??
    editable.find((p) => p.id === projectChoice) ??
    (pathKey ? editable.find((p) => p.key === decodeURIComponent(pathKey).toUpperCase()) : undefined) ??
    editable.find((p) => p.id === readLastProject()) ??
    editable[0] ??
    null;
  const canCreateLabels = selectedProject?.role === 'owner' || selectedProject?.role === 'editor';
  const detail = useProject(selectedProject?.key ?? '', { enabled: Boolean(selectedProject) });
  const statuses = useMemo(() => detail.data?.statuses ?? [], [detail.data?.statuses]);
  const projectLabels = useMemo(() => detail.data?.labels ?? [], [detail.data?.labels]);
  const statusId = statuses.some((s) => s.id === statusChoice) ? statusChoice : (statuses.find((s) => s.isDefault) ?? statuses[0])?.id;

  const parsed = useMemo(
    () =>
      parseQuickAdd(title, {
        today,
        people: people.data ?? [],
        projects: editable,
        labels: projectLabels,
        meId: user.id,
        ignore,
        createLabels,
        // Like Linear: a #name you typed is a label. New ones are created on save (chip "name (new)");
        // the chip's × keeps it as text. Closing the suggestion list (Esc) never drops it.
        createUnknownLabels: canCreateLabels,
        // An @name that matched nobody leaves the title too; its red chip says the task is unassigned.
        stripUnknownPeople: true,
      }),
    [title, today, people.data, editable, projectLabels, user.id, ignore, createLabels, canCreateLabels],
  );

  // What will be saved: words in the text win over the pickers.
  const dueDate = parsed.dueDate ?? dueChoice;
  const priority = parsed.priority ?? priorityChoice;
  const assigneeId = parsed.assigneeId ?? assigneeChoice;
  const labelIds = useMemo(
    () => [...new Set([...labelChoice.filter((id) => projectLabels.some((l) => l.id === id)), ...parsed.labelIds])],
    [labelChoice, parsed.labelIds, projectLabels],
  );
  const newLabels = useMemo(() => {
    const seen = new Set(labelIds.map((id) => projectLabels.find((l) => l.id === id)?.name.toLowerCase()));
    const out: string[] = [];
    for (const name of [...newLabelChoice, ...parsed.newLabels]) {
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
    }
    return out;
  }, [labelIds, newLabelChoice, parsed.newLabels, projectLabels]);
  // WMS codes in the name (PO2240) are written the WMS way (PO002240) and linked to that record.
  const wmsLinks = useWmsCodeLinks(title);
  const finalTitle = wmsLinks.normalize(parsed.title);

  const tokenOf = useCallback((kind: QuickAddToken['kind']) => parsed.tokens.find((t) => t.kind === kind && !t.unresolved), [parsed.tokens]);
  /** A picker change replaces whatever the text said: drop that word from the text. */
  const overrideFromPicker = (kind: QuickAddToken['kind']) => {
    const token = tokenOf(kind);
    if (token) setTitle((text) => cutToken(text, token));
  };
  const dismiss = (token: QuickAddToken) => {
    setIgnore((list) => [...list, token.id]);
    titleRef.current?.focus();
  };

  const resolveNewLabels = async (projectId: string): Promise<string[] | null> => {
    const ids: string[] = [];
    for (const name of newLabels) {
      const result = await createLabelAction({ projectId, name });
      if (!result.ok) {
        toast.error(`Couldn't create the label “${name}”`, result.error.message);
        return null;
      }
      ids.push(result.data.id);
    }
    if (ids.length) void queryClient.invalidateQueries({ queryKey: qk.project(selectedProject?.key ?? '') });
    return ids;
  };

  const reset = () => {
    setTitle('');
    setIgnore([]);
    setCreateLabels([]);
    setDetails(null);
    setLabelIds([]);
    setNewLabels([]);
    setAttempted(false);
    wmsLinks.reset();
    titleRef.current?.focus();
  };

  const submit = async (openAfter = false) => {
    setAttempted(true);
    if (!finalTitle) {
      titleRef.current?.focus();
      toast.error(title.trim() ? 'Add a few words for the task name' : 'Give the task a name first', title.trim() ? 'Dates, @people and #labels are pulled out of the name.' : undefined);
      return;
    }
    if (!selectedProject) {
      toast.error('Pick a project for this task');
      return;
    }
    setSaving(true);
    const createdLabelIds = newLabels.length ? await resolveNewLabels(selectedProject.id) : [];
    if (createdLabelIds === null) {
      setSaving(false);
      return;
    }
    const created = await createTask(
      {
        projectId: selectedProject.id,
        title: finalTitle,
        description: details?.trim() ? textToHtml(details) : undefined,
        statusId: statusId ?? null,
        assigneeId,
        dueDate,
        priority,
        labelIds: [...labelIds, ...createdLabelIds],
        // No section picked: the project's first section, so the task lands where you can see it
        // instead of in a "No section" group at the very bottom.
        sectionId: defaults.sectionId ?? (defaults.parentTaskId ? null : (detail.data?.sections[0]?.id ?? null)),
        parentTaskId: defaults.parentTaskId ?? null,
        at: 'bottom',
      },
      selectedProject.key,
    );
    if (created) {
      const linked = await wmsLinks.linkTo(created.id, finalTitle);
      if (linked) void queryClient.invalidateQueries({ queryKey: qk.projectTaskLinks(selectedProject.key) });
    }
    setSaving(false);
    if (!created) return;
    try {
      window.localStorage.setItem(LAST_PROJECT_KEY, selectedProject.id);
    } catch {
      // storage unavailable
    }
    const missed = parsed.tokens.find((token) => token.unresolved && token.kind === 'assignee');
    toast.success(
      `Added ${created.key}`,
      missed && !assigneeId ? `${created.title}. ${missed.display}, so it is unassigned.` : created.title,
      { id: taskToastId(created.key) },
    );
    if (openAfter) {
      close();
      openTask(created.key);
      return;
    }
    if (another) {
      reset();
      return;
    }
    close();
  };

  const suggestData = useMemo(
    () => ({ people: people.data ?? [], labels: projectLabels, projects: editable, meId: user.id }),
    [people.data, projectLabels, editable, user.id],
  );

  const labelOptions = useMemo(
    () => projectLabels.map((label) => ({ value: label.id, label: label.name, icon: <LabelDot color={label.color} /> })),
    [projectLabels],
  );
  const confirmLabel = (name: string) => {
    setCreateLabels((list) => (list.some((entry) => entry.toLowerCase() === name.toLowerCase()) ? list : [...list, name]));
    titleRef.current?.focus();
  };

  return (
    <DialogContent
      size="lg"
      data-testid="quick-add"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
      onEscapeKeyDown={(event) => {
        if (titleRef.current?.dismissSuggestions()) event.preventDefault();
      }}
    >
      <DialogHeader title="New task" description="Dates, priority, people and labels are picked out as you type." />
      <DialogBody className="flex flex-col gap-3 [&>*]:shrink-0">
        <SmartTitleInput
          ref={titleRef}
          value={title}
          onChange={setTitle}
          tokens={parsed.tokens}
          invalid={attempted && !finalTitle}
          suggestData={suggestData}
          onCreateLabel={canCreateLabels ? confirmLabel : undefined}
          placeholder="e.g. Call Acme tomorrow !high @maya #sales"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit(event.shiftKey);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <UnderstoodChips tokens={parsed.tokens} onDismiss={dismiss} onCreateLabel={canCreateLabels ? confirmLabel : undefined} />
        <WmsCodeLinkChips state={wmsLinks} />
        {finalTitle && finalTitle !== title.trim() ? (
          <p className="-mt-1 truncate text-xs text-fg-muted" data-testid="quick-add-final-title">
            Task name: <span className="font-medium text-fg-secondary">{finalTitle}</span>
          </p>
        ) : null}

        {details === null ? (
          <button
            type="button"
            onClick={() => setDetails('')}
            className="inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <TextQuote aria-hidden className="size-4" /> Add details
          </button>
        ) : (
          <Textarea
            autoFocus
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            maxLength={10_000}
            aria-label="Details"
            placeholder="Notes, links or steps (optional)"
          />
        )}

        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg-secondary">
            Project
            <Combobox
              aria-label="Project"
              options={editable.map((p) => ({ value: p.id, label: p.name, keywords: [p.key], icon: <EntityIcon icon={p.icon} color={p.color} size={18} /> }))}
              value={selectedProject?.id ?? null}
              onValueChange={(value) => {
                if (!value) return;
                overrideFromPicker('project');
                setProjectId(value);
              }}
              placeholder={projects.isLoading ? 'Loading projects…' : 'Choose a project'}
              emptyMessage="No projects you can add to"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg-secondary">
            Status
            <Select
              aria-label="Status"
              value={statusId}
              onValueChange={setStatusId}
              options={statuses.map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon category={s.category} color={s.color} /> }))}
              placeholder={detail.isLoading ? 'Loading…' : 'Status'}
              disabled={statuses.length === 0}
            />
          </label>
          <div className="flex flex-col gap-1.5 text-sm font-medium text-fg-secondary">
            <span>Assignee</span>
            <UserPicker
              people={people.data ?? []}
              meId={user.id}
              value={assigneeId}
              onChange={(value) => {
                overrideFromPicker('assignee');
                setAssigneeId(value);
              }}
              placeholder="No one yet"
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm font-medium text-fg-secondary">
            <span>Due date</span>
            <IsoDatePicker
              value={dueDate}
              onChange={(value) => {
                overrideFromPicker('date');
                setDueDate(value);
              }}
              placeholder="No due date"
              aria-label="Due date"
            />
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg-secondary">
            Priority
            <Select
              aria-label="Priority"
              value={priority}
              onValueChange={(value) => {
                overrideFromPicker('priority');
                setPriority(value as Priority);
              }}
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p], icon: <PriorityIcon priority={p} /> }))}
            />
          </label>
          <div className="flex flex-col gap-1.5 text-sm font-medium text-fg-secondary">
            <span>Labels</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Labels"
                  data-testid="quick-add-labels"
                  className="flex min-h-9 w-full items-center gap-1.5 rounded-md border border-border-input bg-panel px-2.5 py-1 text-left text-sm font-normal text-fg hover:border-border-input-hover focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30 focus-visible:outline-none"
                >
                  {labelIds.length + newLabels.length === 0 ? (
                    <span className="flex flex-1 items-center gap-1.5 text-fg-placeholder">
                      <Tags aria-hidden className="size-4 text-icon" /> No labels
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                      {labelIds.map((id) => {
                        const label = projectLabels.find((l) => l.id === id);
                        return label ? <LabelPill key={id} name={label.name} color={label.color} /> : null;
                      })}
                      {newLabels.map((name) => (
                        <span key={name} className="inline-flex h-5 items-center gap-1 rounded-full border border-dashed border-border-strong px-2 text-2xs font-medium text-fg-secondary">
                          <Plus aria-hidden className="size-3" /> {name}
                        </span>
                      ))}
                    </span>
                  )}
                  <ChevronDown aria-hidden className="size-4 shrink-0 text-icon" />
                </button>
              </PopoverTrigger>
              <PopoverContent flush align="start" className="w-64">
                <OptionList
                  multiple
                  placeholder="Find or create a label…"
                  emptyText={projectLabels.length ? 'No label with that name' : 'This project has no labels yet'}
                  options={labelOptions}
                  selected={labelIds}
                  onToggle={(id) => {
                    const fromText = parsed.tokens.find((t) => t.kind === 'label' && t.value === id);
                    if (fromText) {
                      setTitle((text) => cutToken(text, fromText));
                      setLabelIds((list) => list.filter((x) => x !== id));
                      return;
                    }
                    setLabelIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
                  }}
                  onCreate={canCreateLabels ? (text) => setNewLabels((list) => [...list, text.trim()].filter(Boolean)) : undefined}
                  createLabel={(text) => `Create label “${text}”`}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </DialogBody>
      <DialogFooter className="flex-wrap justify-between gap-3">
        <Checkbox label="Add another" checked={another} onCheckedChange={(value) => setAnother(value === true)} />
        <div className="flex items-center gap-2">
          <span className={cn('hidden items-center gap-1 text-xs text-fg-muted lg:flex')}>
            <Kbd>Enter</Kbd> add · <Kbd>{mod}</Kbd>
            <Kbd>⇧</Kbd>
            <Kbd>Enter</Kbd> add and open
          </span>
          <Button variant="secondary" onClick={() => void submit(true)} disabled={saving} data-testid="quick-add-open">
            Add and open
          </Button>
          <Button onClick={() => void submit()} loading={saving} data-testid="quick-add-submit">
            Add task
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
