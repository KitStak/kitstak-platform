'use client';
/**
 * Automations: every rule as a plain sentence with an on/off switch, a recipe gallery of
 * ready-made rules, and a run history log. Rules are built with the sentence builder
 * (automation-builder.tsx). URL: /automations?tab=recipes|history&project=<id>&edit=<id>&new=1
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  CalendarClock,
  Copy,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SearchInput,
  Select,
  Sheet,
  SheetContent,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { Page } from '@/components/layout/page';
import { SCHEDULED_TRIGGER_TYPES } from '@/lib/automation-types';
import type { AutomationDTO, AutomationRunRowDTO, ProjectSummary } from '@/lib/types';
import { describeAutomation } from '@/server/automations/engine';
import {
  createAutomationAction,
  deleteAutomationAction,
  restoreAutomationAction,
  runScheduledAutomationsAction,
  updateAutomationAction,
} from '@/server/actions/automations';
import { useShell } from '@/features/shell/shell-context';
import { usePrograms } from '@/lib/hooks/use-programs';
import { RecordRecipes } from './record-recipes';
import { LocalTime } from '@/features/task/local-time';
import { SampleProjectButton } from '@/features/onboarding/sample-project-button';
import { AutomationBuilder, blankDraft, draftFromRule, type AutomationDraft } from './automation-builder';
import { RECIPES, RECIPE_CATEGORIES, actsOnBuilds, buildWords, triggerOption, type Recipe, type RecipeCategory } from './catalog';
import { RunHistoryList, useRunHistory, type RunFilter } from './run-history';

export interface AutomationRow extends AutomationDTO {
  readonly sentence: string;
}

type Tab = 'rules' | 'recipes' | 'history' | 'apps';
type StateFilter = 'all' | 'on' | 'off';

function useUrlState() {
  const router = useRouter();
  const pathname = usePathname() ?? '/automations';
  const params = useSearchParams();
  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { params, set };
}

function RecipeIcon({ recipe, className }: { readonly recipe: Recipe; readonly className?: string }) {
  const Icon = recipe.needs
    ? Workflow
    : recipe.categories.includes('Reminders')
      ? CalendarClock
      : recipe.categories.includes('Hand-offs')
        ? BellRing
        : Zap;
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg',
        recipe.needs ? 'bg-info-subtle text-info-text' : 'bg-warning-subtle text-warning-text',
        className,
      )}
    >
      <Icon aria-hidden className="size-[18px]" />
    </span>
  );
}

function RecipeCard({
  recipe,
  onUse,
  connected,
}: {
  readonly recipe: Recipe;
  readonly onUse: () => void;
  readonly connected: boolean;
}) {
  return (
    <li className="group flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-sm">
      <div className="flex items-start gap-3">
        <RecipeIcon recipe={recipe} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">{recipe.name}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{recipe.blurb}</p>
        </div>
      </div>
      <p className="flex-1 rounded-lg bg-sunken px-3 py-2 text-sm text-fg-secondary">
        {describeAutomation({
          trigger: recipe.trigger,
          conditions: recipe.conditions ?? [],
          actions: recipe.actions,
        })}
      </p>
      <div className="flex items-center justify-between gap-2">
        {recipe.needs ? (
          <Badge tone={connected ? 'info' : 'neutral'} size="sm">
            {recipe.needs === 'crm' ? 'Uses KitStak CRM' : 'Uses KitStak WMS'}
            {connected ? '' : ' (not connected)'}
          </Badge>
        ) : (
          <span />
        )}
        <Button size="sm" variant="secondary" onClick={onUse} data-testid={`recipe-${recipe.id}`}>
          Use recipe
        </Button>
      </div>
    </li>
  );
}

/** The saved sentence in the words of where the rule runs: build words for rules on builds. */
function plainSentence(rule: AutomationRow, project?: { readonly isProgram?: boolean }): string {
  const onBuilds = Boolean(project?.isProgram) || actsOnBuilds(rule.trigger, rule.conditions);
  return onBuilds ? buildWords(rule.sentence) : rule.sentence;
}

