'use client';
/**
 * "From CRM and WMS" on the Automations page: the cross-app recipe library (deal won starts a
 * project or a program, receipt discrepancy opens an urgent task, count variance opens a task) plus
 * the workspace's active recipes with what each one created. Only KitStak can do this: the CRM and
 * WMS are native, so the trigger reads the real records, not a webhook from a third party.
 *
 * The deal won recipe has an action select (docs/programs/SPEC.md 6.2): "Start a project" from a
 * project template, or "Start a program" from a program template, a copy of another program, or
 * the deal's own lines. The server side is src/server/integrations/record-triggers.ts.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Copy, FolderKanban, LayoutTemplate, Package, Plus, ReceiptText, RefreshCw, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Switch,
  ToggleGroup,
  cn,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { apiGet, apiPath } from '@/lib/api-client';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { usePeople, useProjects, useTemplates } from '@/lib/hooks/use-data';
import { usePrograms, useProgramTemplates } from '@/lib/hooks/use-programs';
import {
  RECORD_TRIGGER_RECIPES,
  type RecordTriggerDTO,
  type RecordTriggerKind,
  type RecordTriggerRecipe,
} from '@/lib/record-trigger-types';
import {
  createRecordTriggerAction,
  deleteRecordTriggerAction,
  runRecordTriggersAction,
  updateRecordTriggerAction,
} from '@/server/actions/record-triggers';
import { routes } from '@/lib/routes';
import { useShell } from '@/features/shell/shell-context';
import { SiblingAppMark } from '@/features/integrations/record-chip';

const RECIPES_KEY = ['integrations', 'recipes'] as const;

function useRecordTriggers(enabled: boolean) {
  return useQuery({
    queryKey: RECIPES_KEY,
    queryFn: () => apiGet<RecordTriggerDTO[]>(apiPath('integrations/recipes')),
    enabled,
  });
}

function ago(iso: string | null): string {
  if (!iso) return 'not checked yet';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'checked just now';
  if (minutes < 60) return `checked ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `checked ${hours} h ago`;
  return `checked ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** What a won deal starts. */
type DealAction = 'create_project' | 'create_program';
/** How a program starts: a program template, a copy of a program, or the deal's own lines. */
type ProgramStart = 'template' | 'copy' | 'deal';

interface Draft {
  readonly kind: RecordTriggerKind;
  readonly name: string;
  readonly action: DealAction;
  readonly programStart: ProgramStart;
  readonly programTemplateId: string;
  readonly copyProgramKey: string;
  readonly templateId: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly assigneeId: string;
  readonly priority: Priority;
  readonly dueInDays: string;
  readonly thresholdPercent: string;
  readonly lookBack: boolean;
}

const NOBODY = '__nobody__';

const DEFAULT_NAMES: Readonly<Record<DealAction, string>> = {
  create_project: 'Start a project when a deal is won',
  create_program: 'Start a program when a deal is won',
};

const PROGRAM_STARTS: readonly {
  readonly value: ProgramStart;
  readonly label: string;
  readonly text: string;
  readonly emptyTip: string;
  readonly icon: typeof Copy;
}[] = [
  { value: 'deal', label: 'The deal lines', text: 'Variants and rates from what was sold.', emptyTip: '', icon: ReceiptText },
  { value: 'template', label: 'A template', text: 'A saved program template.', emptyTip: 'No program templates yet', icon: LayoutTemplate },
  { value: 'copy', label: 'Another program', text: 'Copy its variants, rates and schedules.', emptyTip: 'No programs to copy yet', icon: Copy },
];

/** The program path that opens "Save as template" for that program in the directory. */
export const saveProgramTemplateHref = (key: string): string => `${routes.programs()}?saveTemplate=${encodeURIComponent(key)}`;

/**
 * Shown while there are no program templates: a way to make one. It opens "Save as template" for
 * the program you pick in a new tab; the template list here refreshes when you come back.
 */
