'use client';
/**
 * New project wizard (/projects/new): (1) start blank or pick from the visual template gallery,
 * (2) name, auto key, space, owner, dates, color and icon, (3) people and links to CRM / the
 * shared customer list, then create and open. Prefills from the URL so CRM's "Create project
 * from deal" lands here ready to go:
 *   /projects/new?template=builtin:client-onboarding&crmItem=<id>&customer=<id>&name=…&space=<id>
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Flag, LayoutList, Lock, Search, Sparkles, UserPlus, Users, Workflow, X, Zap } from 'lucide-react';
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  IsoDatePicker,
  Select,
  Switch,
  Textarea,
  ToggleGroup,
  UserPicker,
  WizardSteps,
  buttonVariants,
  cn,
  toLabelColor,
  toast,
} from '@/components/ui';
import { EntityIcon, PersonAvatar, StatusIcon } from '@/components/pm';
import { Page } from '@/components/layout/page';
import { PROJECT_KEY_PATTERN, PROJECT_ROLES, PROJECT_ROLE_LABELS, type ProjectRole } from '@/lib/constants';
import { diffDays, templateOffsetDateIso, formatRange, todayIso } from '@/lib/dates';
import { useServerAction } from '@/lib/hooks/use-action';
import { useIntegrationSearch, useIntegrationStatus, usePeople, useProjects, useSpaces, useTemplates, type ResolvedTargetDTO } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { suggestProjectKey } from '@/lib/task-key';
import { describeTemplateTaskCounts, startingStatusKey, templateDayText } from '@/lib/template-math';
import type { TemplatePayload } from '@/lib/template-types';
import type { TemplateDTO } from '@/lib/types';
import { addLinkAction } from '@/server/actions/links';
import { createProjectAction } from '@/server/actions/projects';
import { useShell } from '@/features/shell/shell-context';
import { AppearancePicker } from './appearance-picker';
import { RecordPicker } from './record-picker';

export interface NewProjectPrefill {
  readonly templateId?: string;
  readonly name?: string;
  readonly crmItemId?: string;
  readonly customerId?: string;
  readonly spaceId?: string;
}

const BLANK_STATUSES = [
  { key: 'todo', name: 'To do', category: 'todo', color: 'gray' },
  { key: 'doing', name: 'In progress', category: 'in_progress', color: 'blue' },
  { key: 'review', name: 'In review', category: 'in_progress', color: 'purple' },
  { key: 'done', name: 'Done', category: 'done', color: 'green' },
] as const;

const STEPS = [
  { id: 'start', title: 'Start' },
  { id: 'details', title: 'Details' },
  { id: 'team', title: 'People & links' },
];

function taskCountText(template: TemplateDTO, noun = 'tasks'): string {
  return describeTemplateTaskCounts({ tasks: template.taskCount, subtasks: template.subtaskCount ?? 0 }, noun);
}

function weeksLabel(days: number | undefined): string | null {
  if (!days) return null;
  if (days < 14) return `${days} days`;
  return `${Math.round(days / 7)} weeks`;
}

function escapeHtml(text: string): string {
  return text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string);
}

/** Micro-board preview: status columns with real task titles from the template. */
function TemplateThumbnail({ payload, color }: { readonly payload: TemplatePayload | null; readonly color: string }) {
  const statuses = (payload?.statuses ?? BLANK_STATUSES).slice(0, 3);
  const fallbackKey = statuses.find((s) => 'isDefault' in s && s.isDefault)?.key ?? statuses[0]?.key;
  const tasks = payload?.tasks ?? [];
  return (
    <div className="grid h-[92px] gap-1.5 overflow-hidden rounded-lg border border-border-subtle bg-sunken p-2" style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))`, boxShadow: `inset 0 3px 0 var(--label-${toLabelColor(color)})` }} aria-hidden>
      {statuses.map((status, index) => {
        const cards = tasks.filter((task) => (startingStatusKey(payload?.statuses, task) ?? fallbackKey) === status.key).slice(0, 2);
        const placeholder = !payload && index === 0;
        return (
          <div key={status.key} className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-1 truncate text-[9px] leading-3 font-semibold" style={{ color: `var(--label-${toLabelColor(status.color)}-text)` }}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--label-${toLabelColor(status.color)})` }} />
              <span className="truncate">{status.name}</span>
            </span>
            {cards.map((task) => (
              <span key={task.title} className="block truncate rounded-[3px] bg-panel px-1 py-[3px] text-[9px] leading-3 text-fg shadow-xs">
                {task.title}
              </span>
            ))}
            {placeholder ? <span className="block rounded-[3px] border border-dashed border-border-default px-1 py-[3px] text-[9px] leading-3 text-fg-muted">+ Add task</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function TemplateCard({ template, selected, onSelect, onOpen }: { readonly template: TemplateDTO | null; readonly selected: boolean; readonly onSelect: () => void; readonly onOpen: () => void }) {
  const color = template?.color ?? 'gray';
  const duration = weeksLabel(template?.payload.durationDays);
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      aria-pressed={selected}
      data-testid="template-option"
      data-template-id={template?.id ?? 'blank'}
      className={cn(
        'group relative flex h-full flex-col gap-3 rounded-xl border bg-panel p-3 text-left shadow-xs outline-none',
        'transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-out hover:-translate-y-px hover:shadow-sm motion-reduce:hover:translate-y-0',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        selected ? 'border-primary shadow-[0_0_0_3px_var(--focus-ring-soft)]' : 'border-border-subtle hover:border-border-default',
      )}
    >
      <TemplateThumbnail payload={template?.payload ?? null} color={color} />
      <div className="flex items-start gap-2.5">
        {template ? <EntityIcon icon={template.icon} color={template.color} size={28} /> : <EntityIcon icon="file-text" color="gray" size={28} />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg">{template?.name ?? 'Blank project'}</p>
          {template ? (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-muted">
              {template.builtIn === false ? <Badge tone="info" size="sm">Your team</Badge> : null}
              {[template.category, taskCountText(template), duration].filter(Boolean).map((part, index) => (
                // The dot travels with the part after it, so a wrapped line never ends on "·".
                <span key={part} className="whitespace-nowrap">
                  {index > 0 ? <span aria-hidden className="mr-1.5">·</span> : null}
                  {part}
                </span>
              ))}
            </p>
          ) : (
            <p className="text-xs text-fg-muted">Start from scratch</p>
          )}
        </div>
        <span
          aria-hidden
          className={cn('mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors', selected ? 'border-primary bg-primary text-primary-fg' : 'border-border-default bg-panel')}
        >
          {selected ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-fg-secondary">{template?.description ?? 'An empty project with To do, In progress, In review and Done. Good for small or one-off work.'}</p>
    </button>
  );
}

function PreviewSection({ icon, title, children }: { readonly icon: ReactNode; readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase [&_svg]:size-3.5">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

function TemplatePreview({ template, onUse }: { readonly template: TemplateDTO | null; readonly onUse: () => void }) {
  const payload = template?.payload;
  const statuses = payload?.statuses ?? BLANK_STATUSES;
  // Every top-level task, milestone tasks included, so the list adds up to the count in the
  // heading (which is also what the created project shows).
  const tasks = payload?.tasks ?? [];
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? tasks : tasks.slice(0, 6);
  const hidden = tasks.length - visible.length;
  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" aria-label="Template preview" data-testid="template-preview">
      <div className="flex items-start gap-3">
        <EntityIcon icon={template?.icon ?? 'file-text'} color={template?.color ?? 'gray'} size={40} />
        <div className="min-w-0">
          <h3 className="text-md font-semibold text-fg">{template?.name ?? 'Blank project'}</h3>
          <p className="text-sm text-fg-secondary">{template?.description ?? 'Start with an empty board and add your own tasks.'}</p>
        </div>
      </div>
      <PreviewSection icon={<Workflow aria-hidden />} title="Board columns">
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((status) => (
            <span key={status.key} className="inline-flex items-center gap-1.5 rounded-sm bg-sunken px-2 py-0.5 text-xs text-fg">
              <StatusIcon category={status.category} color={status.color} size={12} />
              {status.name}
            </span>
          ))}
        </div>
      </PreviewSection>
      {payload?.milestones?.length ? (
        <PreviewSection icon={<Flag aria-hidden />} title="Milestones">
          <ul className="flex flex-col gap-1 text-sm">
            {payload.milestones.map((milestone) => (
              <li key={milestone.key} className="flex items-center justify-between gap-2">
                <span className="truncate text-fg">{milestone.name}</span>
                {templateDayText(milestone.dueOffsetDays) ? <span className="shrink-0 text-xs text-fg-muted tabular-nums">{templateDayText(milestone.dueOffsetDays)}</span> : null}
              </li>
            ))}
          </ul>
        </PreviewSection>
      ) : null}
      {tasks.length ? (
        <PreviewSection icon={<LayoutList aria-hidden />} title={template ? `Starter work: ${taskCountText(template)}` : `${tasks.length} starter tasks`}>
          <ul className="flex flex-col gap-1 text-sm">
            {visible.map((task, index) => (
              <li key={`${index}-${task.title}`} className="flex items-center gap-2 truncate text-fg-secondary">
                {task.isMilestone ? (
                  <Flag aria-label="Milestone" className="size-3 shrink-0 text-primary-text" />
                ) : (
                  <span aria-hidden className="mx-[3px] size-1.5 shrink-0 rounded-full bg-border-strong" />
                )}
                <span className="truncate">{task.title}</span>
                {task.subtasks?.length ? (
                  <span className="shrink-0 text-xs text-fg-muted">
                    {task.subtasks.length} {task.subtasks.length === 1 ? 'subtask' : 'subtasks'}
                  </span>
                ) : null}
              </li>
            ))}
            {hidden > 0 ? (
              <li>
                <button type="button" onClick={() => setShowAll(true)} className="text-xs font-medium text-primary-text hover:underline" data-testid="template-preview-more">
                  Show {hidden} more {hidden === 1 ? 'task' : 'tasks'}
                </button>
              </li>
            ) : null}
          </ul>
        </PreviewSection>
      ) : null}
      {payload?.automations?.length ? (
        <PreviewSection icon={<Zap aria-hidden />} title="Automations included">
          <ul className="flex flex-col gap-1 text-sm text-fg-secondary">
            {payload.automations.map((automation) => (
              <li key={automation.name} className="flex gap-2">
                <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary-text" />
                {automation.name}
              </li>
            ))}
          </ul>
        </PreviewSection>
      ) : null}
      <Button onClick={onUse} trailingIcon={<ArrowRight aria-hidden />} data-testid="use-template">
        {template ? 'Use this template' : 'Start blank'}
      </Button>
    </aside>
  );
}

interface MemberChoice {
  readonly userId: string;
  readonly role: ProjectRole;
}

export function NewProjectWizard({ prefill }: { readonly prefill: NewProjectPrefill }) {
  const router = useRouter();
  const { user, can, appUrls } = useShell();
  const templates = useTemplates();
  const spaces = useSpaces();
  const people = usePeople();
  const projects = useProjects();
  const integrations = useIntegrationStatus();
  const [step, setStep] = useState(prefill.templateId ? 1 : 0);
  const [templateId, setTemplateId] = useState<string | null>(prefill.templateId ?? null);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [nameInput, setName] = useState<string | null>(prefill.name ?? null);
  const [keyInput, setKey] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  // undefined = not picked yet: the space whose name matches the template's category (Warehouse
  // go-live is 'Operations' → the Operations space), else 'No space'.
  const [spaceChoice, setSpaceId] = useState<string | undefined>(prefill.spaceId);
  const [ownerId, setOwnerId] = useState<string | null>(user.id);
  const [startDate, setStartDate] = useState<string | null>(todayIso());
  const [dueChoice, setDueDate] = useState<string | null | undefined>(undefined);
  const [visibility, setVisibility] = useState<'org' | 'private'>('org');
  const [colorChoice, setColor] = useState<string | null>(null);
  const [iconChoice, setIcon] = useState<string | null>(null);
  const [includeTasks, setIncludeTasks] = useState(true);
  const [members, setMembers] = useState<MemberChoice[]>([]);
  const [crmKind, setCrmKind] = useState<'crm_item' | 'crm_account'>('crm_item');
  // undefined = not touched yet, so the prefilled record (from CRM's deep link) is used.
  const [crmChoice, setCrmRecord] = useState<ResolvedTargetDTO | null | undefined>(undefined);
  const [customerChoice, setCustomer] = useState<ResolvedTargetDTO | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  // Resolve prefilled ids (from CRM's "Create project from deal") into display records.
  const prefillCustomer = useIntegrationSearch('core_customer', '', { enabled: Boolean(prefill.customerId) });
  const prefillDeal = useIntegrationSearch('crm_item', '', { enabled: Boolean(prefill.crmItemId) && integrations.data?.crm === true });
  const customer: ResolvedTargetDTO | null =
    customerChoice !== undefined
      ? customerChoice
      : prefill.customerId
        ? (prefillCustomer.data?.find((record) => record.id === prefill.customerId) ?? { type: 'core_customer', id: prefill.customerId, title: prefillCustomer.isPending ? 'Loading customer…' : 'Customer from CRM', status: null, url: null })
        : null;
  const crmRecord: ResolvedTargetDTO | null =
    crmChoice !== undefined
      ? crmChoice
      : prefill.crmItemId
        ? (prefillDeal.data?.find((record) => record.id === prefill.crmItemId) ?? { type: 'crm_item', id: prefill.crmItemId, title: 'Deal from CRM', status: null, url: null })
        : null;

  const create = useServerAction(createProjectAction, {
    silentError: true,
    invalidate: [qk.projects(), qk.spaces()],
    onError: (error) => {
      // Field errors (e.g. the key was just taken) send people back to the Details step to fix them.
      if (error.fields?.name || error.fields?.key) setStep(1);
      else toast.error("Couldn't create the project", error.message);
    },
  });

  const allTemplates = useMemo(() => templates.data ?? [], [templates.data]);
  const template = useMemo(() => allTemplates.find((t) => t.id === templateId) ?? null, [allTemplates, templateId]);
  const spaceId = useMemo(() => {
    if (spaceChoice !== undefined) return spaceChoice;
    const category = template?.category?.trim().toLowerCase();
    if (!category) return 'none';
    const list = spaces.data ?? [];
    const match = list.find((space) => space.name.trim().toLowerCase() === category) ?? list.find((space) => space.name.toLowerCase().includes(category) || category.includes(space.name.trim().toLowerCase()));
    return match?.id ?? 'none';
  }, [spaceChoice, template, spaces.data]);
  const taken = useMemo(() => new Set((projects.data ?? []).map((p) => p.key)), [projects.data]);
  const categories = useMemo(() => ['All', ...new Set(allTemplates.map((t) => t.category))], [allTemplates]);
  const visibleTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTemplates.filter((t) => (category === 'All' || t.category === category) && (!q || `${t.name} ${t.description ?? ''} ${t.category}`.toLowerCase().includes(q)));
  }, [allTemplates, category, search]);

  // Template defaults are derived (not copied into state) until the person changes a field.
  const name = nameInput ?? template?.name ?? '';
  const key = keyInput ?? (name.trim() ? suggestProjectKey(name, taken) : '');
  const color = colorChoice ?? template?.color ?? 'blue';
  const icon = iconChoice ?? template?.icon ?? 'folder-kanban';
  const dueDate = dueChoice !== undefined ? dueChoice : template?.payload.durationDays && startDate ? templateOffsetDateIso(startDate, template.payload.durationDays) : null;

  const keyError = key && !PROJECT_KEY_PATTERN.test(key) ? 'Use 2 to 6 letters or numbers, starting with a letter.' : taken.has(key) ? 'Another project already uses this key.' : undefined;
  const dateError = startDate && dueDate && startDate > dueDate ? 'The due date has to be on or after the start date.' : undefined;
  const nameError = create.fieldErrors.name;
  const detailsValid = name.trim().length > 0 && key.length > 0 && !keyError && !dateError;
  const asksForCustomer = Boolean(template?.payload.asksForCustomer);
  const crmAvailable = integrations.data?.crm === true;
  const memberIds = members.map((m) => m.userId);
  const peopleById = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p])), [people.data]);

  const goTo = (next: number) => {
    setStep(next);
    document.getElementById('main-content')?.firstElementChild?.scrollTo?.({ top: 0 });
    window.scrollTo?.({ top: 0 });
  };

  const submit = async () => {
    if (!detailsValid) {
      goTo(1);
      return;
    }
    setCreating(true);
    const project = await create.run({
      name: name.trim(),
      key,
      description: description.trim() ? `<p>${escapeHtml(description.trim()).replace(/\n/g, '<br>')}</p>` : null,
      spaceId: spaceId === 'none' ? null : spaceId,
      ownerId,
      startDate,
      dueDate,
      visibility,
      color,
      icon,
      crmCustomerId: customer?.id ?? null,
      crmItemId: crmRecord?.id ?? null,
      members: members.filter((m) => m.userId !== ownerId),
      templateId: templateId ?? undefined,
      includeTemplateTasks: templateId ? includeTasks : undefined,
    });
    if (!project) {
      setCreating(false);
      return;
    }
    // Links show up on the project Overview and in the sibling apps' "Project work" panels.
    const links = [
      ...(crmRecord ? [addLinkAction({ projectId: project.id, targetType: crmRecord.type, targetId: crmRecord.id })] : []),
      ...(customer ? [addLinkAction({ projectId: project.id, targetType: 'core_customer', targetId: customer.id })] : []),
    ];
    const results = await Promise.all(links);
    if (results.some((result) => !result.ok)) toast.warning('Project created', "We couldn't connect one of the linked records. You can add it from the project's Overview.");
    else toast.success(`${project.name} is ready`, templateId && includeTasks ? 'Your starter tasks are on the board.' : 'Add your first task to get going.');
    router.push(routes.project(project.key));
    router.refresh();
  };

  if (!can('project:create')) {
    return (
      <Page title="New project" width="narrow" breadcrumbs={[{ label: 'Projects', href: routes.projects() }, { label: 'New project' }]}>
        <div className="rounded-xl border border-border-subtle bg-panel p-6 text-center">
          <Lock aria-hidden className="mx-auto mb-2 size-6 text-icon" />
          <p className="font-semibold text-fg">You can’t create projects in this workspace</p>
          <p className="mt-1 text-sm text-fg-muted">Ask a workspace admin to make you a member, or to create the project for you.</p>
        </div>
      </Page>
    );
  }

  return (
    <Page
      title="New project"
      subtitle="Pick a starting point, give it a name, and you’re ready to go."
      width="default"
      breadcrumbs={[{ label: 'Projects', href: routes.projects() }, { label: 'New project' }]}
    >
      <WizardSteps steps={STEPS} current={step} className="mb-6 max-w-[640px] px-0" />

      {step === 0 ? (
        <div className="animate-step-in" data-testid="wizard-start">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
              leadingIcon={<Search aria-hidden />}
              containerClassName="w-full sm:w-60"
            />
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Template category">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={category === c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'h-7 rounded-full border px-3 text-sm font-medium outline-none transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-focus',
                    category === c ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-subtle bg-panel text-fg-secondary hover:border-border-default hover:text-fg',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" data-testid="template-gallery">
              {category === 'All' && !search.trim() ? <TemplateCard template={null} selected={templateId === null} onSelect={() => setTemplateId(null)} onOpen={() => goTo(1)} /> : null}
              {templates.isPending
                ? Array.from({ length: 5 }, (_, i) => <div key={i} className="ks-skeleton h-[220px] rounded-xl" />)
                : visibleTemplates.map((t) => <TemplateCard key={t.id} template={t} selected={templateId === t.id} onSelect={() => setTemplateId(t.id)} onOpen={() => { setTemplateId(t.id); goTo(1); }} />)}
              {!templates.isPending && visibleTemplates.length === 0 ? (
                <p className="col-span-full rounded-xl border border-dashed border-border-default px-4 py-8 text-center text-sm text-fg-muted">No templates match. Try another word or pick All.</p>
              ) : null}
            </div>
            <div className="hidden lg:sticky lg:top-4 lg:block">
              <TemplatePreview key={template?.id ?? 'blank'} template={template} onUse={() => goTo(1)} />
            </div>
          </div>
          <div className="sticky bottom-0 -mx-6 mt-5 flex items-center justify-between gap-3 border-t border-border-subtle bg-app/95 px-6 py-3 backdrop-blur lg:hidden">
            <p className="min-w-0 truncate text-sm text-fg-secondary">
              <span className="text-fg-muted">Starting from </span>
              <strong className="font-semibold text-fg">{template?.name ?? 'Blank project'}</strong>
            </p>
            <Button trailingIcon={<ArrowRight aria-hidden />} onClick={() => goTo(1)} data-testid="wizard-next">
              Continue
            </Button>
          </div>
        </div>
      ) : step === 1 ? (
        <form
          className="flex max-w-[760px] animate-step-in flex-col gap-5"
          data-testid="wizard-details"
          onSubmit={(event) => {
            event.preventDefault();
            if (detailsValid) goTo(2);
          }}
        >
          <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-panel p-3 shadow-xs">
            <EntityIcon icon={template?.icon ?? 'file-text'} color={template?.color ?? 'gray'} size={36} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-fg-muted">Starting from</p>
              <p className="truncate font-semibold text-fg">{template?.name ?? 'Blank project'}</p>
            </div>
            <Button variant="ghost" size="sm" leadingIcon={<ArrowLeft aria-hidden />} onClick={() => goTo(0)} type="button">
              Change
            </Button>
          </div>

          <div className="flex items-start gap-4">
            <div className="pt-6">
              <AppearancePicker color={color} icon={icon} size={44} onChange={(next) => { if (next.color) setColor(next.color); if (next.icon) setIcon(next.icon); }} />
            </div>
            <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Field label="Project name" required error={nameError}>
                {({ inputId, describedBy, invalid }) => (
                  <Input
                    id={inputId}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={template ? `e.g. ${template.name} for Acme` : 'e.g. Acme warehouse go-live'}
                    autoFocus
                    aria-describedby={describedBy}
                    invalid={invalid}
                    size="lg"
                    maxLength={120}
                    data-testid="project-name"
                  />
                )}
              </Field>
              <Field label="Key" hint={key ? `Task ids: ${key}-1` : 'Short code for task ids'} error={keyError ?? create.fieldErrors.key}>
                {({ inputId, describedBy, invalid }) => (
                  <Input
                    id={inputId}
                    value={key}
                    onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    size="lg"
                    className="font-key uppercase"
                    data-testid="project-key"
                  />
                )}
              </Field>
            </div>
          </div>

          <Field label="What is this project about?" hint="Optional. The goal, who it’s for, and what done looks like.">
            {({ inputId, describedBy }) => <Textarea id={inputId} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} aria-describedby={describedBy} placeholder="We’re moving Acme onto our warehouse so their orders ship the same day." />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Space" hint="Spaces group projects by team">
              {({ inputId, describedBy }) => (
                <Select id={inputId} aria-describedby={describedBy} value={spaceId} onValueChange={setSpaceId} options={[{ value: 'none', label: 'No space' }, ...(spaces.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} size="lg" />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Owner</span>
              <UserPicker people={people.data ?? []} meId={user.id} value={ownerId} onChange={setOwnerId} allowNone={false} className="h-10 w-full" aria-label="Owner" />
              <span className="text-2xs text-fg-muted">Leads the project and can manage people</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Start date</span>
              <IsoDatePicker size="lg" value={startDate} onChange={setStartDate} aria-label="Start date" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Due date</span>
              <IsoDatePicker size="lg" value={dueDate} onChange={setDueDate} placeholder="No due date" aria-label="Due date" />
              {dateError ? (
                <span role="alert" className="text-2xs font-medium text-danger-text">{dateError}</span>
              ) : startDate && dueDate ? (
                <span className="text-2xs text-fg-muted">{formatRange(startDate, dueDate)} · {weeksLabel(diffDays(startDate, dueDate)) ?? `${diffDays(startDate, dueDate)} days`}</span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Who can see it</span>
            <ToggleGroup
              label="Who can see it"
              value={visibility}
              onValueChange={setVisibility}
              options={[
                { value: 'org', label: 'Everyone in the workspace', icon: <Users aria-hidden /> },
                { value: 'private', label: 'Only people I add', icon: <Lock aria-hidden /> },
              ]}
            />
          </div>

          {template && template.taskCount > 0 ? (
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border-subtle bg-panel px-4 py-3">
              <span>
                <span className="block text-sm font-medium text-fg">Add the starter work ({taskCountText(template)})</span>
                <span className="block text-xs text-fg-muted">Start and due dates line up with your start date. Turn off to get just the columns, labels and milestones.</span>
              </span>
              <Switch checked={includeTasks} onCheckedChange={setIncludeTasks} aria-label="Add the starter tasks" />
            </label>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-5">
            <Button type="button" variant="ghost" leadingIcon={<ArrowLeft aria-hidden />} onClick={() => goTo(0)}>
              Back
            </Button>
            <Button type="submit" trailingIcon={<ArrowRight aria-hidden />} disabled={!detailsValid} data-testid="wizard-next">
              Continue
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex max-w-[760px] animate-step-in flex-col gap-5" data-testid="wizard-team">
          <section className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-fg">Who’s working on it?</h2>
                <p className="text-sm text-fg-muted">Add teammates now or later. They get a note in their inbox.</p>
              </div>
              <UserPicker
                multiple
                people={(people.data ?? []).filter((p) => p.id !== ownerId)}
                meId={user.id}
                value={memberIds}
                onChange={(ids) => setMembers(ids.map((id) => members.find((m) => m.userId === id) ?? { userId: id, role: 'editor' }))}
                trigger={
                  <Button variant="secondary" size="lg" leadingIcon={<UserPlus aria-hidden />} data-testid="add-members">
                    Add people
                  </Button>
                }
              />
            </div>
            <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
              <li className="flex items-center gap-3 px-3 py-2">
                <PersonAvatar userId={ownerId} showName className="min-w-0 flex-1" />
                <span className="text-xs text-fg-muted">Owner</span>
              </li>
              {members.map((member) => (
                <li key={member.userId} className="flex items-center gap-3 px-3 py-2">
                  <PersonAvatar userId={member.userId} showName className="min-w-0 flex-1" />
                  <Select
                    size="sm"
                    aria-label={`Role for ${peopleById.get(member.userId)?.name ?? 'teammate'}`}
                    value={member.role}
                    onValueChange={(role) => setMembers(members.map((m) => (m.userId === member.userId ? { ...m, role: role as ProjectRole } : m)))}
                    options={PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE_LABELS[r] }))}
                    className="w-32"
                  />
                  <IconButton label={`Remove ${peopleById.get(member.userId)?.name ?? 'teammate'}`} icon={<X aria-hidden />} size="sm" onClick={() => setMembers(members.filter((m) => m.userId !== member.userId))} />
                </li>
              ))}
            </ul>
            {visibility === 'private' && members.length === 0 ? <p className="text-xs text-warning-text">This project is private, so only you will see it until you add people.</p> : null}
          </section>

          <section className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
            <div>
              <h2 className="text-base font-semibold text-fg">Connect it to your customer</h2>
              <p className="text-sm text-fg-muted">
                Optional. Linked records show on the project and the project shows up {crmAvailable ? 'on the CRM deal' : 'next to the customer'}.
                {asksForCustomer && !customer ? ' This template works best with a customer picked.' : ''}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="flex h-6 items-center text-xs font-medium text-fg-secondary">Customer{asksForCustomer ? ' (recommended)' : ''}</span>
                <RecordPicker type="core_customer" value={customer} onChange={setCustomer} placeholder="Pick a customer" />
                <span className="text-2xs text-fg-muted">The shared customer list used by CRM and the warehouse</span>
              </div>
              {crmAvailable ? (
                <div className="flex flex-col gap-1.5">
                  <span className="flex h-6 items-center justify-between gap-2 text-xs font-medium text-fg-secondary">
                    CRM record
                    <ToggleGroup
                      label="CRM record type"
                      size="sm"
                      value={crmKind}
                      onValueChange={(kind) => {
                        setCrmKind(kind);
                        if (crmRecord && crmRecord.type !== kind) setCrmRecord(null);
                      }}
                      options={[
                        { value: 'crm_item', label: 'Deal' },
                        { value: 'crm_account', label: 'Account' },
                      ]}
                    />
                  </span>
                  <RecordPicker
                    type={crmKind}
                    value={crmRecord}
                    onChange={setCrmRecord}
                    placeholder={crmKind === 'crm_item' ? 'Pick a deal' : 'Pick an account'}
                    emptyActions={({ close }) => (
                      <>
                        {crmKind === 'crm_item' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            data-testid="record-picker-use-account"
                            onClick={() => {
                              setCrmKind('crm_account');
                              setCrmRecord(null);
                              close();
                            }}
                          >
                            Link an account instead
                          </Button>
                        ) : null}
                        <a
                          href={appUrls.crm}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                          data-testid="record-picker-open-crm"
                        >
                          {crmKind === 'crm_item' ? 'Create a deal in CRM' : 'Add an account in CRM'}
                        </a>
                      </>
                    )}
                  />
                </div>
              ) : crmRecord ? (
                <div className="flex flex-col gap-1.5">
                  <span className="flex h-6 items-center text-xs font-medium text-fg-secondary">CRM record</span>
                  <p className="flex h-10 items-center gap-2 rounded-md border border-border-subtle bg-sunken px-3 text-sm text-fg">{crmRecord.title}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-border-subtle bg-sunken/60 p-4" aria-label="Summary" data-testid="wizard-summary">
            <div className="flex items-center gap-3">
              <EntityIcon icon={icon} color={color} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{name || 'Untitled project'}</p>
                <p className="truncate text-xs text-fg-muted">
                  <span className="font-key">{key}</span> · {template?.name ?? 'Blank project'} · {spaceId === 'none' ? 'No space' : (spaces.data ?? []).find((s) => s.id === spaceId)?.name}
                </p>
              </div>
              <span className="hidden text-xs text-fg-secondary sm:block">{formatRange(startDate, dueDate)}</span>
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
              <li className="inline-flex items-center gap-1"><Users aria-hidden className="size-3.5" />{members.length + 1} {members.length === 0 ? 'person' : 'people'}</li>
              <li className="inline-flex items-center gap-1"><LayoutList aria-hidden className="size-3.5" />{template && includeTasks && template.taskCount > 0 ? taskCountText(template) : 'No tasks yet'}</li>
              <li className="inline-flex items-center gap-1">{visibility === 'private' ? <Lock aria-hidden className="size-3.5" /> : <Users aria-hidden className="size-3.5" />}{visibility === 'private' ? 'Private' : 'Whole workspace'}</li>
              {customer ? <li className="inline-flex items-center gap-1">Customer: <strong className="font-medium text-fg">{customer.title}</strong></li> : null}
              {crmRecord ? <li className="inline-flex items-center gap-1">CRM: <strong className="font-medium text-fg">{crmRecord.title}</strong></li> : null}
            </ul>
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-5">
            <Button type="button" variant="ghost" leadingIcon={<ArrowLeft aria-hidden />} onClick={() => goTo(1)} disabled={creating}>
              Back
            </Button>
            <Button size="lg" loading={creating} onClick={() => void submit()} data-testid="create-project">
              {template ? `Create from “${template.name}”` : 'Create project'}
            </Button>
          </div>
          <p className="-mt-2 text-right text-xs text-fg-muted">You can change any of this later in the project’s Settings.</p>
        </div>
      )}
    </Page>
  );
}