function RuleCard({
  rule,
  project,
  lastRun,
  canEdit,
  onToggle,
  onEdit,
  onDuplicate,
  onHistory,
  onDelete,
}: {
  readonly rule: AutomationRow;
  /** The project or program the rule works in. */
  readonly project?: { readonly name: string; readonly icon: string | null; readonly color: string | null; readonly isProgram?: boolean };
  readonly lastRun?: AutomationRunRowDTO;
  readonly canEdit: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onEdit: () => void;
  readonly onDuplicate: () => void;
  readonly onHistory: () => void;
  readonly onDelete: () => void;
}) {
  const scheduled = SCHEDULED_TRIGGER_TYPES.includes(rule.trigger.type);
  return (
    <li
      className={cn(
        'group flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel px-4 py-3.5 shadow-xs transition-[border-color,box-shadow,opacity] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-sm sm:flex-row sm:items-center sm:gap-4',
      )}
      data-testid="automation-rule"
      data-enabled={rule.enabled || undefined}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={cn(
            'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
            rule.enabled ? 'bg-warning-subtle text-warning-text' : 'bg-muted text-icon',
          )}
        >
          {scheduled ? (
            <CalendarClock aria-hidden className="size-[18px]" />
          ) : (
            <Zap aria-hidden className="size-[18px]" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={canEdit ? onEdit : onHistory}
            className="block max-w-full truncate rounded-xs text-left text-md font-semibold text-fg transition-colors hover:text-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {rule.name}
          </button>
          <p className={cn('mt-0.5 text-sm', rule.enabled ? 'text-fg-secondary' : 'text-fg-muted')}>
            {plainSentence(rule, project)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
            <span className="inline-flex items-center gap-1.5">
              {project ? (
                <EntityIcon icon={project.icon} color={project.color} size={16} />
              ) : (
                <Workflow aria-hidden className="size-3.5 text-icon" />
              )}
              {project ? (project.isProgram ? `${project.name} (program)` : project.name) : 'Every project'}
            </span>
            <button
              type="button"
              onClick={onHistory}
              className="tabular-nums hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              Ran {rule.runCount} {rule.runCount === 1 ? 'time' : 'times'}
            </button>
            {rule.lastRunAt ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 rounded-full',
                    lastRun?.status === 'failed' ? 'bg-danger' : 'bg-success',
                  )}
                />
                {lastRun?.status === 'failed' ? 'Last run stopped' : 'Last ran'}{' '}
                <LocalTime iso={rule.lastRunAt} />
              </span>
            ) : (
              <span className="text-fg-muted">Hasn’t run yet</span>
            )}
            {!rule.enabled ? <Badge size="sm">Off</Badge> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 self-end sm:self-center">
        <Tooltip
          content={!canEdit ? 'You need edit access to change this' : rule.enabled ? 'Turn off' : 'Turn on'}
        >
          <span>
            <Switch
              checked={rule.enabled}
              disabled={!canEdit}
              onCheckedChange={onToggle}
              aria-label={`${rule.enabled ? 'Turn off' : 'Turn on'} ${rule.name}`}
              data-testid="automation-toggle"
            />
          </span>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={`More for ${rule.name}`}
              icon={<MoreHorizontal aria-hidden />}
              data-testid="automation-menu"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canEdit ? (
              <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={onEdit}>
                Edit
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem icon={<History aria-hidden />} onSelect={onHistory}>
              Run history
            </DropdownMenuItem>
            {canEdit ? (
              <>
                <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={onDuplicate}>
                  Duplicate
                </DropdownMenuItem>
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

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'danger';
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border-subtle bg-panel px-4 py-3 shadow-xs">
      <span
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'danger' && value > 0 ? 'text-danger-text' : 'text-fg',
        )}
      >
        {value}
      </span>
      <span className="truncate text-xs text-fg-muted">{label}</span>
    </div>
  );
}

export function AutomationsView({
  rules,
  projects,
  initialRuns,
}: {
  readonly rules: AutomationRow[];
  readonly projects: ProjectSummary[];
  readonly initialRuns: AutomationRunRowDTO[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, integrations, user } = useShell();
  const { params, set } = useUrlState();
  const programsQuery = usePrograms();
  const programs = useMemo(() => (programsQuery.data ?? []).filter((program) => !program.archivedAt), [programsQuery.data]);
  const tab = (
    ['rules', 'recipes', 'apps', 'history'].includes(params?.get('tab') ?? '') ? params?.get('tab') : 'rules'
  ) as Tab;
  const projectFilter = params?.get('project') ?? 'all';
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [recipeCategory, setRecipeCategory] = useState<RecipeCategory | 'All'>('Popular');
  const [runFilter, setRunFilter] = useState<RunFilter>('all');
  const [localEnabled, setLocalEnabled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [builder, setBuilder] = useState<{ open: boolean; draft: AutomationDraft; recipeName?: string }>({
    open: false,
    draft: blankDraft(null),
  });
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const canManageGlobal = can('automation:manage_global');
  const editableProjects = useMemo(
    () => projects.filter((p) => !p.archivedAt && (p.role === 'owner' || p.role === 'editor')),
    [projects],
  );
  const byId = useMemo(
    () =>
      new Map<string, { name: string; icon: string | null; color: string | null; isProgram?: boolean }>([
        ...projects.map((p) => [p.id, p] as const),
        ...programs.map((p) => [p.id, { name: p.name, icon: p.icon, color: p.color, isProgram: true }] as const),
      ]),
    [programs, projects],
  );
  // Program rules: workspace managers and the program owner (the server checks the program role).
  const editablePrograms = useMemo(
    () => programs.filter((program) => canManageGlobal || program.owner?.id === user.id),
    [canManageGlobal, programs, user.id],
  );
  const canAdd = canManageGlobal || editableProjects.length > 0 || editablePrograms.length > 0;
  const canEditRule = useCallback(
    (rule: AutomationDTO) =>
      rule.projectId
        ? editableProjects.some((p) => p.id === rule.projectId) || editablePrograms.some((p) => p.id === rule.projectId)
        : canManageGlobal,
    [canManageGlobal, editablePrograms, editableProjects],
  );

  const list = useMemo(
    () => rules.map((rule) => ({ ...rule, enabled: localEnabled.get(rule.id) ?? rule.enabled })),
    [rules, localEnabled],
  );
  const runs = useRunHistory(null, runFilter, runFilter === 'all' ? initialRuns : undefined);
  const lastRunByRule = useMemo(() => {
    const map = new Map<string, AutomationRunRowDTO>();
    for (const run of initialRuns) if (!map.has(run.automationId)) map.set(run.automationId, run);
    return map;
  }, [initialRuns]);

  const q = query.trim().toLowerCase();
  const visible = list.filter((rule) => {
    if (projectFilter === 'workspace' && rule.projectId) return false;
    if (projectFilter !== 'all' && projectFilter !== 'workspace' && rule.projectId !== projectFilter)
      return false;
    if (stateFilter === 'on' && !rule.enabled) return false;
    if (stateFilter === 'off' && rule.enabled) return false;
    if (q && !`${rule.name} ${rule.sentence}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const [weekAgo] = useState(() => Date.now() - 7 * 86_400_000);
  const runsThisWeek = initialRuns.filter((run) => new Date(run.createdAt).getTime() >= weekAgo);
  const stoppedThisWeek = runsThisWeek.filter((run) => run.status === 'failed').length;
  const hasScheduled = list.some(
    (rule) => rule.enabled && SCHEDULED_TRIGGER_TYPES.includes(rule.trigger.type),
  );

  const defaultProjectId = (): string | null => {
    if (
      projectFilter !== 'all' &&
      projectFilter !== 'workspace' &&
      (editableProjects.some((p) => p.id === projectFilter) || editablePrograms.some((p) => p.id === projectFilter))
    )
      return projectFilter;
    if (canManageGlobal) return null;
    return editableProjects[0]?.id ?? null;
  };

  const refresh = useCallback(() => {
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: ['automations'] });
  }, [queryClient, router]);

  const openNew = () => setBuilder({ open: true, draft: blankDraft(defaultProjectId()) });
  const openEdit = (rule: AutomationDTO) => setBuilder({ open: true, draft: draftFromRule(rule) });
  const openRecipe = (recipe: Recipe) =>
    setBuilder({
      open: true,
      recipeName: recipe.name,
      draft: {
        name: recipe.name,
        projectId: defaultProjectId(),
        enabled: true,
        trigger: recipe.trigger,
        conditions: recipe.conditions ?? [],
        actions: recipe.actions,
      },
    });

  // Deep links: ?new=1 and ?edit=<id> (from a project's settings or the command palette).
  // Opened while rendering (once per URL), then the param is cleaned up in an effect.
  const deepLink = params?.get('new') === '1' ? 'new' : (params?.get('edit') ?? null);
  const [handledLink, setHandledLink] = useState<string | null>(null);
  if (deepLink && deepLink !== handledLink) {
    setHandledLink(deepLink);
    if (deepLink === 'new') {
      if (canAdd) setBuilder({ open: true, draft: blankDraft(defaultProjectId()) });
    } else {
      const rule = rules.find((r) => r.id === deepLink);
      if (rule) setBuilder({ open: true, draft: draftFromRule(rule) });
    }
  }
  useEffect(() => {
    if (deepLink) set({ new: null, edit: null });
  }, [deepLink, set]);

  const toggle = async (rule: AutomationRow, enabled: boolean) => {
    setLocalEnabled((current) => new Map(current).set(rule.id, enabled));
    const result = await updateAutomationAction({ automationId: rule.id, patch: { enabled } });
    if (!result.ok) {
      setLocalEnabled((current) => new Map(current).set(rule.id, !enabled));
      toast.error("Couldn't change that automation", result.error.message);
      return;
    }
    toast.success(
      enabled ? `“${rule.name}” is on` : `“${rule.name}” is off`,
      enabled ? 'It will run the next time this happens.' : 'It won’t run until you turn it back on.',
    );
    refresh();
  };

  const remove = async (rule: AutomationRow) => {
    const result = await deleteAutomationAction({ automationId: rule.id });
    if (!result.ok) {
      toast.error("Couldn't delete that automation", result.error.message);
      return;
    }
    refresh();
    toast.undo(`Deleted “${rule.name}”`, {
      onUndo: async () => {
        const restored = await restoreAutomationAction({ automationId: rule.id });
        if (!restored.ok) toast.error("Couldn't bring it back", restored.error.message);
        refresh();
      },
    });
  };

  const duplicate = async (rule: AutomationRow) => {
    const result = await createAutomationAction({
      projectId: rule.projectId,
      name: `${rule.name} (copy)`.slice(0, 120),
      description: rule.description,
      enabled: false,
      trigger: rule.trigger,
      conditions: [...rule.conditions],
      actions: [...rule.actions],
    });
    if (!result.ok) {
      toast.error("Couldn't duplicate that automation", result.error.message);
      return;
    }
    toast.success('Copy made', 'It starts turned off so you can adjust it first.');
    refresh();
    setBuilder({ open: true, draft: draftFromRule(result.data) });
  };

  const checkNow = async () => {
    setChecking(true);
    const result = await runScheduledAutomationsAction();
    setChecking(false);
    if (!result.ok) {
      toast.error("Couldn't run the checks", result.error.message);
      return;
    }
    toast.success(
      'Checked due dates and linked records',
      result.data.checked
        ? `${result.data.checked} ${result.data.checked === 1 ? 'task was' : 'tasks were'} looked at.`
        : 'Nothing needed doing right now.',
    );
    refresh();
    void queryClient.invalidateQueries({ queryKey: ['automations', 'history'] });
  };

  const recipeList = RECIPES.filter(
    (recipe) => recipeCategory === 'All' || recipe.categories.includes(recipeCategory),
  );
  const historyRule = historyFor ? list.find((rule) => rule.id === historyFor) : undefined;

  const filterOptions = [
    { value: 'all', label: 'All rules' },
    { value: 'workspace', label: 'Rules for everywhere' },
    ...projects
      .filter((p) => !p.archivedAt)
      .map((p) => ({
        value: p.id,
        label: p.name,
        icon: <EntityIcon icon={p.icon} color={p.color} size={16} />,
      })),
    ...programs.map((p) => ({
      value: p.id,
      label: p.name,
      description: 'Program',
      icon: <EntityIcon icon={p.icon} color={p.color} size={16} />,
    })),
  ];

  return (
    <Page
      title="Automations"
      actions={
        <>
          {hasScheduled ? (
            <Tooltip content="Run due-date and CRM/WMS checks right now">
              <Button
                variant="secondary"
                leadingIcon={<RefreshCw aria-hidden className={checking ? 'animate-spin' : undefined} />}
                onClick={() => void checkNow()}
                disabled={checking}
                data-testid="automations-check-now"
              >
                Check now
              </Button>
            </Tooltip>
          ) : null}
          {canAdd ? (
            <Button leadingIcon={<Plus aria-hidden />} onClick={openNew} data-testid="automation-new">
              New automation
            </Button>
          ) : null}
        </>
      }
      tabs={
        <Tabs value={tab} onValueChange={(value) => set({ tab: value === 'rules' ? null : value })}>
          <div className="-mx-1 overflow-x-auto px-1 max-md:pr-6 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)]">
            <TabsList aria-label="Automations sections" className="min-w-max [&>button]:whitespace-nowrap">
              <TabsTrigger value="rules" count={list.length} data-testid="automations-tab-rules">
                Your automations
              </TabsTrigger>
              <TabsTrigger value="recipes" count={RECIPES.length} data-testid="automations-tab-recipes">
                Recipes
              </TabsTrigger>
              {integrations.crm || integrations.wms ? (
                <TabsTrigger value="apps" data-testid="automations-tab-apps">
                  From CRM and WMS
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="history" data-testid="automations-tab-history">
                Run history
              </TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
      }
    >
      {tab === 'rules' ? (
        projects.length === 0 && list.length === 0 ? (
          <EmptyState
            illustration="workspace"
            title="Automations need a project to work in"
            description="Create a project first, or try the sample one."
            actions={<SampleProjectButton variant="primary" />}
          />
        ) : list.length === 0 ? (
          <div className="flex flex-col gap-6">
            <EmptyState
              visual={
                <span className="inline-flex size-16 items-center justify-center rounded-2xl bg-warning-subtle text-warning-text">
                  <Zap aria-hidden className="size-8" />
                </span>
              }
              title="No automations yet"
              description="Start with a recipe below or build your own."
              actions={
                canAdd ? (
                  <Button leadingIcon={<Plus aria-hidden />} onClick={openNew}>
                    Build my own
                  </Button>
                ) : null
              }
            />
            {canAdd ? (
              <div>
                <h2 className="mb-3 text-base font-semibold text-fg">Popular recipes</h2>
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {RECIPES.filter((r) => r.categories.includes('Popular') && !r.needs)
                    .slice(0, 3)
                    .map((recipe) => (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        connected
                        onUse={() => openRecipe(recipe)}
                      />
                    ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Turned on" value={list.filter((r) => r.enabled).length} />
              <Stat label="Turned off" value={list.filter((r) => !r.enabled).length} />
              <Stat label="Runs in the last 7 days" value={runsThisWeek.length} />
              <Stat label="Stopped with a problem" value={stoppedThisWeek} tone="danger" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search automations"
                aria-label="Search automations"
                containerClassName="w-full sm:w-64"
              />
              <Select
                value={projectFilter}
                onValueChange={(value) => set({ project: value === 'all' ? null : value })}
                options={filterOptions}
                aria-label="Project"
                className="w-full sm:w-56"
              />
              <ToggleGroup
                label="Show"
                className="[&>button]:whitespace-nowrap"
                value={stateFilter}
                onValueChange={(value) => setStateFilter(value as StateFilter)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>
            {visible.length === 0 ? (
              <EmptyState
                size="sm"
                visual={<Search aria-hidden className="size-10 text-icon" />}
                title="No automations match"
                description="Try another word or clear the filters."
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      setStateFilter('all');
                      set({ project: null });
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Automations" data-testid="automation-list">
                {visible.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    project={rule.projectId ? byId.get(rule.projectId) : undefined}
                    lastRun={lastRunByRule.get(rule.id)}
                    canEdit={canEditRule(rule)}
                    onToggle={(enabled) => void toggle(rule, enabled)}
                    onEdit={() => openEdit(rule)}
                    onDuplicate={() => void duplicate(rule)}
                    onHistory={() => setHistoryFor(rule.id)}
                    onDelete={() => void remove(rule)}
                  />
                ))}
              </ul>
            )}
          </div>
        )
      ) : null}

      {tab === 'recipes' ? (
        <div className="flex flex-col gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <ToggleGroup
              label="Recipe category"
              className="min-w-max [&>button]:whitespace-nowrap"
              value={recipeCategory}
              onValueChange={(value) => setRecipeCategory(value as RecipeCategory | 'All')}
              options={[...RECIPE_CATEGORIES, 'All' as const].map((category) => ({
                value: category,
                label: category,
              }))}
            />
          </div>
          {!canAdd ? (
            <p className="text-sm text-fg-muted">
              You need edit access to a project to add automations. You can still look around.
            </p>
          ) : null}
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="recipe-gallery">
            {recipeList.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                connected={!recipe.needs || integrations[recipe.needs]}
                onUse={() =>
                  canAdd
                    ? openRecipe(recipe)
                    : toast.info(
                        'Ask a project owner',
                        'You need edit access to a project to add automations.',
                      )
                }
              />
            ))}
            {canAdd ? (
              <li className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong p-6 text-center">
                <p className="font-semibold text-fg">Something else in mind?</p>
                <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={openNew}>
                  Build my own
                </Button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {tab === 'apps' ? <RecordRecipes /> : null}

      {tab === 'history' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              label="Result"
              value={runFilter}
              onValueChange={(value) => setRunFilter(value as RunFilter)}
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'success', label: 'Worked' },
                { value: 'failed', label: 'Stopped' },
              ]}
            />
            <p className="text-xs text-fg-muted">Newest first · refreshes on its own</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs">
            <RunHistoryList
              runs={runs.data ?? []}
              loading={runs.isLoading}
              onOpenRule={(id) => setHistoryFor(id)}
            />
          </div>
        </div>
      ) : null}

      <AutomationBuilder
        open={builder.open}
        onOpenChange={(open) => setBuilder((current) => ({ ...current, open }))}
        initial={builder.draft}
        recipeName={builder.recipeName}
        projects={projects}
        programIds={editablePrograms.map((program) => program.id)}
        canManageGlobal={canManageGlobal}
        onSaved={(rule, created) => {
          toast.success(
            created ? 'Automation created' : 'Automation saved',
            created
              ? rule.enabled
                ? `“${rule.name}” is on and ready.`
                : `“${rule.name}” is saved but turned off.`
              : rule.name,
          );
          if (created && tab !== 'rules') set({ tab: null });
          refresh();
        }}
      />

      <Sheet open={Boolean(historyRule)} onOpenChange={(open) => !open && setHistoryFor(null)}>
        {historyRule ? (
          <SheetContent
            width={560}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            title={historyRule.name}
            description={historyRule.sentence}
            actions={
              canEditRule(historyRule) ? (
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Pencil aria-hidden />}
                  onClick={() => {
                    setHistoryFor(null);
                    openEdit(historyRule);
                  }}
                >
                  Edit
                </Button>
              ) : null
            }
          >
            <RuleHistory rule={historyRule} />
          </SheetContent>
        ) : null}
      </Sheet>
    </Page>
  );
}

function RuleHistory({ rule }: { readonly rule: AutomationRow }) {
  const runs = useRunHistory(rule.id, 'all');
  const trigger = triggerOption(rule.trigger.type);
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 border-b border-border-subtle px-6 py-4">
        <div>
          <p className="text-xs text-fg-muted">Runs so far</p>
          <p className="text-xl font-semibold text-fg tabular-nums">{rule.runCount}</p>
        </div>
        <div>
          <p className="text-xs text-fg-muted">Starts when</p>
          <p className="text-sm font-medium text-fg">
            {trigger.label.charAt(0).toUpperCase() + trigger.label.slice(1)}
          </p>
        </div>
      </div>
      <RunHistoryList
        runs={runs.data ?? []}
        loading={runs.isLoading}
        showRuleName={false}
        emptyHint="This automation hasn’t done anything yet. It runs the next time its trigger happens."
      />
    </div>
  );
}