function TemplateHelp({ programs }: { readonly programs: readonly { readonly id: string; readonly key: string; readonly name: string }[] }) {
  if (programs.length === 0) {
    return (
      <p className="-mt-2 text-xs text-fg-muted" data-testid="template-help">
        To start from a template or another program, first{' '}
        <Link href={routes.newProgram()} className="font-medium text-fg-link hover:underline">create a program</Link>.
      </p>
    );
  }
  return (
    <p className="-mt-2 flex flex-wrap items-center gap-x-1 text-xs text-fg-muted" data-testid="template-help">
      No program templates yet.
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1 rounded-sm font-medium text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus" data-testid="save-program-template">
            Save a program as a template
            <ArrowUpRight aria-hidden className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
          <DropdownMenuLabel>Save which program?</DropdownMenuLabel>
          {programs.map((program) => (
            <DropdownMenuItem key={program.id} onSelect={() => window.open(saveProgramTemplateHref(program.key), '_blank', 'noopener')}>
              <span className="min-w-0 flex-1 truncate">{program.name}</span>
              <span className="shrink-0 font-key text-2xs text-fg-muted">{program.key}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </p>
  );
}

/** The library, with the deal won recipe worded for both actions. */
const RECIPES: readonly RecordTriggerRecipe[] = RECORD_TRIGGER_RECIPES.map((recipe) =>
  recipe.kind === 'crm_deal_won'
    ? {
        ...recipe,
        title: 'Deal won, start the work',
        description: 'When a CRM deal moves to Won, start a project from a template or a program with the deal’s rates, linked to the deal and its customer.',
      }
    : recipe,
);

const recipeFor = (kind: RecordTriggerKind | undefined) => RECIPES.find((entry) => entry.kind === kind);

function draftFor(recipe: RecordTriggerRecipe, me: string): Draft {
  return {
    kind: recipe.kind,
    name: recipe.defaultName,
    action: 'create_project',
    programStart: 'deal',
    programTemplateId: '',
    copyProgramKey: '',
    templateId: 'builtin:client-onboarding',
    ownerId: me,
    projectId: '',
    assigneeId: me,
    priority: recipe.kind === 'wms_receipt_discrepancy' ? 'urgent' : 'high',
    dueInDays: recipe.kind === 'wms_receipt_discrepancy' ? '1' : '2',
    thresholdPercent: '2',
    lookBack: false,
  };
}

function RecipeDialog({ draft, onClose }: { readonly draft: Draft | null; readonly onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useShell();
  const [state, setState] = useState<Draft | null>(draft);
  const [current, setCurrent] = useState<Draft | null>(draft);
  if (draft !== current) {
    setCurrent(draft);
    setState(draft);
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const open = Boolean(draft);
  const templates = useTemplates({ enabled: open && draft?.kind === 'crm_deal_won' });
  const programTemplates = useProgramTemplates({ enabled: open && draft?.kind === 'crm_deal_won' });
  const programs = usePrograms({}, { enabled: open && draft?.kind === 'crm_deal_won' });
  const projects = useProjects({}, { enabled: open && draft?.kind !== 'crm_deal_won' });
  const people = usePeople({ enabled: open });
  const recipe = recipeFor(state?.kind);
  const peopleOptions = useMemo(
    () => (people.data ?? []).map((person) => ({ value: person.id, label: person.id === user.id ? `${person.name} (you)` : person.name })),
    [people.data, user.id],
  );
  if (!state || !recipe) return null;
  const patch = (next: Partial<Draft>) => setState({ ...state, ...next });
  const startsProgram = state.kind === 'crm_deal_won' && state.action === 'create_program';
  const pickAction = (action: DealAction) =>
    patch({
      action,
      // Keep a name the person typed; swap only our own default.
      name:
        state.name === DEFAULT_NAMES.create_project || state.name === DEFAULT_NAMES.create_program ? DEFAULT_NAMES[action] : state.name,
    });

  const save = async () => {
    setSaving(true);
    setErrors({});
    if (startsProgram && state.programStart === 'template' && !state.programTemplateId) {
      setSaving(false);
      setErrors({ programTemplateId: 'Pick a program template.' });
      return;
    }
    if (startsProgram && state.programStart === 'copy' && !state.copyProgramKey) {
      setSaving(false);
      setErrors({ copyProgramKey: 'Pick the program to copy.' });
      return;
    }
    const config: Record<string, string | number | null> =
      state.kind === 'crm_deal_won'
        ? startsProgram
          ? {
              action: 'create_program',
              programTemplateId: state.programStart === 'template' ? state.programTemplateId : null,
              copyProgramKey: state.programStart === 'copy' ? state.copyProgramKey : null,
              ownerId: state.ownerId || null,
            }
          : { templateId: state.templateId, ownerId: state.ownerId || null }
        : {
            projectId: state.projectId,
            assigneeId: state.assigneeId === NOBODY ? null : state.assigneeId || null,
            priority: state.priority,
            dueInDays: Number(state.dueInDays) || 0,
            ...(state.kind === 'wms_count_variance' ? { thresholdPercent: Number(state.thresholdPercent) } : {}),
          };
    const result = await createRecordTriggerAction({ kind: state.kind, name: state.name, config, lookbackDays: state.lookBack ? (recipe.app === 'crm' ? 7 : 30) : 0 });
    if (!result.ok) {
      setSaving(false);
      setErrors({ ...(result.error.fields ?? {}), form: result.error.message });
      return;
    }
    // Look at CRM / WMS right away so the person sees it work.
    const run = await runRecordTriggersAction({ triggerId: result.data.id });
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: RECIPES_KEY });
    const started = run.ok ? run.data.started : 0;
    toast.success(
      `“${result.data.name}” is on`,
      started
        ? `It already found ${started} ${started === 1 ? 'match' : 'matches'} and started the work.`
        : recipe.app === 'crm'
          ? startsProgram
            ? 'The next deal that moves to Won gets its program automatically.'
            : 'The next deal that moves to Won gets its project automatically.'
          : 'The next matching record in WMS gets a task automatically.',
    );
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent size="md" data-testid="recipe-dialog">
        <DialogHeader
          icon={
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-sunken">
              <SiblingAppMark app={recipe.app} size={22} />
            </span>
          }
          title={recipe.title}
          description={recipe.description}
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          {errors.form ? <p className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text">{errors.form}</p> : null}
          <Field label="Name" error={errors.name}>
            {({ inputId, describedBy, invalid }) => (
              <Input id={inputId} value={state.name} onChange={(event) => patch({ name: event.target.value })} aria-describedby={describedBy} invalid={invalid} />
            )}
          </Field>
          {state.kind === 'crm_deal_won' ? (
            <Field label="When the deal is won" hint={startsProgram ? 'A program holds repeat work with variants, rates and a schedule.' : 'A project holds one piece of work with tasks.'}>
              {() => (
                <ToggleGroup
                  label="When the deal is won"
                  value={state.action}
                  onValueChange={(value) => pickAction(value as DealAction)}
                  options={[
                    { value: 'create_project', label: 'Start a project', icon: <FolderKanban aria-hidden /> },
                    { value: 'create_program', label: 'Start a program', icon: <Package aria-hidden /> },
                  ]}
                  className="w-full [&>button]:flex-1"
                />
              )}
            </Field>
          ) : null}
          {startsProgram ? (
            <>
              <Field label="Start the program from" hint="The new program is named after the deal and linked to it and its customer.">
                {() => (
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Start the program from">
                    {PROGRAM_STARTS.map((option) => {
                      const disabled =
                        (option.value === 'template' && !programTemplates.isLoading && (programTemplates.data ?? []).length === 0) ||
                        (option.value === 'copy' && !programs.isLoading && (programs.data ?? []).length === 0);
                      const selected = state.programStart === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={disabled}
                          title={disabled ? option.emptyTip : undefined}
                          onClick={() =>
                            patch({
                              programStart: option.value,
                              // Pick the first choice so the next field is never empty.
                              programTemplateId: state.programTemplateId || (option.value === 'template' ? (programTemplates.data?.[0]?.id ?? '') : ''),
                              copyProgramKey: state.copyProgramKey || (option.value === 'copy' ? (programs.data?.find((program) => !program.archivedAt)?.key ?? '') : ''),
                            })
                          }
                          className={cn(
                            'flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55',
                            selected ? 'border-primary bg-primary-subtle' : 'border-border-default bg-panel hover:border-border-strong',
                          )}
                          data-testid={`program-start-${option.value}`}
                        >
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
                            <option.icon aria-hidden className="size-4 text-icon" />
                            {option.label}
                          </span>
                          <span className="text-xs text-fg-secondary">{disabled ? option.emptyTip : option.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
              {!programTemplates.isLoading && (programTemplates.data ?? []).length === 0 ? (
                <TemplateHelp programs={(programs.data ?? []).filter((program) => !program.archivedAt)} />
              ) : null}
              {state.programStart === 'template' ? (
                <Field label="Program template" error={errors.programTemplateId}>
                  {({ inputId, describedBy, invalid }) => (
                    <Select
                      id={inputId}
                      value={state.programTemplateId || undefined}
                      onValueChange={(value) => patch({ programTemplateId: value })}
                      options={(programTemplates.data ?? []).map((template) => ({
                        value: template.id,
                        label: template.name,
                        description: template.description ?? undefined,
                      }))}
                      placeholder={programTemplates.isLoading ? 'Loading templates' : 'Pick a program template'}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      data-testid="program-template-select"
                    />
                  )}
                </Field>
              ) : null}
              {state.programStart === 'copy' ? (
                <Field label="Program to copy" error={errors.copyProgramKey} hint="Uses its variants, rates and schedule. When the deal has prices, the deal prices win.">
                  {({ inputId, describedBy, invalid }) => (
                    <Select
                      id={inputId}
                      value={state.copyProgramKey || undefined}
                      onValueChange={(value) => patch({ copyProgramKey: value })}
                      options={(programs.data ?? [])
                        .filter((program) => !program.archivedAt)
                        .map((program) => ({
                          value: program.key,
                          label: program.name,
                          description: program.customer ? `${program.key} · ${program.customer.name}` : program.key,
                          icon: <EntityIcon icon={program.icon} color={program.color} size={16} />,
                        }))}
                      placeholder={programs.isLoading ? 'Loading programs' : 'Pick a program'}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      data-testid="copy-program-select"
                    />
                  )}
                </Field>
              ) : null}
              {state.programStart === 'deal' ? (
                <p className="flex items-start gap-2 rounded-md bg-sunken px-3 py-2 text-sm text-fg-secondary">
                  <ReceiptText aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
                  Variants and rates come from the lines on the deal. You can add a schedule later.
                </p>
              ) : null}
              <Field label="Program owner" error={errors.ownerId}>
                {({ inputId, describedBy, invalid }) => (
                  <Select id={inputId} value={state.ownerId} onValueChange={(value) => patch({ ownerId: value })} options={peopleOptions} aria-describedby={describedBy} invalid={invalid} />
                )}
              </Field>
            </>
          ) : state.kind === 'crm_deal_won' ? (
            <>
              <Field label="Create the project from" error={errors.templateId} hint="The new project is named after the deal and linked to it and its customer.">
                {({ inputId, describedBy, invalid }) => (
                  <Select
                    id={inputId}
                    value={state.templateId}
                    onValueChange={(value) => patch({ templateId: value })}
                    options={(templates.data ?? []).map((template) => ({
                      value: template.id,
                      label: template.name,
                      icon: <EntityIcon icon={template.icon} color={template.color} size={16} />,
                    }))}
                    placeholder={templates.isLoading ? 'Loading templates' : 'Pick a template'}
                    aria-describedby={describedBy}
                    invalid={invalid}
                  />
                )}
              </Field>
              <Field label="Project owner" error={errors.ownerId}>
                {({ inputId, describedBy, invalid }) => (
                  <Select id={inputId} value={state.ownerId} onValueChange={(value) => patch({ ownerId: value })} options={peopleOptions} aria-describedby={describedBy} invalid={invalid} />
                )}
              </Field>
            </>
          ) : (
            <>
              <Field label="Put the task in" error={errors.projectId}>
                {({ inputId, describedBy, invalid }) => (
                  <Select
                    id={inputId}
                    value={state.projectId || undefined}
                    onValueChange={(value) => patch({ projectId: value })}
                    options={(projects.data ?? [])
                      .filter((project) => !project.archivedAt)
                      .map((project) => ({ value: project.id, label: project.name, icon: <EntityIcon icon={project.icon} color={project.color} size={16} /> }))}
                    placeholder={projects.isLoading ? 'Loading projects' : 'Pick a project'}
                    aria-describedby={describedBy}
                    invalid={invalid}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={state.kind === 'wms_receipt_discrepancy' ? 'Receiving lead' : 'Inventory lead'} error={errors.assigneeId}>
                  {({ inputId, describedBy }) => (
                    <Select
                      id={inputId}
                      value={state.assigneeId || NOBODY}
                      onValueChange={(value) => patch({ assigneeId: value })}
                      options={[...peopleOptions, { value: NOBODY, label: 'Nobody yet' }]}
                      aria-describedby={describedBy}
                    />
                  )}
                </Field>
                <Field label="Priority">
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      value={state.priority}
                      onValueChange={(value) => patch({ priority: value as Priority })}
                      options={PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
                    />
                  )}
                </Field>
                <Field label="Due in (days)" error={errors.dueInDays}>
                  {({ inputId, describedBy, invalid }) => (
                    <Input id={inputId} type="number" min={0} max={60} value={state.dueInDays} onChange={(event) => patch({ dueInDays: event.target.value })} aria-describedby={describedBy} invalid={invalid} />
                  )}
                </Field>
                {state.kind === 'wms_count_variance' ? (
                  <Field label="Variance limit (%)" error={errors.thresholdPercent} hint="Open a task when the count is off by more than this.">
                    {({ inputId, describedBy, invalid }) => (
                      <Input
                        id={inputId}
                        type="number"
                        min={0.1}
                        max={100}
                        step={0.1}
                        value={state.thresholdPercent}
                        onChange={(event) => patch({ thresholdPercent: event.target.value })}
                        aria-describedby={describedBy}
                        invalid={invalid}
                      />
                    )}
                  </Field>
                ) : null}
              </div>
            </>
          )}
          <Checkbox
            label={
              recipe.app === 'crm'
                ? startsProgram
                  ? 'Also start programs for deals won in the last 7 days'
                  : 'Also start projects for deals won in the last 7 days'
                : 'Also check records from the last 30 days'
            }
            checked={state.lookBack}
            onCheckedChange={(value) => patch({ lookBack: value === true })}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} data-testid="recipe-save">
            Turn it on
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecipeTile({ recipe, available, onUse }: { readonly recipe: RecordTriggerRecipe; readonly available: boolean; readonly onUse: () => void }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border-default bg-panel p-4 shadow-xs" data-testid="cross-app-recipe">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-sunken">
          <SiblingAppMark app={recipe.app} size={18} />
        </span>
        <Badge>{recipe.app === 'crm' ? 'KitStak CRM' : 'KitStak WMS'}</Badge>
      </div>
      <div className="flex-1">
        <h3 className="text-base font-semibold text-fg">{recipe.title}</h3>
        <p className="mt-1 text-sm text-fg-secondary">{recipe.description}</p>
      </div>
      {available ? (
        <Button variant="secondary" leadingIcon={<Plus aria-hidden />} onClick={onUse} className="self-start">
          Use this recipe
        </Button>
      ) : (
        <p className="text-sm text-fg-muted">Needs KitStak {recipe.app === 'crm' ? 'CRM' : 'WMS'} in this workspace.</p>
      )}
    </li>
  );
}

function ActiveRecipe({ trigger, canManage }: { readonly trigger: RecordTriggerDTO; readonly canManage: boolean }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: RECIPES_KEY });
  const app = recipeFor(trigger.kind)?.app ?? 'crm';

  const toggle = async (enabled: boolean) => {
    const result = await updateRecordTriggerAction({ triggerId: trigger.id, patch: { enabled } });
    if (!result.ok) toast.error('Couldn’t change that recipe', result.error.message);
    else toast.success(enabled ? `“${trigger.name}” is on` : `“${trigger.name}” is off`);
    void refresh();
  };
  const remove = async () => {
    const result = await deleteRecordTriggerAction({ triggerId: trigger.id });
    if (!result.ok) toast.error('Couldn’t delete that recipe', result.error.message);
    else toast.success(`Deleted “${trigger.name}”`, 'Work it already started stays as it is.');
    void refresh();
  };
  const check = async () => {
    setBusy(true);
    const result = await runRecordTriggersAction({ triggerId: trigger.id });
    setBusy(false);
    if (!result.ok) toast.error('Couldn’t check right now', result.error.message);
    else
      toast.success(
        result.data.started ? `Started ${result.data.started} new ${result.data.started === 1 ? 'piece' : 'pieces'} of work` : 'Nothing new to do',
        result.data.started ? 'See the list below.' : `No new matches in ${app === 'crm' ? 'CRM' : 'WMS'} right now.`,
      );
    void refresh();
  };

  return (
    <li className="rounded-xl border border-border-default bg-panel shadow-xs" data-testid="cross-app-active">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken">
          <SiblingAppMark app={app} size={18} />
        </span>
        <div className="min-w-[200px] flex-1">
          <p className="font-semibold text-fg">{trigger.name}</p>
          <p className="text-sm text-fg-secondary">{trigger.sentence}.</p>
          <p className="mt-1 text-xs text-fg-muted">
            {trigger.runCount} started so far · {ago(trigger.lastCheckedAt)}
          </p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-1 max-sm:w-full max-sm:justify-end">
            <Button variant="ghost" size="sm" leadingIcon={<RefreshCw aria-hidden className={cn(busy && 'animate-spin')} />} onClick={() => void check()} disabled={busy || !trigger.enabled}>
              Check now
            </Button>
            <IconButton label="Delete recipe" icon={<Trash2 aria-hidden />} size="sm" onClick={() => void remove()} />
            <Switch checked={trigger.enabled} onCheckedChange={(value) => void toggle(value)} aria-label={trigger.enabled ? 'Turn off' : 'Turn on'} />
          </div>
        ) : null}
      </div>
      {trigger.recentRuns.length ? (
        <ul className="border-t border-border-subtle px-4 py-2">
          {trigger.recentRuns.map((run) => (
            <li key={run.id} className="flex items-center gap-2 py-1 text-sm">
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full', run.status === 'created' ? 'bg-success' : run.status === 'failed' ? 'bg-danger' : 'bg-fg-muted')}
              />
              <span className="min-w-0 flex-1 truncate text-fg-secondary">
                <span className="font-medium text-fg">{run.recordTitle ?? run.recordId}</span> · {run.message}
              </span>
              {run.resultUrl ? (
                <a href={run.resultUrl} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-fg-link hover:underline">
                  Open
                  <ArrowUpRight aria-hidden className="size-3" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function RecordRecipes() {
  const { can, integrations, user } = useShell();
  const canManage = can('project:create');
  const any = integrations.crm || integrations.wms;
  const triggers = useRecordTriggers(any);
  const [draft, setDraft] = useState<Draft | null>(null);

  if (!any) {
    return (
      <EmptyState
        illustration="workspace"
        title="Connect your other KitStak apps"
        description="Add KitStak CRM or WMS to this workspace to use these recipes."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6" data-testid="cross-app-recipes">
      <section aria-labelledby="cross-app-active-title">
        <h2 id="cross-app-active-title" className="mb-3 text-base font-semibold text-fg">
          Running in this workspace
        </h2>
        {triggers.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (triggers.data ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-default px-4 py-6 text-center text-sm text-fg-secondary">
            No cross-app recipes yet. Pick one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(triggers.data ?? []).map((trigger) => (
              <ActiveRecipe key={trigger.id} trigger={trigger} canManage={canManage} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="cross-app-library-title">
        <h2 id="cross-app-library-title" className="text-base font-semibold text-fg">
          Recipe library
        </h2>
        {canManage ? null : (
          <p className="mt-1 text-sm text-fg-secondary">Ask a workspace member with edit access to turn one on.</p>
        )}
        <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {RECIPES.map((recipe) => (
            <RecipeTile
              key={recipe.kind}
              recipe={recipe}
              available={canManage && integrations[recipe.app]}
              onUse={() => setDraft(draftFor(recipe, user.id))}
            />
          ))}
        </ul>
      </section>
      <RecipeDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
