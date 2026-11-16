'use client';
/**
 * "From CRM and WMS" on the Automations page: the cross-app recipe library (deal won starts a
 * project, receipt discrepancy opens an urgent task, count variance opens a task) plus the
 * workspace's active recipes with what each one created. Only KitStak can do this: the CRM and
 * WMS are native, so the trigger reads the real records, not a webhook from a third party.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Switch,
  cn,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { apiGet, apiPath } from '@/lib/api-client';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { usePeople, useProjects, useTemplates } from '@/lib/hooks/use-data';
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
import { useShell } from '@/features/shell/shell-context';
import { SiblingAppMark } from './record-chip';

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

interface Draft {
  readonly kind: RecordTriggerKind;
  readonly name: string;
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

function draftFor(recipe: RecordTriggerRecipe, me: string): Draft {
  return {
    kind: recipe.kind,
    name: recipe.defaultName,
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
  const projects = useProjects({}, { enabled: open && draft?.kind !== 'crm_deal_won' });
  const people = usePeople({ enabled: open });
  const recipe = RECORD_TRIGGER_RECIPES.find((entry) => entry.kind === state?.kind);
  const peopleOptions = useMemo(
    () => (people.data ?? []).map((person) => ({ value: person.id, label: person.id === user.id ? `${person.name} (you)` : person.name })),
    [people.data, user.id],
  );
  if (!state || !recipe) return null;
  const patch = (next: Partial<Draft>) => setState({ ...state, ...next });

  const save = async () => {
    setSaving(true);
    setErrors({});
    const config: Record<string, string | number | null> =
      state.kind === 'crm_deal_won'
        ? { templateId: state.templateId, ownerId: state.ownerId || null }
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
          ? 'The next deal that moves to Won gets its project automatically.'
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
            label={recipe.app === 'crm' ? 'Also start projects for deals won in the last 7 days' : 'Also check records from the last 30 days'}
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
  const app = RECORD_TRIGGER_RECIPES.find((entry) => entry.kind === trigger.kind)?.app ?? 'crm';

  const toggle = async (enabled: boolean) => {
    const result = await updateRecordTriggerAction({ triggerId: trigger.id, patch: { enabled } });
    if (!result.ok) toast.error('Couldn’t change that recipe', result.error.message);
    else toast.success(enabled ? `“${trigger.name}” is on` : `“${trigger.name}” is off`);
    void refresh();
  };
  const remove = async () => {
    const result = await deleteRecordTriggerAction({ triggerId: trigger.id });
    if (!result.ok) toast.error('Couldn’t delete that recipe', result.error.message);
    else toast.success(`Deleted “${trigger.name}”`, 'Projects and tasks it already created stay as they are.');
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

export function CrossAppRecipes() {
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
          {RECORD_TRIGGER_RECIPES.map((recipe) => (
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
