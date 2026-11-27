'use client';
/**
 * Intake forms: every form with its project, response count, on/off switch and share link.
 * "New form" starts from a ready-made question set. Opening a form shows the builder.
 * URL: /forms?project=<id>&form=<id>&tab=questions|settings|share|responses&new=1
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
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
  Field,
  IconButton,
  Input,
  SearchInput,
  Select,
  Switch,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { Page } from '@/components/layout/page';
import { routes } from '@/lib/routes';
import type { FormDTO, ProjectSummary } from '@/lib/types';
import {
  createFormAction,
  deleteFormAction,
  restoreFormAction,
  updateFormAction,
} from '@/server/actions/forms';
import { LocalTime } from '@/features/task/local-time';
import { SampleProjectButton } from '@/features/onboarding/sample-project-button';
import { useShell } from '@/features/shell/shell-context';
import { ProgramIcon } from '@/features/programs/kit';
import { FORM_STARTERS, type FormStarter } from './form-starters';
import { buildFormStarter, type FormProgram, type VariantQuestion } from './build-form';

/** A program in the forms list (it hosts build forms). */
function programShim(program: FormProgram, canEdit: boolean): ProjectSummary {
  return {
    id: program.id,
    kind: 'program',
    key: program.key,
    name: program.name,
    status: 'active',
    health: 'on_track',
    healthNote: null,
    color: program.color ?? 'orange',
    icon: program.icon ?? 'package',
    spaceId: null,
    ownerId: null,
    startDate: null,
    dueDate: null,
    visibility: 'org',
    crmCustomerId: null,
    crmItemId: null,
    isTemplate: false,
    archivedAt: null,
    completedAt: null,
    createdAt: '',
    updatedAt: '',
    progress: { total: 0, done: 0, overdue: 0, percent: 0 },
    memberCount: 0,
    role: canEdit ? 'editor' : 'viewer',
    starred: false,
  };
}
import { FormBuilder, type BuilderTab } from './form-builder';

