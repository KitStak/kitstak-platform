'use client';
/**
 * Intake form builder: questions (each mapped to a task field), where new tasks land, who can
 * fill it in, the share link and every response. A live preview shows exactly what people see.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  AtSign,
  Calendar,
  CheckSquare,
  CircleDot,
  Code2,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  Hash,
  Link2,
  ListChecks,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  UserPicker,
  cn,
  toast,
} from '@/components/ui';
import { EntityIcon, PriorityIcon, StatusIcon } from '@/components/pm';
import { Page, Panel } from '@/components/layout/page';
import { apiGet, apiPath } from '@/lib/api-client';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import type { FormField, FormFieldTarget, FormFieldType, FormSettings } from '@/lib/form-types';
import { usePeople, useProject } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { CustomFieldDTO, FormDTO, FormSubmissionDTO, ProjectSummary } from '@/lib/types';
import { updateFormAction } from '@/server/actions/forms';
import { useShell } from '@/features/shell/shell-context';
import { LocalTime } from '@/features/task/local-time';
import { OptionList } from '@/features/views/option-list';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { FIELD_TYPE_LABELS, blankField, newFieldId } from './form-starters';
import { FormFieldControl } from './public-form';

export type BuilderTab = 'questions' | 'settings' | 'share' | 'responses';

const TYPE_ICONS: Readonly<Record<FormFieldType, typeof Type>> = {
  short_text: Type,
  long_text: AlignLeft,
  email: AtSign,
  phone: Phone,
  number: Hash,
  date: Calendar,
  select: CircleDot,
  multiselect: ListChecks,
  checkbox: CheckSquare,
  url: Link2,
};

function TypeIcon({ type, className }: { readonly type: FormFieldType; readonly className?: string }) {
  const Icon = TYPE_ICONS[type];
  return <Icon aria-hidden className={cn('size-4 text-icon', className)} />;
}

interface Draft {
  readonly name: string;
  readonly description: string;
  readonly fields: readonly FormField[];
  readonly settings: FormSettings;
  readonly isPublic: boolean;
  readonly enabled: boolean;
}

const toDraft = (form: FormDTO): Draft => ({
  name: form.name,
  description: form.description ?? '',
  fields: form.fields,
  settings: form.settings,
  isPublic: form.isPublic,
  enabled: form.enabled,
});

/** Custom field types that can take each answer type. */
function customFieldFits(field: FormField, custom: CustomFieldDTO): boolean {
  switch (custom.type) {
    case 'text':
      return ['short_text', 'long_text', 'email', 'phone', 'url'].includes(field.type);
    case 'url':
      return field.type === 'url' || field.type === 'short_text';
    case 'number':
    case 'currency':
      return field.type === 'number';
    case 'date':
      return field.type === 'date';
    case 'checkbox':
      return field.type === 'checkbox';
    default:
      return false;
  }
}

function targetOptions(field: FormField, customFields: readonly CustomFieldDTO[]) {
  const options: { value: string; label: string; description?: string }[] = [
    { value: 'none', label: 'Listed in the description', description: 'Shown as “Question: answer”' },
  ];
  if (['short_text', 'email', 'url', 'select'].includes(field.type))
    options.push({ value: 'title', label: 'Task name' });
  if (['short_text', 'long_text'].includes(field.type))
    options.push({ value: 'description', label: 'Task description (top)' });
  if (field.type === 'date') options.push({ value: 'due_date', label: 'Due date' });
  if (field.type === 'select' || field.type === 'short_text')
    options.push({ value: 'priority', label: 'Priority', description: 'Answers like “High” or “Urgent”' });
  for (const custom of customFields)
    if (customFieldFits(field, custom))
      options.push({ value: `custom:${custom.id}`, label: custom.name, description: 'Custom field' });
  return options;
}