function NewFormDialog({
  open,
  onOpenChange,
  projects: allContainers,
  programs = [],
  defaultProjectId,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: readonly ProjectSummary[];
  readonly programs?: readonly FormProgram[];
  readonly defaultProjectId?: string;
  readonly onCreated: (form: FormDTO) => void;
}) {
  const projects = allContainers.filter((container) => container.kind !== 'program');
  const [makes, setMakes] = useState<'tasks' | 'builds'>('tasks');
  const [programId, setProgramId] = useState<string | undefined>(programs[0]?.id);
  const [variantQuestion, setVariantQuestion] = useState<VariantQuestion>('list');
  const [starter, setStarter] = useState<FormStarter>(FORM_STARTERS[0]);
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId ?? projects[0]?.id);
  const [name, setName] = useState(FORM_STARTERS[0].formName);
  const [saving, setSaving] = useState(false);
  // Reset each time the dialog opens (adjusting state during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStarter(FORM_STARTERS[0]);
      setName(FORM_STARTERS[0].formName);
      setProjectId(
        defaultProjectId && projects.some((p) => p.id === defaultProjectId)
          ? defaultProjectId
          : projects[0]?.id,
      );
    }
  }
  const program = programs.find((entry) => entry.id === programId);
  const create = async () => {
    if (makes === 'builds') {
      if (!program) return;
      const made = buildFormStarter(program, variantQuestion);
      setSaving(true);
      const result = await createFormAction({ projectId: program.id, name: name.trim() || `${program.name} order`, description: `Tell us what to build for ${program.name}.`, fields: made.fields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })), settings: made.settings as Record<string, unknown>, isPublic: true });
      setSaving(false);
      if (!result.ok) {
        toast.error("Couldn't create the form", result.error.message);
        return;
      }
      toast.success('Build form created', `Each response makes a build in ${program.key}.`);
      onCreated(result.data);
      onOpenChange(false);
      return;
    }
    if (!projectId) return;
    setSaving(true);
    const result = await createFormAction({
      projectId,
      name: name.trim() || starter.formName,
      description: starter.description || null,
      fields: starter
        .fields()
        .map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })),
      settings: (starter.settings ?? {}) as Record<string, unknown>,
      isPublic: true,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't create the form", result.error.message);
      return;
    }
    toast.success('Form created', 'Adjust the questions, then share the link.');
    onCreated(result.data);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="new-form-dialog">
        <DialogHeader
          icon={
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-info-subtle text-info-text">
              <ClipboardList aria-hidden className="size-5" />
            </span>
          }
          title="New intake form"
          description={makes === 'builds' ? 'Each response becomes a build.' : 'Each response becomes a task.'}
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          {programs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="new-form-makes">
              <span className="text-sm font-medium text-fg">Each response makes</span>
              <div role="radiogroup" aria-label="Each response makes" className="inline-flex rounded-md border border-border-subtle bg-sunken p-0.5">
                {(['tasks', 'builds'] as const).map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={makes === value} onClick={() => { setMakes(value); if (value === 'builds' && program) setName(`${program.name} order`); else if (value === 'tasks') setName(starter.formName); }} className={cn('h-7 rounded-sm px-3 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus', makes === value ? 'bg-panel text-fg shadow-xs' : 'text-fg-secondary hover:text-fg')}>
                    {value === 'tasks' ? 'A task' : 'A build in a program'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {makes === 'builds' && program ? (
            <div className="grid gap-4 sm:grid-cols-2" data-testid="new-build-form">
              <Field label="Builds go into">
                {({ inputId }) => (
                  <Select id={inputId} value={programId} onValueChange={(id) => { setProgramId(id); const next = programs.find((entry) => entry.id === id); if (next) setName(`${next.name} order`); }} options={programs.map((entry) => ({ value: entry.id, label: entry.name, description: `${entry.variants.length} ${entry.variants.length === 1 ? 'kit' : 'kits'}`, icon: <ProgramIcon icon={entry.icon} color={entry.color} size={16} /> }))} aria-label="Builds go into" />
                )}
              </Field>
              <Field label="The kit question">
                {({ inputId }) => (
                  <Select id={inputId} value={variantQuestion} onValueChange={(value) => setVariantQuestion(value as VariantQuestion)} options={[{ value: 'list', label: `A list of the ${program.variants.length} kits`, description: 'People pick one' }, { value: 'sku', label: 'A typed SKU', description: 'Matched by SKU, key or name' }]} aria-label="The kit question" />
                )}
              </Field>
              <Field label="Form name" required className="sm:col-span-2">
                {({ inputId }) => <Input id={inputId} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="new-form-name" />}
              </Field>
              <p className="text-xs text-fg-muted sm:col-span-2">Starts with the kit, how many {program.unit.plural} and the day. Each response makes one build in {program.key}.</p>
            </div>
          ) : (
          <>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">Start with</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Start with">
              {FORM_STARTERS.map((option) => {
                const on = option.id === starter.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      if (!name.trim() || FORM_STARTERS.some((s) => s.formName === name))
                        setName(option.formName);
                      setStarter(option);
                    }}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                      on ? 'border-primary bg-primary-subtle/40' : 'border-border-subtle hover:bg-hover',
                    )}
                    data-testid={`form-starter-${option.id}`}
                  >
                    <span className="text-sm font-medium text-fg">{option.name}</span>
                    <span className="text-xs text-fg-muted">{option.blurb}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Form name" required>
              {({ inputId }) => (
                <Input
                  id={inputId}
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="new-form-name"
                />
              )}
            </Field>
            <Field label="Tasks go into">
              {({ inputId }) => (
                <Select
                  id={inputId}
                  value={projectId}
                  onValueChange={setProjectId}
                  options={projects.map((p) => ({
                    value: p.id,
                    label: p.name,
                    icon: <EntityIcon icon={p.icon} color={p.color} size={16} />,
                  }))}
                  aria-label="Tasks go into"
                />
              )}
            </Field>
          </div>
          </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void create()}
            loading={saving}
            disabled={(makes === 'builds' ? !program : !projectId) || !name.trim()}
            data-testid="new-form-create"
          >
            Create form
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormCard({
  form,
  project,
  canManage,
  onOpen,
  onToggle,
  onDelete,
}: {
  readonly form: FormDTO;
  readonly project?: ProjectSummary;
  readonly canManage: boolean;
  readonly onOpen: (tab?: BuilderTab) => void;
  readonly onToggle: (enabled: boolean) => void;
  readonly onDelete: () => void;
}) {
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${routes.publicForm(form.publicToken)}`);
      toast.success('Link copied', 'Paste it anywhere: email, chat or your website.');
    } catch {
      toast.error("Couldn't copy", 'Open the form’s Share tab to copy the link.');
    }
  };
  return (
    <li
      className="group flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel px-4 py-3.5 shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-sm sm:flex-row sm:items-center sm:gap-4"
      data-testid="form-card"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={cn(
            'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg',
            form.enabled ? 'bg-info-subtle text-info-text' : 'bg-muted text-icon',
          )}
        >
          <FileText aria-hidden className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen()}
            className="block max-w-full truncate rounded-xs text-left text-md font-semibold text-fg transition-colors hover:text-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {form.name}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
            {project ? (
              <span className="inline-flex items-center gap-1.5">
                <EntityIcon icon={project.icon} color={project.color} size={16} /> {project.name}
              </span>
            ) : null}
            <span>
              {form.fields.length} {form.fields.length === 1 ? 'question' : 'questions'}
            </span>
            <button
              type="button"
              onClick={() => onOpen('responses')}
              className="inline-flex items-center gap-1 tabular-nums hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Inbox aria-hidden className="size-3.5" /> {form.submissionCount}{' '}
              {form.submissionCount === 1 ? 'response' : 'responses'}
            </button>
            <span className="text-fg-muted">
              Made <LocalTime iso={form.createdAt} />
            </span>
            {form.isPublic ? (
              <Badge tone="info">
                Public link
              </Badge>
            ) : (
              <Badge>Workspace only</Badge>
            )}
            {!form.enabled ? <Badge>Off</Badge> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 self-end sm:self-center">
        <Tooltip content="Copy the share link">
          <IconButton
            label={`Copy link for ${form.name}`}
            icon={<Copy aria-hidden />}
            onClick={() => void copyLink()}
          />
        </Tooltip>
        <Tooltip
          content={
            canManage
              ? form.enabled
                ? 'Stop taking responses'
                : 'Start taking responses'
              : 'You need edit access'
          }
        >
          <span>
            <Switch
              checked={form.enabled}
              disabled={!canManage}
              onCheckedChange={onToggle}
              aria-label={`${form.enabled ? 'Turn off' : 'Turn on'} ${form.name}`}
            />
          </span>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`More for ${form.name}`} icon={<MoreHorizontal aria-hidden />} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => onOpen('questions')}>
              Edit questions
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Inbox aria-hidden />} onSelect={() => onOpen('responses')}>
              See responses
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Share2 aria-hidden />} onSelect={() => onOpen('share')}>
              Share
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<ExternalLink aria-hidden />}
              onSelect={() => window.open(routes.publicForm(form.publicToken), '_blank', 'noopener')}
            >
              Open the form
            </DropdownMenuItem>
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={onDelete}>
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function FormsView({
  forms,
  projects: projectList,
  programs = [],
}: {
  readonly forms: FormDTO[];
  readonly projects: ProjectSummary[];
  readonly programs?: readonly FormProgram[];
}) {
  const { can } = useShell();
  // Programs host build forms: they join the list as containers (kind program).
  const projects = useMemo(() => [...projectList, ...programs.map((program) => programShim(program, can('project:create')))], [projectList, programs, can]);
  const router = useRouter();
  const pathname = usePathname() ?? '/forms';
  const params = useSearchParams();
  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [enabledOverride, setEnabledOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
  // Forms made here show up instantly, before the server list refreshes.
  const [created, setCreated] = useState<readonly FormDTO[]>([]);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const editable = useMemo(
    () => projects.filter((p) => !p.archivedAt && (p.role === 'owner' || p.role === 'editor')),
    [projects],
  );
  const canManageForm = (form: FormDTO) => editable.some((p) => p.id === form.projectId);

  const setParams = useCallback(
    (patch: Record<string, string | null>, mode: 'push' | 'replace' = 'replace') => {
      const next = new URLSearchParams(params?.toString() ?? '');
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (mode === 'push') router.push(href, { scroll: true });
      else router.replace(href, { scroll: false });
    },
    [params, pathname, router],
  );

  // ?new=1 opens the "New form" dialog once, then the param is cleaned up.
  const wantsNew = params?.get('new') === '1';
  const [handledNew, setHandledNew] = useState(false);
  if (wantsNew && !handledNew) {
    setHandledNew(true);
    setNewOpen(true);
  }
  useEffect(() => {
    if (wantsNew) setParams({ new: null });
  }, [wantsNew, setParams]);

  const projectFilter = params?.get('project') ?? 'all';
  const openId = params?.get('form');
  const tabParam = params?.get('tab');
  const tab: BuilderTab =
    tabParam === 'settings' || tabParam === 'share' || tabParam === 'responses' ? tabParam : 'questions';
  const list = [...created.filter((c) => !forms.some((f) => f.id === c.id)), ...forms]
    .filter((form) => !hidden.has(form.id))
    .map((form) => ({ ...form, enabled: enabledOverride.get(form.id) ?? form.enabled }));
  const current = openId ? list.find((form) => form.id === openId) : undefined;

  if (current) {
    return (
      <FormBuilder
        key={current.id}
        form={current}
        project={byId.get(current.projectId)}
        program={programs.find((program) => program.id === current.projectId)}
        tab={tab}
        onTab={(next) => setParams({ tab: next === 'questions' ? null : next })}
        onBack={() => setParams({ form: null, tab: null }, 'push')}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const visible = list.filter((form) => {
    if (projectFilter !== 'all' && form.projectId !== projectFilter) return false;
    if (q && !`${form.name} ${form.description ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const toggle = async (form: FormDTO, enabled: boolean) => {
    setEnabledOverride((m) => new Map(m).set(form.id, enabled));
    const result = await updateFormAction({ formId: form.id, patch: { enabled } });
    if (!result.ok) {
      setEnabledOverride((m) => new Map(m).set(form.id, !enabled));
      toast.error("Couldn't change the form", result.error.message);
      return;
    }
    toast.success(
      enabled ? `“${form.name}” is taking responses` : `“${form.name}” is paused`,
      enabled ? undefined : 'The link shows a “not found” page until you turn it back on.',
    );
    router.refresh();
  };

  const remove = async (form: FormDTO) => {
    setHidden((s) => new Set(s).add(form.id));
    const result = await deleteFormAction({ formId: form.id });
    if (!result.ok) {
      setHidden((s) => {
        const next = new Set(s);
        next.delete(form.id);
        return next;
      });
      toast.error("Couldn't delete the form", result.error.message);
      return;
    }
    router.refresh();
    toast.undo(`Deleted “${form.name}”. Its tasks were kept.`, {
      onUndo: async () => {
        const restored = await restoreFormAction({ formId: form.id });
        if (!restored.ok) {
          toast.error("Couldn't bring it back", restored.error.message);
          return;
        }
        setHidden((s) => {
          const next = new Set(s);
          next.delete(form.id);
          return next;
        });
        router.refresh();
      },
    });
  };

  return (
    <Page
      title="Forms"
      actions={
        editable.length ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setNewOpen(true)} data-testid="form-new">
            New form
          </Button>
        ) : null
      }
    >
      {projects.length === 0 ? (
        <EmptyState
          illustration="workspace"
          title="Forms need a project to send tasks to"
          description="Create a project first, or try the sample one."
          actions={<SampleProjectButton variant="primary" />}
        />
      ) : list.length === 0 ? (
        <EmptyState
          visual={
            <span className="inline-flex size-16 items-center justify-center rounded-2xl bg-info-subtle text-info-text">
              <ClipboardList aria-hidden className="size-8" />
            </span>
          }
          title="No forms yet"
          description="Share the link with anyone. Each response becomes a task in your project."
          actions={
            editable.length ? (
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => setNewOpen(true)}>
                Make my first form
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search forms"
              aria-label="Search forms"
              containerClassName="w-full sm:w-64"
            />
            <Select
              value={projectFilter}
              onValueChange={(value) => setParams({ project: value === 'all' ? null : value })}
              options={[
                { value: 'all', label: 'All projects' },
                ...projects
                  .filter((p) => !p.archivedAt)
                  .map((p) => ({
                    value: p.id,
                    label: p.name,
                    icon: <EntityIcon icon={p.icon} color={p.color} size={16} />,
                  })),
              ]}
              aria-label="Project"
              className="w-full sm:w-56"
            />
          </div>
          {visible.length === 0 ? (
            <EmptyState
              size="sm"
              visual={<Search aria-hidden className="size-10 text-icon" />}
              title="No forms match"
              description="Try another word or pick “All projects”."
            />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="form-list">
              {visible.map((form) => (
                <FormCard
                  key={form.id}
                  form={form}
                  project={byId.get(form.projectId)}
                  canManage={canManageForm(form)}
                  onOpen={(next) =>
                    setParams({ form: form.id, tab: next && next !== 'questions' ? next : null }, 'push')
                  }
                  onToggle={(enabled) => void toggle(form, enabled)}
                  onDelete={() => void remove(form)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      <NewFormDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projects={editable}
        programs={programs}
        defaultProjectId={projectFilter !== 'all' ? projectFilter : undefined}
        onCreated={(form) => {
          setCreated((list) => [form, ...list]);
          router.refresh();
          setParams({ form: form.id, tab: null }, 'push');
        }}
      />
    </Page>
  );
}