function problemsOf(draft: Draft): Map<string, string> {
  const problems = new Map<string, string>();
  if (!draft.name.trim()) problems.set('name', 'Give the form a name.');
  if (draft.fields.length === 0) problems.set('fields', 'Add at least one question.');
  const titles = draft.fields.filter((f) => f.mapTo === 'title');
  draft.fields.forEach((field) => {
    if (!field.label.trim()) problems.set(field.id, 'Write the question.');
    else if (
      (field.type === 'select' || field.type === 'multiselect') &&
      !(field.options ?? []).some((o) => o.label.trim())
    )
      problems.set(field.id, 'Add at least one choice.');
    else if ((field.options ?? []).some((o) => !o.label.trim()))
      problems.set(field.id, 'Every choice needs words.');
    else if (field.mapTo === 'title' && titles.length > 1 && titles[0].id !== field.id)
      problems.set(field.id, 'Only one question can become the task name.');
  });
  return problems;
}

// --- Question editor ---------------------------------------------------------------------------

function QuestionCard({
  field,
  index,
  count,
  problem,
  customFields,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  readonly field: FormField;
  readonly index: number;
  readonly count: number;
  readonly problem?: string;
  readonly customFields: readonly CustomFieldDTO[];
  readonly onChange: (field: FormField) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
}) {
  const choices = field.type === 'select' || field.type === 'multiselect';
  const targets = targetOptions(field, customFields);
  const mapValue = field.mapTo && targets.some((t) => t.value === field.mapTo) ? field.mapTo : 'none';
  return (
    <li
      className={cn(
        'rounded-xl border bg-panel shadow-xs',
        problem ? 'border-danger/50' : 'border-border-subtle',
      )}
      data-testid="form-question"
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="mt-2 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-fg-secondary tabular-nums">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={field.label}
              onChange={(event) => onChange({ ...field, label: event.target.value })}
              placeholder="Write your question"
              aria-label={`Question ${index + 1}`}
              maxLength={200}
              size="lg"
              invalid={Boolean(problem) && !field.label.trim()}
              containerClassName="flex-1"
            />
            <Select
              value={field.type}
              onValueChange={(type) => {
                const next = type as FormFieldType;
                const needsChoices = next === 'select' || next === 'multiselect';
                const fresh = blankField(next);
                const mapTo = targetOptions({ ...field, type: next }, customFields).some(
                  (t) => t.value === field.mapTo,
                )
                  ? field.mapTo
                  : null;
                onChange({
                  ...field,
                  type: next,
                  options: needsChoices ? (field.options?.length ? field.options : fresh.options) : undefined,
                  mapTo,
                });
              }}
              options={(Object.keys(FIELD_TYPE_LABELS) as FormFieldType[]).map((type) => ({
                value: type,
                label: FIELD_TYPE_LABELS[type],
                icon: <TypeIcon type={type} />,
              }))}
              aria-label="Answer type"
              size="lg"
              className="sm:w-44"
            />
          </div>
          <Input
            value={field.helpText ?? ''}
            onChange={(event) => onChange({ ...field, helpText: event.target.value || undefined })}
            placeholder="Help text (optional)"
            aria-label="Help text"
            maxLength={500}
            size="sm"
            containerClassName="mt-2"
          />
          {choices ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {(field.options ?? []).map((option, optionIndex) => (
                <div key={option.id} className="flex items-center gap-2">
                  {field.type === 'select' ? (
                    <CircleDot aria-hidden className="size-4 shrink-0 text-icon" />
                  ) : (
                    <CheckSquare aria-hidden className="size-4 shrink-0 text-icon" />
                  )}
                  <Input
                    value={option.label}
                    size="sm"
                    maxLength={120}
                    aria-label={`Choice ${optionIndex + 1}`}
                    onChange={(event) =>
                      onChange({
                        ...field,
                        options: field.options?.map((o) =>
                          o.id === option.id ? { ...o, label: event.target.value } : o,
                        ),
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onChange({
                          ...field,
                          options: [...(field.options ?? []), { id: newFieldId(), label: '' }],
                        });
                      }
                    }}
                    containerClassName="flex-1"
                  />
                  <IconButton
                    size="sm"
                    label={`Remove ${option.label || 'choice'}`}
                    icon={<X aria-hidden />}
                    disabled={(field.options?.length ?? 0) <= 1}
                    onClick={() =>
                      onChange({ ...field, options: field.options?.filter((o) => o.id !== option.id) })
                    }
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="w-fit"
                leadingIcon={<Plus aria-hidden />}
                disabled={(field.options?.length ?? 0) >= 50}
                onClick={() =>
                  onChange({
                    ...field,
                    options: [
                      ...(field.options ?? []),
                      { id: newFieldId(), label: `Option ${(field.options?.length ?? 0) + 1}` },
                    ],
                  })
                }
              >
                Add a choice
              </Button>
            </div>
          ) : null}
          {problem ? (
            <p className="mt-2 text-xs text-danger-text" role="alert">
              {problem}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-2.5">
        <label className="flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
          <span className="shrink-0">Goes to</span>
          <Select
            value={mapValue}
            onValueChange={(value) =>
              onChange({ ...field, mapTo: value === 'none' ? null : (value as FormFieldTarget) })
            }
            options={targets}
            aria-label="Where the answer goes on the task"
            size="sm"
            className="w-52"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <Switch
            checked={field.required}
            onCheckedChange={(required) => onChange({ ...field, required })}
            aria-label="Required"
            size="sm"
          />
          Required
        </label>
        <span className="flex-1" />
        <div className="flex items-center gap-0.5">
          <IconButton
            size="sm"
            label="Move up"
            icon={<ArrowUp aria-hidden />}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            size="sm"
            label="Move down"
            icon={<ArrowDown aria-hidden />}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          />
          <IconButton
            size="sm"
            label="Duplicate question"
            icon={<CopyPlus aria-hidden />}
            onClick={onDuplicate}
          />
          <IconButton
            size="sm"
            label="Delete question"
            icon={<Trash2 aria-hidden />}
            disabled={count <= 1}
            onClick={onRemove}
          />
        </div>
      </div>
    </li>
  );
}

function FormPreview({
  draft,
  projectName,
  orgName,
}: {
  readonly draft: Draft;
  readonly projectName: string;
  readonly orgName: string;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  return (
    <div className="rounded-2xl border border-border-subtle bg-app p-4" data-testid="form-preview">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        <Eye aria-hidden className="size-3.5" /> Live preview
      </p>
      <div className="rounded-xl border border-border-subtle bg-panel p-5 shadow-xs">
        <p className="text-xs text-fg-muted">
          {orgName} · {projectName}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-fg">
          {draft.name || 'Untitled form'}
        </h2>
        {draft.description ? (
          <p className="mt-1.5 text-sm whitespace-pre-wrap text-fg-secondary">{draft.description}</p>
        ) : null}
        <div className="mt-4 flex flex-col gap-4">
          {draft.fields.map((field) => (
            <Field
              key={field.id}
              label={field.label || 'Untitled question'}
              required={field.required}
              hint={field.type === 'checkbox' ? undefined : field.helpText}
            >
              {({ inputId, describedBy, invalid }) => (
                <FormFieldControl
                  field={field}
                  id={`preview-${inputId}`}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={answers[field.id]}
                  onChange={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
                />
              )}
            </Field>
          ))}
          {(draft.settings.collectContact ?? draft.isPublic) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your name">{({ inputId }) => <Input id={`preview-${inputId}`} disabled />}</Field>
              <Field label="Your email">
                {({ inputId }) => <Input id={`preview-${inputId}`} disabled />}
              </Field>
            </div>
          ) : null}
          <Button disabled className="w-full">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Settings ----------------------------------------------------------------------------------

function LabelsField({
  value,
  onChange,
  labels,
}: {
  readonly value: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly labels: readonly { id: string; name: string; color: string }[];
}) {
  const chosen = labels.filter((label) => value.includes(label.id));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-border-input bg-panel px-2 py-1 text-left text-sm hover:border-border-input-hover focus-visible:border-primary focus-visible:outline-none"
          aria-label="Labels"
        >
          {chosen.length ? (
            chosen.map((label) => (
              <Badge key={label.id} size="sm">
                {label.name}
              </Badge>
            ))
          ) : (
            <span className="text-fg-placeholder">No labels</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent flush className="w-64">
        <OptionList
          options={labels.map((label) => ({ value: label.id, label: label.name }))}
          selected={value}
          onToggle={(id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])}
          emptyText="This project has no labels yet"
        />
      </PopoverContent>
    </Popover>
  );
}

// --- Responses ---------------------------------------------------------------------------------

function answerText(field: FormField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'checkbox') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return value.map((id) => field.options?.find((o) => o.id === id)?.label ?? String(id)).join(', ');
  if (field.type === 'select') return field.options?.find((o) => o.id === value)?.label ?? String(value);
  return String(value);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function Responses({ form, fields }: { readonly form: FormDTO; readonly fields: readonly FormField[] }) {
  const { openTask } = useTaskDrawer();
  const [expanded, setExpanded] = useState<string | null>(null);
  const submissions = useQuery({
    queryKey: qk.formSubmissions(form.id),
    queryFn: () => apiGet<FormSubmissionDTO[]>(apiPath(`forms/${form.id}/submissions`)),
    refetchInterval: 30_000,
  });
  const list = submissions.data ?? [];
  const download = () => {
    const header = ['Sent at', 'Name', 'Email', 'Task', ...fields.map((f) => f.label)];
    const rows = list.map((s) => [
      new Date(s.createdAt).toLocaleString(),
      s.submitterName ?? '',
      s.submitterEmail ?? '',
      s.taskKey ?? '',
      ...fields.map((f) => answerText(f, s.data[f.id])),
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'form'}-responses.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (submissions.isLoading)
    return <p className="py-10 text-center text-sm text-fg-muted">Loading responses…</p>;
  if (list.length === 0) {
    return (
      <EmptyState
        illustration="inbox"
        title="No responses yet"
        description="Share the link from the Share tab. Each response shows up here and becomes a task in the project."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="form-responses">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary">
          {list.length} {list.length === 1 ? 'response' : 'responses'}, newest first
        </p>
        <Button size="sm" variant="secondary" leadingIcon={<Download aria-hidden />} onClick={download}>
          Download CSV
        </Button>
      </div>
      <ul className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs">
        {list.map((submission) => {
          const open = expanded === submission.id;
          const titleField = fields.find((f) => f.mapTo === 'title');
          const headline =
            (titleField && answerText(titleField, submission.data[titleField.id])) ||
            submission.taskTitle ||
            'Response';
          return (
            <li key={submission.id} className="border-b border-border-subtle last:border-b-0">
              <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-xs text-left focus-visible:outline-2 focus-visible:outline-focus"
                  onClick={() => setExpanded(open ? null : submission.id)}
                  aria-expanded={open}
                >
                  <p className="truncate text-sm font-medium text-fg">{headline}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {[submission.submitterName, submission.submitterEmail].filter(Boolean).join(' · ') ||
                      'Anonymous'}{' '}
                    · <LocalTime iso={submission.createdAt} />
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  {submission.taskKey ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      data-task-key={submission.taskKey}
                      onClick={() => openTask(submission.taskKey as string)}
                    >
                      <span className="font-mono text-xs text-fg-muted">{submission.taskKey}</span> Open task
                    </Button>
                  ) : (
                    <Badge>Task deleted</Badge>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setExpanded(open ? null : submission.id)}>
                    {open ? 'Hide answers' : 'Answers'}
                  </Button>
                </div>
              </div>
              {open ? (
                <dl className="grid gap-x-6 gap-y-2 bg-sunken/60 px-4 py-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                  {fields.map((field) => (
                    <div key={field.id} className="contents">
                      <dt className="text-xs font-medium text-fg-muted">{field.label}</dt>
                      <dd className="text-sm whitespace-pre-wrap text-fg">
                        {answerText(field, submission.data[field.id]) || (
                          <span className="text-fg-muted">No answer</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Builder -----------------------------------------------------------------------------------

export function FormBuilder({
  form,
  project,
  tab,
  onTab,
  onBack,
}: {
  readonly form: FormDTO;
  readonly project: ProjectSummary | undefined;
  readonly tab: BuilderTab;
  readonly onTab: (tab: BuilderTab) => void;
  readonly onBack: () => void;
}) {
  const router = useRouter();
  const { org, user } = useShell();
  const [draft, setDraft] = useState<Draft>(() => toDraft(form));
  const [saved, setSaved] = useState<Draft>(() => toDraft(form));
  const [token, setToken] = useState(form.publicToken);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmNewLink, setConfirmNewLink] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const detail = useProject(project?.key ?? '', { enabled: Boolean(project) });
  const people = usePeople();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const problems = useMemo(() => problemsOf(draft), [draft]);
  const statuses = detail.data?.statuses ?? [];
  const sections = detail.data?.sections ?? [];
  const labels = detail.data?.labels ?? [];
  const customFields = detail.data?.customFields ?? [];
  const link =
    typeof window === 'undefined'
      ? routes.publicForm(token)
      : `${window.location.origin}${routes.publicForm(token)}`;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setSettings = (patch: Partial<FormSettings>) =>
    setDraft((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
  const setField = (id: string, next: FormField) =>
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((f) =>
        f.id === id ? next : next.mapTo === 'title' && f.mapTo === 'title' ? { ...f, mapTo: null } : f,
      ),
    }));

  const save = async (patch?: Partial<Draft> & { regenerateLink?: boolean }) => {
    const next = patch ? { ...draft, ...patch } : draft;
    setShowProblems(true);
    const found = problemsOf(next);
    if (found.size > 0) {
      toast.error('Almost there', found.values().next().value ?? 'Fix the highlighted questions first.');
      if (tab !== 'questions' && !found.has('name')) onTab('questions');
      return false;
    }
    setSaving(true);
    const result = await updateFormAction({
      formId: form.id,
      patch: {
        name: next.name,
        description: next.description.trim() || null,
        fields: next.fields.map((f) => ({
          ...f,
          label: f.label.trim(),
          options: f.options?.map((o) => ({ ...o, label: o.label.trim() })),
        })),
        settings: next.settings as Record<string, unknown>,
        isPublic: next.isPublic,
        enabled: next.enabled,
        regenerateLink: patch?.regenerateLink,
      },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't save the form", result.error.message);
      return false;
    }
    const fresh = toDraft(result.data);
    setDraft(fresh);
    setSaved(fresh);
    setToken(result.data.publicToken);
    router.refresh();
    return true;
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy", 'Select the text and copy it yourself.');
    }
  };

  const embed = `<iframe src="${link}" width="100%" height="720" style="border:0" title="${draft.name.replace(/"/g, '&quot;')}"></iframe>`;

  return (
    <Page
      title={draft.name || 'Untitled form'}
      breadcrumbs={[{ label: 'Forms', href: routes.forms() }, { label: draft.name || 'Untitled form' }]}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {project ? (
            <span className="inline-flex items-center gap-1.5">
              <EntityIcon icon={project.icon} color={project.color} size={16} /> Answers become tasks in{' '}
              {project.name}
            </span>
          ) : null}
          {draft.enabled ? (
            <Badge tone="success" size="sm">
              Accepting responses
            </Badge>
          ) : (
            <Badge size="sm">Turned off</Badge>
          )}
          {draft.isPublic ? (
            <Badge size="sm" tone="info">
              Anyone with the link
            </Badge>
          ) : (
            <Badge size="sm">Workspace only</Badge>
          )}
        </span>
      }
      actions={
        <>
          <span className="hidden text-xs text-fg-muted sm:inline" aria-live="polite">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <Button
            variant="secondary"
            leadingIcon={<Copy aria-hidden />}
            onClick={() => void copy(link, 'Link')}
          >
            Copy link
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!dirty} data-testid="form-save">
            Save
          </Button>
        </>
      }
      tabs={
        <Tabs value={tab} onValueChange={(value) => onTab(value as BuilderTab)}>
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList aria-label="Form sections" className="min-w-max [&>button]:whitespace-nowrap">
              <TabsTrigger value="questions" count={draft.fields.length}>
                Questions
              </TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="share">Share</TabsTrigger>
              <TabsTrigger value="responses" count={form.submissionCount} data-testid="form-tab-responses">
                Responses
              </TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
      }
    >
      {tab === 'questions' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex flex-col gap-4">
            <Panel>
              <div className="flex flex-col gap-3">
                <Field label="Form name" required error={showProblems ? problems.get('name') : undefined}>
                  {({ inputId, invalid }) => (
                    <Input
                      id={inputId}
                      value={draft.name}
                      maxLength={120}
                      onChange={(e) => update({ name: e.target.value })}
                      invalid={invalid}
                      size="lg"
                      data-testid="form-name"
                    />
                  )}
                </Field>
                <Field label="Intro" hint="Shown under the name. Say what happens after someone sends it.">
                  {({ inputId, describedBy }) => (
                    <Textarea
                      id={inputId}
                      aria-describedby={describedBy}
                      rows={2}
                      maxLength={2000}
                      value={draft.description}
                      onChange={(e) => update({ description: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            </Panel>
            <ol className="flex flex-col gap-3" aria-label="Questions">
              {draft.fields.map((field, index) => (
                <QuestionCard
                  key={field.id}
                  field={field}
                  index={index}
                  count={draft.fields.length}
                  problem={showProblems ? problems.get(field.id) : undefined}
                  customFields={customFields}
                  onChange={(next) => setField(field.id, next)}
                  onMove={(delta) => {
                    const list = [...draft.fields];
                    const [moved] = list.splice(index, 1);
                    list.splice(index + delta, 0, moved);
                    update({ fields: list });
                  }}
                  onDuplicate={() => {
                    const list = [...draft.fields];
                    list.splice(index + 1, 0, {
                      ...field,
                      id: newFieldId(),
                      label: `${field.label} (copy)`.slice(0, 200),
                      mapTo: field.mapTo === 'title' ? null : field.mapTo,
                      options: field.options?.map((o) => ({ ...o, id: newFieldId() })),
                    });
                    update({ fields: list });
                  }}
                  onRemove={() => update({ fields: draft.fields.filter((f) => f.id !== field.id) })}
                />
              ))}
            </ol>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  leadingIcon={<Plus aria-hidden />}
                  className="w-fit"
                  disabled={draft.fields.length >= 50}
                  data-testid="form-add-question"
                >
                  Add a question
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {(Object.keys(FIELD_TYPE_LABELS) as FormFieldType[]).map((type) => (
                  <DropdownMenuItem
                    key={type}
                    icon={<TypeIcon type={type} />}
                    onSelect={() => update({ fields: [...draft.fields, blankField(type)] })}
                  >
                    {FIELD_TYPE_LABELS[type]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {!draft.fields.some((f) => f.mapTo === 'title') ? (
              <p className="rounded-lg bg-info-subtle px-3 py-2 text-sm text-info-text">
                Tip: set one question to “Goes to: Task name”. Otherwise tasks are named “
                {draft.name || 'Form'} from …”.
              </p>
            ) : null}
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            <FormPreview draft={draft} projectName={project?.name ?? 'Project'} orgName={org.name} />
          </div>
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="flex max-w-[760px] flex-col gap-4">
          <Panel title="New tasks">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start in status">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={draft.settings.statusId ?? 'default'}
                    onValueChange={(value) =>
                      setSettings({ statusId: value === 'default' ? undefined : value })
                    }
                    options={[
                      { value: 'default', label: 'The project’s first status' },
                      ...statuses.map((s) => ({
                        value: s.id,
                        label: s.name,
                        icon: <StatusIcon category={s.category} color={s.color} size={14} />,
                      })),
                    ]}
                    aria-label="Start in status"
                  />
                )}
              </Field>
              <Field label="Section">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={draft.settings.sectionId ?? 'none'}
                    onValueChange={(value) =>
                      setSettings({ sectionId: value === 'none' ? undefined : value })
                    }
                    options={[
                      { value: 'none', label: 'No section' },
                      ...sections.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                    aria-label="Section"
                  />
                )}
              </Field>
              <Field label="Assign to">
                {() => (
                  <UserPicker
                    people={people.data ?? []}
                    meId={user.id}
                    value={draft.settings.assigneeId ?? null}
                    onChange={(assigneeId) => setSettings({ assigneeId })}
                    placeholder="Nobody yet"
                    aria-label="Assign new tasks to"
                  />
                )}
              </Field>
              <Field label="Priority" hint="Used when no question sets it.">
                {({ inputId, describedBy }) => (
                  <Select
                    id={inputId}
                    aria-describedby={describedBy}
                    value={draft.settings.priority ?? 'none'}
                    onValueChange={(value) => setSettings({ priority: value as Priority })}
                    options={PRIORITIES.map((p) => ({
                      value: p,
                      label: PRIORITY_LABELS[p],
                      icon: <PriorityIcon priority={p} size={14} />,
                    }))}
                    aria-label="Priority"
                  />
                )}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Labels">
                  {() => (
                    <LabelsField
                      value={draft.settings.labelIds ?? []}
                      onChange={(labelIds) => setSettings({ labelIds })}
                      labels={labels}
                    />
                  )}
                </Field>
              </div>
            </div>
          </Panel>
          <Panel title="After someone sends it">
            <div className="flex flex-col gap-4">
              <label className="flex items-center justify-between gap-4 rounded-lg border border-border-subtle px-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium text-fg">Send responses to Triage first</span>
                  <span className="block text-xs text-fg-muted">
                    Each response waits in the project’s Triage list. Someone accepts it into a task, declines it, snoozes it or merges it with a task that already exists.
                  </span>
                </span>
                <Switch
                  checked={draft.settings.sendToTriage ?? false}
                  onCheckedChange={(sendToTriage) => setSettings({ sendToTriage })}
                  aria-label="Send responses to Triage first"
                />
              </label>
              <Field label="Thank-you message">
                {({ inputId }) => (
                  <Textarea
                    id={inputId}
                    rows={2}
                    maxLength={500}
                    value={draft.settings.confirmationMessage ?? ''}
                    onChange={(e) => setSettings({ confirmationMessage: e.target.value || undefined })}
                    placeholder="Thanks! Your request was sent to the team."
                  />
                )}
              </Field>
              <Field
                label="Tell these people about each response"
                hint="The project owner always hears about it."
              >
                {() => (
                  <UserPicker
                    multiple
                    people={people.data ?? []}
                    meId={user.id}
                    value={draft.settings.notifyUserIds ?? []}
                    onChange={(notifyUserIds) => setSettings({ notifyUserIds })}
                    placeholder="Pick people"
                    aria-label="People to notify"
                  />
                )}
              </Field>
            </div>
          </Panel>
          <Panel title="Who can fill it in">
            <div className="flex flex-col gap-3" role="radiogroup" aria-label="Who can fill it in">
              {[
                {
                  value: true,
                  title: 'Anyone with the link',
                  body: 'Customers, partners and teammates. No sign-in needed.',
                },
                {
                  value: false,
                  title: `Only people in ${org.name}`,
                  body: 'They sign in first. Good for internal requests.',
                },
              ].map((choice) => (
                <label
                  key={String(choice.value)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                    draft.isPublic === choice.value
                      ? 'border-primary bg-primary-subtle/40'
                      : 'border-border-subtle hover:bg-hover',
                  )}
                >
                  <input
                    type="radio"
                    name="form-access"
                    className="mt-1 accent-[var(--primary)]"
                    checked={draft.isPublic === choice.value}
                    onChange={() => update({ isPublic: choice.value })}
                  />
                  <span>
                    <span className="block text-sm font-medium text-fg">{choice.title}</span>
                    <span className="block text-xs text-fg-muted">{choice.body}</span>
                  </span>
                </label>
              ))}
              <label className="mt-1 flex items-center justify-between gap-4 py-1">
                <span>
                  <span className="block text-sm font-medium text-fg">Ask for their name and email</span>
                  <span className="block text-xs text-fg-muted">
                    So you can reply. Shown at the bottom of the form.
                  </span>
                </span>
                <Switch
                  checked={draft.settings.collectContact ?? draft.isPublic}
                  onCheckedChange={(collectContact) => setSettings({ collectContact })}
                  aria-label="Ask for name and email"
                />
              </label>
            </div>
          </Panel>
          <Panel title="Form status">
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium text-fg">Accepting responses</span>
                <span className="block text-xs text-fg-muted">
                  Turn off to pause the form. The link shows a “not found” page while it’s off.
                </span>
              </span>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) => update({ enabled })}
                aria-label="Accepting responses"
                data-testid="form-enabled"
              />
            </label>
          </Panel>
        </div>
      ) : null}

      {tab === 'share' ? (
        <div className="flex max-w-[760px] flex-col gap-4">
          {dirty ? (
            <p className="rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-text">
              You have unsaved changes. Save so people see the latest version.
            </p>
          ) : null}
          {!draft.enabled ? (
            <p className="rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-text">
              This form is turned off. Turn it on in Settings before sharing.
            </p>
          ) : null}
          <Panel title="Share link">
            <p className="mb-3 text-sm text-fg-secondary">
              {draft.isPublic
                ? 'Anyone with this link can send a response. No account needed.'
                : `People must sign in to ${org.name} to use this link.`}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                value={link}
                aria-label="Form link"
                onFocus={(e) => e.currentTarget.select()}
                containerClassName="flex-1"
                data-testid="form-link"
              />
              <div className="flex gap-2">
                <Button leadingIcon={<Copy aria-hidden />} onClick={() => void copy(link, 'Link')}>
                  Copy
                </Button>
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-muted"
                >
                  <ExternalLink aria-hidden className="size-4" /> Open
                </a>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`mailto:?subject=${encodeURIComponent(draft.name)}&body=${encodeURIComponent(`${draft.description ? `${draft.description}\n\n` : ''}${link}`)}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-fg-secondary hover:bg-hover hover:text-fg"
              >
                <Mail aria-hidden className="size-4" /> Send by email
              </a>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<RefreshCw aria-hidden />}
                onClick={() => setConfirmNewLink(true)}
              >
                Make a new link
              </Button>
            </div>
          </Panel>
          <Panel title="Put it on a website">
            <p className="mb-2 text-sm text-fg-secondary">
              Paste this code into any web page to show the form there.
            </p>
            <div className="flex flex-col gap-2">
              <Textarea
                readOnly
                rows={3}
                value={embed}
                aria-label="Embed code"
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                size="sm"
                variant="secondary"
                className="w-fit"
                leadingIcon={<Code2 aria-hidden />}
                onClick={() => void copy(embed, 'Embed code')}
              >
                Copy code
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === 'responses' ? <Responses form={form} fields={saved.fields} /> : null}

      <ConfirmDialog
        open={confirmNewLink}
        onOpenChange={setConfirmNewLink}
        title="Make a new link?"
        description="The old link stops working right away. Anyone who has it will need the new one."
        confirmLabel="Make a new link"
        destructive
        onConfirm={async () => {
          setConfirmNewLink(false);
          if (await save({ regenerateLink: true }))
            toast.success('New link ready', 'The old link no longer works.');
        }}
      />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave without saving?"
        description="Your changes to this form will be lost."
        confirmLabel="Leave"
        destructive
        onConfirm={() => {
          setConfirmLeave(false);
          onBack();
        }}
      />
      <BackGuard dirty={dirty} onBlocked={() => setConfirmLeave(true)} onBack={onBack} />
    </Page>
  );
}

/** "← All forms" button that asks before throwing away unsaved changes. */
function BackGuard({
  dirty,
  onBlocked,
  onBack,
}: {
  readonly dirty: boolean;
  readonly onBlocked: () => void;
  readonly onBack: () => void;
}): ReactNode {
  return (
    <div className="mt-8 border-t border-border-subtle pt-4">
      <Button variant="ghost" onClick={() => (dirty ? onBlocked() : onBack())}>
        ← All forms
      </Button>
    </div>
  );
}
